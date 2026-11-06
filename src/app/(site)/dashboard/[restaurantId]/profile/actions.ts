"use server";

import { refresh } from "next/cache";
import { requireRestaurantAccess } from "@/lib/auth";
import { normaliseHours } from "@/lib/hours";
import { getTranslator } from "@/lib/i18n";
import { expireMenu } from "@/lib/menu/expire";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export interface ProfileInput {
  name: string;
  description: string;
  descriptionLg: string;
  brandColor: string;
  cuisines: string[];
  priceRange: number | null;
  area: string;
  address: string;
  lat: number | null;
  lng: number | null;
  whatsapp: string;
  phone: string;
  hours: unknown;
  acceptsDineIn: boolean;
  acceptsTakeaway: boolean;
  acceptsDelivery: boolean;
  deliveryNote: string;
  momoMtnCode: string;
  momoMtnName: string;
  momoAirtelCode: string;
  momoAirtelName: string;
}

export type ProfileResult = { ok: true } | { ok: false; field?: keyof ProfileInput; error: string };

const clip = (value: string, max: number) => value.trim().slice(0, max) || null;

export async function saveProfileAction(restaurantId: string, branchId: string, input: ProfileInput): Promise<ProfileResult> {
  await requireRestaurantAccess(restaurantId, ["owner"]);

  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) return { ok: false, field: "name", error: t("profile.errors.name") };
  if (!/^#[0-9a-f]{6}$/i.test(input.brandColor)) return { ok: false, field: "brandColor", error: t("profile.errors.color") };

  const whatsapp = input.whatsapp.trim() ? normalizePhone(input.whatsapp) : null;
  if (input.whatsapp.trim() && !whatsapp) return { ok: false, field: "whatsapp", error: t("profile.errors.whatsapp") };
  const phone = input.phone.trim() ? normalizePhone(input.phone) : null;
  if (input.phone.trim() && !phone) return { ok: false, field: "phone", error: t("profile.errors.phone") };

  const hours = normaliseHours(input.hours);
  if (!hours.ok) return { ok: false, field: "hours", error: t("profile.errors.hours") };

  for (const code of [input.momoMtnCode, input.momoAirtelCode]) {
    if (code.trim() && !/^\d{3,20}$/.test(code.replace(/\s/g, ""))) return { ok: false, field: "momoMtnCode", error: t("profile.errors.momo") };
  }

  const lat = input.lat !== null && Number.isFinite(input.lat) && Math.abs(input.lat) <= 90 ? input.lat : null;
  const lng = input.lng !== null && Number.isFinite(input.lng) && Math.abs(input.lng) <= 180 ? input.lng : null;
  const cuisines = [...new Set(input.cuisines.map((c) => c.trim().slice(0, 30)).filter(Boolean))].slice(0, 8);
  const priceRange = input.priceRange && input.priceRange >= 1 && input.priceRange <= 4 ? Math.round(input.priceRange) : null;

  const supabase = await createClient();
  const restaurant = await supabase
    .from("restaurants")
    .update({ name, description: clip(input.description, 500), description_lg: clip(input.descriptionLg ?? "", 500), brand_color: input.brandColor, cuisines, price_range: priceRange })
    .eq("id", restaurantId);
  if (restaurant.error) {
    console.error("[profile] restaurant update failed", restaurant.error.message);
    return { ok: false, error: restaurant.error.code === "42501" ? t("editor.errors.notAllowed") : t("common.errorGeneric") };
  }

  const branch = await supabase
    .from("branches")
    .update({
      area: clip(input.area, 80),
      address: clip(input.address, 200),
      lat: lat !== null && lng !== null ? lat : null,
      lng: lat !== null && lng !== null ? lng : null,
      whatsapp,
      phone,
      opening_hours: hours.hours,
      accepts_dine_in: input.acceptsDineIn,
      accepts_takeaway: input.acceptsTakeaway,
      accepts_delivery: input.acceptsDelivery,
      delivery_note: clip(input.deliveryNote, 200),
      momo_mtn_code: clip(input.momoMtnCode.replace(/\s/g, ""), 20),
      momo_mtn_name: clip(input.momoMtnName, 80),
      momo_airtel_code: clip(input.momoAirtelCode.replace(/\s/g, ""), 20),
      momo_airtel_name: clip(input.momoAirtelName, 80),
    })
    .eq("id", branchId)
    .eq("restaurant_id", restaurantId);
  if (branch.error) {
    console.error("[profile] branch update failed", branch.error.message);
    return { ok: false, error: branch.error.code === "42501" ? t("editor.errors.notAllowed") : t("common.errorGeneric") };
  }

  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}

/** Asks to appear in "Menus near me" (the Menyu team approves), or leaves it. */
export async function setDirectoryListingAction(restaurantId: string, listed: boolean): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_directory_listing", { p_restaurant_id: restaurantId, p_listed: listed });
  if (error) return { ok: false, error: error.code === "42501" ? t("profile.directory.freeBody") : t("common.errorGeneric") };
  expireMenu(restaurantId);
  refresh();
  return { ok: true, status: data as string };
}
