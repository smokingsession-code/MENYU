import { timingSafeEqual } from "node:crypto";
import { activeProvider } from "@/lib/billing/providers";
import { refreshBillingStatuses } from "@/lib/billing/refresh";
import { reconcilePendingPayments } from "@/lib/billing/settle";
import { expireMenu } from "@/lib/menu/expire";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";

/**
 * The daily billing job (vercel.json runs it every morning, Kampala time).
 * Vercel Cron sends CRON_SECRET as a bearer token; anything else gets 401.
 */
function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  // First catch up on online payments whose notification never arrived.
  const reconciled = await reconcilePendingPayments(activeProvider());
  for (const restaurantId of reconciled.paid) expireMenu(restaurantId, "background");

  const result = await refreshBillingStatuses(new Date());
  // Restaurants that changed plan show a different menu (footer, 30 dishes).
  for (const change of result.changed) expireMenu(change.restaurantId, "background");
  const { data: pruned } = await createAdminClient().rpc("prune_rate_limits");

  console.info("[cron] billing", { checked: result.checked, changed: result.changed.length, pending: reconciled.checked, pruned });
  return Response.json({
    checked: result.checked,
    changed: result.changed,
    pendingPaymentsChecked: reconciled.checked,
    prunedRateLimits: pruned ?? 0,
  });
}
