"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { importAvailable, type StoredFile } from "@/lib/import/process";
import { createImport } from "@/lib/import/start";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnUploadPath, UPLOAD_TYPES } from "@/lib/uploads";

const t = getTranslator("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["new", "in_progress", "done", "cancelled"] as const;

type Fail = { ok: false; error: string };

export async function setRequestStatusAction(requestId: string, status: (typeof STATUSES)[number]): Promise<{ ok: true } | Fail> {
  const admin = await requireAdmin();
  if (!UUID.test(requestId) || !STATUSES.includes(status)) return { ok: false, error: t("admin.errors.billingFailed") };
  const { error } = await createAdminClient()
    .from("setup_requests")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
      ...(status === "in_progress" ? { assigned_to: admin.id } : {}),
    })
    .eq("id", requestId);
  if (error) return { ok: false, error: t("admin.errors.billingFailed") };
  refresh();
  return { ok: true };
}

interface RequestFile {
  path: string;
  name: string;
  type: string;
  size: number;
}

/**
 * Runs the photo import on the photos an owner sent with a request. The
 * photos are copied, so the request keeps its own (an import deletes its
 * files once it is published or discarded).
 */
export async function importFromRequestAction(requestId: string): Promise<{ ok: true; url: string } | Fail> {
  const admin = await requireAdmin();
  if (!UUID.test(requestId)) return { ok: false, error: t("import.errors.failed") };
  if (!importAvailable()) return { ok: false, error: t("import.errors.unavailable") };
  const db = createAdminClient();
  const { data: request } = await db.from("setup_requests").select("id, restaurant_id, status, files").eq("id", requestId).maybeSingle();
  const restaurantId = request?.restaurant_id;
  if (!request || !restaurantId) return { ok: false, error: t("import.errors.failed") };
  const { data: branch } = await db
    .from("branches")
    .select("menu_id")
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .order("is_main", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!branch) return { ok: false, error: t("import.errors.failed") };

  const files = ((request.files as unknown as RequestFile[]) ?? []).filter(
    (f) => isOwnUploadPath(restaurantId, "requests", f.path) && Boolean(UPLOAD_TYPES[f.type]),
  );
  if (files.length === 0) return { ok: false, error: t("import.errors.noFiles") };

  const storage = db.storage.from("uploads");
  const copies: StoredFile[] = [];
  for (const f of files.slice(0, 10)) {
    const to = `${restaurantId}/imports/${randomUUID()}.${UPLOAD_TYPES[f.type]}`;
    const { error } = await storage.copy(f.path, to);
    if (error) {
      console.error("[requests] could not copy a photo", { message: error.message });
      return { ok: false, error: t("import.errors.failed") };
    }
    copies.push({ path: to, mime: f.type, size: f.size, name: f.name.slice(0, 120) });
  }

  const started = await createImport({ restaurantId, menuId: branch.menu_id, userId: admin.id, isAdmin: true, files: copies });
  if (!started.ok) {
    await storage.remove(copies.map((c) => c.path));
    return { ok: false, error: started.code === "running" ? t("import.errors.running") : started.code === "too_many" ? t("import.errors.tooMany") : t("import.errors.failed") };
  }
  if (request.status === "new") await db.from("setup_requests").update({ status: "in_progress", assigned_to: admin.id }).eq("id", requestId);
  return { ok: true, url: `/dashboard/${restaurantId}/import/${started.importId}` };
}
