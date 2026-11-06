"use server";

import { refresh } from "next/cache";
import { requireRestaurantAccess } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getTranslator } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function inviteStaffAction(
  restaurantId: string,
  input: { phone: string; branchId: string },
): Promise<{ ok: true; url: string; phone: string } | { ok: false; error: string }> {
  const { user } = await requireRestaurantAccess(restaurantId, ["owner"]);
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: t("staff.errors.phone") };
  if (input.branchId && !UUID.test(input.branchId)) return { ok: false, error: t("staff.errors.failed") };
  if (!(await rateLimit(`invite:${user.id}`, 30, 3600))) return { ok: false, error: t("auth.errors.tooMany") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_restaurant_id: restaurantId,
    p_role: "staff",
    p_phone: phone,
    p_branch_id: input.branchId || undefined,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: t("staff.proOnly") };
    console.error("[staff] invite failed", { code: error.code, message: error.message });
    return { ok: false, error: t("staff.errors.failed") };
  }
  refresh();
  return { ok: true, url: `${publicEnv.siteUrl}/invite/${(data as { token: string }).token}`, phone };
}

export async function removeStaffAction(restaurantId: string, membershipId: string): Promise<{ ok: boolean }> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  if (!UUID.test(membershipId)) return { ok: false };
  const supabase = await createClient();
  // Row-level security only lets owners remove staff, never other owners.
  const { data } = await supabase
    .from("memberships")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", membershipId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "staff")
    .select("id");
  refresh();
  return { ok: Boolean(data?.length) };
}

export async function cancelInviteAction(restaurantId: string, invitationId: string): Promise<{ ok: boolean }> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  if (!UUID.test(invitationId)) return { ok: false };
  const supabase = await createClient();
  const { data } = await supabase
    .from("invitations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("restaurant_id", restaurantId)
    .select("id");
  refresh();
  return { ok: Boolean(data?.length) };
}
