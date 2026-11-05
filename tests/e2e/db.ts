import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export function service() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A restaurant with simple items, created straight in the database for tests. */
export async function createMenuFixture(options: {
  plan?: "free" | "standard" | "pro";
  status?: "trial" | "active" | "overdue" | "free";
  items?: number;
  whatsapp?: string;
  name?: string;
}) {
  const db = service();
  const suffix = randomBytes(3).toString("hex");
  const name = options.name ?? `Test Grill ${suffix}`;
  const { data: r, error } = await db.from("restaurants").insert({ name, brand_color: "#8B2E16" }).select("id").single();
  if (error) throw error;
  const { data: menu } = await db.from("menus").insert({ restaurant_id: r.id }).select("id").single();
  const slug = `test-grill-${suffix}`;
  const { data: branch } = await db
    .from("branches")
    .insert({
      restaurant_id: r.id,
      menu_id: menu!.id,
      slug,
      area: "Kira",
      whatsapp: options.whatsapp ?? "256772000999",
      phone: options.whatsapp ?? "256772000999",
      is_main: true,
      opening_hours: { mon: [["00:00", "00:00"]], tue: [["00:00", "00:00"]], wed: [["00:00", "00:00"]], thu: [["00:00", "00:00"]], fri: [["00:00", "00:00"]], sat: [["00:00", "00:00"]], sun: [["00:00", "00:00"]] },
    })
    .select("id")
    .single();
  await db.from("subscriptions").insert({
    restaurant_id: r.id,
    plan: options.plan ?? "standard",
    status: options.status ?? "active",
    paid_until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  const { data: cat } = await db.from("categories").insert({ restaurant_id: r.id, menu_id: menu!.id, name: "Mains", sort_order: 0 }).select("id").single();
  const count = options.items ?? 3;
  await db.from("items").insert(
    Array.from({ length: count }, (_, i) => ({
      restaurant_id: r.id,
      menu_id: menu!.id,
      category_id: cat!.id,
      name: `Dish ${i + 1}`,
      price_ugx: 1000 * (i + 1),
      sort_order: i,
      description: null,
    })),
  );
  await db.from("tables").insert({ restaurant_id: r.id, branch_id: branch!.id, label: "7", code: "7", sort_order: 0 });
  return { restaurantId: r.id, branchId: branch!.id, slug, name };
}

/** A confirmed user with a phone number, linked to a restaurant. */
export async function createMember(restaurantId: string, role: "owner" | "staff" = "owner") {
  const db = service();
  const rest = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const digits = `25678${rest}`;
  const { data, error } = await db.auth.admin.createUser({ phone: digits, phone_confirm: true });
  if (error) throw error;
  const { error: m } = await db.from("memberships").insert({ user_id: data.user.id, restaurant_id: restaurantId, role });
  if (m) throw m;
  return { userId: data.user.id, digits, local: `078${rest}` };
}

/** A phone number nobody has used yet (for signup tests). */
export function freshPhone() {
  const rest = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  return { digits: `25675${rest}`, local: `075${rest}` };
}
