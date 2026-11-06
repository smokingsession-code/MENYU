"use server";

import { refresh, updateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { expireMenu } from "@/lib/menu/expire";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setDirectoryEnabledAction(enabled: boolean): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  const db = createAdminClient();
  const { error } = await db.from("settings").upsert({ key: "directory_enabled", value: enabled, updated_by: admin.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false };
  await db.from("audit_log").insert({ actor_id: admin.id, action: "directory.switched", details: { enabled } });
  updateTag(SITE_SETTINGS_TAG);
  refresh();
  return { ok: true };
}

export async function setListingAction(restaurantId: string, status: "approved" | "rejected" | "hidden"): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  if (!UUID.test(restaurantId) || !["approved", "rejected", "hidden"].includes(status)) return { ok: false };
  const db = createAdminClient();
  const { error } = await db
    .from("restaurants")
    .update({ directory_status: status, ...(status !== "approved" ? { is_featured: false } : {}) })
    .eq("id", restaurantId);
  if (error) return { ok: false };
  await db.from("audit_log").insert({ actor_id: admin.id, restaurant_id: restaurantId, action: "directory.listing", details: { status } });
  // Listed menus are indexable by search engines; the menu page says so.
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}

export async function setFeaturedAction(restaurantId: string, featured: boolean): Promise<{ ok: boolean }> {
  await requireAdmin();
  if (!UUID.test(restaurantId)) return { ok: false };
  const { error } = await createAdminClient().from("restaurants").update({ is_featured: featured }).eq("id", restaurantId);
  if (error) return { ok: false };
  refresh();
  return { ok: true };
}
