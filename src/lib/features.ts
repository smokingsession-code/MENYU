import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveSwitches, LAUNCH_DEFAULTS, SWITCH_KEYS, type SwitchKey, type Switches } from "@/config/features";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/** Expired whenever the admin changes a switch (with every menu's tag). */
export const SWITCHES_TAG = "feature-switches";

/** "On", "Off", or no override ("default": follow the global switch). */
export type OverrideState = "default" | "on" | "off";

function isKey(key: string): key is SwitchKey {
  return (SWITCH_KEYS as readonly string[]).includes(key);
}

/**
 * The global switches, cached for public pages (the marketing site, price
 * lists). If they cannot be read, the launch settings apply.
 */
export async function getGlobalSwitches(): Promise<Switches> {
  "use cache";
  cacheTag(SWITCHES_TAG);
  cacheLife("hours");
  const { data, error } = await createAdminClient().from("feature_flags").select("key, enabled");
  if (error || !data) {
    console.error("[features] could not read the switches", { message: error?.message });
    return LAUNCH_DEFAULTS;
  }
  return effectiveSwitches(new Map(data.map((row) => [row.key, row.enabled])));
}

export interface RestaurantSwitches {
  /** What applies to this restaurant (global AND not turned off here). */
  switches: Switches;
  global: Switches;
  overrides: Partial<Record<SwitchKey, boolean>>;
}

/**
 * A restaurant's switches, read with the caller's own client (row-level
 * security lets members and the admin read them), never cached: changes
 * show at once.
 */
export async function loadRestaurantSwitches(supabase: SupabaseClient<Database>, restaurantId: string): Promise<RestaurantSwitches> {
  const [flags, rows] = await Promise.all([
    supabase.from("feature_flags").select("key, enabled"),
    supabase.from("restaurant_features").select("key, enabled").eq("restaurant_id", restaurantId),
  ]);
  if (flags.error || !flags.data) {
    console.error("[features] could not read the switches", { message: flags.error?.message });
    return { switches: LAUNCH_DEFAULTS, global: LAUNCH_DEFAULTS, overrides: {} };
  }
  const global = new Map(flags.data.map((row) => [row.key, row.enabled]));
  const overrides: Partial<Record<SwitchKey, boolean>> = {};
  for (const row of rows.data ?? []) if (isKey(row.key)) overrides[row.key] = row.enabled;
  return { switches: effectiveSwitches(global, overrides), global: effectiveSwitches(global), overrides };
}
