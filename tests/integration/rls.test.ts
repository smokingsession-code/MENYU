import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { plansAsRows } from "../../src/config/plans";
import {
  anonClient,
  makeAdmin,
  selfServeRestaurant,
  serviceClient,
  setSubscription,
  signedInUser,
  uniq,
  type CreatedRestaurant,
  type TestUser,
} from "./helpers";

const PRIVATE_TABLES = [
  "profiles", "admins", "settings", "agents", "restaurants", "menus", "branches", "memberships",
  "invitations", "categories", "items", "item_options", "sold_out", "tables", "specials",
  "special_items", "menu_imports", "feedback", "events", "setup_requests", "subscriptions",
  "payments", "agent_commissions", "agent_payouts", "referrals", "rate_limits", "audit_log",
  "deals", "orders", "loyalty_cards",
] as const;

const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function sql(query: string): string[] {
  return execFileSync("psql", [DB_URL, "-Atc", query], { encoding: "utf8" }).split("\n").filter(Boolean);
}

describe("every table has row-level security", () => {
  it("RLS is enabled on all public tables", () => {
    expect(sql("select tablename from pg_tables where schemaname = 'public' and not rowsecurity")).toEqual([]);
  });

  it("this test file covers every table (add new tables to PRIVATE_TABLES)", () => {
    const tables = sql("select tablename from pg_tables where schemaname = 'public' order by 1");
    expect(tables.filter((t) => t !== "plans").sort()).toEqual([...PRIVATE_TABLES].sort());
  });

  it("anon has no table privileges except reading plans", () => {
    expect(
      sql(
        "select table_name || ':' || privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' order by 1",
      ),
    ).toEqual(["plans:SELECT"]);
  });
});

describe("anonymous diners", () => {
  const anon = anonClient();

  it.each(PRIVATE_TABLES)("cannot read %s", async (table) => {
    const { data, error } = await anon.from(table).select("*").limit(1);
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("can read the public price list", async () => {
    const { data, error } = await anon.from("plans").select("code").order("sort_order");
    expect(error).toBeNull();
    expect(data?.map((p) => p.code)).toEqual(["free", "standard", "pro"]);
  });

  it("cannot create restaurants or claim invitations", async () => {
    const created = await anon.rpc("create_restaurant", { p_name: "Sneaky" });
    expect(created.error?.code).toBe("42501");
    const claimed = await anon.rpc("claim_invitations");
    expect(claimed.error?.code).toBe("42501");
  });

  it("cannot use the rate limiter directly", async () => {
    const { error } = await anon.rpc("rate_limit_hit", { p_key: "x", p_limit: 1, p_window_seconds: 60 });
    expect(error?.code).toBe("42501");
  });

  it("gets nothing back for an unknown invitation token", async () => {
    const { data, error } = await anon.rpc("invitation_preview", { p_token: "not-a-real-token-123456" });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("plans table", () => {
  it("matches src/config/plans.ts (run npm run plans:sql after editing the config)", async () => {
    const { data } = await anonClient()
      .from("plans")
      .select("code, name, price_monthly_ugx, price_yearly_ugx, price_per_branch, limits, features, sort_order")
      .order("sort_order");
    expect(data).toEqual(plansAsRows());
  });
});

describe("admin creates a restaurant and invites the owner", () => {
  let admin: TestUser;
  let created: CreatedRestaurant;
  const ownerEmail = `${uniq("owner")}@menyu.test`;

  beforeAll(async () => {
    admin = await signedInUser();
    await makeAdmin(admin.id);
    const { data, error } = await admin.client.rpc("create_restaurant", {
      p_name: "Kijani Test Café",
      p_area: "Ntinda",
      p_whatsapp: "256772123456",
      p_owner_email: ownerEmail,
      p_trial_days: 14,
    });
    if (error) throw error;
    created = data as unknown as CreatedRestaurant;
  });

  it("creates the restaurant, its main branch, a menu and a Standard trial", async () => {
    expect(created.slug).toMatch(/^kijani-test-cafe-ntinda(-\d+)?$/);
    expect(created.invitation_token).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const service = serviceClient();
    const { data: sub } = await service.from("subscriptions").select("*").eq("restaurant_id", created.restaurant_id).single();
    expect(sub?.plan).toBe("standard");
    expect(sub?.status).toBe("trial");
    const days = (new Date(sub!.trial_ends_at!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    const { data: branch } = await service.from("branches").select("*").eq("id", created.branch_id).single();
    expect(branch?.is_main).toBe(true);
    expect(branch?.whatsapp).toBe("256772123456");
    expect(branch?.menu_id).toBe(created.menu_id);
  });

  it("does not make the admin a member", async () => {
    const { data } = await serviceClient().from("memberships").select("*").eq("restaurant_id", created.restaurant_id);
    expect(data).toEqual([]);
  });

  it("stores only a hash of the invitation token", async () => {
    const { data } = await serviceClient().from("invitations").select("token_hash").eq("restaurant_id", created.restaurant_id);
    expect(data?.[0].token_hash).toHaveLength(64);
    expect(data?.[0].token_hash).not.toContain(created.invitation_token!);
  });

  it("shows a safe preview of the invitation", async () => {
    const { data } = await anonClient().rpc("invitation_preview", { p_token: created.invitation_token! });
    expect(data).toMatchObject({ restaurant_name: "Kijani Test Café", role: "owner", status: "pending" });
  });

  it("turns the invitation into ownership when the owner signs in", async () => {
    const owner = await signedInUser({ email: ownerEmail });
    const { data: count } = await owner.client.rpc("claim_invitations");
    expect(count).toBe(1);

    const { data: restaurants } = await owner.client.from("restaurants").select("id, name");
    expect(restaurants).toEqual([{ id: created.restaurant_id, name: "Kijani Test Café" }]);

    const { data: membership } = await owner.client.from("memberships").select("role").eq("user_id", owner.id).single();
    expect(membership?.role).toBe("owner");

    const { data: again } = await owner.client.rpc("claim_invitations");
    expect(again).toBe(0);
  });

  it("lets the admin see every restaurant", async () => {
    const { data } = await admin.client.from("restaurants").select("id").eq("id", created.restaurant_id);
    expect(data).toHaveLength(1);
  });

  it("rejects an unknown agent code", async () => {
    const { error } = await admin.client.rpc("create_restaurant", { p_name: "Agent Test", p_agent_code: "NOPE99" });
    expect(error?.message).toContain("unknown_agent_code");
  });
});

describe("restaurants cannot see or touch each other's data", () => {
  let a: TestUser;
  let b: TestUser;
  let ra: CreatedRestaurant;
  let rb: CreatedRestaurant;
  let bCategoryId: string;

  beforeAll(async () => {
    [a, b] = await Promise.all([signedInUser(), signedInUser()]);
    [ra, rb] = await Promise.all([selfServeRestaurant(a, "Cafe A"), selfServeRestaurant(b, "Cafe B")]);
    const { data, error } = await b.client
      .from("categories")
      .insert({ restaurant_id: rb.restaurant_id, menu_id: rb.menu_id, name: "B drinks" })
      .select("id")
      .single();
    if (error) throw error;
    bCategoryId = data.id;
    await b.client.from("items").insert({
      restaurant_id: rb.restaurant_id, menu_id: rb.menu_id, category_id: bCategoryId, name: "Secret juice", price_ugx: 5000,
    });
  });

  it("self-serve signup makes the user owner of a Standard trial", async () => {
    const { data } = await a.client.from("memberships").select("role, restaurant_id");
    expect(data).toEqual([{ role: "owner", restaurant_id: ra.restaurant_id }]);
    const { data: sub } = await a.client.from("subscriptions").select("plan, status").single();
    expect(sub).toEqual({ plan: "standard", status: "trial" });
  });

  it("each owner only sees their own rows", async () => {
    for (const table of ["restaurants", "branches", "menus", "categories", "items", "subscriptions"] as const) {
      const { data, error } = await a.client.from(table).select("*");
      expect(error).toBeNull();
      const ids = (data ?? []).map((row) => ("restaurant_id" in row ? row.restaurant_id : (row as { id: string }).id));
      expect(ids.every((id) => id === ra.restaurant_id)).toBe(true);
    }
    const { data: items } = await a.client.from("items").select("id").eq("restaurant_id", rb.restaurant_id);
    expect(items).toEqual([]);
  });

  it("an owner can add to their own menu", async () => {
    const { data: cat, error } = await a.client
      .from("categories")
      .insert({ restaurant_id: ra.restaurant_id, menu_id: ra.menu_id, name: "Breakfast" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { error: itemError } = await a.client.from("items").insert({
      restaurant_id: ra.restaurant_id, menu_id: ra.menu_id, category_id: cat!.id, name: "Rolex", price_ugx: 5000,
    });
    expect(itemError).toBeNull();
  });

  it("an owner cannot write into another restaurant", async () => {
    const { error } = await a.client
      .from("categories")
      .insert({ restaurant_id: rb.restaurant_id, menu_id: rb.menu_id, name: "Hijack" });
    expect(error?.code).toBe("42501");
  });

  it("an owner cannot attach their item to another restaurant's category", async () => {
    const { error } = await a.client.from("items").insert({
      restaurant_id: ra.restaurant_id, menu_id: ra.menu_id, category_id: bCategoryId, name: "Sneaky", price_ugx: 1,
    });
    expect(error?.code).toBe("23503"); // composite foreign key
  });

  it("an owner cannot change another restaurant", async () => {
    await a.client.from("restaurants").update({ name: "Taken over" }).eq("id", rb.restaurant_id);
    const { data } = await serviceClient().from("restaurants").select("name").eq("id", rb.restaurant_id).single();
    expect(data?.name).toBe("Cafe B");
  });

  it("an owner cannot set privileged columns on their own restaurant", async () => {
    const featured = await a.client.from("restaurants").update({ is_featured: true }).eq("id", ra.restaurant_id);
    expect(featured.error?.code).toBe("42501");
    const agent = await a.client.from("restaurants").update({ directory_status: "approved" }).eq("id", ra.restaurant_id);
    expect(agent.error?.code).toBe("42501");
    const slug = await a.client.from("branches").update({ slug: "stolen-slug" }).eq("id", ra.branch_id);
    expect(slug.error?.code).toBe("42501");
  });

  it("an owner cannot change billing or make themselves admin", async () => {
    const sub = await a.client.from("subscriptions").update({ status: "active" }).eq("restaurant_id", ra.restaurant_id);
    expect(sub.error?.code).toBe("42501");
    const pay = await a.client.from("payments").insert({ restaurant_id: ra.restaurant_id, amount_ugx: 1, method: "cash" });
    expect(pay.error?.code).toBe("42501");
    const adm = await a.client.from("admins").insert({ user_id: a.id });
    expect(adm.error?.code).toBe("42501");
  });

  it("an owner cannot join or invite people into another restaurant", async () => {
    const join = await a.client.from("memberships").insert({ user_id: a.id, restaurant_id: rb.restaurant_id, role: "owner" });
    expect(join.error?.code).toBe("42501");
    const invite = await a.client.rpc("create_invitation", { p_restaurant_id: rb.restaurant_id, p_role: "staff", p_email: "x@y.co" });
    expect(invite.error?.message).toContain("forbidden");
  });

  it("menu changes bump the restaurant's content version and last update time", async () => {
    const service = serviceClient();
    const before = await service.from("restaurants").select("content_version, menu_updated_at").eq("id", ra.restaurant_id).single();
    const { data: cat } = await a.client.from("categories").select("id").eq("restaurant_id", ra.restaurant_id).limit(1).single();
    await a.client.from("items").insert({
      restaurant_id: ra.restaurant_id, menu_id: ra.menu_id, category_id: cat!.id, name: "Chapati", price_ugx: 1000,
    });
    const after = await service.from("restaurants").select("content_version, menu_updated_at").eq("id", ra.restaurant_id).single();
    expect(after.data!.content_version).toBeGreaterThan(before.data!.content_version);
    expect(after.data!.menu_updated_at).not.toBeNull();
  });
});

describe("staff and plan features", () => {
  let owner: TestUser;
  let staff: TestUser;
  let r: CreatedRestaurant;
  let itemId: string;

  beforeAll(async () => {
    owner = await signedInUser();
    r = await selfServeRestaurant(owner, "Pro Lounge");
    const { data: cat } = await owner.client
      .from("categories")
      .insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, name: "Drinks" })
      .select("id")
      .single();
    const { data: item } = await owner.client
      .from("items")
      .insert({ restaurant_id: r.restaurant_id, menu_id: r.menu_id, category_id: cat!.id, name: "Passion juice", price_ugx: 4000 })
      .select("id")
      .single();
    itemId = item!.id;
  });

  it("Standard owners cannot invite staff", async () => {
    const { error } = await owner.client.rpc("create_invitation", { p_restaurant_id: r.restaurant_id, p_role: "staff", p_email: "s@menyu.test" });
    expect(error?.message).toContain("plan_required");
  });

  it("Pro owners invite staff, who can toggle sold-out but not edit the menu or see billing", async () => {
    await setSubscription(r.restaurant_id, { plan: "pro", status: "active" });
    const staffEmail = `${uniq("staff")}@menyu.test`;
    const { error } = await owner.client.rpc("create_invitation", { p_restaurant_id: r.restaurant_id, p_role: "staff", p_email: staffEmail });
    expect(error).toBeNull();
    const ownerInvite = await owner.client.rpc("create_invitation", { p_restaurant_id: r.restaurant_id, p_role: "owner", p_email: "o@menyu.test" });
    expect(ownerInvite.error?.message).toContain("forbidden");

    staff = await signedInUser({ email: staffEmail });
    expect((await staff.client.rpc("claim_invitations")).data).toBe(1);

    const { data: items } = await staff.client.from("items").select("id");
    expect(items?.map((i) => i.id)).toContain(itemId);

    const edit = await staff.client.from("items").update({ price_ugx: 1 }).eq("id", itemId).select();
    expect(edit.data ?? []).toEqual([]);
    const { data: price } = await serviceClient().from("items").select("price_ugx").eq("id", itemId).single();
    expect(price?.price_ugx).toBe(4000);

    const soldOut = await staff.client.from("sold_out").insert({ branch_id: r.branch_id, item_id: itemId, restaurant_id: r.restaurant_id });
    expect(soldOut.error).toBeNull();
    const back = await staff.client.from("sold_out").delete().eq("item_id", itemId).select();
    expect(back.data).toHaveLength(1);

    const { data: sub } = await staff.client.from("subscriptions").select("*");
    expect(sub).toEqual([]);
    const { data: events } = await staff.client.from("events").select("*");
    expect(events).toEqual([]);
  });

  it("Free restaurants are read-only for owners (menu changes are on request)", async () => {
    await setSubscription(r.restaurant_id, { status: "free" });
    const { data: cat } = await owner.client.from("categories").select("id").eq("restaurant_id", r.restaurant_id).limit(1).single();
    const add = await owner.client.from("items").insert({
      restaurant_id: r.restaurant_id, menu_id: r.menu_id, category_id: cat!.id, name: "Blocked", price_ugx: 1000,
    });
    expect(add.error?.code).toBe("42501");
    const toggle = await owner.client.from("sold_out").insert({ branch_id: r.branch_id, item_id: itemId, restaurant_id: r.restaurant_id });
    expect(toggle.error?.code).toBe("42501");

    // They can still ask the Menyu team for a change.
    const request = await owner.client.from("setup_requests").insert({ restaurant_id: r.restaurant_id, kind: "change", notes: "New prices" });
    expect(request.error).toBeNull();

    // Reading still works, and nothing was deleted.
    const { data: items } = await owner.client.from("items").select("id");
    expect(items?.length).toBeGreaterThan(0);
  });
});

describe("rate limiting", () => {
  it("allows calls up to the limit in a window, then refuses", async () => {
    const service = serviceClient();
    const key = uniq("rl");
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const { data } = await service.rpc("rate_limit_hit", { p_key: key, p_limit: 3, p_window_seconds: 600 });
      results.push(data as boolean);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("signed-in users cannot call it", async () => {
    const user = await signedInUser();
    const { error } = await user.client.rpc("rate_limit_hit", { p_key: "x", p_limit: 1, p_window_seconds: 1 });
    expect(error?.code).toBe("42501");
  });
});
