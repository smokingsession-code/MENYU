"use server";

import { randomUUID } from "node:crypto";
import { PLANS } from "@/config/plans";
import { requireRestaurantAccess } from "@/lib/auth";
import { activeProvider } from "@/lib/billing/providers";
import { recordPayment } from "@/lib/billing/record";
import { billingSummary, isPaidPlan } from "@/lib/billing/status";
import { getDashboardContext } from "@/lib/dashboard";
import { publicEnv } from "@/lib/env";
import { getTranslator } from "@/lib/i18n";
import { rateLimit } from "@/lib/rate-limit";

const t = getTranslator("en");

/**
 * Starts an online payment for the next period: creates the order with the
 * provider, records it as pending, and returns the checkout page to open.
 * The plan only changes once the provider confirms the payment.
 */
export async function startOnlinePaymentAction(restaurantId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { user } = await requireRestaurantAccess(restaurantId, ["owner"]);
  const provider = activeProvider();
  if (!provider.collects) return { ok: false, error: t("billing.payStartFailed") };
  const ctx = await getDashboardContext(restaurantId);
  if (!ctx.subscription) return { ok: false, error: t("billing.payStartFailed") };
  const summary = billingSummary(ctx.subscription, new Date(), ctx.branches.length);
  if (!summary.amountUgx || !isPaidPlan(summary.plan)) return { ok: false, error: t("billing.payStartFailed") };
  if (!(await rateLimit(`pay:${restaurantId}`, 10, 3600))) return { ok: false, error: t("auth.errors.tooMany") };

  // Pro is monthly only.
  const interval = summary.plan === "pro" ? "month" : summary.interval;
  const reference = `mny-${randomUUID()}`;
  const started = await provider.startCollection({
    restaurantId,
    amountUgx: summary.amountUgx,
    phone: user.phone ?? ctx.branch.whatsapp ?? "",
    reference,
    description: t("billing.payDescription", { plan: PLANS[summary.plan].name, restaurant: ctx.name }),
    callbackUrl: `${publicEnv.siteUrl}/api/payments/${provider.id}/return?rid=${restaurantId}`,
  });
  if (!started.ok || !started.redirectUrl) return { ok: false, error: t("billing.payStartFailed") };

  const pending = await recordPayment({
    restaurantId,
    kind: "subscription",
    plan: summary.plan,
    interval,
    periods: 1,
    amountUgx: summary.amountUgx,
    method: "other",
    provider: provider.id,
    providerRef: started.providerRef,
    status: "pending",
    paidAt: new Date(),
    actorId: user.id,
    raw: { reference },
  });
  if (!pending.ok) return { ok: false, error: t("billing.payStartFailed") };
  return { ok: true, url: started.redirectUrl };
}
