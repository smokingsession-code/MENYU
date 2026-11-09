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
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const dealSchema = z.object({
  itemId: uuid,
  percent: z.number().int().min(5).max(90),
  endsAt: z.string().datetime(),
  note: z.string().trim().max(120),
  noteLg: z.string().trim().max(120),
});

export type DealInput = z.input<typeof dealSchema>;
export type DealResult = { ok: true } | { ok: false; field?: keyof DealInput; error: string };

/** "Sell it today": a discount on one dish at this branch until a time today. */
export async function startDealAction(restaurantId: string, branchId: string, input: DealInput): Promise<DealResult> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0] as keyof DealInput | undefined;
    const error = field === "itemId" ? t("deals.errors.dish") : field === "percent" ? t("deals.errors.percent") : field === "endsAt" ? t("deals.errors.time") : t("deals.errors.failed");
    return { ok: false, field, error };
  }
  const ctx = await getDashboardContext(restaurantId, branchId);
  if (!ctx.canEditMenu || !planHas(ctx.plan, "specials") || ctx.branch.id !== branchId) return { ok: false, error: t("deals.errors.failed") };

  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_deal", {
    p_restaurant_id: restaurantId,
    p_branch_id: branchId,
    p_item_id: v.itemId,
    p_percent: v.percent,
    p_ends_at: v.endsAt,
    p_note: v.note || undefined,
    p_note_lg: v.noteLg || undefined,
  });
  if (error) {
    if (error.message === "ends_at") return { ok: false, field: "endsAt", error: t("deals.errors.time") };
    if (error.message === "not_found") return { ok: false, field: "itemId", error: t("deals.errors.dish") };
    console.error("[deals] start_deal failed", { message: error.message });
    return { ok: false, error: t("deals.errors.failed") };
  }
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}

export async function endDealAction(restaurantId: string, dealId: string): Promise<DealResult> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  if (!uuid.safeParse(dealId).success) return { ok: false, error: t("deals.errors.failed") };
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ ends_at: new Date().toISOString() })
    .eq("id", dealId)
    .eq("restaurant_id", restaurantId)
    .gt("ends_at", new Date().toISOString());
  if (error) {
    console.error("[deals] end failed", { message: error.message });
    return { ok: false, error: t("deals.errors.failed") };
  }
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}
