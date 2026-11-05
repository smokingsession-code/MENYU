import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  phone: string | null;
  email: string | null;
}

/** The signed-in user, verified from the session JWT. Null when signed out. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Checking the session reads the clock (token expiry), so it must wait for
  // a real request rather than run while Next.js prerenders the page shell.
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    phone: typeof claims.phone === "string" && claims.phone ? claims.phone : null,
    email: typeof claims.email === "string" && claims.email ? claims.email : null,
  };
});

export async function requireUser(nextPath = "/dashboard"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

export const isAdmin = cache(async (): Promise<boolean> => {
  const user = await getSessionUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(data);
});

/** Admin pages 404 for everyone else, so the admin area is not advertised. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser("/admin");
  if (!(await isAdmin())) notFound();
  return user;
}

export type Role = "owner" | "staff";

export interface Membership {
  restaurantId: string;
  role: Role;
  branchId: string | null;
  restaurantName: string;
}

export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("restaurant_id, role, branch_id, restaurants!inner(name, deleted_at)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .is("restaurants.deleted_at", null)
    .order("created_at");
  if (error) throw new Error(`Could not load memberships: ${error.message}`);
  return (data ?? []).map((m) => ({
    restaurantId: m.restaurant_id,
    role: m.role as Role,
    branchId: m.branch_id,
    restaurantName: m.restaurants.name,
  }));
});

/**
 * The caller's access to one restaurant: their membership, or "admin" for
 * the Menyu team. 404 when they have none, so ids cannot be probed.
 */
export async function requireRestaurantAccess(restaurantId: string, roles: readonly Role[] = ["owner", "staff"]) {
  const user = await requireUser(`/dashboard/${restaurantId}`);
  if (await isAdmin()) return { user, role: "admin" as const, branchId: null };
  const membership = (await getMemberships()).find((m) => m.restaurantId === restaurantId);
  if (!membership || !roles.includes(membership.role)) notFound();
  return { user, role: membership.role, branchId: membership.branchId };
}

/** Only same-site paths are allowed as a post-login destination. */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}
