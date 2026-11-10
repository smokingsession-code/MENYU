"use server";

import { refresh } from "next/cache";
import { setFeatureSwitchAction } from "@/app/(site)/admin/features/actions";
import { requireAdmin } from "@/lib/auth";
import { expireMenu } from "@/lib/menu/expire";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The "Menus near me" switch (the same one as on Admin > Features). */
export async function setDirectoryEnabledAction(enabled: boolean): Promise<{ ok: boolean }> {
  return setFeatureSwitchAction("directory", enabled);
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
