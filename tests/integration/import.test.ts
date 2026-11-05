import { beforeAll, describe, expect, it } from "vitest";
import type { ImportDraft } from "@/lib/import/draft";
import type { Json } from "@/lib/supabase/database.types";
import {
  anonClient,
  makeAdmin,
  selfServeRestaurant,
  serviceClient,
  setSubscription,
  signedInUser,
  type CreatedRestaurant,
  type TestUser,
} from "./helpers";

const flags = { name: false, description: false, price: false, sizes: false };

function draft(): ImportDraft {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        name: " Breakfast ",
        items: [
          {
            id: "i1",
            name: "Rolex",
            description: "Chapati with eggs",
            price: 5000,
            sizes: [],
            addons: [{ id: "a1", name: "Extra egg", price: 1000, unsure: false }],
            tags: ["popular"],
            unsure: flags,
          },
          {
            id: "i2",
            name: "Passion juice",
            description: "",
            // Ignored: a dish with sizes is priced by its sizes.
            price: 9999,
            sizes: [
              { id: "z1", name: "Glass", price: 3000, unsure: false },
              { id: "z2", name: "Jug", price: 10000, unsure: false },
            ],
            addons: [],
            tags: [],
            unsure: flags,
          },
          { id: "i3", name: "Malakwang", description: "", price: null, sizes: [], addons: [], tags: [], unsure: flags },
        ],
      },
      // Sections without dishes are skipped.
      { id: "s2", name: "Empty", items: [] },
    ],
  };
}

async function newImport(r: CreatedRestaurant, status = "needs_review", value: ImportDraft = draft()): Promise<string> {
  const { data, error } = await serviceClient()
    .from("menu_imports")
    .insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, status, draft: value as unknown as Json, files: [] })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function liveMenu(r: CreatedRestaurant) {
  const { data, error } = await serviceClient()
    .from("categories")
    .select("name, sort_order, items(name, description, price_ugx, tags, sort_order, deleted_at, item_options(kind, name, price_ugx, sort_order))")
    .eq("menu_id", r.menu_id)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) throw error;
  return data.map((c) => ({ ...c, items: c.items.filter((i) => !i.deleted_at).sort((a, b) => a.sort_order - b.sort_order) }));
}

describe("menu import publishing", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let freeOwner: TestUser;
  let admin: TestUser;
  let staff: TestUser;
  let r: CreatedRestaurant;
  let other: CreatedRestaurant;
  let free: CreatedRestaurant;

  beforeAll(async () => {
    [owner, stranger, freeOwner, admin, staff] = await Promise.all([signedInUser(), signedInUser(), signedInUser(), signedInUser(), signedInUser()]);
    [r, other, free] = await Promise.all([
      selfServeRestaurant(owner, "Import Cafe"),
      selfServeRestaurant(stranger, "Other Cafe"),
      selfServeRestaurant(freeOwner, "Free Cafe"),
    ]);
    await setSubscription(free.restaurant_id, { status: "free", plan: "free" });
    await makeAdmin(admin.id);
    const { error } = await serviceClient().from("memberships").insert({ restaurant_id: r.restaurant_id, user_id: staff.id, role: "staff" });
    if (error) throw error;
    await owner.client.from("categories").insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, name: "Existing", sort_order: 0 });
  });

  it("shows imports only to the restaurant's owners, who may change the draft but not the status", async () => {
    const id = await newImport(r);
    expect((await owner.client.from("menu_imports").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await stranger.client.from("menu_imports").select("id").eq("id", id)).data).toHaveLength(0);
    expect((await staff.client.from("menu_imports").select("id").eq("id", id)).data).toHaveLength(0);

    const edited = { ...draft(), sections: [] };
    const { data: updated } = await owner.client.from("menu_imports").update({ draft: edited as unknown as Json }).eq("id", id).select("draft");
    expect(updated?.[0].draft).toEqual(edited);
    const status = await owner.client.from("menu_imports").update({ status: "published" }).eq("id", id);
    expect(status.error?.code).toBe("42501");
    // Only the server (service role) creates imports.
    const insert = await owner.client.from("menu_imports").insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id });
    expect(insert.error?.code).toBe("42501");
  });

  it("adds the reviewed sections after the current menu, with sizes, add-ons and labels", async () => {
    const id = await newImport(r);
    const { data, error } = await owner.client.rpc("publish_menu_import", { p_import_id: id, p_draft: draft() as unknown as Json, p_mode: "append" });
    expect(error).toBeNull();
    expect(data).toEqual({ sections: 1, items: 3 });

    const menu = await liveMenu(r);
    expect(menu.map((c) => c.name)).toEqual(["Existing", "Breakfast"]);
    const [rolex, juice, malakwang] = menu[1].items;
    expect(rolex).toMatchObject({ name: "Rolex", description: "Chapati with eggs", price_ugx: 5000, tags: ["popular"] });
    expect(rolex.item_options).toEqual([{ kind: "addon", name: "Extra egg", price_ugx: 1000, sort_order: 0 }]);
    expect(juice.price_ugx).toBeNull();
    expect(juice.item_options.sort((a, b) => a.sort_order - b.sort_order).map((o) => [o.kind, o.name, o.price_ugx])).toEqual([
      ["size", "Glass", 3000],
      ["size", "Jug", 10000],
    ]);
    expect(malakwang).toMatchObject({ price_ugx: null, description: null });

    const { data: row } = await serviceClient().from("menu_imports").select("status, published_by, published_at").eq("id", id).single();
    expect(row).toMatchObject({ status: "published", published_by: owner.id });
    expect(row?.published_at).toBeTruthy();
    const { data: audit } = await serviceClient()
      .from("audit_log")
      .select("action, actor_id, details")
      .eq("restaurant_id", r.restaurant_id)
      .eq("action", "menu_import.published");
    expect(audit?.[0]).toMatchObject({ actor_id: owner.id, details: { import_id: id, mode: "append", items: 3 } });

    // Publishing is once only.
    const again = await owner.client.rpc("publish_menu_import", { p_import_id: id, p_draft: draft() as unknown as Json, p_mode: "append" });
    expect(again.error?.message).toBe("not_reviewable");
  });

  it("replaces the current menu, keeping the old dishes restorable", async () => {
    const id = await newImport(r);
    const { error } = await owner.client.rpc("publish_menu_import", { p_import_id: id, p_draft: draft() as unknown as Json, p_mode: "replace" });
    expect(error).toBeNull();
    const menu = await liveMenu(r);
    expect(menu.map((c) => c.name)).toEqual(["Breakfast"]);
    const { count } = await serviceClient()
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("menu_id", r.menu_id)
      .not("deleted_at", "is", null);
    expect(count).toBe(2);
  });

  it("refuses empty drafts and bad options without changing anything", async () => {
    const before = await liveMenu(r);
    const empty = await newImport(r);
    const blank = { version: 1, sections: [{ id: "s", name: "Drinks", items: [{ ...draft().sections[0].items[0], name: "  " }] }] };
    const e1 = await owner.client.rpc("publish_menu_import", { p_import_id: empty, p_draft: blank as unknown as Json, p_mode: "append" });
    expect(e1.error?.message).toBe("empty_draft");

    const broken = draft();
    broken.sections[0].items[1].sizes[1].price = null;
    const e2 = await owner.client.rpc("publish_menu_import", { p_import_id: empty, p_draft: broken as unknown as Json, p_mode: "append" });
    expect(e2.error).not.toBeNull();
    const e3 = await owner.client.rpc("publish_menu_import", { p_import_id: empty, p_draft: draft() as unknown as Json, p_mode: "merge" });
    expect(e3.error?.message).toBe("invalid_mode");

    expect(await liveMenu(r)).toEqual(before);
    const { data: row } = await serviceClient().from("menu_imports").select("status").eq("id", empty).single();
    expect(row?.status).toBe("needs_review");
  });

  it("only publishes for people who can edit that menu", async () => {
    const id = await newImport(r);
    const payload = { p_import_id: id, p_draft: draft() as unknown as Json, p_mode: "append" };
    expect((await stranger.client.rpc("publish_menu_import", payload)).error?.code).toBe("42501");
    expect((await staff.client.rpc("publish_menu_import", payload)).error?.code).toBe("42501");
    expect((await anonClient().rpc("publish_menu_import", payload)).error).not.toBeNull();
    const processing = await newImport(r, "processing");
    expect((await owner.client.rpc("publish_menu_import", { ...payload, p_import_id: processing })).error?.message).toBe("not_reviewable");
    void other;
  });

  it("lets the Menyu team publish for Free restaurants, whose owners cannot", async () => {
    const id = await newImport(free);
    const payload = { p_import_id: id, p_draft: draft() as unknown as Json, p_mode: "append" };
    expect((await freeOwner.client.rpc("publish_menu_import", payload)).error?.code).toBe("42501");
    const { data, error } = await admin.client.rpc("publish_menu_import", payload);
    expect(error).toBeNull();
    expect(data).toEqual({ sections: 1, items: 3 });
    const { data: row } = await serviceClient().from("menu_imports").select("published_by").eq("id", id).single();
    expect(row?.published_by).toBe(admin.id);
  });
});
