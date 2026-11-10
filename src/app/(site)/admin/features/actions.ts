"use server";

import { refresh, updateTag } from "next/cache";
import { SWITCH_KEYS, type SwitchKey } from "@/config/features";
import { requireAdmin } from "@/lib/auth";
import { SWITCHES_TAG, type OverrideState } from "@/lib/features";
import { expireAllMenus, expireMenu } from "@/lib/menu/expire";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isKey = (key: unknown): key is SwitchKey => typeof key === "string" && (SWITCH_KEYS as readonly string[]).includes(key);

/** Everything that shows a switchable feature, expired at once. */
function expireEverything() {
  expireAllMenus();
  updateTag(SWITCHES_TAG);
  updateTag(SITE_SETTINGS_TAG);
  updateTag("directory-top");
}

/**
 * A global switch. Written with the admin's own session: row-level security
 * refuses anyone who is not the admin, even if this check were bypassed.
 */
export async function setFeatureSwitchAction(key: string, enabled: boolean): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  if (!isKey(key) || typeof enabled !== "boolean") return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.from("feature_flags").update({ enabled }).eq("key", key).select("key");
  if (error || !data?.length) {
    if (error) console.error("[features] switch failed", { key, message: error.message });
    return { ok: false };
  }
  await createAdminClient().from("audit_log").insert({ actor_id: admin.id, action: "feature.switched", details: { key, enabled } });
  expireEverything();
  refresh();
  return { ok: true };
}

/** One restaurant: "on", "off" or "default" (follow the global switch). */
export async function setRestaurantFeatureAction(restaurantId: string, key: string, state: OverrideState): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  if (!UUID.test(restaurantId) || !isKey(key) || !["default", "on", "off"].includes(state)) return { ok: false };
  const supabase = await createClient();
  let error: { message: string } | null = null;
  if (state === "default") {
    ({ error } = await supabase.from("restaurant_features").delete().eq("restaurant_id", restaurantId).eq("key", key));
  } else {
    const enabled = state === "on";
    const updated = await supabase.from("restaurant_features").update({ enabled }).eq("restaurant_id", restaurantId).eq("key", key).select("key");
    error = updated.error;
    if (!error && !updated.data?.length) {
      ({ error } = await supabase.from("restaurant_features").insert({ restaurant_id: restaurantId, key, enabled }));
    }
  }
  if (error) {
    console.error("[features] override failed", { key, message: error.message });
    return { ok: false };
  }
  await createAdminClient()
    .from("audit_log")
    .insert({ actor_id: admin.id, restaurant_id: restaurantId, action: "feature.override", details: { key, state } });
  expireMenu(restaurantId);
  if (key === "directory" || key === "rankings") updateTag("directory-top");
  refresh();
  return { ok: true };
}
