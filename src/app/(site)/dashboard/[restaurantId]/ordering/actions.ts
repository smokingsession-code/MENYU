"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { planHas } from "@/config/plans";
import { requireRestaurantAccess } from "@/lib/auth";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator } from "@/lib/i18n";
import { expireMenu } from "@/lib/menu/expire";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

const schema = z.object({
  mode: z.enum(["waiter", "whatsapp", "kitchen"]),
  acceptsCash: z.boolean(),
  loyaltyEnabled: z.boolean(),
  loyaltyVisits: z.number().int().min(2).max(20),
  loyaltyReward: z.string().trim().max(80),
  loyaltyRewardLg: z.string().trim().max(80),
  loyaltyMinUgx: z.number().int().min(0).max(10_000_000),
});

export type OrderingInput = z.input<typeof schema>;
export type OrderingResult = { ok: true } | { ok: false; field?: keyof OrderingInput; error: string };

/** How a branch takes orders and payment, and the restaurant's loyalty stamps. */
export async function saveOrderingAction(restaurantId: string, branchId: string, input: OrderingInput): Promise<OrderingResult> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0] as keyof OrderingInput | undefined;
    const error =
      field === "loyaltyVisits" ? t("ordering.errors.visits") : field === "loyaltyMinUgx" ? t("ordering.errors.min") : t("ordering.errors.failed");
    return { ok: false, field, error };
  }
  const v = parsed.data;
  const ctx = await getDashboardContext(restaurantId, branchId);
  if (!ctx.canManage || ctx.branch.id !== branchId) return { ok: false, error: t("ordering.errors.failed") };
  if ((v.mode === "kitchen" && !planHas(ctx.plan, "kitchen")) || (v.mode === "whatsapp" && !ctx.branch.whatsapp)) {
    return { ok: false, field: "mode", error: t("ordering.errors.mode") };
  }
  const loyalty = planHas(ctx.plan, "loyalty");
  if (loyalty && v.loyaltyEnabled && !v.loyaltyReward) return { ok: false, field: "loyaltyReward", error: t("ordering.errors.reward") };

  const supabase = await createClient();
  const { error: branchError } = await supabase
    .from("branches")
    .update({ order_mode: v.mode, accepts_cash: v.acceptsCash })
    .eq("id", branchId)
    .eq("restaurant_id", restaurantId);
  if (branchError) {
    console.error("[ordering] branch update failed", { message: branchError.message });
    return { ok: false, error: t("ordering.errors.failed") };
  }
  if (loyalty) {
    const { error } = await supabase
      .from("restaurants")
      .update({
        loyalty_enabled: v.loyaltyEnabled,
        loyalty_visits: v.loyaltyVisits,
        loyalty_reward: v.loyaltyReward || null,
        loyalty_reward_lg: v.loyaltyRewardLg || null,
        loyalty_min_ugx: v.loyaltyMinUgx,
      })
      .eq("id", restaurantId);
    if (error) {
      console.error("[ordering] loyalty update failed", { message: error.message });
      return { ok: false, error: t("ordering.errors.failed") };
    }
  }
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}
