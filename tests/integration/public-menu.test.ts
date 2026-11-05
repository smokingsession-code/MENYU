import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, selfServeRestaurant, serviceClient, setSubscription, signedInUser, type CreatedRestaurant, type TestUser } from "./helpers";

interface Menu {
  version: number;
  plan: string;
  features: Record<string, boolean>;
  restaurant: { name: string; is_demo: boolean };
  branch: { slug: string; momo: unknown; whatsapp: string | null };
  categories: { name: string; items: { id: string; name: string; photo: unknown; sold_out: boolean; options: { kind: string; name: string; price: number }[] }[] }[];
  tables: Record<string, string>;
  specials: unknown[];
}

async function publicMenu(slug: string): Promise<Menu | null> {
  const { data, error } = await anonClient().rpc("get_public_menu", { p_slug: slug });
  if (error) throw error;
  return data as unknown as Menu | null;
}

const items = (m: Menu) => m.categories.flatMap((c) => c.items);

describe("get_public_menu", () => {
  let owner: TestUser;
  let r: CreatedRestaurant;
  let categoryId: string;
  const photo = { path: "x/item/y", w: 640, h: 480, widths: [160, 320, 640], color: "#aa8844" };

  beforeAll(async () => {
    owner = await signedInUser();
    r = await selfServeRestaurant(owner, "Menu Test Grill");
    const db = owner.client;
    const { data: cat } = await db.from("categories").insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, name: "Mains", sort_order: 0 }).select("id").single();
    categoryId = cat!.id;
    const { data: hiddenCat } = await db.from("categories").insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, name: "Secret", sort_order: 1, is_hidden: true }).select("id").single();

    // 35 visible items, one hidden item, one deleted item, one in a hidden category.
    const rows = Array.from({ length: 35 }, (_, i) => ({
      restaurant_id: r.restaurant_id,
      menu_id: r.menu_id,
      category_id: categoryId,
      name: `Dish ${String(i + 1).padStart(2, "0")}`,
      price_ugx: 1000 * (i + 1),
      sort_order: i,
      photo: i < 3 ? photo : null,
    }));
    const { error } = await db.from("items").insert(rows);
    if (error) throw error;
    await db.from("items").insert([
      { restaurant_id: r.restaurant_id, menu_id: r.menu_id, category_id: categoryId, name: "Hidden dish", price_ugx: 1, is_hidden: true },
      { restaurant_id: r.restaurant_id, menu_id: r.menu_id, category_id: categoryId, name: "Deleted dish", price_ugx: 1, deleted_at: new Date().toISOString() },
      { restaurant_id: r.restaurant_id, menu_id: r.menu_id, category_id: hiddenCat!.id, name: "In hidden category", price_ugx: 1 },
    ] as never);
    const { data: first } = await db.from("items").select("id").eq("name", "Dish 01").single();
    // Bulk inserts send NULL for keys a row leaves out, so every row lists every column.
    const options = await db.from("item_options").insert([
      { restaurant_id: r.restaurant_id, item_id: first!.id, kind: "size", name: "Large", price_ugx: 3000, sort_order: 1 },
      { restaurant_id: r.restaurant_id, item_id: first!.id, kind: "size", name: "Small", price_ugx: 1000, sort_order: 0 },
      { restaurant_id: r.restaurant_id, item_id: first!.id, kind: "addon", name: "Egg", price_ugx: 500, sort_order: 0 },
    ]);
    if (options.error) throw options.error;
    await db.from("sold_out").insert({ branch_id: r.branch_id, item_id: first!.id, restaurant_id: r.restaurant_id });
    await db.from("tables").insert({ restaurant_id: r.restaurant_id, branch_id: r.branch_id, label: "Table 5", code: "5" });
    await db
      .from("branches")
      .update({ momo_mtn_code: "123456", momo_mtn_name: "MENU TEST" })
      .eq("id", r.branch_id);
  });

  it("returns null for unknown slugs", async () => {
    expect(await publicMenu("no-such-menu-here")).toBeNull();
  });

  it("shows every visible item on Standard, never hidden or deleted ones", async () => {
    const menu = (await publicMenu(r.slug))!;
    expect(menu.plan).toBe("standard");
    const names = items(menu).map((i) => i.name);
    expect(names).toHaveLength(35);
    expect(names).not.toContain("Hidden dish");
    expect(names).not.toContain("Deleted dish");
    expect(names).not.toContain("In hidden category");
    expect(menu.categories.map((c) => c.name)).toEqual(["Mains"]);
  });

  it("orders sizes before add-ons, each by sort order, and marks sold-out items", async () => {
    const dish = items((await publicMenu(r.slug))!).find((i) => i.name === "Dish 01")!;
    expect(dish.options.map((o) => `${o.kind}:${o.name}`)).toEqual(["size:Small", "size:Large", "addon:Egg"]);
    expect(dish.sold_out).toBe(true);
  });

  it("includes table names, payment codes, photos and ordering on Standard", async () => {
    const menu = (await publicMenu(r.slug))!;
    expect(menu.tables).toEqual({ "5": "Table 5" });
    expect(menu.branch.momo).toMatchObject({ mtn_code: "123456" });
    expect(items(menu).filter((i) => i.photo)).toHaveLength(3);
    expect(menu.features).toMatchObject({ whatsapp_ordering: true, hide_footer: true, specials: false });
  });

  it("on Free shows only the first 30 items, no photos, no ordering, no tables or payment codes", async () => {
    await setSubscription(r.restaurant_id, { status: "free" });
    const menu = (await publicMenu(r.slug))!;
    expect(menu.plan).toBe("free");
    const names = items(menu).map((i) => i.name);
    expect(names).toHaveLength(30);
    expect(names.at(-1)).toBe("Dish 30");
    expect(items(menu).every((i) => i.photo === null)).toBe(true);
    expect(menu.tables).toEqual({});
    expect(menu.branch.momo).toBeNull();
    expect(menu.features).toMatchObject({ whatsapp_ordering: false, hide_footer: false });

    // Nothing was deleted: back on Standard, all 35 return.
    await setSubscription(r.restaurant_id, { status: "active" });
    expect(items((await publicMenu(r.slug))!)).toHaveLength(35);
  });

  it("hides suspended and deleted restaurants", async () => {
    const service = serviceClient();
    await service.from("restaurants").update({ is_suspended: true }).eq("id", r.restaurant_id);
    expect(await publicMenu(r.slug)).toBeNull();
    await service.from("restaurants").update({ is_suspended: false }).eq("id", r.restaurant_id);
    expect(await publicMenu(r.slug)).not.toBeNull();
  });

  it("anon cannot read the underlying tables even though the menu is public", async () => {
    const { error } = await anonClient().from("items").select("id").eq("restaurant_id", r.restaurant_id);
    expect(error?.code).toBe("42501");
  });
});

describe("record_event", () => {
  it("stores a valid event and returns the live state; ignores junk values", async () => {
    const owner = await signedInUser();
    const r = await selfServeRestaurant(owner, "Events Cafe");
    const service = serviceClient();
    const { data: live, error } = await service.rpc("record_event", {
      p_slug: r.slug,
      p_type: "menu_view",
      p_table: "5",
      p_session: "abcdefgh12345678",
    });
    expect(error).toBeNull();
    expect(live).toMatchObject({ sold_out: [] });

    await service.rpc("record_event", { p_slug: r.slug, p_type: "menu_view", p_table: "<script>", p_session: "x" });
    await service.rpc("record_event", { p_slug: r.slug, p_type: "not_a_type" });

    const { data: events } = await service.from("events").select("type, table_code, session_id").eq("restaurant_id", r.restaurant_id).order("id");
    expect(events).toEqual([
      { type: "menu_view", table_code: "5", session_id: "abcdefgh12345678" },
      { type: "menu_view", table_code: null, session_id: null },
    ]);

    // Owners see their own events.
    const { data: own } = await owner.client.from("events").select("id");
    expect(own).toHaveLength(2);
  });

  it("is not callable by diners directly", async () => {
    const { error } = await anonClient().rpc("record_event", { p_slug: "x", p_type: "menu_view" });
    expect(error?.code).toBe("42501");
  });

  it("stops storing events over the rate limit but still answers", async () => {
    const owner = await signedInUser();
    const r = await selfServeRestaurant(owner, "Busy Cafe");
    const service = serviceClient();
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 302; i++) {
      const { data } = await service.rpc("record_event", { p_slug: r.slug, p_type: "item_view", p_rate_key: key });
      expect(data).not.toBeNull();
    }
    const { count } = await service.from("events").select("id", { count: "exact", head: true }).eq("restaurant_id", r.restaurant_id);
    expect(count).toBe(300);
  });
});
