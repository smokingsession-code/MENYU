import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, makeAdmin, selfServeRestaurant, serviceClient, setSubscription, signedInUser, uniq, type CreatedRestaurant, type TestUser } from "./helpers";

const DAY = 86_400_000;
const paidPro = { plan: "pro", status: "active", paid_until: new Date(Date.now() + 30 * DAY).toISOString() };

/** Today at a given Kampala hour, as an ISO timestamp (UTC+3). */
function kampalaToday(hour: number): string {
  const local = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${local}T${String(hour).padStart(2, "0")}:30:00+03:00`).toISOString();
}

describe("specials, feedback and insights", () => {
  let owner: TestUser;
  let staff: TestUser;
  let stranger: TestUser;
  let admin: TestUser;
  let standardOwner: TestUser;
  let pro: CreatedRestaurant;
  let standard: CreatedRestaurant;
  let rolex: string;
  let tea: string;

  beforeAll(async () => {
    [owner, staff, stranger, admin, standardOwner] = await Promise.all([signedInUser(), signedInUser(), signedInUser(), signedInUser(), signedInUser()]);
    pro = await selfServeRestaurant(owner, "Pro Lounge");
    standard = await selfServeRestaurant(standardOwner, "Standard Cafe");
    await selfServeRestaurant(stranger, "Stranger Bar");
    await setSubscription(pro.restaurant_id, paidPro);
    await makeAdmin(admin.id);
    const db = serviceClient();
    const { error } = await db.from("memberships").insert({ restaurant_id: pro.restaurant_id, user_id: staff.id, role: "staff" });
    if (error) throw error;
    const { data: cat } = await db.from("categories").insert({ restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, name: "Breakfast" }).select("id").single();
    const { data: items } = await db
      .from("items")
      .insert([
        { restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, category_id: cat!.id, name: "Rolex", price_ugx: 5000, sort_order: 0, description: null },
        { restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, category_id: cat!.id, name: "African tea", price_ugx: 2000, sort_order: 1, description: null },
      ])
      .select("id, name");
    rolex = items!.find((i) => i.name === "Rolex")!.id;
    tea = items!.find((i) => i.name === "African tea")!.id;
  });

  it("accepts private feedback only on plans that include it, a few at a time", async () => {
    const db = serviceClient();
    const key = uniq("ip");
    const send = (slug: string, rating: number, rateKey = key) =>
      db.rpc("submit_feedback", { p_slug: slug, p_rating: rating, p_comment: "  Great rolex!  ", p_table: "7", p_rate_key: rateKey });

    expect((await send(pro.slug, 5)).data).toBe("ok");
    expect((await send(pro.slug, 0)).data).toBe("invalid");
    expect((await send(standard.slug, 4)).data).toBe("not_available");
    expect((await send("no-such-menu", 4)).data).toBe("not_found");
    expect((await send(pro.slug, 4)).data).toBe("ok");
    expect((await send(pro.slug, 3)).data).toBe("ok");
    expect((await send(pro.slug, 3)).data).toBe("too_many");
    expect((await send(pro.slug, 3, uniq("other-ip"))).data).toBe("ok");

    for (const client of [anonClient(), owner.client]) {
      expect((await client.rpc("submit_feedback", { p_slug: pro.slug, p_rating: 5 })).error?.code).toBe("42501");
    }
    const { data: mine } = await owner.client.from("feedback").select("rating, comment, table_code").eq("restaurant_id", pro.restaurant_id);
    expect(mine).toHaveLength(4);
    expect(mine![0]).toMatchObject({ comment: "Great rolex!", table_code: "7" });
    expect((await staff.client.from("feedback").select("id").eq("restaurant_id", pro.restaurant_id)).data).toHaveLength(4);
    expect((await stranger.client.from("feedback").select("id").eq("restaurant_id", pro.restaurant_id)).data).toHaveLength(0);
  });

  it("counts views, orders, busy hours and top dishes in Kampala time, for Pro owners and admins only", async () => {
    const db = serviceClient();
    const at = kampalaToday(9);
    const event = (type: string, extra: Record<string, unknown> = {}) => ({
      restaurant_id: pro.restaurant_id,
      branch_id: pro.branch_id,
      type,
      occurred_at: at,
      ...extra,
    });
    const { error } = await db.from("events").insert([
      event("menu_view", { session_id: "visitor-one-1", table_code: "7" }),
      event("menu_view", { session_id: "visitor-one-1", table_code: "7" }),
      event("menu_view", { session_id: "visitor-two-2" }),
      event("item_view", { item_id: rolex }),
      event("item_view", { item_id: rolex }),
      event("item_view", { item_id: tea }),
      event("whatsapp_order"),
      event("waiter_call", { table_code: "7" }),
      event("momo_view"),
    ]);
    if (error) throw error;

    const { data, error: rpcError } = await owner.client.rpc("restaurant_insights", { p_restaurant_id: pro.restaurant_id, p_days: 7 });
    expect(rpcError).toBeNull();
    const insights = data as {
      totals: Record<string, number>;
      per_day: { date: string; views: number; orders: number }[];
      hours: { hour: number; views: number }[];
      top_items: { name: string; views: number }[];
      tables: { code: string; views: number }[];
    };
    expect(insights.totals).toMatchObject({ menu_views: 3, visitors: 2, item_views: 3, whatsapp_orders: 1, waiter_calls: 1, momo_views: 1, bill_requests: 0 });
    expect(insights.per_day).toHaveLength(7);
    expect(insights.per_day.at(-1)).toMatchObject({ views: 3, orders: 1 });
    expect(insights.hours).toHaveLength(24);
    expect(insights.hours[9].views).toBe(3);
    expect(insights.top_items.map((i) => [i.name, i.views])).toEqual([
      ["Rolex", 2],
      ["African tea", 1],
    ]);
    expect(insights.tables).toEqual([{ code: "7", views: 2 }]);

    expect((await admin.client.rpc("restaurant_insights", { p_restaurant_id: pro.restaurant_id, p_days: 30 })).error).toBeNull();
    expect((await stranger.client.rpc("restaurant_insights", { p_restaurant_id: pro.restaurant_id })).error?.code).toBe("42501");
    expect((await staff.client.rpc("restaurant_insights", { p_restaurant_id: pro.restaurant_id })).error?.code).toBe("42501");
    expect((await standardOwner.client.rpc("restaurant_insights", { p_restaurant_id: standard.restaurant_id })).error?.code).toBe("42501");
  });

  it("saves specials with their dishes on Pro, and diners see them", async () => {
    const special = {
      restaurant_id: pro.restaurant_id,
      title: " Breakfast deal ",
      description: "Every morning",
      price_ugx: 6000,
      days: [1, 2, 3, 4, 5, 5],
      start_time: "07:00",
      end_time: "10:00",
      is_active: true,
      item_ids: [rolex, tea],
    };
    const { data: id, error } = await owner.client.rpc("save_special", { p: special });
    expect(error).toBeNull();
    const { data: saved } = await owner.client.from("specials").select("title, days, special_items(item_id)").eq("id", id as string).single();
    expect(saved).toMatchObject({ title: "Breakfast deal", days: [1, 2, 3, 4, 5] });
    expect(saved!.special_items).toHaveLength(2);

    const { error: updateError } = await owner.client.rpc("save_special", { p: { ...special, id, item_ids: [rolex] } });
    expect(updateError).toBeNull();
    const { data: menu } = await anonClient().rpc("get_public_menu", { p_slug: pro.slug });
    const specials = (menu as { specials: { title: string; start: string; items: { name: string }[] }[] }).specials;
    expect(specials).toEqual([expect.objectContaining({ title: "Breakfast deal", start: "07:00", items: [expect.objectContaining({ name: "Rolex" })] })]);

    const refused = await standardOwner.client.rpc("save_special", { p: { ...special, restaurant_id: standard.restaurant_id, item_ids: [] } });
    expect(refused.error?.code).toBe("42501");
    const staffTry = await staff.client.rpc("save_special", { p: { ...special, item_ids: [] } });
    expect(staffTry.error?.code).toBe("42501");
  });
});
