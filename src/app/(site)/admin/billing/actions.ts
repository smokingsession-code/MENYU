"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { changeSubscription, PAYMENT_KINDS, PAYMENT_METHODS, recordPayment, removePayment } from "@/lib/billing/record";
import { refreshBillingStatuses } from "@/lib/billing/refresh";
import { fromDateInput } from "@/lib/dates";
import { getTranslator } from "@/lib/i18n";
import { expireMenu } from "@/lib/menu/expire";
import { normalizePhone } from "@/lib/phone";
import { saveBillingSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const t = getTranslator("en");

type Fail = { ok: false; error: string; field?: string };

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const failure: Record<string, string> = {
  duplicate_transaction: t("admin.errors.duplicateTransaction"),
  stale: t("admin.errors.stale"),
  invalid: t("admin.errors.billingInvalid"),
  not_found: t("admin.errors.billingFailed"),
  failed: t("admin.errors.billingFailed"),
};

const paymentSchema = z
  .object({
    kind: z.enum(PAYMENT_KINDS),
    plan: z.enum(["standard", "pro"]).optional(),
    interval: z.enum(["month", "year"]).optional(),
    periods: z.number().int().min(1).max(12).optional(),
    amountUgx: z.number().int().min(1).max(100_000_000),
    method: z.enum(PAYMENT_METHODS),
    transactionId: z.string().trim().max(80).optional().default(""),
    paidOn: z.string(),
    notes: z.string().trim().max(500).optional().default(""),
  })
  .refine((p) => p.kind !== "subscription" || (p.plan && p.interval && p.periods), { message: "plan" })
  .refine((p) => !(p.plan === "pro" && p.interval === "year"), { message: "plan" });

export type PaymentFormInput = z.input<typeof paymentSchema>;

export async function recordPaymentAction(
  restaurantId: string,
  input: PaymentFormInput,
): Promise<{ ok: true; paidUntil: string | null } | Fail> {
  const admin = await requireAdmin();
  if (!uuid.safeParse(restaurantId).success) return { ok: false, error: failure.invalid };
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, error: field === "amountUgx" ? t("admin.errors.amount") : failure.invalid, field: typeof field === "string" ? field : undefined };
  }
  const p = parsed.data;
  const paidAt = fromDateInput(p.paidOn, "midday");
  if (!paidAt) return { ok: false, error: t("admin.errors.date"), field: "paidOn" };

  const result = await recordPayment({
    restaurantId,
    kind: p.kind,
    amountUgx: p.amountUgx,
    method: p.method,
    transactionId: p.transactionId || null,
    paidAt,
    notes: p.notes || null,
    actorId: admin.id,
    ...(p.kind === "subscription" ? { plan: p.plan, interval: p.interval, periods: p.periods } : {}),
  });
  if (!result.ok) return { ok: false, error: failure[result.code] ?? failure.failed, field: result.code === "duplicate_transaction" ? "transactionId" : undefined };

  expireMenu(restaurantId);
  refresh();
  return { ok: true, paidUntil: result.paidUntil?.toISOString() ?? null };
}

export async function removePaymentAction(paymentId: string): Promise<{ ok: true } | Fail> {
  const admin = await requireAdmin();
  if (!uuid.safeParse(paymentId).success) return { ok: false, error: failure.invalid };
  const result = await removePayment(paymentId, admin.id);
  if (!result.ok) return { ok: false, error: failure[result.code] ?? failure.failed };
  expireMenu(result.restaurantId);
  refresh();
  return { ok: true };
}

const planSchema = z.object({
  plan: z.enum(["free", "standard", "pro"]),
  mode: z.enum(["trial", "paid", "free"]),
  interval: z.enum(["month", "year"]),
  until: z.string(),
  graceDays: z.number().int().min(0).max(90),
  expectedUpdatedAt: z.string().min(1),
});

export type PlanFormInput = z.input<typeof planSchema>;

export async function changePlanAction(restaurantId: string, input: PlanFormInput): Promise<{ ok: true } | Fail> {
  const admin = await requireAdmin();
  if (!uuid.safeParse(restaurantId).success) return { ok: false, error: failure.invalid };
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, error: field === "graceDays" ? t("admin.errors.graceDays") : failure.invalid, field: typeof field === "string" ? field : undefined };
  }
  const p = parsed.data;
  const free = p.plan === "free" || p.mode === "free";
  const until = free ? null : fromDateInput(p.until, "end");
  if (!free && !until) return { ok: false, error: t("admin.errors.date"), field: "until" };
  const interval = p.plan === "pro" ? "month" : p.interval;

  const result = await changeSubscription(restaurantId, { plan: p.plan, mode: free ? "free" : p.mode, interval, until, graceDays: p.graceDays }, admin.id, p.expectedUpdatedAt);
  if (!result.ok) return { ok: false, error: failure[result.code] ?? failure.failed };
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}

/** The reminder itself is sent from the admin's WhatsApp; this notes when. */
export async function markRemindedAction(restaurantId: string): Promise<{ ok: true } | Fail> {
  const admin = await requireAdmin();
  if (!uuid.safeParse(restaurantId).success) return { ok: false, error: failure.invalid };
  const db = createAdminClient();
  const { error } = await db.from("subscriptions").update({ last_reminder_at: new Date().toISOString() }).eq("restaurant_id", restaurantId);
  if (error) return { ok: false, error: failure.failed };
  await db.from("audit_log").insert({ actor_id: admin.id, restaurant_id: restaurantId, action: "billing.reminder_sent", details: {} });
  refresh();
  return { ok: true };
}

export async function runBillingCheckAction(): Promise<{ ok: true; changed: number } | Fail> {
  await requireAdmin();
  const result = await refreshBillingStatuses(new Date());
  for (const change of result.changed) expireMenu(change.restaurantId);
  refresh();
  return { ok: true, changed: result.changed.length };
}

const settingsSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
  graceDays: z.number().int().min(0).max(90),
  mtnCode: z.string().trim().max(20).regex(/^\d*$/),
  mtnName: z.string().trim().max(80),
  airtelCode: z.string().trim().max(20).regex(/^\d*$/),
  airtelName: z.string().trim().max(80),
  supportWhatsapp: z.string().trim().max(30),
});

export type SettingsFormInput = z.input<typeof settingsSchema>;

export async function saveSettingsAction(input: SettingsFormInput): Promise<{ ok: true } | Fail> {
  const admin = await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const error =
      field === "trialDays"
        ? t("admin.errors.trialDays")
        : field === "graceDays"
          ? t("admin.errors.graceDays")
          : field === "mtnCode" || field === "airtelCode"
            ? t("admin.errors.code")
            : failure.invalid;
    return { ok: false, error, field };
  }
  const s = parsed.data;
  const phone = s.supportWhatsapp ? normalizePhone(s.supportWhatsapp) : "";
  if (phone === null) return { ok: false, error: t("admin.errors.phone"), field: "supportWhatsapp" };

  const saved = await saveBillingSettings(
    {
      trialDays: s.trialDays,
      graceDays: s.graceDays,
      momo: { mtn_code: s.mtnCode, mtn_name: s.mtnName, airtel_code: s.airtelCode, airtel_name: s.airtelName },
      supportWhatsapp: phone,
    },
    admin.id,
  );
  if (!saved) return { ok: false, error: failure.failed };
  refresh();
  return { ok: true };
}
