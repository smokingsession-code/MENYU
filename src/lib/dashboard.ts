import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { PLANS, planHas, type PlanCode } from "@/config/plans";
import { requireRestaurantAccess } from "@/lib/auth";
import { effectivePlan } from "@/lib/billing/plan";
import type { OpeningHours } from "@/lib/hours";
import type { ImageDescriptor } from "@/lib/images/shared";
import { createClient } from "@/lib/supabase/server";

export interface DashboardBranch {
  id: string;
  slug: string;
  name: string | null;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  whatsapp: string | null;
  momoMtnCode: string | null;
  momoMtnName: string | null;
  momoAirtelCode: string | null;
  momoAirtelName: string | null;
  openingHours: OpeningHours;
  acceptsDineIn: boolean;
  acceptsTakeaway: boolean;
  acceptsDelivery: boolean;
  deliveryNote: string | null;
  menuId: string;
  isMain: boolean;
}

export interface DashboardContext {
  restaurantId: string;
  role: "owner" | "staff" | "admin";
  name: string;
  description: string | null;
  brandColor: string;
  logo: ImageDescriptor | null;
  cover: ImageDescriptor | null;
  cuisines: string[];
  priceRange: number | null;
  plan: PlanCode;
  /** Billing details, for owners and admins only. */
  subscription: {
    plan: string;
    status: string;
    billing_interval: string;
    trial_ends_at: string | null;
    paid_until: string | null;
    grace_days: number;
  } | null;
  branches: DashboardBranch[];
  branch: DashboardBranch;
  canEditMenu: boolean;
  canManage: boolean;
  canToggleSoldOut: boolean;
  isDemo: boolean;
  /** For the owner's "invite another restaurant" link. */
  referralCode: string;
}

/**
 * Everything a dashboard page needs about one restaurant, after checking
 * the caller may see it (owner, staff or admin). The permissions mirror the
 * database rules, which remain the real guard.
 */
export const getDashboardContext = cache(async (restaurantId: string, branchId?: string): Promise<DashboardContext> => {
  if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) notFound();
  const { role, branchId: staffBranch } = await requireRestaurantAccess(restaurantId);

  const supabase = await createClient();
  const { data: r } = await supabase
    .from("restaurants")
    .select(
      "id, name, description, brand_color, logo, cover, cuisines, price_range, is_demo, referral_code, subscriptions(plan, status, billing_interval, trial_ends_at, paid_until, grace_days), branches(id, slug, name, area, address, lat, lng, phone, whatsapp, momo_mtn_code, momo_mtn_name, momo_airtel_code, momo_airtel_name, opening_hours, accepts_dine_in, accepts_takeaway, accepts_delivery, delivery_note, menu_id, is_main, sort_order, deleted_at)",
    )
    .eq("id", restaurantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!r) notFound();

  const branches: DashboardBranch[] = r.branches
    .filter((b) => !b.deleted_at)
    .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.sort_order - b.sort_order)
    .map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      area: b.area,
      address: b.address,
      lat: b.lat,
      lng: b.lng,
      phone: b.phone,
      whatsapp: b.whatsapp,
      momoMtnCode: b.momo_mtn_code,
      momoMtnName: b.momo_mtn_name,
      momoAirtelCode: b.momo_airtel_code,
      momoAirtelName: b.momo_airtel_name,
      openingHours: (b.opening_hours ?? {}) as OpeningHours,
      acceptsDineIn: b.accepts_dine_in,
      acceptsTakeaway: b.accepts_takeaway,
      acceptsDelivery: b.accepts_delivery,
      deliveryNote: b.delivery_note,
      menuId: b.menu_id,
      isMain: b.is_main,
    }));
  if (branches.length === 0) notFound();

  // Staff limited to one branch only ever see that branch.
  const visible = staffBranch ? branches.filter((b) => b.id === staffBranch) : branches;
  const branch = visible.find((b) => b.id === branchId) ?? visible[0];

  // Staff cannot read the subscription (row security), so fall back to the
  // public plan to decide what they see.
  const subscription = r.subscriptions;
  let plan: PlanCode;
  if (subscription) {
    plan = effectivePlan(subscription);
  } else {
    const { data } = await supabase.rpc("get_public_menu", { p_slug: branch.slug });
    plan = ((data as { plan?: PlanCode } | null)?.plan ?? "free") as PlanCode;
  }

  const admin = role === "admin";
  return {
    restaurantId,
    role,
    name: r.name,
    description: r.description,
    brandColor: r.brand_color,
    logo: (r.logo as unknown as ImageDescriptor | null) ?? null,
    cover: (r.cover as unknown as ImageDescriptor | null) ?? null,
    cuisines: r.cuisines,
    priceRange: r.price_range,
    plan,
    subscription: role === "staff" ? null : subscription,
    branches: visible,
    branch,
    canEditMenu: admin || (role === "owner" && planHas(plan, "menu_editing")),
    canManage: admin || (role === "owner" && planHas(plan, "dashboard")),
    canToggleSoldOut: admin || (role === "owner" && planHas(plan, "menu_editing")) || (role === "staff" && planHas(plan, "staff")),
    isDemo: r.is_demo,
    referralCode: r.referral_code,
  };
});

export function itemLimit(plan: PlanCode): number | null {
  return PLANS[plan].limits.items;
}
