"use server";

import { requireAdmin } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getTranslator } from "@/lib/i18n";
import { formatPhoneLocal, normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/whatsapp";

const FIELDS = ["name", "area", "whatsapp", "ownerName", "ownerPhone", "ownerEmail", "trialDays", "agentCode"] as const;
type FieldName = (typeof FIELDS)[number];

export interface CreatedRestaurant {
  restaurantId: string;
  restaurantName: string;
  menuUrl: string;
  inviteUrl: string | null;
  whatsappHref: string | null;
}

export interface CreateRestaurantState {
  values?: Partial<Record<FieldName, string>>;
  errors?: Partial<Record<FieldName, string>>;
  formError?: string;
  created?: CreatedRestaurant;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function createRestaurantAction(
  _prev: CreateRestaurantState,
  formData: FormData,
): Promise<CreateRestaurantState> {
  await requireAdmin();
  const t = getTranslator("en");

  const values = Object.fromEntries(
    FIELDS.map((f) => [f, String(formData.get(f) ?? "").trim()]),
  ) as Record<FieldName, string>;
  const errors: Partial<Record<FieldName, string>> = {};

  if (values.name.length < 2 || values.name.length > 120) errors.name = t("admin.create.errors.name");
  if (!values.area || values.area.length > 80) errors.area = t("admin.create.errors.area");

  const whatsapp = normalizePhone(values.whatsapp);
  if (!whatsapp) errors.whatsapp = t("admin.create.errors.whatsapp");

  let ownerPhone: string | null = null;
  if (values.ownerPhone) {
    ownerPhone = normalizePhone(values.ownerPhone);
    if (!ownerPhone) errors.ownerPhone = t("admin.create.errors.ownerPhone");
  }
  const ownerEmail = values.ownerEmail.toLowerCase() || null;
  if (ownerEmail && (!EMAIL.test(ownerEmail) || ownerEmail.length > 254)) errors.ownerEmail = t("admin.create.errors.ownerEmail");
  // Most owners use the restaurant's WhatsApp number themselves.
  if (!ownerPhone && !ownerEmail && whatsapp) ownerPhone = whatsapp;

  const trialDays = values.trialDays === "" ? null : Number(values.trialDays);
  if (trialDays !== null && (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365)) {
    errors.trialDays = t("admin.create.errors.trialDays");
  }
  const agentCode = values.agentCode.toUpperCase() || null;
  if (agentCode && !/^[A-Z0-9]{3,12}$/.test(agentCode)) errors.agentCode = t("admin.create.errors.agentCode");

  if (Object.keys(errors).length > 0) return { values, errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_restaurant", {
    p_name: values.name,
    p_area: values.area,
    p_whatsapp: whatsapp!,
    p_owner_phone: ownerPhone ?? undefined,
    p_owner_email: ownerEmail ?? undefined,
    p_trial_days: trialDays ?? undefined,
    p_agent_code: agentCode ?? undefined,
  });

  if (error) {
    if (error.message.includes("unknown_agent_code")) return { values, errors: { agentCode: t("admin.create.errors.agentCode") } };
    if (error.message.includes("invalid_whatsapp")) return { values, errors: { whatsapp: t("admin.create.errors.whatsapp") } };
    console.error("[admin] create_restaurant failed", { code: error.code, message: error.message });
    return { values, formError: t("admin.create.errors.failed") };
  }

  const result = data as { restaurant_id: string; slug: string; invitation_token: string | null };
  const menuUrl = `${publicEnv.siteUrl}/r/${result.slug}`;
  const inviteUrl = result.invitation_token ? `${publicEnv.siteUrl}/invite/${result.invitation_token}` : null;
  const ownerFirstName = values.ownerName.split(/\s+/)[0] || "there";

  let whatsappHref: string | null = null;
  if (inviteUrl) {
    const message = ownerPhone
      ? t("admin.inviteMessage", {
          name: ownerFirstName,
          restaurant: values.name,
          menuUrl,
          phone: formatPhoneLocal(ownerPhone),
          inviteUrl,
        })
      : t("admin.inviteMessageEmail", { name: ownerFirstName, restaurant: values.name, menuUrl, email: ownerEmail!, inviteUrl });
    whatsappHref = waLink(ownerPhone ?? whatsapp!, message);
  }

  return {
    created: { restaurantId: result.restaurant_id, restaurantName: values.name, menuUrl, inviteUrl, whatsappHref },
  };
}
