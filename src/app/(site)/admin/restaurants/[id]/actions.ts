"use server";

import { requireAdmin } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getTranslator } from "@/lib/i18n";
import { formatPhoneLocal, normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/whatsapp";

export interface InviteState {
  error?: string;
  phone?: string;
  inviteUrl?: string;
  whatsappHref?: string;
}

export async function newOwnerInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  await requireAdmin();
  const t = getTranslator("en");
  const restaurantId = String(formData.get("restaurantId") ?? "");
  const rawPhone = String(formData.get("phone") ?? "");
  const phone = normalizePhone(rawPhone);
  if (!phone) return { phone: rawPhone, error: t("admin.create.errors.ownerPhone") };

  const supabase = await createClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name, branches(slug, is_main)")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!restaurant) return { phone: rawPhone, error: t("common.errorGeneric") };

  const { data, error } = await supabase.rpc("create_invitation", {
    p_restaurant_id: restaurantId,
    p_role: "owner",
    p_phone: phone,
  });
  if (error || !data) {
    console.error("[admin] create_invitation failed", { message: error?.message });
    return { phone: rawPhone, error: t("common.errorGeneric") };
  }

  const token = (data as { token: string }).token;
  const slug = restaurant.branches.find((b) => b.is_main)?.slug ?? restaurant.branches[0]?.slug;
  const inviteUrl = `${publicEnv.siteUrl}/invite/${token}`;
  const message = t("admin.inviteMessage", {
    name: "there",
    restaurant: restaurant.name,
    menuUrl: `${publicEnv.siteUrl}/r/${slug}`,
    phone: formatPhoneLocal(phone),
    inviteUrl,
  });
  return { phone: formatPhoneLocal(phone), inviteUrl, whatsappHref: waLink(phone, message) };
}
