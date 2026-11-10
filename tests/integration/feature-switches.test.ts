import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { featureStatus, PLAN_FEATURE_SWITCH, SWITCHES, SWITCH_KEYS, type SwitchKey, type Switches } from "../../src/config/features";
import { FEATURES } from "../../src/config/plans";
import type { Json } from "../../src/lib/supabase/database.types";
import { anonClient, makeAdmin, selfServeRestaurant, serviceClient, setSubscription, signedInUser, uniq, type CreatedRestaurant, type TestUser } from "./helpers";

const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DAY = 86_400_000;
const paid = (plan: "standard" | "pro") => ({ plan, status: "active", paid_until: new Date(Date.now() + 30 * DAY).toISOString() });

function sql(query: string): string[] {
  return execFileSync("psql", [DB_URL, "-Atc", query], { encoding: "utf8" }).split("\n").filter(Boolean);
}

async function setGlobal(key: SwitchKey, enabled: boolean) {
  await serviceClient().from("feature_flags").update({ enabled }).eq("key", key).throwOnError();
}

async function menu(slug: string) {
  const { data, error } = await anonClient().rpc("get_public_menu", { p_slug: slug });
  if (error) throw error;
  return data as unknown as {
    version: number;
    features: Record<string, boolean>;
    branch: { order_mode: string | null; accepts_cash: boolean; momo: unknown };
    specials: unknown[];
    deals: unknown[];
    loyalty: unknown;
  };
}

describe("feature switches", () => {
  let admin: TestUser;
  let owner: TestUser;
  let other: TestUser;
  let staff: TestUser;
  let pro: CreatedRestaurant;
  let second: CreatedRestaurant;
  let dish: string;

  beforeAll(async () => {
    [admin, owner, other, staff] = await Promise.all([signedInUser(), signedInUser(), signedInUser(), signedInUser()]);
    await makeAdmin(admin.id);
    pro = await selfServeRestaurant(owner, `Switch Grill ${uniq()}`);
    second = await selfServeRestaurant(other, `Other Grill ${uniq()}`);
    await setSubscription(pro.restaurant_id, paid("pro"));
    await setSubscription(second.restaurant_id, paid("pro"));
    const db = serviceClient();
    await db.from("memberships").insert({ restaurant_id: pro.restaurant_id, user_id: staff.id, role: "staff" }).throwOnError();
    await db
      .from("branches")
      .update({ momo_mtn_code: "778899", order_mode: "kitchen" })
      .in("id", [pro.branch_id, second.branch_id])
      .throwOnError();
    const { data: cat } = await db.from("categories").insert({ restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, name: "Food" }).select("id").single().throwOnError();
    const { data: item } = await db
      .from("items")
      .insert({ restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, category_id: cat!.id, name: "Rolex", price_ugx: 5000 })
      .select("id")
      .single()
      .throwOnError();
    dish = item!.id;
    await db.from("specials").insert({ restaurant_id: pro.restaurant_id, title: "All day deal", price_ugx: 4000 }).throwOnError();
    await db
      .from("restaurants")
      .update({ loyalty_enabled: true, loyalty_visits: 3, loyalty_reward: "a free juice" })
      .eq("id", pro.restaurant_id)
      .throwOnError();
  });

  afterAll(() => {
    // Leave every switch on for the other test files.
    sql("update public.feature_flags set enabled = true; delete from public.restaurant_features;");
  });

  it("start from the launch defaults written in the code", async () => {
    const { data } = await serviceClient().from("feature_flags").select("key, launch_default");
    const fromDb = Object.fromEntries((data ?? []).map((r) => [r.key, r.launch_default]));
    expect(fromDb).toEqual(Object.fromEntries(SWITCHES.map((s) => [s.key, s.launchDefault])));
  });

  it("guard the same plan features in the database as in the code", () => {
    for (const feature of FEATURES) {
      const [value] = sql(`select coalesce(private.feature_switch_for('${feature}'), '')`);
      expect(value ?? "", feature).toBe(PLAN_FEATURE_SWITCH[feature] ?? "");
    }
  });

  it("can be read by signed-in people but changed only by the admin", async () => {
    // Owners, staff and other owners read the global switches; diners read nothing.
    expect((await owner.client.from("feature_flags").select("key")).data).toHaveLength(SWITCH_KEYS.length);
    expect((await anonClient().from("feature_flags").select("key").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("restaurant_features").select("key").limit(1)).error?.code).toBe("42501");

    // An owner cannot switch anything, globally or for their own restaurant.
    await owner.client.from("feature_flags").update({ enabled: false }).eq("key", "specials");
    expect(sql("select enabled from public.feature_flags where key = 'specials'")).toEqual(["t"]);
    const ownerInsert = await owner.client.from("restaurant_features").insert({ restaurant_id: pro.restaurant_id, key: "loyalty", enabled: false });
    expect(ownerInsert.error?.code).toBe("42501");

    // The admin can, and members see their own restaurant's overrides only.
    const adminInsert = await admin.client.from("restaurant_features").insert({ restaurant_id: pro.restaurant_id, key: "christmas", enabled: true });
    expect(adminInsert.error).toBeNull();
    expect((await staff.client.from("restaurant_features").select("key").eq("restaurant_id", pro.restaurant_id)).data).toEqual([{ key: "christmas" }]);
    expect((await other.client.from("restaurant_features").select("key").eq("restaurant_id", pro.restaurant_id)).data).toEqual([]);
    await owner.client.from("restaurant_features").delete().eq("restaurant_id", pro.restaurant_id);
    expect(sql(`select count(*) from public.restaurant_features where restaurant_id = '${pro.restaurant_id}'`)).toEqual(["1"]);
    await admin.client.from("restaurant_features").delete().eq("restaurant_id", pro.restaurant_id).throwOnError();
    const { error: adminUpdate } = await admin.client.from("feature_flags").update({ enabled: true }).eq("key", "specials");
    expect(adminUpdate).toBeNull();
  });

  it("hide every switched-off feature from the diner menu, and moving the version so phones refresh", async () => {
    const before = await menu(pro.slug);
    expect(before.features).toMatchObject({ specials: true, momo_pay: true, feedback: true, loyalty: true, waiter_call: true, order_kitchen: true });
    expect(before.branch).toMatchObject({ order_mode: "kitchen", accepts_cash: true });
    expect(before.specials).toHaveLength(1);
    expect(before.loyalty).not.toBeNull();

    for (const key of ["specials", "payments", "ratings", "loyalty", "waiter_call", "order_kitchen"] as const) await setGlobal(key, false);
    const after = await menu(pro.slug);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.features).toMatchObject({ specials: false, momo_pay: false, feedback: false, loyalty: false, waiter_call: false, order_kitchen: false });
    expect(after.branch).toMatchObject({ order_mode: "whatsapp", accepts_cash: false, momo: null });
    expect(after.specials).toEqual([]);
    expect(after.loyalty).toBeNull();

    // The database refuses what the menu no longer shows.
    const feedback = await serviceClient().rpc("submit_feedback", { p_slug: pro.slug, p_rating: 5, p_rate_key: uniq("ip") });
    expect(feedback.data).toBe("not_available");
    const order = await serviceClient().rpc("place_order", {
      p: { slug: pro.slug, ref: uniq("ord").replace(/[^A-Za-z0-9]/g, "").padEnd(14, "x"), mode: "kitchen", type: "dine_in", lines: [{ i: dish, q: 1 }] } as Json,
      p_rate_key: uniq("ip"),
    });
    expect((order.data as { result: string }).result).toBe("mode_changed");
    const { error: specialError } = await owner.client.from("specials").insert({ restaurant_id: pro.restaurant_id, title: "Sneaky", price_ugx: 1 });
    expect(specialError?.code).toBe("42501");

    // Every way of ordering off: the menu is for reading only.
    await setGlobal("order_whatsapp", false);
    await setGlobal("order_waiter", false);
    expect((await menu(pro.slug)).branch.order_mode).toBeNull();

    // Back on: everything returns as it was, nothing lost.
    for (const key of SWITCH_KEYS) await setGlobal(key, true);
    const restored = await menu(pro.slug);
    expect(restored.features).toMatchObject(before.features);
    expect(restored.branch).toMatchObject({ order_mode: "kitchen", accepts_cash: true });
    expect(restored.specials).toHaveLength(1);
    expect(restored.loyalty).toEqual(before.loyalty);
  });

  it("turn a feature off for one restaurant only, and On there cannot beat a global Off", async () => {
    await admin.client.from("restaurant_features").insert({ restaurant_id: pro.restaurant_id, key: "specials", enabled: false }).throwOnError();
    expect((await menu(pro.slug)).features.specials).toBe(false);
    expect((await menu(second.slug)).features.specials).toBe(true);

    await admin.client.from("restaurant_features").update({ enabled: true }).eq("restaurant_id", pro.restaurant_id).eq("key", "specials").throwOnError();
    await setGlobal("specials", false);
    expect((await menu(pro.slug)).features.specials).toBe(false);
    await setGlobal("specials", true);
    expect((await menu(pro.slug)).features.specials).toBe(true);
    await admin.client.from("restaurant_features").delete().eq("restaurant_id", pro.restaurant_id).throwOnError();
  });

  it("keep owners' insights and the kitchen closed while switched off", async () => {
    await setGlobal("insights", false);
    const insights = await owner.client.rpc("restaurant_insights", { p_restaurant_id: pro.restaurant_id, p_days: 7 });
    expect(insights.error?.code).toBe("42501");
    await setGlobal("insights", true);
    expect((await owner.client.rpc("restaurant_insights", { p_restaurant_id: pro.restaurant_id, p_days: 7 })).error).toBeNull();

    const ref = uniq("k").replace(/[^A-Za-z0-9]/g, "").padEnd(14, "x");
    const placed = await serviceClient().rpc("place_order", {
      p: { slug: pro.slug, ref, mode: "kitchen", type: "dine_in", lines: [{ i: dish, q: 1 }] } as Json,
      p_rate_key: uniq("ip"),
    });
    expect((placed.data as { result: string }).result).toBe("ok");
    await setGlobal("kitchen_screen", false);
    await staff.client.from("orders").update({ status: "cooking" }).eq("client_ref", ref);
    expect(sql(`select status from public.orders where client_ref = '${ref}'`)).toEqual(["new"]);
    await setGlobal("kitchen_screen", true);
    await staff.client.from("orders").update({ status: "cooking" }).eq("client_ref", ref).throwOnError();
    expect(sql(`select status from public.orders where client_ref = '${ref}'`)).toEqual(["cooking"]);
  });

  it("shows the Christmas theme when the owner or the admin switches it on, never when it is off", async () => {
    expect((await menu(pro.slug)).features.christmas).toBe(false);
    await owner.client.from("restaurants").update({ christmas_theme: true }).eq("id", pro.restaurant_id).throwOnError();
    expect((await menu(pro.slug)).features.christmas).toBe(true);
    await setGlobal("christmas", false);
    expect((await menu(pro.slug)).features.christmas).toBe(false);
    await setGlobal("christmas", true);
    await owner.client.from("restaurants").update({ christmas_theme: false }).eq("id", pro.restaurant_id).throwOnError();
    await admin.client.from("restaurant_features").insert({ restaurant_id: second.restaurant_id, key: "christmas", enabled: true }).throwOnError();
    expect((await menu(second.slug)).features.christmas).toBe(true);
    await admin.client.from("restaurant_features").delete().eq("restaurant_id", second.restaurant_id).throwOnError();
  });

  it("switches Menus near me and the rankings off for everyone or for one restaurant", async () => {
    const db = serviceClient();
    const area = `Switchville ${uniq()}`;
    for (const r of [pro, second]) {
      await db.from("restaurants").update({ directory_status: "approved" }).eq("id", r.restaurant_id).throwOnError();
      await db.from("branches").update({ area }).eq("id", r.branch_id).throwOnError();
      await db.from("events").insert({ restaurant_id: r.restaurant_id, branch_id: r.branch_id, type: "menu_view", session_id: `s${uniq()}`.slice(0, 30) }).throwOnError();
    }
    const listed = async () =>
      ((await anonClient().rpc("directory_search", { p_area: area })).data as { enabled: boolean; results: { slug: string }[] });
    expect((await listed()).results.map((r) => r.slug).sort()).toEqual([pro.slug, second.slug].sort());
    expect(((await anonClient().rpc("directory_top", { p_area: area })).data as unknown[]).length).toBe(2);

    await admin.client.from("restaurant_features").insert({ restaurant_id: second.restaurant_id, key: "directory", enabled: false }).throwOnError();
    expect((await listed()).results.map((r) => r.slug)).toEqual([pro.slug]);
    await admin.client.from("restaurant_features").delete().eq("restaurant_id", second.restaurant_id).throwOnError();

    await setGlobal("rankings", false);
    expect((await anonClient().rpc("directory_top", { p_area: area })).data).toEqual([]);
    await setGlobal("directory", false);
    expect(await listed()).toMatchObject({ enabled: false, results: [] });
    await setGlobal("directory", true);
    await setGlobal("rankings", true);
    expect((await listed()).results).toHaveLength(2);
  });

  it("counts restaurants per switch for the admin only, the same way the admin page explains them", async () => {
    await setGlobal("loyalty", false);
    await admin.client.from("restaurant_features").insert({ restaurant_id: pro.restaurant_id, key: "ratings", enabled: false }).throwOnError();
    const { data, error } = await admin.client.rpc("admin_feature_summary");
    expect(error).toBeNull();
    const summary = data as unknown as { total: number; features: Record<string, { active: number; on: number; off: number }> };
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(summary.features.loyalty.active).toBe(0);
    expect(summary.features.ratings.off).toBeGreaterThanOrEqual(1);
    expect((await owner.client.rpc("admin_feature_summary")).error?.code).toBe("42501");

    // The admin page's explanation (TypeScript) agrees with the database for every switch.
    const { data: flags } = await serviceClient().from("feature_flags").select("key, enabled");
    const global = Object.fromEntries((flags ?? []).map((f) => [f.key, f.enabled])) as Switches;
    const { data: rows } = await serviceClient().from("restaurant_features").select("key, enabled").eq("restaurant_id", pro.restaurant_id);
    const overrides = Object.fromEntries((rows ?? []).map((r) => [r.key, r.enabled])) as Partial<Record<SwitchKey, boolean>>;
    const { data: r } = await serviceClient().from("restaurants").select("christmas_theme, directory_status").eq("id", pro.restaurant_id).single();
    for (const key of SWITCH_KEYS) {
      const [active] = sql(`select private.feature_active('${pro.restaurant_id}', '${key}')`);
      const status = featureStatus(key, { plan: "pro", global, overrides, christmasTheme: r!.christmas_theme, listed: r!.directory_status === "approved" });
      expect(status.active, key).toBe(active === "t");
    }
    await setGlobal("loyalty", true);
  });

  it("only stamps loyalty cards while loyalty is on", async () => {
    const phone = createHash("sha256").update(uniq("phone")).digest("hex");
    const place = () =>
      serviceClient().rpc("place_order", {
        p: { slug: pro.slug, ref: uniq("w").replace(/[^A-Za-z0-9]/g, "").padEnd(14, "x"), mode: "whatsapp", type: "dine_in", lines: [{ i: dish, q: 1 }] } as Json,
        p_rate_key: uniq("ip"),
        p_device_hash: phone,
      });
    await serviceClient().from("branches").update({ whatsapp: "256772000111" }).eq("id", pro.branch_id).throwOnError();
    await setGlobal("loyalty", false);
    expect((((await place()).data) as { loyalty: unknown }).loyalty).toBeNull();
    await setGlobal("loyalty", true);
    expect((((await place()).data) as { loyalty: { stamps: number } }).loyalty.stamps).toBe(1);
  });
});
