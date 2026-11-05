import "server-only";
import { after } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { expireStaleImports, processImport, type StoredFile } from "./process";

export type StartImportFailure = "running" | "too_many" | "failed";

/** Imports cost money (Claude calls), so they are limited per person and per restaurant. */
export async function importWithinLimits(userId: string, restaurantId: string, admin: boolean): Promise<boolean> {
  const perUser = await rateLimit(`import:u:${userId}`, admin ? 40 : 10, 3600);
  if (!perUser) return false;
  return rateLimit(`import:r:${restaurantId}`, 20, 86_400);
}

/**
 * Creates an import and starts reading it in the background of the current
 * Server Action (Next.js `after`), which shares its page's time limit.
 * Callers check who is allowed and that the files are this restaurant's.
 */
export async function createImport(input: {
  restaurantId: string;
  menuId: string;
  userId: string;
  isAdmin: boolean;
  files: StoredFile[];
}): Promise<{ ok: true; importId: string } | { ok: false; code: StartImportFailure }> {
  const db = createAdminClient();
  await expireStaleImports(input.restaurantId);
  const { count: running } = await db
    .from("menu_imports")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", input.restaurantId)
    .eq("status", "processing")
    .is("deleted_at", null);
  if ((running ?? 0) > 0) return { ok: false, code: "running" };
  if (!(await importWithinLimits(input.userId, input.restaurantId, input.isAdmin))) return { ok: false, code: "too_many" };

  const { data, error } = await db
    .from("menu_imports")
    .insert({
      restaurant_id: input.restaurantId,
      menu_id: input.menuId,
      created_by: input.userId,
      files: input.files as unknown as Json[],
      status: "processing",
      attempts: 1,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[import] could not create the import", { message: error?.message });
    return { ok: false, code: "failed" };
  }
  await db.from("audit_log").insert({
    actor_id: input.userId,
    restaurant_id: input.restaurantId,
    action: "menu_import.started",
    details: { import_id: data.id, files: input.files.length },
  });

  const importId = data.id;
  after(() => processImport(importId));
  return { ok: true, importId };
}
