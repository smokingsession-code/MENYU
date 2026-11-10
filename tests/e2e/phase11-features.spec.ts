import type { Browser, Page } from "@playwright/test";
import { createMember, createMenuFixture, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

const ADMIN = { digits: "256700000001", local: "0700 000 001" };
const PHONE_UA = "Mozilla/5.0 (Linux; Android 12; TECNO KG5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

async function signIn(page: Page, who: { digits: string; local: string }) {
  await page.goto("/login");
  await signInWithPhone(page, who.digits, who.local);
}

async function diner(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA, serviceWorkers: "block" });
  return { context, page: await context.newPage() };
}

/** A signed-in admin on Admin > Features (switches are changed the way the admin does it). */
async function adminFeatures(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, ADMIN);
  await page.goto("/admin/features");
  return { context, page };
}

async function setSwitch(admin: Page, key: string, on: boolean) {
  const toggle = admin.locator(`[data-feature="${key}"]`).getByRole("switch");
  if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
  await expect(admin.locator(`[data-feature="${key}"]`)).toContainText(on ? "On" : "Off");
}

/** Every switch back on, whatever a test did. */
async function allOn() {
  const db = service();
  await db.from("feature_flags").update({ enabled: true }).neq("key", "");
  await db.from("restaurant_features").delete().neq("key", "");
}

test.afterEach(allOn);

test.describe("feature switches (Admin > Features)", () => {
  test("the admin turns Ratings off for everyone and back on: diners and owners see it go and come back", async ({ page, browser }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    const owner = await createMember(fixture.restaurantId);

    await signIn(page, ADMIN);
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Features" }).click();
    await expect(page.getByRole("heading", { name: "Features", level: 1 })).toBeVisible();
    for (const group of ["Diner", "Owner", "Network"]) await expect(page.getByRole("heading", { name: group, level: 2 })).toBeVisible();
    const ratings = page.locator('[data-feature="ratings"]');
    await expect(ratings).toContainText("Diners rate their visit");
    await expect(ratings).toContainText(/On for \d+ of \d+ restaurants/);
    await expect(ratings.getByRole("switch", { name: "Ratings" })).toHaveAttribute("aria-checked", "true");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/admin-features-360.png", fullPage: true });

    await ratings.getByRole("switch", { name: "Ratings" }).click();
    await expect(ratings.getByRole("switch", { name: "Ratings" })).toHaveAttribute("aria-checked", "false");
    await expect(ratings).toContainText("On for 0 of");

    // Diners: no "Rate your visit".
    const { context, page: menu } = await diner(browser);
    await menu.goto(`/r/${fixture.slug}`);
    await expect(menu.getByRole("heading", { name: fixture.name })).toBeVisible();
    await expect(menu.getByRole("button", { name: /Rate your visit/ })).toHaveCount(0);

    // Owners: no Feedback anywhere, and the page itself says so kindly.
    const ownerContext = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage, owner);
    await expect(ownerPage.getByRole("heading", { name: "More tools" })).toBeVisible();
    await expect(ownerPage.getByRole("link", { name: /^Feedback/ })).toHaveCount(0);
    await ownerPage.goto(`/dashboard/${fixture.restaurantId}/feedback`);
    await expect(ownerPage.getByText("This isn't available at the moment.", { exact: false })).toBeVisible();

    // Back on: everything returns.
    await ratings.getByRole("switch", { name: "Ratings" }).click();
    await expect(ratings.getByRole("switch", { name: "Ratings" })).toHaveAttribute("aria-checked", "true");
    await menu.goto(`/r/${fixture.slug}`);
    await expect(menu.getByRole("button", { name: /Rate your visit/ })).toBeVisible();
    await ownerPage.goto(`/dashboard/${fixture.restaurantId}`);
    await expect(ownerPage.getByRole("link", { name: /^Feedback/ })).toBeVisible();
    await context.close();
    await ownerContext.close();
  });

  test("per restaurant: Off hides Specials for that restaurant only; owners never see the Features page", async ({ page, browser }) => {
    const one = await createMenuFixture({ plan: "pro" });
    const two = await createMenuFixture({ plan: "pro" });
    for (const f of [one, two]) {
      await service().from("specials").insert({ restaurant_id: f.restaurantId, title: "Lunch deal", price_ugx: 9000 }).throwOnError();
    }

    await signIn(page, ADMIN);
    await page.goto(`/admin/restaurants/${one.restaurantId}`);
    const section = page.locator("#features");
    await expect(section.getByRole("heading", { name: "Features" })).toBeVisible();
    const specials = section.locator('[data-feature="specials"]');
    await expect(specials).toContainText("Working here");
    await specials.getByRole("radio", { name: "Off" }).click();
    await expect(specials).toContainText("Off for this restaurant");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/admin-restaurant-features-360.png", fullPage: true });

    const { context, page: menu } = await diner(browser);
    await menu.goto(`/r/${one.slug}`);
    await expect(menu.getByRole("heading", { name: one.name })).toBeVisible();
    await expect(menu.getByText("Lunch deal")).toHaveCount(0);
    await menu.goto(`/r/${two.slug}`);
    await expect(menu.getByText("Lunch deal")).toBeVisible();

    // Use global default: it comes back, nothing lost.
    await specials.getByRole("radio", { name: "Use global default" }).click();
    await expect(specials).toContainText("Working here");
    await menu.goto(`/r/${one.slug}`);
    await expect(menu.getByText("Lunch deal")).toBeVisible();
    await context.close();

    // Owners cannot open the admin pages.
    const owner = await createMember(one.restaurantId);
    await page.context().clearCookies();
    await signIn(page, owner);
    await page.goto("/admin/features");
    await expect(page.getByRole("heading", { name: "Features", level: 1 })).toHaveCount(0);
  });

  test("ordering buttons follow the switches, and a menu with none is for reading only", async ({ browser }) => {
    const fixture = await createMenuFixture({ plan: "standard" });
    await service().from("branches").update({ order_mode: "waiter" }).eq("id", fixture.branchId).throwOnError();
    const { context, page } = await diner(browser);

    await page.goto(`/r/${fixture.slug}?t=7`);
    await page.getByRole("button", { name: "Add Dish 1" }).click();
    await page.getByRole("button", { name: /View order/ }).click();
    await expect(page.getByRole("button", { name: "Show to waiter" })).toBeVisible();

    const admin = await adminFeatures(browser);
    await setSwitch(admin.page, "order_waiter", false);
    await page.goto(`/r/${fixture.slug}?t=7`);
    await page.getByRole("button", { name: /View order/ }).click();
    await expect(page.getByRole("link", { name: "Send order on WhatsApp" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show to waiter" })).toHaveCount(0);

    await setSwitch(admin.page, "order_whatsapp", false);
    await page.goto(`/r/${fixture.slug}?t=7`);
    await expect(page.getByRole("heading", { name: fixture.name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Dish 1" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /View order/ })).toHaveCount(0);
    await setSwitch(admin.page, "order_waiter", true);
    await setSwitch(admin.page, "order_whatsapp", true);
    await admin.context.close();
    await context.close();
  });

  test("the owner switches on the Christmas theme; it disappears while the admin's switch is off", async ({ page, browser }) => {
    const fixture = await createMenuFixture({ plan: "standard" });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await page.goto(`/dashboard/${fixture.restaurantId}/profile`);
    await page.getByRole("switch", { name: "Switch on the Christmas theme" }).click();
    await expect(page.getByText("Your menu shows the Christmas theme.")).toBeVisible();

    const { context, page: menu } = await diner(browser);
    await menu.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await menu.goto(`/r/${fixture.slug}`, { waitUntil: "load" });
    await expect(menu.getByText("Merry Christmas and happy holidays!")).toBeVisible();
    await menu.waitForTimeout(800);
    expect(await menu.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.01);
    await expectNoHorizontalScroll(menu);
    await menu.screenshot({ path: "test-results/screens/christmas-menu-360.png" });

    const admin = await adminFeatures(browser);
    await setSwitch(admin.page, "christmas", false);
    await menu.goto(`/r/${fixture.slug}`);
    await expect(menu.getByRole("heading", { name: fixture.name })).toBeVisible();
    await expect(menu.getByText("Merry Christmas and happy holidays!")).toHaveCount(0);
    await page.goto(`/dashboard/${fixture.restaurantId}/profile`);
    await expect(page.getByRole("switch", { name: /Christmas theme/ })).toHaveCount(0);
    await setSwitch(admin.page, "christmas", true);
    await admin.context.close();
    await context.close();
  });
});
