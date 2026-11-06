import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { PaymentEvent, PaymentProvider } from "./providers";
import { recordPayment } from "./record";

export type SettleResult = "paid" | "already_paid" | "pending" | "failed" | "mismatch" | "unknown" | "error";

/**
 * Applies a payment's verified state (from a webhook, the owner coming back
 * from checkout, or the daily reconciliation) to the pending payment it
 * belongs to. Money is only credited when the provider confirms it and the
 * amount and currency are exactly what was asked for. Safe to repeat.
 */
export async function settleProviderPayment(
  provider: PaymentProvider,
  event: PaymentEvent,
): Promise<{ result: SettleResult; restaurantId?: string; paidUntil?: Date | null; referrerId?: string | null }> {
  const db = createAdminClient();
  const { data: payment } = await db
    .from("payments")
    .select("id, restaurant_id, kind, plan, billing_interval, amount_ugx, status")
    .eq("provider", provider.id)
    .eq("provider_ref", event.providerRef)
    .maybeSingle();
  if (!payment) {
    console.error("[payments] notification for an unknown payment", { provider: provider.id });
    return { result: "unknown" };
  }
  const restaurantId = payment.restaurant_id;
  if (payment.status === "succeeded") return { result: "already_paid", restaurantId };
  if (event.status === "pending") return { result: "pending", restaurantId };
  if (event.status === "failed") {
    await db.from("payments").update({ status: "failed", raw: event.raw as Json }).eq("id", payment.id).eq("status", "pending");
    return { result: "failed", restaurantId };
  }
  if (event.currency !== "UGX" || event.amountUgx !== payment.amount_ugx) {
    console.error("[payments] confirmed amount does not match", { provider: provider.id, expected: payment.amount_ugx, got: event.amountUgx, currency: event.currency });
    await db.from("audit_log").insert({
      restaurant_id: restaurantId,
      action: "payment.amount_mismatch",
      details: { payment_id: payment.id, expected: payment.amount_ugx, received: event.amountUgx, currency: event.currency },
    });
    return { result: "mismatch", restaurantId };
  }

  const recorded = await recordPayment({
    restaurantId,
    kind: payment.kind as "subscription" | "setup_fee" | "other",
    amountUgx: payment.amount_ugx,
    method: event.method,
    provider: provider.id,
    providerRef: event.providerRef,
    transactionId: event.transactionId,
    paidAt: event.paidAt,
    raw: event.raw as Json,
    plan: (payment.plan ?? undefined) as "standard" | "pro" | undefined,
    interval: (payment.billing_interval ?? undefined) as "month" | "year" | undefined,
  });
  if (!recorded.ok) {
    if (recorded.code === "duplicate_transaction") return { result: "already_paid", restaurantId };
    console.error("[payments] could not record a confirmed payment", { code: recorded.code });
    return { result: "error", restaurantId };
  }
  return {
    result: recorded.duplicate ? "already_paid" : "paid",
    restaurantId,
    paidUntil: recorded.paidUntil,
    referrerId: recorded.rewardedReferrerId,
  };
}

/**
 * Daily: asks the provider about payments still pending (a missed webhook,
 * an owner who closed the page), and gives up on ones older than a week.
 */
export async function reconcilePendingPayments(provider: PaymentProvider, now = new Date()): Promise<{ checked: number; paid: string[] }> {
  if (!provider.collects) return { checked: 0, paid: [] };
  const db = createAdminClient();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const halfHourAgo = new Date(now.getTime() - 30 * 60_000).toISOString();
  await db.from("payments").update({ status: "failed" }).eq("provider", provider.id).eq("status", "pending").lt("created_at", weekAgo);
  const { data: pending } = await db
    .from("payments")
    .select("provider_ref")
    .eq("provider", provider.id)
    .eq("status", "pending")
    .lt("created_at", halfHourAgo)
    .not("provider_ref", "is", null)
    .limit(200);
  const paid: string[] = [];
  for (const p of pending ?? []) {
    try {
      const event = await provider.checkStatus(p.provider_ref!);
      if (!event) continue;
      const settled = await settleProviderPayment(provider, event);
      if (settled.result === "paid" && settled.restaurantId) paid.push(settled.restaurantId, ...(settled.referrerId ? [settled.referrerId] : []));
    } catch (error) {
      console.error("[payments] reconciliation check failed", { message: (error as Error).message });
    }
  }
  return { checked: pending?.length ?? 0, paid };
}
