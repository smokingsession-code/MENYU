import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { effectiveSwitches, LAUNCH_DEFAULTS, type Switches } from "@/config/features";
import { TRIAL } from "@/config/plans";
import { SWITCHES_TAG } from "@/lib/features";
import { createAdminClient } from "@/lib/supabase/admin";

/** Expired whenever the admin saves settings or changes a feature switch. */
export const SITE_SETTINGS_TAG = "site-settings";

export interface SiteSettings {
  /** International digits, or "" when not set. */
  supportWhatsapp: string;
  /** The "Menus near me" switch (Admin > Features). */
  directoryEnabled: boolean;
  trialDays: number;
  /** The admin's global feature switches (price lists hide what is off). */
  switches: Switches;
}

/**
 * The few settings public pages need (the marketing site's WhatsApp button,
 * whether "Menus near me" is on), cached so those pages stay static.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  "use cache";
  cacheTag(SITE_SETTINGS_TAG, SWITCHES_TAG);
  cacheLife("hours");
  const db = createAdminClient();
  const [{ data }, flags] = await Promise.all([
    db.from("settings").select("key, value").in("key", ["support_whatsapp", "trial_days"]),
    db.from("feature_flags").select("key, enabled"),
  ]);
  const values = new Map((data ?? []).map((row) => [row.key, row.value]));
  const trial = Number(values.get("trial_days"));
  const switches = flags.data ? effectiveSwitches(new Map(flags.data.map((f) => [f.key, f.enabled]))) : LAUNCH_DEFAULTS;
  return {
    supportWhatsapp: typeof values.get("support_whatsapp") === "string" ? (values.get("support_whatsapp") as string) : "",
    directoryEnabled: switches.directory,
    trialDays: Number.isInteger(trial) && trial > 0 ? trial : TRIAL.defaultDays,
    switches,
  };
}
