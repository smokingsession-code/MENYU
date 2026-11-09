import type { Browser, Page } from "@playwright/test";
import { createMember, createMenuFixture, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

/** A normal phone browser: events from headless browsers are not counted. */
const PHONE_UA = "Mozilla/5.0 (Linux; Android 12; TECNO KG5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

async function dinerPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  return { context, page };
}

async function cls(page: Page) {
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

async function itemId(restaurantId: string, name: string) {
  const { data } = await service().from("items").select("id").eq("restaurant_id", restaurantId).eq("name", name).single();
  return data!.id;
}

test.beforeEach(async () => {
  await service().from("rate_limits").delete().like("key", "loy:%");
});

test.describe("ordering: show the waiter, the kitchen screen, loyalty stamps and Sell it today", () => {
  test("a diner sees today's deal, pays cash, shows the waiter the bill and collects a stamp, then uses the reward", async ({ browser }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    const db = service();
    await db.from("branches").update({ order_mode: "waiter", momo_mtn_code: "778899", momo_mtn_name: "Test Grill Ltd" }).eq("id", fixture.branchId).throwOnError();
    await db.from("restaurants").update({ loyalty_enabled: true, loyalty_visits: 3, loyalty_reward: "a free juice" }).eq("id", fixture.restaurantId).throwOnError();
    const dish3 = await itemId(fixture.restaurantId, "Dish 3");
    await db
      .from("deals")
      .insert({ restaurant_id: fixture.restaurantId, branch_id: fixture.branchId, item_id: dish3, percent_off: 30, note: "Fresh this morning", ends_at: new Date(Date.now() + 3 * 3_600_000).toISOString() })
      .throwOnError();

    const { context, page } = await dinerPage(browser);
    await page.goto(`/r/${fixture.slug}?t=7`, { waitUntil: "load" });

    const deals = page.getByRole("region", { name: "Today only" });
    await expect(deals).toBeVisible();
    await expect(deals.getByText("Dish 3")).toBeVisible();
    await expect(deals.getByText("30% off")).toBeVisible();
    await expect(deals.getByText("UGX 2,100")).toBeVisible();
    await expect(deals.getByText("Fresh this morning")).toBeVisible();
    // The dish in the list shows the deal price too, and the normal price is hidden.
    const card = page.getByRole("button", { name: /^Dish 3/ }).first();
    await expect(card.getByText("UGX 2,100")).toBeVisible();
    await page.waitForTimeout(1000);
    // The deal was showing when the page first painted: nothing moved.
    expect(await cls(page)).toBeLessThan(0.01);

    await deals.getByRole("button", { name: "Add Dish 3" }).click();
    await page.getByRole("button", { name: "Add Dish 1" }).click();
    await expect(page.getByRole("button", { name: /View order/ })).toContainText("UGX 3,100");

    await page.getByRole("button", { name: /View order/ }).click();
    const order = page.getByRole("dialog", { name: "Your order" });
    await expect(order.getByText("-30%")).toBeVisible();
    await expect(order.getByRole("region", { name: "Loyalty card" })).toContainText("3 stamps = a free juice");
    await order.getByRole("button", { name: "Cash" }).click();
    await expect(order.getByRole("link", { name: "Send on WhatsApp" })).toHaveCount(0);
    await order.getByRole("button", { name: "Show to waiter" }).click();

    const bill = page.getByRole("dialog", { name: "Show this to your waiter" });
    await expect(bill.getByText("Table 7", { exact: true })).toBeVisible();
    await expect(bill.getByText("1 × Dish 3")).toBeVisible();
    await expect(bill.getByText("UGX 3,100").last()).toBeVisible();
    await expect(bill.getByText("Paying with Cash")).toBeVisible();
    await expect(bill.getByText("Stamp added! 1 of 3")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/waiter-bill-360.png", fullPage: true });

    const { data: saved } = await db.from("orders").select("mode, status, total_ugx, table_label, payment, lines").eq("branch_id", fixture.branchId).single();
    expect(saved).toMatchObject({ mode: "waiter", status: "sent", total_ugx: 3100, table_label: "7", payment: "cash" });
    expect(saved!.lines).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Dish 3", unit: 2100, percent_off: 30 })]));

    // Showing the same order again updates it rather than adding another.
    await bill.getByRole("button", { name: "Back to the menu" }).click();
    await page.getByRole("button", { name: /View order/ }).click();
    await page.getByRole("dialog", { name: "Your order" }).getByRole("button", { name: "Show to waiter" }).click();
    await expect(page.getByRole("dialog", { name: "Show this to your waiter" })).toBeVisible();
    await expect.poll(async () => (await db.from("orders").select("id", { count: "exact", head: true }).eq("branch_id", fixture.branchId)).count).toBe(1);

    // Two more visits on other days fill the card; the reward is used in front of the waiter.
    await db.from("loyalty_cards").update({ stamps: 3 }).eq("restaurant_id", fixture.restaurantId).throwOnError();
    await page.goto(`/r/${fixture.slug}?t=7`, { waitUntil: "load" });
    await page.getByRole("button", { name: /View order/ }).click();
    const again = page.getByRole("dialog", { name: "Your order" });
    await expect(again.getByText("Your reward is ready: a free juice!")).toBeVisible();
    await again.getByRole("button", { name: "Use my reward now" }).click();
    await again.getByRole("button", { name: "Yes, use it" }).click();
    await expect(again.getByText("Reward used")).toBeVisible();
    await expect(again.getByText(/^Used at \d{2}:\d{2}$/)).toBeVisible();
    const { data: cardRow } = await db.from("loyalty_cards").select("stamps, rewards_used").eq("restaurant_id", fixture.restaurantId).single();
    expect(cardRow).toEqual({ stamps: 0, rewards_used: 1 });
    await context.close();
  });

  test("orders go to the kitchen screen; staff move them along and the diner sees when it's ready", async ({ browser }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    await service().from("branches").update({ order_mode: "kitchen" }).eq("id", fixture.branchId).throwOnError();

    const { context, page } = await dinerPage(browser);
    await page.goto(`/r/${fixture.slug}?t=7`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Add Dish 2" }).click();
    await page.getByRole("button", { name: /View order/ }).click();
    const order = page.getByRole("dialog", { name: "Your order" });
    await order.getByLabel("Your name").fill("Sarah");
    await order.getByRole("button", { name: "Send to kitchen" }).click();
    const sent = page.getByRole("dialog", { name: "Sent to the kitchen" });
    await expect(sent.getByText("Order 1", { exact: true })).toBeVisible();
    await expect(sent.locator('[aria-current="step"]')).toHaveText(/Received/);
    await expectNoHorizontalScroll(page);

    // Staff on the kitchen screen.
    const staff = await createMember(fixture.restaurantId, "staff");
    const staffContext = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const kitchen = await staffContext.newPage();
    await kitchen.goto("/login");
    await signInWithPhone(kitchen, staff.digits, staff.local);
    await kitchen.getByRole("navigation").getByRole("link", { name: "Kitchen" }).click();
    const newColumn = kitchen.getByRole("region", { name: /^New/ });
    await expect(newColumn.getByText("Order 1")).toBeVisible();
    await expect(newColumn.getByText("1 × Dish 2")).toBeVisible();
    await expect(newColumn.getByText("Table 7 · Sarah").or(newColumn.getByText("Table 7"))).toBeVisible();
    await newColumn.getByRole("button", { name: "Start cooking" }).click();
    const cooking = kitchen.getByRole("region", { name: /^Cooking/ });
    await expect(cooking.getByText("Order 1")).toBeVisible();
    await expectNoHorizontalScroll(kitchen);
    await kitchen.screenshot({ path: "test-results/screens/kitchen-360.png", fullPage: true });
    await cooking.getByRole("button", { name: "Ready" }).click();
    await expect(kitchen.getByRole("region", { name: /^Ready/ }).getByText("Order 1")).toBeVisible();
    await expect.poll(async () => (await service().from("orders").select("status").eq("branch_id", fixture.branchId).single()).data?.status).toBe("ready");

    // The diner's phone follows along.
    await expect(sent.getByText("Your order is ready!")).toBeVisible({ timeout: 20_000 });
    await sent.getByRole("button", { name: "Back to the menu" }).click();
    await expect(page.getByRole("button", { name: "Order 1: Ready" })).toBeVisible();

    await kitchen.getByRole("region", { name: /^Ready/ }).getByRole("button", { name: "Served" }).click();
    await expect(kitchen.getByText("Served today: 1")).toBeVisible();
    await staffContext.close();
    await context.close();
  });

  test("owners choose how diners order, run a Sell it today deal and see today's orders", async ({ page, browser }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    const owner = await createMember(fixture.restaurantId);
    await page.goto("/login");
    await signInWithPhone(page, owner.digits, owner.local);
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    await page.getByRole("link", { name: "How diners order" }).click();
    await page.getByRole("radio", { name: /Show to waiter/ }).check();
    await page.getByLabel("Give loyalty stamps").check();
    await page.getByLabel("Stamps for a reward").fill("4");
    await page.getByLabel("Reward", { exact: true }).fill("a free chapati");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved. Your menu shows it now.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/ordering-settings-360.png", fullPage: true });
    const { data: branch } = await service().from("branches").select("order_mode").eq("id", fixture.branchId).single();
    expect(branch?.order_mode).toBe("waiter");

    await page.goto(`/dashboard/${fixture.restaurantId}/deals`);
    await page.getByLabel("Dish", { exact: true }).selectOption({ label: "Dish 2 · UGX 2,000" });
    await page.getByRole("button", { name: "50%" }).click();
    await expect(page.getByText("UGX 2,000 → UGX 1,000")).toBeVisible();
    await page.getByRole("button", { name: "In 3 hours" }).click();
    await page.getByLabel("Note for diners").fill("Must go today");
    await page.getByRole("button", { name: "Start the deal" }).click();
    await expect(page.getByText("Deal started. It's on your menu now.")).toBeVisible();
    await expect(page.getByText(/UGX 2,000 → UGX 1,000 · Until/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/sell-it-today-360.png", fullPage: true });

    // A diner sees it straight away, orders it and shows the waiter.
    const { context, page: diner } = await dinerPage(browser);
    await diner.goto(`/r/${fixture.slug}?t=7`, { waitUntil: "load" });
    const deals = diner.getByRole("region", { name: "Today only" });
    await expect(deals.getByText("Must go today")).toBeVisible();
    await deals.getByRole("button", { name: "Add Dish 2" }).click();
    await diner.getByRole("button", { name: /View order/ }).click();
    await expect(diner.getByRole("dialog", { name: "Your order" }).getByRole("region", { name: "Loyalty card" })).toContainText("4 stamps = a free chapati");
    await diner.getByRole("button", { name: "Show to waiter" }).click();
    await expect(diner.getByText("Stamp added! 1 of 4")).toBeVisible();
    await context.close();

    // The owner's home counts it; ending the deal takes it off the menu.
    await page.goto(`/dashboard/${fixture.restaurantId}`);
    const today = page.locator("div", { has: page.getByRole("heading", { name: "Today" }) }).last();
    await expect(today).toContainText("UGX 1,000");
    await expect(page.getByText("On now: Dish 2 -50%")).toBeVisible();
    await page.goto(`/dashboard/${fixture.restaurantId}/deals`);
    await page.getByRole("button", { name: "End now" }).click();
    await expect(page.getByText("Deal ended.")).toBeVisible();
    await expect(page.getByText("No deals on now.")).toBeVisible();

    await page.goto(`/dashboard/${fixture.restaurantId}/insights`);
    await expect(page.getByRole("heading", { name: "Orders and sales" })).toBeVisible();
    await expect(page.getByText("Most ordered")).toBeVisible();
  });

  test("Standard owners get the waiter and WhatsApp buttons; deals, loyalty and the kitchen are Pro", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "standard" });
    const owner = await createMember(fixture.restaurantId);
    await page.goto("/login");
    await signInWithPhone(page, owner.digits, owner.local);
    await page.goto(`/dashboard/${fixture.restaurantId}/ordering`);
    await expect(page.getByRole("radio", { name: /Send to kitchen/ })).toBeDisabled();
    await expect(page.getByText("Loyalty stamps come with the Pro plan.")).toBeVisible();
    await page.goto(`/dashboard/${fixture.restaurantId}/deals`);
    await expect(page.getByText("Sell it today comes with the Pro plan")).toBeVisible();
    await page.goto(`/dashboard/${fixture.restaurantId}/kitchen`);
    await expect(page.getByText("The kitchen screen comes with the Pro plan.")).toBeVisible();
  });
});

test.describe("Menus near me: deals and this week's top places", () => {
  test("shows today's deal on a listing and ranks the busiest places in an area", async ({ page }) => {
    const db = service();
    const area = `Bugolobi ${Date.now().toString(36)}`;
    const places = [await createMenuFixture({ plan: "pro", name: `Busy Bar ${Date.now()}` }), await createMenuFixture({ plan: "pro", name: `Quiet Cafe ${Date.now()}` })];
    for (const p of places) {
      await db.from("restaurants").update({ directory_status: "approved" }).eq("id", p.restaurantId).throwOnError();
      await db.from("branches").update({ area }).eq("id", p.branchId).throwOnError();
    }
    await db.from("settings").upsert({ key: "directory_enabled", value: true }).throwOnError();
    const view = (p: { restaurantId: string; branchId: string }, s: string) => ({ restaurant_id: p.restaurantId, branch_id: p.branchId, type: "menu_view", session_id: s });
    await db.from("events").insert([view(places[0], "aaaaaaaa1"), view(places[0], "aaaaaaaa2"), view(places[0], "aaaaaaaa3"), view(places[1], "aaaaaaaa4")]).throwOnError();
    const dish = await itemId(places[1].restaurantId, "Dish 3");
    await db.from("deals").insert({ restaurant_id: places[1].restaurantId, branch_id: places[1].branchId, item_id: dish, percent_off: 20, ends_at: new Date(Date.now() + 3_600_000).toISOString() }).throwOnError();

    await page.goto(`/menus?area=${encodeURIComponent(area)}`);
    const top = page.getByRole("region", { name: `Top in ${area} this week` });
    await expect(top.getByRole("listitem")).toHaveText([/Busy Bar/, /Quiet Cafe/]);
    await expect(top.getByText(/Ratings are private and never used/)).toBeVisible();
    await expect(page.getByText("Today: Dish 3 20% off")).toBeVisible();
    await expect(page.getByText(/UGX 2,400 \(was UGX 3,000\)/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/menus-top-360.png", fullPage: true });
  });
});
