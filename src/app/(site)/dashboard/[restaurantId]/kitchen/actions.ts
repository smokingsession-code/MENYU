"use server";

import { requireRestaurantAccess } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["new", "cooking", "ready", "done", "cancelled"]);

/** Moves a kitchen order along (or back). Owners and staff; row-level security checks the branch and plan. */
export async function setOrderStatusAction(restaurantId: string, orderId: string, status: string): Promise<{ ok: boolean; error?: string }> {
  await requireRestaurantAccess(restaurantId);
  if (!UUID.test(orderId) || !STATUSES.has(status)) return { ok: false, error: t("kitchen.failed") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .eq("restaurant_id", restaurantId)
    .eq("mode", "kitchen")
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("[kitchen] status update failed", { message: error.message });
    return { ok: false, error: t("kitchen.failed") };
  }
  return { ok: true };
}
