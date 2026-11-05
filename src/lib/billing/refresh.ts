import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeStatus } from "./status";

export interface StatusChange {
  restaurantId: string;
  from: string;
  to: string;
}

/**
 * Moves every subscription to the status its dates call for: trials and
 * paid periods that ended become overdue, and overdue ones past their grace
 * days move to Free. Run by the daily billing job (and on demand from the
 * admin billing page). Callers expire the changed restaurants' menus.
 */
export async function refreshBillingStatuses(now = new Date()): Promise<{ checked: number; changed: StatusChange[] }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("subscriptions")
    .select("restaurant_id, plan, status, billing_interval, trial_ends_at, paid_until, grace_days")
    .in("status", ["trial", "active", "overdue"]);
  if (error) throw new Error(`Could not read subscriptions: ${error.message}`);

  const changed: StatusChange[] = [];
  for (const sub of data ?? []) {
    const next = computeStatus(sub, now);
    if (next === sub.status) continue;
    const { data: applied, error: applyError } = await db.rpc("apply_billing_status", {
      p_restaurant_id: sub.restaurant_id,
      p_from: sub.status,
      p_to: next,
    });
    if (applyError) {
      console.error("[billing] status change failed", { restaurantId: sub.restaurant_id, message: applyError.message });
      continue;
    }
    if (applied) changed.push({ restaurantId: sub.restaurant_id, from: sub.status, to: next });
  }
  return { checked: data?.length ?? 0, changed };
}
