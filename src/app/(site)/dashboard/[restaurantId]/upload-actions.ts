"use server";

import { randomUUID } from "node:crypto";
import { requireRestaurantAccess } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_LIMITS, UPLOAD_TYPES, type UploadPurpose } from "@/lib/uploads";

const t = getTranslator("en");

/**
 * Signed upload links for menu photos and PDFs (setup requests and, in
 * phase 4, the AI import). Files go straight from the phone to private
 * storage; the server never streams them through Vercel.
 */
const TYPES = UPLOAD_TYPES;

export interface UploadRequest {
  name: string;
  type: string;
  size: number;
}

export interface SignedUpload {
  name: string;
  type: string;
  size: number;
  path: string;
  signedUrl: string;
}

export async function createUploadsAction(
  restaurantId: string,
  purpose: UploadPurpose,
  files: UploadRequest[],
): Promise<{ ok: true; uploads: SignedUpload[] } | { ok: false; error: string }> {
  const { user } = await requireRestaurantAccess(restaurantId, ["owner"]);
  if (files.length === 0 || files.length > UPLOAD_LIMITS.maxFiles) {
    return { ok: false, error: t("uploads.errors.count", { max: UPLOAD_LIMITS.maxFiles }) };
  }
  for (const f of files) {
    if (!TYPES[f.type]) return { ok: false, error: t("uploads.errors.type", { name: f.name }) };
    if (f.size <= 0 || f.size > UPLOAD_LIMITS.maxBytes) return { ok: false, error: t("uploads.errors.size", { name: f.name }) };
  }
  if (!(await rateLimit(`upload:${user.id}`, 60, 3600))) return { ok: false, error: t("photos.errors.tooMany") };

  const storage = createAdminClient().storage.from("uploads");
  const uploads: SignedUpload[] = [];
  for (const f of files) {
    const path = `${restaurantId}/${purpose}/${randomUUID()}.${TYPES[f.type]}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: t("uploads.errors.failed", { name: f.name }) };
    uploads.push({ name: f.name.slice(0, 120), type: f.type, size: f.size, path, signedUrl: data.signedUrl });
  }
  return { ok: true, uploads };
}
