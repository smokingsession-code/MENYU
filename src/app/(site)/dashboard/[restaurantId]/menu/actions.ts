"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRestaurantAccess } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { expireMenu } from "@/lib/menu/expire";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export type ActionResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const price = z.number().int().min(0).max(100_000_000);
const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

const optionSchema = z.object({
  id: uuid.optional(),
  kind: z.enum(["size", "addon"]),
  name: z.string().trim().min(1).max(60),
  name_lg: optionalText(60),
  price_ugx: price,
});

const itemSchema = z
  .object({
    id: uuid.optional(),
    category_id: uuid,
    name: z.string().trim().min(1).max(120),
    name_lg: optionalText(120),
    description: optionalText(300),
    description_lg: optionalText(300),
    price_ugx: price.nullable(),
    tags: z.array(z.enum(["popular", "spicy", "vegetarian", "new"])).max(4),
    is_hidden: z.boolean(),
    options: z.array(optionSchema).max(30),
  })
  .refine((item) => item.price_ugx !== null || item.options.some((o) => o.kind === "size"), {
    message: "price_required",
  });

export type ItemInput = z.input<typeof itemSchema>;

function failure(error: { code?: string; message?: string } | null | undefined): ActionResult {
  if (error?.code === "42501") return { ok: false, error: t("editor.errors.notAllowed") };
  console.error("[editor] database error", { code: error?.code, message: error?.message });
  return { ok: false, error: t("common.errorGeneric") };
}

async function owner(restaurantId: string) {
  // Owners and admins edit; staff never reach these actions' writes (and
  // row-level security would refuse them anyway).
  await requireRestaurantAccess(restaurantId, ["owner"]);
  return createClient();
}

function done(restaurantId: string, result: ActionResult = { ok: true }): ActionResult {
  expireMenu(restaurantId);
  refresh();
  return result;
}

export async function saveItemAction(restaurantId: string, input: ItemInput): Promise<ActionResult> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    const priceMissing = parsed.error.issues.some((i) => i.message === "price_required");
    return { ok: false, error: priceMissing ? t("editor.errors.priceRequired") : t("editor.errors.invalid") };
  }
  const supabase = await owner(restaurantId);
  const { data, error } = await supabase.rpc("save_item", { p_item: { ...parsed.data, restaurant_id: restaurantId } });
  if (error) return failure(error);
  return done(restaurantId, { ok: true, id: data as string });
}

export async function deleteItemAction(restaurantId: string, itemId: string): Promise<ActionResult> {
  const supabase = await owner(restaurantId);
  const { error } = await supabase
    .from("items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("restaurant_id", restaurantId);
  return error ? failure(error) : done(restaurantId);
}

export async function duplicateItemAction(restaurantId: string, itemId: string): Promise<ActionResult> {
  const supabase = await owner(restaurantId);
  const { data: item } = await supabase
    .from("items")
    .select("category_id, name, name_lg, description, description_lg, price_ugx, tags, item_options(kind, name, name_lg, price_ugx, sort_order, deleted_at)")
    .eq("id", itemId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!item) return { ok: false, error: t("common.errorGeneric") };
  const { data, error } = await supabase.rpc("save_item", {
    p_item: {
      restaurant_id: restaurantId,
      category_id: item.category_id,
      name: `${item.name} (${t("editor.copySuffix")})`.slice(0, 120),
      name_lg: item.name_lg,
      description: item.description,
      description_lg: item.description_lg,
      price_ugx: item.price_ugx,
      tags: item.tags,
      // Copies start hidden so they never show up half-edited.
      is_hidden: true,
      options: item.item_options
        .filter((o) => !o.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((o) => ({ kind: o.kind, name: o.name, name_lg: o.name_lg, price_ugx: o.price_ugx })),
    },
  });
  if (error) return failure(error);
  return done(restaurantId, { ok: true, id: data as string });
}

export async function setItemHiddenAction(restaurantId: string, itemId: string, hidden: boolean): Promise<ActionResult> {
  const supabase = await owner(restaurantId);
  const { error } = await supabase.from("items").update({ is_hidden: hidden }).eq("id", itemId).eq("restaurant_id", restaurantId);
  return error ? failure(error) : done(restaurantId);
}

/** One tap from the list. Staff on Pro may do this too. */
export async function setSoldOutAction(restaurantId: string, branchId: string, itemId: string, soldOut: boolean): Promise<ActionResult> {
  await requireRestaurantAccess(restaurantId, ["owner", "staff"]);
  const supabase = await createClient();
  const { error } = soldOut
    ? await supabase.from("sold_out").upsert({ branch_id: branchId, item_id: itemId, restaurant_id: restaurantId }, { onConflict: "branch_id,item_id", ignoreDuplicates: true })
    : await supabase.from("sold_out").delete().eq("branch_id", branchId).eq("item_id", itemId);
  return error ? failure(error) : done(restaurantId);
}

export async function createCategoryAction(restaurantId: string, menuId: string, name: string): Promise<ActionResult> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return { ok: false, error: t("editor.errors.categoryName") };
  const supabase = await owner(restaurantId);
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("menu_id", menuId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("categories")
    .insert({ restaurant_id: restaurantId, menu_id: menuId, name: clean, sort_order: (last?.sort_order ?? -1) + 1 })
    .select("id")
    .single();
  if (error) return failure(error);
  return done(restaurantId, { ok: true, id: data.id });
}

export async function updateCategoryAction(
  restaurantId: string,
  categoryId: string,
  changes: { name?: string; is_hidden?: boolean },
): Promise<ActionResult> {
  const update: { name?: string; is_hidden?: boolean } = {};
  if (changes.name !== undefined) {
    const clean = changes.name.trim().slice(0, 80);
    if (!clean) return { ok: false, error: t("editor.errors.categoryName") };
    update.name = clean;
  }
  if (changes.is_hidden !== undefined) update.is_hidden = changes.is_hidden;
  const supabase = await owner(restaurantId);
  const { error } = await supabase.from("categories").update(update).eq("id", categoryId).eq("restaurant_id", restaurantId);
  return error ? failure(error) : done(restaurantId);
}

/** Soft-deletes the category and the items in it. */
export async function deleteCategoryAction(restaurantId: string, categoryId: string): Promise<ActionResult> {
  const supabase = await owner(restaurantId);
  const now = new Date().toISOString();
  const items = await supabase.from("items").update({ deleted_at: now }).eq("category_id", categoryId).eq("restaurant_id", restaurantId).is("deleted_at", null);
  if (items.error) return failure(items.error);
  const { error } = await supabase.from("categories").update({ deleted_at: now }).eq("id", categoryId).eq("restaurant_id", restaurantId);
  return error ? failure(error) : done(restaurantId);
}

export async function reorderAction(restaurantId: string, kind: "categories" | "items", ids: string[]): Promise<ActionResult> {
  if (!ids.every((id) => uuid.safeParse(id).success) || ids.length > 500) return { ok: false, error: t("editor.errors.invalid") };
  const supabase = await owner(restaurantId);
  const { error } = await supabase.rpc("reorder", { p_kind: kind, p_ids: ids });
  return error ? failure(error) : done(restaurantId);
}

export async function bulkPriceAction(
  restaurantId: string,
  categoryIds: string[] | null,
  percent: number,
  roundTo: number,
): Promise<ActionResult> {
  if (!Number.isFinite(percent) || percent < -90 || percent > 300 || percent === 0) return { ok: false, error: t("editor.errors.percent") };
  if (![1, 100, 500, 1000].includes(roundTo)) return { ok: false, error: t("editor.errors.invalid") };
  const supabase = await owner(restaurantId);
  const { data, error } = await supabase.rpc("bulk_adjust_prices", {
    p_restaurant_id: restaurantId,
    p_category_ids: categoryIds ?? (null as unknown as string[]),
    p_percent: percent,
    p_round: roundTo,
  });
  if (error) return failure(error);
  return done(restaurantId, { ok: true, count: data as number });
}
