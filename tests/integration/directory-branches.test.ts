import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, selfServeRestaurant, serviceClient, setSubscription, signedInUser, uniq, type CreatedRestaurant, type TestUser } from "./helpers";

const DAY = 86_400_000;
const pro = { plan: "pro", status: "active", paid_until: new Date(Date.now() + 30 * DAY).toISOString() };

async function addMenu(r: CreatedRestaurant, dish: string) {
  const db = serviceClient();
  const { data: cat } = await db.from("categories").insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, name: "Grills" }).select("id").single();
  const { data: item } = await db
    .from("items")
    .insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, category_id: cat!.id, name: dish, price_ugx: 15000, description: null, sort_order: 0 })
    .select("id")
    .single();
  await db.from("item_options").insert({ restaurant_id: r.restaurant_id, item_id: item!.id, kind: "size", name: "Large", price_ugx: 20000 });
}

async function setDirectory(enabled: boolean) {
  const { error } = await serviceClient().from("settings").upsert({ key: "directory_enabled", value: enabled });
  if (error) throw error;
}

describe("branches", () => {
  let owner: TestUser;
  let standardOwner: TestUser;
  let staff: TestUser;
  let r: CreatedRestaurant;
  let standard: CreatedRestaurant;

  beforeAll(async () => {
    [owner, standardOwner, staff] = await Promise.all([signedInUser(), signedInUser(), signedInUser()]);
    r = await selfServeRestaurant(owner, `Branchy ${uniq()}`);
    standard = await selfServeRestaurant(standardOwner, `Single ${uniq()}`);
    await setSubscription(r.restaurant_id, pro);
    await addMenu(r, "Pork ribs");
    await serviceClient().from("memberships").insert({ restaurant_id: r.restaurant_id, user_id: staff.id, role: "staff" });
  });

  it("adds branches that share the menu, copy it, or start empty, on Pro only", async () => {
    const shared = await owner.client.rpc("add_branch", { p_restaurant_id: r.restaurant_id, p_name: "Kira branch", p_area: "Kira", p_menu: "shared" });
    expect(shared.error).toBeNull();
    expect((shared.data as { menu_id: string }).menu_id).toBe(r.menu_id);

    const copy = await owner.client.rpc("add_branch", { p_restaurant_id: r.restaurant_id, p_name: "Najjera", p_area: "Najjera", p_whatsapp: "256772000222", p_menu: "copy" });
    expect(copy.error).toBeNull();
    const created = copy.data as { menu_id: string; slug: string };
    expect(created.menu_id).not.toBe(r.menu_id);
    const { data: menu } = await anonClient().rpc("get_public_menu", { p_slug: created.slug });
    const categories = (menu as { categories: { name: string; items: { name: string; options: { name: string }[] }[] }[] }).categories;
    expect(categories.map((c) => c.name)).toEqual(["Grills"]);
    expect(categories[0].items[0]).toMatchObject({ name: "Pork ribs", options: [expect.objectContaining({ name: "Large" })] });
    const { data: branch } = await serviceClient().from("branches").select("whatsapp, is_main").eq("slug", created.slug).single();
    expect(branch).toEqual({ whatsapp: "256772000222", is_main: false });

    const empty = await owner.client.rpc("add_branch", { p_restaurant_id: r.restaurant_id, p_name: "Kiosk", p_menu: "empty" });
    const { count } = await serviceClient().from("categories").select("id", { count: "exact", head: true }).eq("menu_id", (empty.data as { menu_id: string }).menu_id);
    expect(count).toBe(0);

    expect((await standardOwner.client.rpc("add_branch", { p_restaurant_id: standard.restaurant_id, p_name: "Second" })).error?.code).toBe("42501");
    expect((await staff.client.rpc("add_branch", { p_restaurant_id: r.restaurant_id, p_name: "Sneaky" })).error?.code).toBe("42501");
    expect((await anonClient().rpc("add_branch", { p_restaurant_id: r.restaurant_id, p_name: "Anon" })).error).not.toBeNull();
  });
});

describe("the directory", () => {
  let owner: TestUser;
  let freeOwner: TestUser;
  let stranger: TestUser;
  let listed: CreatedRestaurant;
  let featured: CreatedRestaurant;
  let free: CreatedRestaurant;
  const area = `Area${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    [owner, freeOwner, stranger] = await Promise.all([signedInUser(), signedInUser(), signedInUser()]);
    listed = await selfServeRestaurant(owner, `Zebra Grill ${uniq()}`);
    featured = await selfServeRestaurant(owner, `Zulu Lounge ${uniq()}`);
    free = await selfServeRestaurant(freeOwner, `Hidden Cafe ${uniq()}`);
    await setSubscription(featured.restaurant_id, pro);
    await setSubscription(free.restaurant_id, { plan: "free", status: "free" });
    await serviceClient().from("branches").update({ area }).in("id", [listed.branch_id, featured.branch_id]);
    await addMenu(listed, "Rolex special");
  });

  afterAll(() => setDirectory(false));

  it("lets owners on Standard or Pro ask to be listed, and unlist", async () => {
    expect((await owner.client.rpc("request_directory_listing", { p_restaurant_id: listed.restaurant_id, p_listed: true })).data).toBe("pending");
    expect((await freeOwner.client.rpc("request_directory_listing", { p_restaurant_id: free.restaurant_id, p_listed: true })).error?.code).toBe("42501");
    expect((await stranger.client.rpc("request_directory_listing", { p_restaurant_id: listed.restaurant_id, p_listed: true })).error?.code).toBe("42501");
    // Owners cannot approve themselves.
    const self = await owner.client.from("restaurants").update({ directory_status: "approved" }).eq("id", listed.restaurant_id);
    expect(self.error?.code).toBe("42501");
  });

  it("shows approved listings by area, featured first, matching dish names, only while switched on", async () => {
    const db = serviceClient();
    await db.from("restaurants").update({ directory_status: "approved" }).in("id", [listed.restaurant_id, featured.restaurant_id, free.restaurant_id]);
    await db.from("restaurants").update({ is_featured: true }).eq("id", featured.restaurant_id);

    await setDirectory(false);
    expect((await anonClient().rpc("directory_search", { p_area: area })).data).toMatchObject({ enabled: false, results: [] });

    await setDirectory(true);
    const all = (await anonClient().rpc("directory_search", { p_area: area.toLowerCase() })).data as { results: { name: string; featured: boolean }[]; areas: { area: string; count: number }[] };
    expect(all.results.map((x) => [x.name, x.featured])).toEqual([
      [expect.stringMatching(/^Zulu Lounge/), true],
      [expect.stringMatching(/^Zebra Grill/), false],
    ]);
    expect(all.areas).toContainEqual({ area, count: 2 });

    const rolex = (await anonClient().rpc("directory_search", { p_query: "ROLEX", p_area: area })).data as { results: { name: string; dishes: string[] }[] };
    expect(rolex.results).toEqual([expect.objectContaining({ name: expect.stringMatching(/^Zebra Grill/), dishes: ["Rolex special"] })]);
    // A search is text, not a pattern.
    expect(((await anonClient().rpc("directory_search", { p_query: "%", p_area: area })).data as { results: unknown[] }).results).toEqual([]);
    // Free restaurants are never listed, even if approved.
    const everything = (await anonClient().rpc("directory_search", { p_limit: 200 })).data as { results: { name: string }[] };
    expect(everything.results.some((x) => x.name.startsWith("Hidden Cafe"))).toBe(false);
  });
});
