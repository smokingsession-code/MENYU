"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import sharp from "sharp";
import { planHas } from "@/config/plans";
import { requireRestaurantAccess } from "@/lib/auth";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator } from "@/lib/i18n";
import { photoEnhancer } from "@/lib/images/enhance";
import { storeImage } from "@/lib/images/process";
import type { ImageDescriptor, ImageKind } from "@/lib/images/shared";
import { expireMenu } from "@/lib/menu/expire";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export type PhotoTarget = { kind: "item"; itemId: string } | { kind: "logo" } | { kind: "cover" };

type UploadResult = { ok: true; path: string; signedUrl: string } | { ok: false; error: string };
type AttachResult = { ok: true; photo: ImageDescriptor } | { ok: false; error: string };

/** Uploads are shrunk in the browser first; this is a hard ceiling. */
const MAX_BYTES = 10 * 1024 * 1024;

async function allowed(restaurantId: string, target: PhotoTarget) {
  const { user } = await requireRestaurantAccess(restaurantId, ["owner"]);
  const ctx = await getDashboardContext(restaurantId);
  if (target.kind === "item") {
    if (!ctx.canEditMenu) return { user, error: t("editor.errors.notAllowed") };
    // Free menus show no item photos; Standard and Pro are unlimited.
    if (ctx.role !== "admin" && !planHas(ctx.plan, "menu_editing")) return { user, error: t("editor.errors.notAllowed") };
  } else if (!ctx.canManage) {
    return { user, error: t("editor.errors.notAllowed") };
  }
  return { user, error: null };
}

export async function createPhotoUploadAction(restaurantId: string, target: PhotoTarget): Promise<UploadResult> {
  const { user, error } = await allowed(restaurantId, target);
  if (error) return { ok: false, error };
  if (!(await rateLimit(`upload:${user.id}`, 60, 3600))) return { ok: false, error: t("photos.errors.tooMany") };

  const path = `${restaurantId}/raw/${randomUUID()}.jpg`;
  const { data, error: storageError } = await createAdminClient().storage.from("uploads").createSignedUploadUrl(path);
  if (storageError || !data) {
    console.error("[photos] signed upload failed", { message: storageError?.message });
    return { ok: false, error: t("photos.errors.failed") };
  }
  return { ok: true, path, signedUrl: data.signedUrl };
}

export async function attachPhotoAction(restaurantId: string, target: PhotoTarget, path: string): Promise<AttachResult> {
  const { error } = await allowed(restaurantId, target);
  if (error) return { ok: false, error };
  if (!new RegExp(`^${restaurantId}/raw/[0-9a-f-]{36}\\.jpg$`).test(path)) return { ok: false, error: t("photos.errors.failed") };

  const admin = createAdminClient();
  const { data: file, error: downloadError } = await admin.storage.from("uploads").download(path);
  if (downloadError || !file) return { ok: false, error: t("photos.errors.failed") };
  if (file.size > MAX_BYTES) return { ok: false, error: t("photos.errors.tooBig") };

  const buffer = Buffer.from(await file.arrayBuffer());
  let photo: ImageDescriptor;
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) return { ok: false, error: t("photos.errors.format") };
    const kind: ImageKind = target.kind === "item" ? "item" : target.kind;
    photo = await storeImage(admin, restaurantId, kind, buffer);
  } catch (e) {
    console.error("[photos] processing failed", { message: (e as Error).message });
    return { ok: false, error: t("photos.errors.format") };
  } finally {
    await admin.storage.from("uploads").remove([path]);
  }

  const value = photo as unknown as Json;
  const supabase = await createClient();
  const { error: updateError } =
    target.kind === "item"
      ? await supabase.from("items").update({ photo: value }).eq("id", target.itemId).eq("restaurant_id", restaurantId)
      : await supabase.from("restaurants").update(target.kind === "logo" ? { logo: value } : { cover: value }).eq("id", restaurantId);
  if (updateError) return { ok: false, error: t("photos.errors.failed") };

  expireMenu(restaurantId);
  refresh();
  return { ok: true, photo };
}

export async function removePhotoAction(restaurantId: string, target: PhotoTarget): Promise<{ ok: boolean; error?: string }> {
  const { error } = await allowed(restaurantId, target);
  if (error) return { ok: false, error };
  const supabase = await createClient();
  const { error: updateError } =
    target.kind === "item"
      ? await supabase.from("items").update({ photo: null }).eq("id", target.itemId).eq("restaurant_id", restaurantId)
      : await supabase.from("restaurants").update(target.kind === "logo" ? { logo: null } : { cover: null }).eq("id", restaurantId);
  if (updateError) return { ok: false, error: t("photos.errors.failed") };
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Auto-fix (Pro): makes an improved copy, shows it next to the original, and
// only replaces the photo when the owner says so.
// ---------------------------------------------------------------------------

type EnhanceResult = { ok: true; before: ImageDescriptor; after: ImageDescriptor } | { ok: false; error: string };

function imageKindOf(target: PhotoTarget): ImageKind {
  return target.kind === "item" ? "item" : target.kind;
}

/** Only images this restaurant's photo actions could have stored. */
function ownImage(restaurantId: string, target: PhotoTarget, image: ImageDescriptor): boolean {
  return (
    new RegExp(`^${restaurantId}/${imageKindOf(target)}/[0-9a-f-]{36}$`).test(image.path) &&
    Array.isArray(image.widths) &&
    image.widths.every((w) => Number.isInteger(w) && w > 0 && w <= 4000)
  );
}

async function currentPhoto(restaurantId: string, target: PhotoTarget): Promise<ImageDescriptor | null> {
  const supabase = await createClient();
  if (target.kind === "item") {
    const { data } = await supabase.from("items").select("photo").eq("id", target.itemId).eq("restaurant_id", restaurantId).maybeSingle();
    return (data?.photo as unknown as ImageDescriptor | null) ?? null;
  }
  const { data } = await supabase.from("restaurants").select("logo, cover").eq("id", restaurantId).maybeSingle();
  return ((target.kind === "logo" ? data?.logo : data?.cover) as unknown as ImageDescriptor | null) ?? null;
}

export async function enhancePhotoAction(restaurantId: string, target: PhotoTarget): Promise<EnhanceResult> {
  const { user, error } = await allowed(restaurantId, target);
  if (error) return { ok: false, error };
  const ctx = await getDashboardContext(restaurantId);
  if (!planHas(ctx.plan, "photo_enhance")) return { ok: false, error: t("editor.errors.notAllowed") };
  if (!(await rateLimit(`enhance:${user.id}`, 30, 3600))) return { ok: false, error: t("photos.errors.tooMany") };

  const before = await currentPhoto(restaurantId, target);
  if (!before) return { ok: false, error: t("photos.enhanceFailed") };
  const admin = createAdminClient();
  try {
    const largest = Math.max(...before.widths);
    const { data: file, error: downloadError } = await admin.storage.from("images").download(`${before.path}-${largest}.webp`);
    if (downloadError || !file) throw new Error(downloadError?.message ?? "missing image");
    const improved = await photoEnhancer().enhance(Buffer.from(await file.arrayBuffer()));
    const after = await storeImage(admin, restaurantId, imageKindOf(target), improved);
    return { ok: true, before, after };
  } catch (e) {
    console.error("[photos] auto-fix failed", { message: (e as Error).message });
    return { ok: false, error: t("photos.enhanceFailed") };
  }
}

export async function applyEnhancedPhotoAction(restaurantId: string, target: PhotoTarget, after: ImageDescriptor): Promise<AttachResult> {
  const { error } = await allowed(restaurantId, target);
  if (error) return { ok: false, error };
  if (!ownImage(restaurantId, target, after)) return { ok: false, error: t("photos.errors.failed") };
  const before = await currentPhoto(restaurantId, target);
  const value = after as unknown as Json;
  const supabase = await createClient();
  const { error: updateError } =
    target.kind === "item"
      ? await supabase.from("items").update({ photo: value }).eq("id", target.itemId).eq("restaurant_id", restaurantId)
      : await supabase.from("restaurants").update(target.kind === "logo" ? { logo: value } : { cover: value }).eq("id", restaurantId);
  if (updateError) return { ok: false, error: t("photos.errors.failed") };
  // The original's files are no longer used by anything.
  if (before && ownImage(restaurantId, target, before) && before.path !== after.path) {
    await createAdminClient().storage.from("images").remove(before.widths.map((w) => `${before.path}-${w}.webp`));
  }
  expireMenu(restaurantId);
  refresh();
  return { ok: true, photo: after };
}

export async function discardEnhancedPhotoAction(restaurantId: string, target: PhotoTarget, after: ImageDescriptor): Promise<{ ok: boolean }> {
  const { error } = await allowed(restaurantId, target);
  if (error || !ownImage(restaurantId, target, after)) return { ok: false };
  const current = await currentPhoto(restaurantId, target);
  // Never delete the photo the menu is using.
  if (current?.path === after.path) return { ok: false };
  await createAdminClient().storage.from("images").remove(after.widths.map((w) => `${after.path}-${w}.webp`));
  return { ok: true };
}
