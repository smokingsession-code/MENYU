import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeSubscription } from "./record";
import { addMonths, computeStatus, dueAt, isPaidPlan, type BillingInterval } from "./status";

/**
 * What a restaurant's first plan payment earns: its agent's flat commission
 * and, if another restaurant referred it, free months for that restaurant.
 * Safe to call more than once; the database records each reward once.
 */
export async function applyPaymentRewards(restaurantId: string, paymentId: string): Promise<{ commission: boolean; referrerId: string | null }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("payment_rewards", { p_restaurant_id: restaurantId, p_payment_id: paymentId });
  if (error) {
    console.error("[rewards] could not apply", { message: error.message });
    return { commission: false, referrerId: null };
  }
  const result = data as { commission: boolean; referral: { id: string; referrer_id: string; months: number } | null };
  if (!result.referral) return { commission: result.commission, referrerId: null };

  const given = await giveFreeMonths(result.referral.referrer_id, result.referral.months);
  if (!given) {
    // Leave it pending so the next payment (or a retry) can reward it.
    await db.rpc("unclaim_referral", { p_referral_id: result.referral.id });
    return { commission: result.commission, referrerId: null };
  }
  await db.from("audit_log").insert({
    restaurant_id: result.referral.referrer_id,
    action: "referral.rewarded",
    details: { referral_id: result.referral.id, referred_id: restaurantId, months: result.referral.months },
  });
  return { commission: result.commission, referrerId: result.referral.referrer_id };
}

/**
 * Free months on top of what the referrer has: a trial gets longer, a paid
 * period ends later, and a restaurant on Free gets the months on Standard
 * from today.
 */
export async function giveFreeMonths(restaurantId: string, months: number): Promise<boolean> {
  const db = createAdminClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: sub } = await db
      .from("subscriptions")
      .select("plan, status, billing_interval, trial_ends_at, paid_until, grace_days, updated_at")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!sub) return false;
    const now = new Date();
    const status = computeStatus(sub, now);
    const plan = isPaidPlan(sub.plan) ? sub.plan : "standard";
    const interval: BillingInterval = sub.billing_interval === "year" && plan === "standard" ? "year" : "month";
    const due = dueAt(sub);
    const change =
      status === "trial"
        ? { plan, mode: "trial" as const, interval, until: addMonths(due ?? now, months), graceDays: sub.grace_days }
        : {
            plan,
            mode: "paid" as const,
            interval,
            until: addMonths(status === "free" || !due ? now : due, months),
            graceDays: sub.grace_days,
          };
    const result = await changeSubscription(restaurantId, change, null, sub.updated_at);
    if (result.ok) return true;
    if (result.code !== "stale") return false;
  }
  return false;
}
