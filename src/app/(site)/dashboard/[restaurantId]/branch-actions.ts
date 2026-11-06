"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { requireRestaurantAccess } from "@/lib/auth";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator } from "@/lib/i18n";
import { branchCookie } from "@/lib/branch-cookie";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

/** Which branch the dashboard shows (menu, tables, profile, QR codes). */
export async function chooseBranchAction(restaurantId: string, branchId: string): Promise<{ ok: boolean }> {
  await requireRestaurantAccess(restaurantId);
  const ctx = await getDashboardContext(restaurantId);
  if (!ctx.branches.some((b) => b.id === branchId)) return { ok: false };
  (await cookies()).set(branchCookie(restaurantId), branchId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 365 * 86_400 });
  refresh();
  return { ok: true };
}

export async function addBranchAction(
  restaurantId: string,
  input: { name: string; area: string; whatsapp: string; menu: "shared" | "copy" | "empty" },
): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const name = input.name.trim();
  if (!name || name.length > 80) return { ok: false, error: t("branches.errors.name"), field: "name" };
  const whatsapp = input.whatsapp.trim() ? normalizePhone(input.whatsapp) : null;
  if (input.whatsapp.trim() && !whatsapp) return { ok: false, error: t("branches.errors.whatsapp"), field: "whatsapp" };
  if (!["shared", "copy", "empty"].includes(input.menu)) return { ok: false, error: t("branches.errors.failed") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_branch", {
    p_restaurant_id: restaurantId,
    p_name: name,
    p_area: input.area.trim() || undefined,
    p_whatsapp: whatsapp ?? undefined,
    p_menu: input.menu,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: t("branches.proOnly") };
    console.error("[branches] add failed", { code: error.code, message: error.message });
    return { ok: false, error: t("branches.errors.failed") };
  }
  // Show the new branch, ready to set up.
  (await cookies()).set(branchCookie(restaurantId), (data as { branch_id: string }).branch_id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 365 * 86_400 });
  refresh();
  return { ok: true };
}
