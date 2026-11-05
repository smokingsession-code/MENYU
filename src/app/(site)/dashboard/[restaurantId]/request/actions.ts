"use server";

import { refresh } from "next/cache";
import { requireRestaurantAccess } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { isOwnUploadPath, UPLOAD_LIMITS } from "@/lib/uploads";

const t = getTranslator("en");

export interface RequestFile {
  path: string;
  name: string;
  type: string;
  size: number;
}

/** A change request (Free plan) or "Send it to us" setup request. */
export async function submitRequestAction(
  restaurantId: string,
  input: { kind: "setup" | "change"; notes: string; contactPhone: string; files: RequestFile[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const notes = input.notes.trim().slice(0, 2000);
  const files = input.files.slice(0, UPLOAD_LIMITS.maxFiles);
  if (!notes && files.length === 0) return { ok: false, error: t("request.errors.empty") };
  for (const f of files) {
    if (!isOwnUploadPath(restaurantId, "requests", f.path)) return { ok: false, error: t("request.errors.failed") };
  }
  const phone = input.contactPhone.trim() ? normalizePhone(input.contactPhone) : null;

  const supabase = await createClient();
  const { error } = await supabase.from("setup_requests").insert({
    restaurant_id: restaurantId,
    kind: input.kind,
    notes: notes || null,
    contact_phone: phone,
    files: files.map((f) => ({ path: f.path, name: f.name.slice(0, 120), type: f.type, size: f.size })) as unknown as Json[],
  });
  if (error) {
    console.error("[request] insert failed", error.message);
    return { ok: false, error: t("request.errors.failed") };
  }
  refresh();
  return { ok: true };
}
