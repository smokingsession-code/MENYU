import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { ProviderId } from "./providers/types";
import { computeStatus, nextPeriod, type BillingInterval, type BillingStatus, type SubscriptionState } from "./status";

/**
 * The one way payments enter the system: the admin recording a MoMo payment
 * by hand today, and payment-provider webhooks later. Callers check who is
 * allowed; this applies the billing rules and writes atomically.
 */

export const PAYMENT_METHODS = ["mtn_momo", "airtel_money", "cash", "bank", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_KINDS = ["subscription", "setup_fee", "other"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export interface RecordPaymentInput {
  restaurantId: string;
  kind: PaymentKind;
  amountUgx: number;
  method: PaymentMethod;
  provider?: ProviderId;
  transactionId?: string | null;
  providerRef?: string | null;
  /** "pending" for a mobile money prompt that is not approved yet. */
  status?: "succeeded" | "pending";
  paidAt: Date;
  notes?: string | null;
  actorId?: string | null;
  raw?: Json;
  /** Plan payments only. */
  plan?: "standard" | "pro";
  interval?: BillingInterval;
  periods?: number;
}

export type RecordPaymentResult =
  | { ok: true; paymentId: string; duplicate: boolean; paidUntil: Date | null; status: BillingStatus | null }
  | { ok: false; code: "not_found" | "duplicate_transaction" | "invalid" | "stale" | "failed" };

type StoredSubscription = SubscriptionState & { updated_at: string };

const SUBSCRIPTION_COLUMNS = "plan, status, billing_interval, trial_ends_at, paid_until, grace_days, updated_at";

async function readSubscription(restaurantId: string): Promise<StoredSubscription | null> {
  const { data } = await createAdminClient().from("subscriptions").select(SUBSCRIPTION_COLUMNS).eq("restaurant_id", restaurantId).maybeSingle();
  return data;
}

export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  if (!Number.isInteger(input.amountUgx) || input.amountUgx <= 0 || input.amountUgx > 100_000_000) return { ok: false, code: "invalid" };
  const isPlan = input.kind === "subscription";
  if (isPlan && (!input.plan || !input.interval)) return { ok: false, code: "invalid" };

  // Two tries: if the subscription changed between reading and writing (two
  // payments recorded at once), read it again and recompute.
  for (let attempt = 0; attempt < 2; attempt++) {
    const sub = await readSubscription(input.restaurantId);
    if (!sub) return { ok: false, code: "not_found" };
    const now = new Date();
    // The period depends on when the owner paid, not when it was recorded.
    const paidAt = input.paidAt.getTime() > now.getTime() ? now : input.paidAt;

    let period: { start: Date; end: Date } | null = null;
    let newStatus: BillingStatus | null = null;
    if (isPlan) {
      period = nextPeriod(sub, { interval: input.interval!, periods: input.periods ?? 1, now: paidAt });
      newStatus = computeStatus({ ...sub, status: "active", paid_until: period.end.toISOString() }, now);
    }

    const { data, error } = await createAdminClient().rpc("record_payment", {
      p: {
        restaurant_id: input.restaurantId,
        kind: input.kind,
        amount_ugx: input.amountUgx,
        method: input.method,
        provider: input.provider ?? "manual",
        transaction_id: input.transactionId?.trim() || null,
        provider_ref: input.providerRef ?? null,
        status: input.status ?? "succeeded",
        paid_at: paidAt.toISOString(),
        notes: input.notes ?? null,
        actor_id: input.actorId ?? null,
        raw: input.raw ?? null,
        plan: input.plan ?? null,
        billing_interval: input.interval ?? null,
        period_start: period?.start.toISOString() ?? null,
        period_end: period?.end.toISOString() ?? null,
        new_status: newStatus,
        expected_updated_at: sub.updated_at,
      },
    });
    if (error) {
      if (error.code === "40001") continue;
      if (error.code === "23505") return { ok: false, code: "duplicate_transaction" };
      if (error.code === "P0002") return { ok: false, code: "not_found" };
      if (error.code === "22023" || error.code === "23514") return { ok: false, code: "invalid" };
      console.error("[billing] record_payment failed", { code: error.code, message: error.message });
      return { ok: false, code: "failed" };
    }
    const result = data as { payment_id: string; duplicate: boolean };
    return { ok: true, paymentId: result.payment_id, duplicate: result.duplicate, paidUntil: period?.end ?? null, status: newStatus };
  }
  return { ok: false, code: "stale" };
}

/**
 * Removes a payment recorded by mistake. When it was the latest plan
 * payment, the paid-until date goes back to where it was before it.
 */
export async function removePayment(paymentId: string, actorId: string): Promise<{ ok: true; restaurantId: string } | { ok: false; code: "not_found" | "stale" | "failed" }> {
  const db = createAdminClient();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: payment } = await db
      .from("payments")
      .select("id, restaurant_id, kind, status, period_start, period_end")
      .eq("id", paymentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!payment) return { ok: false, code: "not_found" };
    const sub = await readSubscription(payment.restaurant_id);
    if (!sub) return { ok: false, code: "not_found" };

    let revert: { paid_until: string | null; status: BillingStatus; expected_updated_at: string } | undefined;
    const latest =
      payment.kind === "subscription" &&
      payment.status === "succeeded" &&
      payment.period_end !== null &&
      sub.paid_until !== null &&
      Date.parse(payment.period_end) === Date.parse(sub.paid_until);
    if (latest) {
      // Back to how things were before this payment, as its audit entry recorded.
      const { data: entry } = await db
        .from("audit_log")
        .select("details")
        .eq("action", "payment.recorded")
        .eq("restaurant_id", payment.restaurant_id)
        .contains("details", { payment_id: paymentId })
        .maybeSingle();
      const details = (entry?.details ?? {}) as { status_before?: string; paid_until_before?: string | null };
      const restored: SubscriptionState = {
        ...sub,
        status: details.status_before ?? "active",
        paid_until: details.paid_until_before ?? payment.period_start,
      };
      revert = { paid_until: restored.paid_until, status: computeStatus(restored, new Date()), expected_updated_at: sub.updated_at };
    }

    const { error } = await db.rpc("remove_payment", { p: { payment_id: paymentId, actor_id: actorId, ...(revert ? { revert } : {}) } });
    if (!error) return { ok: true, restaurantId: payment.restaurant_id };
    if (error.code === "40001") continue;
    if (error.code === "P0002") return { ok: false, code: "not_found" };
    console.error("[billing] remove_payment failed", { code: error.code, message: error.message });
    return { ok: false, code: "failed" };
  }
  return { ok: false, code: "stale" };
}

export interface SubscriptionChange {
  plan: "free" | "standard" | "pro";
  mode: "trial" | "paid" | "free";
  interval: BillingInterval;
  /** End of the trial or of the paid period; ignored on Free. */
  until: Date | null;
  graceDays: number;
}

/** The stored values for an admin's plan change, with the status the dates imply. */
export function subscriptionValues(change: SubscriptionChange, current: { trial_ends_at: string | null; paid_until: string | null }, now: Date) {
  if (change.plan === "free" || change.mode === "free") {
    return {
      plan: change.plan === "free" ? "free" : change.plan,
      status: "free" as BillingStatus,
      billing_interval: change.interval,
      trial_ends_at: current.trial_ends_at,
      paid_until: current.paid_until,
      grace_days: change.graceDays,
    };
  }
  const until = change.until?.toISOString() ?? null;
  const base: SubscriptionState =
    change.mode === "trial"
      ? { plan: change.plan, status: "trial", billing_interval: change.interval, trial_ends_at: until, paid_until: null, grace_days: change.graceDays }
      : { plan: change.plan, status: "active", billing_interval: change.interval, trial_ends_at: current.trial_ends_at, paid_until: until, grace_days: change.graceDays };
  return { ...base, status: computeStatus(base, now) };
}

export async function changeSubscription(
  restaurantId: string,
  change: SubscriptionChange,
  actorId: string,
  expectedUpdatedAt: string,
): Promise<{ ok: true; status: BillingStatus } | { ok: false; code: "not_found" | "stale" | "invalid" | "failed" }> {
  const sub = await readSubscription(restaurantId);
  if (!sub) return { ok: false, code: "not_found" };
  const values = subscriptionValues(change, sub, new Date());
  const { error } = await createAdminClient().rpc("set_subscription", {
    p: { restaurant_id: restaurantId, ...values, actor_id: actorId, expected_updated_at: expectedUpdatedAt },
  });
  if (!error) return { ok: true, status: values.status };
  if (error.code === "40001") return { ok: false, code: "stale" };
  if (error.code === "P0002") return { ok: false, code: "not_found" };
  if (error.code === "23514" || error.code === "23503" || error.code === "22023") return { ok: false, code: "invalid" };
  console.error("[billing] set_subscription failed", { code: error.code, message: error.message });
  return { ok: false, code: "failed" };
}
