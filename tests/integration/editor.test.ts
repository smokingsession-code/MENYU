import { beforeAll, describe, expect, it } from "vitest";
import { selfServeRestaurant, serviceClient, setSubscription, signedInUser, type CreatedRestaurant, type TestUser } from "./helpers";

describe("menu editor functions", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let r: CreatedRestaurant;
  let drinks: string;
  let food: string;

  beforeAll(async () => {
    [owner, stranger] = await Promise.all([signedInUser(), signedInUser()]);
    r = await selfServeRestaurant(owner, "Editor Cafe");
    await selfServeRestaurant(stranger, "Stranger Cafe");
    const { data } = await owner.client
      .from("categories")
      .insert([
        { restaurant_id: r.restaurant_id, menu_id: r.menu_id, name: "Drinks", sort_order: 0 },
        { restaurant_id: r.restaurant_id, menu_id: r.menu_id, name: "Food", sort_order: 1 },
      ])
      .select("id, name");
    drinks = data!.find((c) => c.name === "Drinks")!.id;
    food = data!.find((c) => c.name === "Food")!.id;
  });

  it("saves an item with sizes and add-ons in one call, then updates and removes options", async () => {
    const { data: id, error } = await owner.client.rpc("save_item", {
      p_item: {
        restaurant_id: r.restaurant_id,
        category_id: drinks,
        name: "  Passion juice ",
        price_ugx: null,
        tags: ["popular"],
        options: [
          { kind: "size", name: "Small", price_ugx: 4000 },
          { kind: "size", name: "Large", price_ugx: 6000 },
          { kind: "addon", name: "Ice", price_ugx: 0 },
        ],
      },
    });
    expect(error).toBeNull();
    const { data: item } = await owner.client.from("items").select("name, tags, item_options(id, name, kind, price_ugx, sort_order, deleted_at)").eq("id", id!).single();
    expect(item!.name).toBe("Passion juice");
    expect(item!.tags).toEqual(["popular"]);
    const live = item!.item_options.filter((o) => !o.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
    expect(live.map((o) => o.name)).toEqual(["Small", "Large", "Ice"]);

    // Keep Large (new price), drop Small and Ice, add Jug.
    const large = live.find((o) => o.name === "Large")!;
    const { error: e2 } = await owner.client.rpc("save_item", {
      p_item: {
        id,
        restaurant_id: r.restaurant_id,
        category_id: drinks,
        name: "Passion juice",
        tags: [],
        options: [
          { id: large.id, kind: "size", name: "Large", price_ugx: 6500 },
          { kind: "size", name: "Jug", price_ugx: 15000 },
        ],
      },
    });
    expect(e2).toBeNull();
    const { data: after } = await owner.client.from("item_options").select("name, price_ugx, deleted_at").eq("item_id", id!);
    expect(after!.filter((o) => !o.deleted_at).map((o) => `${o.name}:${o.price_ugx}`).sort()).toEqual(["Jug:15000", "Large:6500"]);
    expect(after!.filter((o) => o.deleted_at).map((o) => o.name).sort()).toEqual(["Ice", "Small"]);
  });

  it("refuses items in another restaurant's category or for strangers", async () => {
    const { error } = await stranger.client.rpc("save_item", {
      p_item: { restaurant_id: r.restaurant_id, category_id: drinks, name: "Hack", price_ugx: 1, tags: [], options: [] },
    });
    expect(error?.message).toContain("invalid_category"); // they cannot even see the category
  });

  it("reorders categories and items, and only the owner's rows move", async () => {
    await owner.client.rpc("reorder", { p_kind: "categories", p_ids: [food, drinks] });
    const { data } = await owner.client.from("categories").select("id, sort_order").eq("restaurant_id", r.restaurant_id).order("sort_order");
    expect(data!.map((c) => c.id)).toEqual([food, drinks]);

    const { data: moved } = await stranger.client.rpc("reorder", { p_kind: "categories", p_ids: [drinks, food] });
    expect(moved).toBe(0);
    const { error } = await owner.client.rpc("reorder", { p_kind: "admins", p_ids: [] });
    expect(error?.message).toContain("invalid_kind");
  });

  it("changes prices in bulk with friendly rounding, only in the chosen categories", async () => {
    await owner.client.rpc("save_item", { p_item: { restaurant_id: r.restaurant_id, category_id: food, name: "Rolex", price_ugx: 5000, tags: [], options: [] } });
    await owner.client.rpc("save_item", { p_item: { restaurant_id: r.restaurant_id, category_id: food, name: "Katogo", price_ugx: 4500, tags: [], options: [] } });
    const { data: changed, error } = await owner.client.rpc("bulk_adjust_prices", {
      p_restaurant_id: r.restaurant_id,
      p_category_ids: [food],
      p_percent: 10,
      p_round: 500,
    });
    expect(error).toBeNull();
    expect(changed).toBe(2);
    const { data } = await owner.client.from("items").select("name, price_ugx").eq("category_id", food).order("name");
    expect(data).toEqual([
      { name: "Katogo", price_ugx: 5000 },
      { name: "Rolex", price_ugx: 5500 },
    ]);
    // The juice in Drinks is untouched.
    const { data: jug } = await owner.client.from("item_options").select("price_ugx").eq("name", "Jug").single();
    expect(jug!.price_ugx).toBe(15000);

    const { error: bad } = await owner.client.rpc("bulk_adjust_prices", { p_restaurant_id: r.restaurant_id, p_category_ids: [food], p_percent: 1000 });
    expect(bad?.message).toContain("invalid_percent");
  });

  it("adds tables by number or name, skips duplicates, and reuses codes", async () => {
    const { data: added } = await owner.client.rpc("add_tables", { p_branch_id: r.branch_id, p_labels: ["5", "Garden 1", "garden 1", " ", "VIP"] });
    expect(added).toBe(3);
    const { data: tables } = await owner.client.from("tables").select("id, label, code").eq("branch_id", r.branch_id).is("deleted_at", null).order("sort_order");
    expect(tables!.map((t) => `${t.label}=${t.code}`)).toEqual(["5=5", "Garden 1=garden-1", "VIP=vip"]);

    // Delete table 5 and add it again: same code, so the old sticker still works.
    await owner.client.from("tables").update({ deleted_at: new Date().toISOString() }).eq("id", tables![0].id);
    await owner.client.rpc("add_tables", { p_branch_id: r.branch_id, p_labels: ["5"] });
    const { data: again } = await owner.client.from("tables").select("code").eq("branch_id", r.branch_id).eq("label", "5").is("deleted_at", null).single();
    expect(again!.code).toBe("5");
  });

  it("does not let Free restaurants add tables or edit", async () => {
    await setSubscription(r.restaurant_id, { status: "free" });
    const { error } = await owner.client.rpc("add_tables", { p_branch_id: r.branch_id, p_labels: ["9"] });
    expect(error?.code).toBe("42501");
    const { error: e2 } = await owner.client.rpc("bulk_adjust_prices", { p_restaurant_id: r.restaurant_id, p_category_ids: null as never, p_percent: 5 });
    expect(e2).toBeNull(); // runs, but row security lets it change nothing
    const { data } = await serviceClient().from("items").select("price_ugx").eq("restaurant_id", r.restaurant_id).eq("name", "Rolex").single();
    expect(data!.price_ugx).toBe(5500);
    await setSubscription(r.restaurant_id, { status: "active" });
  });
});
