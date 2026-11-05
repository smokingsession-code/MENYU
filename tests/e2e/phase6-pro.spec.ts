import type { Page } from "@playwright/test";
import { createMember, createMenuFixture, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

/** A normal phone browser: events from headless browsers are not counted. */
const PHONE_UA = "Mozilla/5.0 (Linux; Android 12; TECNO KG5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

async function signIn(page: Page, who: { digits: string; local: string }) {
  await page.goto("/login");
  await signInWithPhone(page, who.digits, who.local);
}

function kampalaHour(offset = 0): string {
  const hour = (new Date(Date.now() + 3 * 3_600_000).getUTCHours() + offset) % 24;
  return `${String(hour).padStart(2, "0")}:00`;
}

test.describe("phase 6: specials, waiter, Mobile Money, feedback and insights", () => {
  test("diners see the special that is on, call the waiter, pay by MoMo and leave feedback; the owner sees it all", async ({ browser }) => {
    const fixture = await createMenuFixture({ plan: "pro", whatsapp: "256772555002" });
    const db = service();
    await db.from("branches").update({ momo_mtn_code: "778899", momo_mtn_name: "Test Grill Ltd" }).eq("id", fixture.branchId);
    const { error } = await db.from("specials").insert([
      { restaurant_id: fixture.restaurantId, title: "Lunch deal", price_ugx: 9000, days: [1, 2, 3, 4, 5, 6, 7], start_time: "00:00", end_time: "00:00" },
      // Starts in two hours, so it must not show now.
      { restaurant_id: fixture.restaurantId, title: "Late happy hour", days: [1, 2, 3, 4, 5, 6, 7], start_time: kampalaHour(2), end_time: kampalaHour(3) },
    ]);
    if (error) throw error;

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
    await page.goto(`/r/${fixture.slug}?t=7`, { waitUntil: "load" });

    await expect(page.getByRole("heading", { name: "Specials now" })).toBeVisible();
    await expect(page.getByText("Lunch deal")).toBeVisible();
    await expect(page.getByText("Late happy hour")).toBeHidden();
    await page.waitForTimeout(1000);
    // The special was already showing when the page first painted: nothing moved.
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.01);

    const waiter = page.getByRole("link", { name: "Call the waiter" });
    expect(decodeURIComponent((await waiter.getAttribute("href")) ?? "")).toContain("https://wa.me/256772555002?text=Table 7: please come to our table.");
    const bill = page.getByRole("link", { name: "Bring the bill" });
    expect(decodeURIComponent((await bill.getAttribute("href")) ?? "")).toContain("Table 7: please bring the bill.");

    await page.getByRole("button", { name: "Add Lunch deal" }).click();
    await expect(page.getByRole("button", { name: /View order/ })).toContainText("UGX 9,000");

    await page.getByRole("button", { name: "Pay with Mobile Money" }).click();
    const pay = page.getByRole("dialog", { name: "Pay with Mobile Money" });
    await expect(pay.getByText("778899")).toBeVisible();
    await expect(pay.getByText("Name: Test Grill Ltd")).toBeVisible();
    await expect(pay.getByText("UGX 9,000")).toBeVisible();
    await pay.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: /Rate your visit/ }).click();
    const feedback = page.getByRole("dialog", { name: "How was your visit?" });
    await feedback.getByRole("button", { name: "Send" }).click();
    await expect(feedback.getByText("Tap a star to rate your visit.")).toBeVisible();
    await feedback.getByRole("radio", { name: "4 out of 5" }).click();
    await feedback.getByLabel("Anything to tell the owner?").fill("Lovely lunch deal");
    await feedback.getByRole("button", { name: "Send" }).click();
    await expect(feedback.getByText("Thank you! The owner will read it.")).toBeVisible();
    await feedback.getByRole("button", { name: "Close" }).click();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/menu-pro-360.png", fullPage: true });
    await context.close();

    // The owner.
    const owner = await createMember(fixture.restaurantId);
    const ownerContext = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage, owner);
    await expect(ownerPage.getByRole("heading", { name: "More tools" })).toBeVisible();
    await expect(ownerPage.getByText("New: 1")).toBeVisible();

    await ownerPage.getByRole("link", { name: /^Feedback/ }).click();
    await expect(ownerPage.getByText("4.0", { exact: true })).toBeVisible();
    await expect(ownerPage.getByText("Lovely lunch deal")).toBeVisible();
    await expect(ownerPage.getByText("Table 7")).toBeVisible();

    await ownerPage.goto(`/dashboard/${fixture.restaurantId}/insights`);
    await expect(ownerPage.getByRole("heading", { name: "Insights" })).toBeVisible();
    const views = ownerPage.locator("div", { has: ownerPage.getByText("Menu views", { exact: true }) }).last();
    await expect(views).toContainText(/[1-9]/);
    await expect(ownerPage.getByText("Menu views per day")).toBeVisible();
    await expectNoHorizontalScroll(ownerPage);
    await ownerPage.screenshot({ path: "test-results/screens/insights-360.png", fullPage: true });

    await ownerPage.goto(`/dashboard/${fixture.restaurantId}/specials`);
    await expect(ownerPage.getByText("Lunch deal")).toBeVisible();
    await ownerPage.getByRole("button", { name: "+ Add a special" }).click();
    const form = ownerPage.getByRole("dialog", { name: "New special" });
    await form.getByLabel("Title").fill("Rolex Tuesday");
    await form.getByLabel("Price (UGX)").fill("5k");
    await form.getByRole("button", { name: "Save special" }).click();
    await expect(ownerPage.getByText("Special saved.")).toBeVisible();
    await expect(ownerPage.getByText("Rolex Tuesday")).toBeVisible();
    await expect(ownerPage.getByText(/Mon, Tue, Wed, Thu, Fri · 4pm – 7pm · UGX 5,000/)).toBeVisible();
    await expectNoHorizontalScroll(ownerPage);
    await ownerContext.close();
  });

  test("Standard menus and owners see none of the Pro tools", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "standard" });
    await page.goto(`/r/${fixture.slug}?t=7`);
    await expect(page.getByRole("heading", { name: fixture.name })).toBeVisible();
    await expect(page.getByRole("link", { name: "Call the waiter" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Rate your visit/ })).toHaveCount(0);

    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await expect(page.getByRole("heading", { name: "Get more with Pro" })).toBeVisible();
    await page.goto(`/dashboard/${fixture.restaurantId}/specials`);
    await expect(page.getByText("Specials come with the Pro plan.")).toBeVisible();
    await page.goto(`/dashboard/${fixture.restaurantId}/insights`);
    await expect(page.getByText("Insights come with the Pro plan.")).toBeVisible();
  });
});
