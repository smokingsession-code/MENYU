import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { TRIAL } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/** Expired whenever the admin saves settings or switches the directory. */
export const SITE_SETTINGS_TAG = "site-settings";

export interface SiteSettings {
  /** International digits, or "" when not set. */
  supportWhatsapp: string;
  directoryEnabled: boolean;
  trialDays: number;
}

/**
 * The few settings public pages need (the marketing site's WhatsApp button,
 * whether "Menus near me" is on), cached so those pages stay static.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  "use cache";
  cacheTag(SITE_SETTINGS_TAG);
  cacheLife("hours");
  const { data } = await createAdminClient().from("settings").select("key, value").in("key", ["support_whatsapp", "directory_enabled", "trial_days"]);
  const values = new Map((data ?? []).map((row) => [row.key, row.value]));
  const trial = Number(values.get("trial_days"));
  return {
    supportWhatsapp: typeof values.get("support_whatsapp") === "string" ? (values.get("support_whatsapp") as string) : "",
    directoryEnabled: values.get("directory_enabled") === true,
    trialDays: Number.isInteger(trial) && trial > 0 ? trial : TRIAL.defaultDays,
  };
}
