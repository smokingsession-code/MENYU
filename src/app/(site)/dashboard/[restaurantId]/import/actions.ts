"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { requireRestaurantAccess } from "@/lib/auth";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator } from "@/lib/i18n";
import { publishProblems, type ImportDraft } from "@/lib/import/draft";
import { draftZ } from "@/lib/import/draft-schema";
import { canRetry, expireStaleImports, importAvailable, processImport, type StoredFile } from "@/lib/import/process";
import { expireMenu } from "@/lib/menu/expire";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { isOwnUploadPath, UPLOAD_LIMITS, UPLOAD_TYPES } from "@/lib/uploads";

const t = getTranslator("en");

type Fail = { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owners on a plan with menu editing, and the Menyu team (who import menus
 * for Free restaurants as part of setup). Row-level security and the
 * publish function check the same thing again.
 */
async function editor(restaurantId: string) {
  if (!UUID.test(restaurantId)) return { error: t("editor.errors.notAllowed") } as const;
  const { user, role } = await requireRestaurantAccess(restaurantId, ["owner"]);
  const ctx = await getDashboardContext(restaurantId);
  if (!ctx.canEditMenu) return { error: t("import.errors.notAllowed") } as const;
  return { user, role, ctx, error: null } as const;
}

/** Imports cost money (Claude calls), so they are limited per person and per restaurant. */
async function withinLimits(userId: string, restaurantId: string, admin: boolean): Promise<boolean> {
  const perUser = await rateLimit(`import:u:${userId}`, admin ? 40 : 10, 3600);
  if (!perUser) return false;
  return rateLimit(`import:r:${restaurantId}`, 20, 86_400);
}

export interface ImportFileInput {
  path: string;
  name: string;
  type: string;
  size: number;
}

export async function startImportAction(
  restaurantId: string,
  input: { files: ImportFileInput[]; branchId?: string },
): Promise<{ ok: true; importId: string } | Fail> {
  const access = await editor(restaurantId);
  if (access.error !== null) return { ok: false, error: access.error };
  const { user, role, ctx } = access;
  if (!importAvailable()) return { ok: false, error: t("import.errors.unavailable") };

  const files = input.files;
  if (files.length === 0) return { ok: false, error: t("import.errors.noFiles") };
  if (files.length > UPLOAD_LIMITS.maxFiles) return { ok: false, error: t("uploads.errors.count", { max: UPLOAD_LIMITS.maxFiles }) };
  for (const f of files) {
    const valid =
      isOwnUploadPath(restaurantId, "imports", f.path) &&
      Boolean(UPLOAD_TYPES[f.type]) &&
      Number.isInteger(f.size) &&
      f.size > 0 &&
      f.size <= UPLOAD_LIMITS.maxBytes;
    if (!valid) return { ok: false, error: t("import.errors.failed") };
  }
  const branch = ctx.branches.find((b) => b.id === input.branchId) ?? ctx.branch;

  const admin = createAdminClient();
  await expireStaleImports(restaurantId);
  const { count: running } = await admin
    .from("menu_imports")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("status", "processing")
    .is("deleted_at", null);
  if ((running ?? 0) > 0) return { ok: false, error: t("import.errors.running") };
  if (!(await withinLimits(user.id, restaurantId, role === "admin"))) return { ok: false, error: t("import.errors.tooMany") };

  const stored: StoredFile[] = files.map((f) => ({ path: f.path, mime: f.type, size: f.size, name: f.name.slice(0, 120) }));
  const { data, error } = await admin
    .from("menu_imports")
    .insert({
      restaurant_id: restaurantId,
      menu_id: branch.menuId,
      created_by: user.id,
      files: stored as unknown as Json[],
      status: "processing",
      attempts: 1,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[import] could not create the import", { message: error?.message });
    return { ok: false, error: t("import.errors.failed") };
  }
  await admin.from("audit_log").insert({
    actor_id: user.id,
    restaurant_id: restaurantId,
    action: "menu_import.started",
    details: { import_id: data.id, files: files.length },
  });

  const importId = data.id;
  after(() => processImport(importId));
  return { ok: true, importId };
}

/** Polled by the progress screen while Claude reads the menu. */
export async function importStatusAction(restaurantId: string, importId: string): Promise<{ status: string } | Fail> {
  if (!UUID.test(restaurantId) || !UUID.test(importId)) return { ok: false, error: t("import.errors.notFound") };
  await requireRestaurantAccess(restaurantId, ["owner"]);
  await expireStaleImports(restaurantId);
  const supabase = await createClient();
  const { data } = await supabase
    .from("menu_imports")
    .select("status")
    .eq("id", importId)
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return { ok: false, error: t("import.errors.notFound") };
  return { status: data.status };
}

function checkDraft(draft: unknown): { ok: true; draft: ImportDraft } | Fail {
  const parsed = draftZ.safeParse(draft);
  if (!parsed.success) return { ok: false, error: t("import.errors.invalid") };
  return { ok: true, draft: parsed.data };
}

/** Autosave while the owner reviews, so nothing is lost if they leave. */
export async function saveDraftAction(restaurantId: string, importId: string, draft: ImportDraft): Promise<{ ok: true } | Fail> {
  if (!UUID.test(importId)) return { ok: false, error: t("import.errors.notFound") };
  const access = await editor(restaurantId);
  if (access.error !== null) return { ok: false, error: access.error };
  const checked = checkDraft(draft);
  if (!checked.ok) return checked;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menu_imports")
    .update({ draft: checked.draft as unknown as Json })
    .eq("id", importId)
    .eq("restaurant_id", restaurantId)
    .eq("status", "needs_review")
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.error("[import] draft save failed", { code: error.code, message: error.message });
    return { ok: false, error: t("import.errors.saveFailed") };
  }
  if (!data?.length) return { ok: false, error: t("import.errors.notReviewable") };
  return { ok: true };
}

export async function publishImportAction(
  restaurantId: string,
  importId: string,
  input: { draft: ImportDraft; mode: "append" | "replace" },
): Promise<{ ok: true; sections: number; items: number } | Fail> {
  if (!UUID.test(importId)) return { ok: false, error: t("import.errors.notFound") };
  const access = await editor(restaurantId);
  if (access.error !== null) return { ok: false, error: access.error };
  if (input.mode !== "append" && input.mode !== "replace") return { ok: false, error: t("import.errors.invalid") };
  const checked = checkDraft(input.draft);
  if (!checked.ok) return checked;
  if (publishProblems(checked.draft).length > 0) return { ok: false, error: t("import.errors.problems") };

  const supabase = await createClient();
  // The import must belong to this restaurant (the function checks access to
  // the import's own restaurant, this keeps the URL honest).
  const { data: row } = await supabase
    .from("menu_imports")
    .select("id, files")
    .eq("id", importId)
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { ok: false, error: t("import.errors.notFound") };

  const { data, error } = await supabase.rpc("publish_menu_import", {
    p_import_id: importId,
    p_draft: checked.draft as unknown as Json,
    p_mode: input.mode,
  });
  if (error) {
    if (error.message === "not_reviewable") return { ok: false, error: t("import.errors.notReviewable") };
    if (error.message === "empty_draft") return { ok: false, error: t("import.errors.problems") };
    if (error.code === "42501") return { ok: false, error: t("import.errors.notAllowed") };
    console.error("[import] publish failed", { code: error.code, message: error.message });
    return { ok: false, error: t("import.errors.publishFailed") };
  }

  // The photos were only needed for the review.
  const paths = (row.files as unknown as StoredFile[]).map((f) => f.path);
  after(async () => {
    if (paths.length) await createAdminClient().storage.from("uploads").remove(paths);
  });
  expireMenu(restaurantId);
  refresh();
  const result = data as { sections: number; items: number };
  return { ok: true, sections: result.sections, items: result.items };
}

export async function discardImportAction(restaurantId: string, importId: string): Promise<{ ok: true } | Fail> {
  if (!UUID.test(importId)) return { ok: false, error: t("import.errors.notFound") };
  const access = await editor(restaurantId);
  if (access.error !== null) return { ok: false, error: access.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menu_imports")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("restaurant_id", restaurantId)
    .neq("status", "published")
    .is("deleted_at", null)
    .select("id, files");
  if (error || !data?.length) return { ok: false, error: t("import.errors.notFound") };

  const admin = createAdminClient();
  await admin.from("menu_imports").update({ status: "discarded" }).eq("id", importId);
  const paths = (data[0].files as unknown as StoredFile[]).map((f) => f.path);
  if (paths.length) await admin.storage.from("uploads").remove(paths);
  refresh();
  return { ok: true };
}

export async function retryImportAction(restaurantId: string, importId: string): Promise<{ ok: true } | Fail> {
  if (!UUID.test(importId)) return { ok: false, error: t("import.errors.notFound") };
  const access = await editor(restaurantId);
  if (access.error !== null) return { ok: false, error: access.error };
  if (!importAvailable()) return { ok: false, error: t("import.errors.unavailable") };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("menu_imports")
    .select("id, status, error_code, attempts")
    .eq("id", importId)
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row || row.status !== "failed" || !canRetry(row.error_code, row.attempts)) {
    return { ok: false, error: t("import.errors.cannotRetry") };
  }
  if (!(await withinLimits(access.user.id, restaurantId, access.role === "admin"))) {
    return { ok: false, error: t("import.errors.tooMany") };
  }

  // Only one retry wins if the button is pressed twice.
  const { data: claimed } = await createAdminClient()
    .from("menu_imports")
    .update({ status: "processing", attempts: row.attempts + 1, error_code: null, error_message: null })
    .eq("id", importId)
    .eq("status", "failed")
    .eq("attempts", row.attempts)
    .select("id");
  if (!claimed?.length) return { ok: false, error: t("import.errors.cannotRetry") };

  after(() => processImport(importId));
  refresh();
  return { ok: true };
}
