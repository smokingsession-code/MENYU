"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRestaurantAccess } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { expireMenu } from "@/lib/menu/expire";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

type Result = { ok: true; id?: string } | { ok: false; error: string; field?: string };

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);

const specialSchema = z
  .object({
    id: uuid.optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).optional().default(""),
    priceUgx: z.number().int().min(0).max(100_000_000).nullable(),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    allDay: z.boolean(),
    start: time,
    end: time,
    startsOn: date,
    endsOn: date,
    isActive: z.boolean(),
    itemIds: z.array(uuid).max(20),
  })
  .refine((s) => !s.startsOn || !s.endsOn || s.endsOn >= s.startsOn, { message: "dates", path: ["endsOn"] });

export type SpecialInput = z.input<typeof specialSchema>;

const fieldErrors: Record<string, string> = {
  title: t("specials.errors.title"),
  days: t("specials.errors.days"),
  start: t("specials.errors.time"),
  end: t("specials.errors.time"),
  priceUgx: t("specials.errors.price"),
  endsOn: t("specials.errors.dates"),
  startsOn: t("specials.errors.dates"),
};

function done(restaurantId: string, result: Result): Result {
  expireMenu(restaurantId);
  refresh();
  return result;
}

export async function saveSpecialAction(restaurantId: string, input: SpecialInput): Promise<Result> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const parsed = specialSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { ok: false, error: fieldErrors[field] ?? t("specials.errors.failed"), field };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_special", {
    p: {
      id: v.id ?? null,
      restaurant_id: restaurantId,
      title: v.title,
      description: v.description,
      price_ugx: v.priceUgx,
      days: v.days,
      start_time: v.allDay ? "00:00" : v.start,
      end_time: v.allDay ? "00:00" : v.end,
      starts_on: v.startsOn || null,
      ends_on: v.endsOn || null,
      is_active: v.isActive,
      item_ids: v.itemIds,
    },
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: t("editor.errors.notAllowed") };
    console.error("[specials] save failed", { code: error.code, message: error.message });
    return { ok: false, error: t("specials.errors.failed") };
  }
  return done(restaurantId, { ok: true, id: data as string });
}

export async function setSpecialActiveAction(restaurantId: string, specialId: string, active: boolean): Promise<Result> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  if (!uuid.safeParse(specialId).success) return { ok: false, error: t("specials.errors.failed") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("specials")
    .update({ is_active: active })
    .eq("id", specialId)
    .eq("restaurant_id", restaurantId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: error?.code === "42501" ? t("editor.errors.notAllowed") : t("specials.errors.failed") };
  return done(restaurantId, { ok: true });
}

export async function deleteSpecialAction(restaurantId: string, specialId: string): Promise<Result> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  if (!uuid.safeParse(specialId).success) return { ok: false, error: t("specials.errors.failed") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("specials")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", specialId)
    .eq("restaurant_id", restaurantId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: t("specials.errors.failed") };
  return done(restaurantId, { ok: true });
}
