"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export interface OnboardingState {
  values?: { name: string; area: string; whatsapp: string; agentCode: string };
  errors?: Partial<Record<"name" | "area" | "whatsapp" | "agentCode", string>>;
  formError?: string;
}

/** Self-serve signup: the signed-in user becomes owner on a Standard trial. */
export async function createMyRestaurantAction(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  await requireUser("/onboarding");
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    area: String(formData.get("area") ?? "").trim(),
    whatsapp: String(formData.get("whatsapp") ?? "").trim(),
    agentCode: String(formData.get("agentCode") ?? "").trim().toUpperCase(),
  };
  const errors: OnboardingState["errors"] = {};
  if (values.name.length < 2 || values.name.length > 120) errors.name = t("onboarding.errors.name");
  if (!values.area || values.area.length > 80) errors.area = t("onboarding.errors.area");
  const whatsapp = normalizePhone(values.whatsapp);
  if (!whatsapp) errors.whatsapp = t("onboarding.errors.whatsapp");
  if (values.agentCode && !/^[A-Z0-9]{3,12}$/.test(values.agentCode)) errors.agentCode = t("onboarding.errors.agentCode");
  if (Object.keys(errors).length) return { values, errors };

  if (!(await rateLimit(`onboard:${await clientKey()}`, 10, 3600))) return { values, formError: t("auth.errors.tooMany") };

  const referral = String(formData.get("ref") ?? "").trim().toUpperCase();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_restaurant", {
    p_name: values.name,
    p_area: values.area,
    p_whatsapp: whatsapp!,
    p_agent_code: values.agentCode || undefined,
    p_referral_code: /^[A-Z0-9]{4,12}$/.test(referral) ? referral : undefined,
  });
  if (error) {
    if (error.message.includes("unknown_agent_code")) return { values, errors: { agentCode: t("onboarding.errors.agentCode") } };
    if (error.message.includes("too_many_restaurants")) return { values, formError: t("onboarding.errors.tooMany") };
    console.error("[onboarding] create_restaurant failed", { code: error.code, message: error.message });
    return { values, formError: t("onboarding.errors.failed") };
  }
  redirect(`/dashboard/${(data as { restaurant_id: string }).restaurant_id}/start`);
}
