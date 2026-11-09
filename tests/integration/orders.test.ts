import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Json } from "../../src/lib/supabase/database.types";
import { anonClient, selfServeRestaurant, serviceClient, setSubscription, signedInUser, uniq, type CreatedRestaurant, type TestUser } from "./helpers";

const DAY = 86_400_000;
const paid = (plan: "standard" | "pro") => ({ plan, status: "active", paid_until: new Date(Date.now() + 30 * DAY).toISOString() });
const device = (name: string) => createHash("sha256").update(name).digest("hex");
const ref = () => uniq("ord").replace(/[^A-Za-z0-9_-]/g, "").padEnd(14, "x").slice(0, 40);

type OrderResult = {
  result: string;
  items?: string[];
  order?: { ref: string; number: number | null; status: string; total: number; item_count: number; lines: { name: string; qty: number; unit: number; total: number; size?: string; addons?: string[]; percent_off?: number }[] };
  loyalty?: { stamps: number; visits: number; ready: boolean; earned: boolean; stamped_today: boolean } | null;
};

async function place(p: Record<string, unknown>, deviceHash?: string, rateKey = uniq("ip")): Promise<OrderResult> {
  const { data, error } = await serviceClient().rpc("place_order", { p: p as Json, p_rate_key: rateKey, p_device_hash: deviceHash });
  if (error) throw error;
  return data as unknown as OrderResult;
}

describe("orders, the kitchen, loyalty and Sell it today", () => {
  let owner: TestUser;
  let staff: TestUser;
  let stranger: TestUser;
  let standardOwner: TestUser;
  let pro: CreatedRestaurant;
  let standard: CreatedRestaurant;
  let rolex: string;
  let juice: string;
  let large: string;
  let small: string;
  let avocado: string;
  let standardItem: string;

  beforeAll(async () => {
    [owner, staff, stranger, standardOwner] = await Promise.all([signedInUser(), signedInUser(), signedInUser(), signedInUser()]);
    pro = await selfServeRestaurant(owner, `Kitchen Grill ${uniq()}`);
    standard = await selfServeRestaurant(standardOwner, `Waiter Cafe ${uniq()}`);
    await selfServeRestaurant(stranger, `Other ${uniq()}`);
    await setSubscription(pro.restaurant_id, paid("pro"));
    await setSubscription(standard.restaurant_id, paid("standard"));
    const db = serviceClient();
    await db.from("memberships").insert({ restaurant_id: pro.restaurant_id, user_id: staff.id, role: "staff" }).throwOnError();

    const { data: cat } = await db.from("categories").insert({ restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, name: "Food" }).select("id").single().throwOnError();
    const { data: items } = await db
      .from("items")
      .insert([
        { restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, category_id: cat!.id, name: "Rolex", price_ugx: 5000, sort_order: 0 },
        { restaurant_id: pro.restaurant_id, menu_id: pro.menu_id, category_id: cat!.id, name: "Passion juice", price_ugx: null, sort_order: 1 },
      ])
      .select("id, name")
      .throwOnError();
    rolex = items!.find((i) => i.name === "Rolex")!.id;
    juice = items!.find((i) => i.name === "Passion juice")!.id;
    const { data: options } = await db
      .from("item_options")
      .insert([
        { restaurant_id: pro.restaurant_id, item_id: juice, kind: "size", name: "Small", price_ugx: 3000, sort_order: 0 },
        { restaurant_id: pro.restaurant_id, item_id: juice, kind: "size", name: "Large", price_ugx: 5000, sort_order: 1 },
        { restaurant_id: pro.restaurant_id, item_id: rolex, kind: "addon", name: "Avocado", price_ugx: 1000, sort_order: 0 },
      ])
      .select("id, name")
      .throwOnError();
    small = options!.find((o) => o.name === "Small")!.id;
    large = options!.find((o) => o.name === "Large")!.id;
    avocado = options!.find((o) => o.name === "Avocado")!.id;

    const { data: scat } = await db.from("categories").insert({ restaurant_id: standard.restaurant_id, menu_id: standard.menu_id, name: "Drinks" }).select("id").single().throwOnError();
    const { data: sitem } = await db
      .from("items")
      .insert({ restaurant_id: standard.restaurant_id, menu_id: standard.menu_id, category_id: scat!.id, name: "Tea", price_ugx: 2000 })
      .select("id")
      .single()
      .throwOnError();
    standardItem = sitem!.id;
  });

  it("prices every line from the menu, never from the phone", async () => {
    const result = await place({
      slug: pro.slug,
      ref: ref(),
      mode: "whatsapp",
      type: "dine_in",
      table_label: "Garden 2",
      payment: "cash",
      lines: [
        { i: rolex, a: [avocado], q: 2, n: "no onions", price: 1 },
        { i: juice, s: large, q: 1, unitPrice: 10 },
      ],
    });
    expect(result.result).toBe("ok");
    expect(result.order).toMatchObject({ status: "sent", number: null, total: 17_000, item_count: 3 });
    expect(result.order!.lines).toEqual([
      { item_id: rolex, name: "Rolex", addons: ["Avocado"], qty: 2, unit: 6000, total: 12_000, note: "no onions" },
      { item_id: juice, name: "Passion juice", size: "Large", addons: [], qty: 1, unit: 5000, total: 5000 },
    ]);
    const { data: row } = await serviceClient().from("orders").select("table_label, payment, mode").eq("client_ref", result.order!.ref).single();
    expect(row).toEqual({ table_label: "Garden 2", payment: "cash", mode: "whatsapp" });
  });

  it("refuses made-up dishes and options, and names dishes that just sold out", async () => {
    const base = { slug: pro.slug, mode: "whatsapp", type: "dine_in" };
    expect((await place({ ...base, ref: ref(), lines: [{ i: juice, q: 1 }] })).result).toBe("changed");
    expect((await place({ ...base, ref: ref(), lines: [{ i: rolex, s: small, q: 1 }] })).result).toBe("changed");
    expect((await place({ ...base, ref: ref(), lines: [{ i: rolex, a: [small], q: 1 }] })).result).toBe("changed");
    expect((await place({ ...base, ref: ref(), lines: [{ i: standardItem, q: 1 }] })).result).toBe("changed");
    expect((await place({ ...base, ref: ref(), lines: [{ i: rolex, q: 0 }] })).result).toBe("invalid");
    expect((await place({ ...base, ref: "short", lines: [{ i: rolex, q: 1 }] })).result).toBe("invalid");

    await serviceClient().from("sold_out").insert({ branch_id: pro.branch_id, item_id: rolex, restaurant_id: pro.restaurant_id }).throwOnError();
    const soldOut = await place({ ...base, ref: ref(), lines: [{ i: rolex, q: 1 }, { i: juice, s: small, q: 1 }] });
    expect(soldOut).toEqual({ result: "sold_out", items: ["Rolex"] });
    await serviceClient().from("sold_out").delete().eq("item_id", rolex).throwOnError();
  });

  it("showing the same order again updates it instead of adding another", async () => {
    await serviceClient().from("branches").update({ order_mode: "waiter" }).eq("id", standard.branch_id).throwOnError();
    const r = ref();
    const first = await place({ slug: standard.slug, ref: r, mode: "waiter", type: "dine_in", lines: [{ i: standardItem, q: 1 }] });
    expect(first.order).toMatchObject({ status: "sent", total: 2000 });
    const again = await place({ slug: standard.slug, ref: r, mode: "waiter", type: "dine_in", lines: [{ i: standardItem, q: 3 }] });
    expect(again.order).toMatchObject({ total: 6000, item_count: 3 });
    const { count } = await serviceClient().from("orders").select("id", { count: "exact", head: true }).eq("client_ref", r);
    expect(count).toBe(1);
    // Standard has no kitchen screen; the menu says "waiter" and so must the order.
    expect((await place({ slug: standard.slug, ref: ref(), mode: "kitchen", type: "dine_in", lines: [{ i: standardItem, q: 1 }] })).result).toBe("mode_changed");
  });

  it("numbers kitchen orders, treats a resend as a retry, and only the team moves them along", async () => {
    await serviceClient().from("branches").update({ order_mode: "kitchen" }).eq("id", pro.branch_id).throwOnError();
    const { data: menu } = await anonClient().rpc("get_public_menu", { p_slug: pro.slug });
    expect((menu as { branch: { order_mode: string } }).branch.order_mode).toBe("kitchen");

    const firstRef = ref();
    const first = await place({ slug: pro.slug, ref: firstRef, mode: "kitchen", type: "dine_in", lines: [{ i: rolex, q: 1 }] });
    const second = await place({ slug: pro.slug, ref: ref(), mode: "kitchen", type: "takeaway", lines: [{ i: juice, s: small, q: 2 }] });
    expect(first.order).toMatchObject({ status: "new" });
    expect(second.order!.number).toBe(first.order!.number! + 1);
    const retry = await place({ slug: pro.slug, ref: firstRef, mode: "kitchen", type: "dine_in", lines: [{ i: rolex, q: 9 }] });
    expect(retry.order).toMatchObject({ number: first.order!.number, total: 5000 });
    // Delivery goes on WhatsApp, never to the kitchen.
    expect((await place({ slug: pro.slug, ref: ref(), mode: "kitchen", type: "delivery", lines: [{ i: rolex, q: 1 }] })).result).toBe("mode_changed");

    const { data: seen } = await staff.client.from("orders").select("id, status").eq("client_ref", firstRef).single();
    expect(seen?.status).toBe("new");
    const { error: moveError } = await staff.client.from("orders").update({ status: "cooking" }).eq("id", seen!.id);
    expect(moveError).toBeNull();
    const { data: status } = await serviceClient().rpc("order_status", { p_slug: pro.slug, p_ref: firstRef });
    expect(status).toMatchObject({ status: "cooking", number: first.order!.number });

    // Strangers and diners see nothing and change nothing.
    expect((await stranger.client.from("orders").select("id").eq("client_ref", firstRef)).data).toEqual([]);
    await stranger.client.from("orders").update({ status: "done" }).eq("id", seen!.id);
    expect((await anonClient().from("orders").select("id").limit(1)).error?.code).toBe("42501");
    const { data: still } = await serviceClient().from("orders").select("status, total_ugx").eq("id", seen!.id).single();
    expect(still).toEqual({ status: "cooking", total_ugx: 5000 });
    // The team can change the status, not the bill.
    expect((await owner.client.from("orders").update({ total_ugx: 1 }).eq("id", seen!.id)).error?.code).toBe("42501");
    await serviceClient().from("branches").update({ order_mode: "whatsapp" }).eq("id", pro.branch_id).throwOnError();
  });

  it("gives one loyalty stamp a day per phone, and a reward after enough visits", async () => {
    await serviceClient()
      .from("restaurants")
      .update({ loyalty_enabled: true, loyalty_visits: 3, loyalty_reward: "a free juice", loyalty_min_ugx: 4000 })
      .eq("id", pro.restaurant_id)
      .throwOnError();
    const phone = device(uniq("phone"));
    const order = (lines: unknown[]) => place({ slug: pro.slug, ref: ref(), mode: "whatsapp", type: "dine_in", lines }, phone);

    const small1 = await order([{ i: juice, s: small, q: 1 }]);
    expect(small1.loyalty).toMatchObject({ stamps: 0, visits: 3, earned: false });
    const first = await order([{ i: rolex, q: 1 }]);
    expect(first.loyalty).toMatchObject({ stamps: 1, earned: true, ready: false, stamped_today: true });
    const sameDay = await order([{ i: rolex, q: 2 }]);
    expect(sameDay.loyalty).toMatchObject({ stamps: 1, earned: false });

    const db = serviceClient();
    const backdate = () =>
      db.from("loyalty_cards").update({ last_stamp_on: "2026-01-01" }).eq("restaurant_id", pro.restaurant_id).eq("device_hash", phone).throwOnError();
    await backdate();
    expect((await order([{ i: rolex, q: 1 }])).loyalty).toMatchObject({ stamps: 2, earned: true });
    await backdate();
    expect((await order([{ i: rolex, q: 1 }])).loyalty).toMatchObject({ stamps: 3, ready: true });
    await backdate();
    // No more stamps while the reward waits.
    expect((await order([{ i: rolex, q: 1 }])).loyalty).toMatchObject({ stamps: 3, earned: false, ready: true });

    const { data: status } = await db.rpc("loyalty_status", { p_slug: pro.slug, p_device_hash: phone });
    expect(status).toMatchObject({ stamps: 3, ready: true });
    const { data: used } = await db.rpc("redeem_loyalty", { p_slug: pro.slug, p_device_hash: phone, p_rate_key: uniq("ip") });
    expect(used).toMatchObject({ result: "ok", loyalty: { stamps: 0, ready: false } });
    expect((used as { loyalty: { last_used_at: string | null } }).loyalty.last_used_at).not.toBeNull();
    const { data: again } = await db.rpc("redeem_loyalty", { p_slug: pro.slug, p_device_hash: phone, p_rate_key: uniq("ip") });
    expect(again).toEqual({ result: "not_ready" });

    // Owners see their cards; nobody else does.
    expect((await owner.client.from("loyalty_cards").select("stamps").eq("device_hash", phone)).data).toEqual([{ stamps: 0 }]);
    expect((await staff.client.from("loyalty_cards").select("stamps").eq("device_hash", phone)).data).toEqual([]);
    // Restaurants without the loyalty feature give no stamps.
    const standardResult = await place({ slug: standard.slug, ref: ref(), mode: "waiter", type: "dine_in", lines: [{ i: standardItem, q: 3 }] }, phone);
    expect(standardResult.loyalty).toBeNull();
  });

  it("Sell it today: owners on Pro start a deal, the menu and orders use the deal price", async () => {
    const ends = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const { data: dealId, error } = await owner.client.rpc("start_deal", {
      p_restaurant_id: pro.restaurant_id,
      p_branch_id: pro.branch_id,
      p_item_id: juice,
      p_percent: 30,
      p_ends_at: ends,
      p_note: "Fresh this morning",
    });
    expect(error).toBeNull();

    const { data: menu } = await anonClient().rpc("get_public_menu", { p_slug: pro.slug });
    expect((menu as { deals: unknown[] }).deals).toEqual([
      { id: dealId, item_id: juice, percent: 30, note: "Fresh this morning", note_lg: null, ends_at: expect.any(String) },
    ]);

    const result = await place({ slug: pro.slug, ref: ref(), mode: "whatsapp", type: "dine_in", lines: [{ i: juice, s: large, q: 2 }] });
    expect(result.order!.lines[0]).toMatchObject({ unit: 3500, total: 7000, percent_off: 30 });

    // A new deal on the same dish replaces the old one.
    await owner.client.rpc("start_deal", {
      p_restaurant_id: pro.restaurant_id,
      p_branch_id: pro.branch_id,
      p_item_id: juice,
      p_percent: 50,
      p_ends_at: ends,
    });
    const { data: live } = await serviceClient().from("deals").select("percent_off").eq("item_id", juice).gt("ends_at", new Date().toISOString());
    expect(live).toEqual([{ percent_off: 50 }]);

    // Ended deals leave the menu and the price goes back (after a short grace).
    await serviceClient().from("deals").update({ ends_at: new Date(Date.now() - 20 * 60_000).toISOString(), starts_at: new Date(Date.now() - 60 * 60_000).toISOString() }).eq("item_id", juice).throwOnError();
    const { data: after } = await anonClient().rpc("get_public_menu", { p_slug: pro.slug });
    expect((after as { deals: unknown[] }).deals).toEqual([]);
    const full = await place({ slug: pro.slug, ref: ref(), mode: "whatsapp", type: "dine_in", lines: [{ i: juice, s: large, q: 1 }] });
    expect(full.order!.total).toBe(5000);
  });

  it("deals are a Pro tool, start soon and last at most a day", async () => {
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const standardTry = await standardOwner.client.rpc("start_deal", {
      p_restaurant_id: standard.restaurant_id,
      p_branch_id: standard.branch_id,
      p_item_id: standardItem,
      p_percent: 20,
      p_ends_at: soon,
    });
    expect(standardTry.error?.code).toBe("42501");
    const strangerTry = await stranger.client.rpc("start_deal", {
      p_restaurant_id: pro.restaurant_id,
      p_branch_id: pro.branch_id,
      p_item_id: rolex,
      p_percent: 20,
      p_ends_at: soon,
    });
    expect(strangerTry.error).not.toBeNull();
    const tooLong = await owner.client.rpc("start_deal", {
      p_restaurant_id: pro.restaurant_id,
      p_branch_id: pro.branch_id,
      p_item_id: rolex,
      p_percent: 20,
      p_ends_at: new Date(Date.now() + 30 * 3_600_000).toISOString(),
    });
    expect(tooLong.error?.message).toBe("ends_at");
  });

  it("insights add up orders and sales from the menu", async () => {
    const { data } = await owner.client.rpc("restaurant_insights", { p_restaurant_id: pro.restaurant_id, p_days: 7 });
    const sales = (data as { sales: { orders: number; value: number; per_day: { orders: number }[]; top: { name: string; qty: number }[] } }).sales;
    expect(sales.orders).toBeGreaterThanOrEqual(8);
    expect(sales.value).toBeGreaterThan(0);
    expect(sales.per_day).toHaveLength(7);
    expect(sales.per_day.at(-1)!.orders).toBe(sales.orders);
    expect(sales.top[0].name).toBe("Rolex");
  });
});

describe("Menus near me: today's deal and top places this week", () => {
  it("shows a listing's live deal and ranks places by visitors and orders, never by ratings", async () => {
    const db = serviceClient();
    const area = `Area ${uniq()}`;
    const owners = await Promise.all([signedInUser(), signedInUser(), signedInUser()]);
    const places = await Promise.all(owners.map((o, i) => selfServeRestaurant(o, `Top ${i} ${uniq()}`)));
    for (const p of places) {
      await setSubscription(p.restaurant_id, paid("pro"));
      await db.from("restaurants").update({ directory_status: "approved" }).eq("id", p.restaurant_id).throwOnError();
      await db.from("branches").update({ area }).eq("id", p.branch_id).throwOnError();
    }
    await db.from("settings").upsert({ key: "directory_enabled", value: true }).throwOnError();

    // Place 0: 2 visitors. Place 1: 1 visitor and 1 order (= 4). Place 2: nothing.
    const view = (p: CreatedRestaurant, session: string) => ({ restaurant_id: p.restaurant_id, branch_id: p.branch_id, type: "menu_view", session_id: session });
    await db.from("events").insert([view(places[0], "s1aaaaaaaa"), view(places[0], "s2aaaaaaaa"), view(places[0], "s2aaaaaaaa"), view(places[1], "s3aaaaaaaa")]).throwOnError();
    const { data: cat } = await db.from("categories").insert({ restaurant_id: places[1].restaurant_id, menu_id: places[1].menu_id, name: "Fish" }).select("id").single().throwOnError();
    const { data: fish } = await db
      .from("items")
      .insert({ restaurant_id: places[1].restaurant_id, menu_id: places[1].menu_id, category_id: cat!.id, name: "Tilapia", price_ugx: 25_000 })
      .select("id")
      .single()
      .throwOnError();
    expect((await place({ slug: places[1].slug, ref: ref(), mode: "whatsapp", type: "dine_in", lines: [{ i: fish!.id, q: 1 }] })).result).toBe("ok");
    // A private one-star rating changes nothing.
    await db.from("feedback").insert({ restaurant_id: places[1].restaurant_id, branch_id: places[1].branch_id, rating: 1 }).throwOnError();

    const { data: top } = await anonClient().rpc("directory_top", { p_area: area, p_limit: 5 });
    expect(top).toEqual([
      { name: expect.stringMatching(/^Top 1 /), slug: places[1].slug, area },
      { name: expect.stringMatching(/^Top 0 /), slug: places[0].slug, area },
    ]);

    await db.from("deals").insert({ restaurant_id: places[1].restaurant_id, branch_id: places[1].branch_id, item_id: fish!.id, percent_off: 30, ends_at: new Date(Date.now() + 3_600_000).toISOString() }).throwOnError();
    const { data: search } = await anonClient().rpc("directory_search", { p_area: area });
    const listing = (search as { results: { slug: string; deal: unknown }[] }).results.find((r) => r.slug === places[1].slug);
    expect(listing?.deal).toEqual({ item: "Tilapia", percent: 30, was: 25_000, price: 17_500, ends_at: expect.any(String) });
    expect((search as { results: { slug: string; deal: unknown }[] }).results.find((r) => r.slug === places[0].slug)?.deal).toBeNull();
  });
});
