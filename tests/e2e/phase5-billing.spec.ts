import type { Page } from "@playwright/test";
import type { Database } from "../../src/lib/supabase/database.types";
import { createMember, createMenuFixture, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

const ADMIN = { digits: "256700000001", local: "0700 000 001" };
/** MoMo transaction IDs can be recorded once, so each run uses a new one. */
const transactionId = () => `4${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
const DAY = 86_400_000;

async function signIn(page: Page, who: { digits: string; local: string }) {
  await page.goto("/login");
  await signInWithPhone(page, who.digits, who.local);
}

async function setSubscription(restaurantId: string, values: Database["public"]["Tables"]["subscriptions"]["Update"]) {
  const { error } = await service().from("subscriptions").update(values).eq("restaurant_id", restaurantId);
  if (error) throw error;
}

test.describe("phase 5: plans and billing", () => {
  test("the admin sets where owners pay, reminds an overdue owner and records their MoMo payment", async ({ page, browser }) => {
    const fixture = await createMenuFixture({ plan: "standard", status: "overdue", whatsapp: "256772555001" });
    await setSubscription(fixture.restaurantId, { paid_until: new Date(Date.now() - 3 * DAY).toISOString(), grace_days: 7 });
    const owner = await createMember(fixture.restaurantId);

    await signIn(page, ADMIN);
    await page.goto("/admin/settings");
    await page.getByLabel("MTN MoMo merchant code").fill("123456");
    await page.getByLabel("Name on the MTN account").fill("Menyu Ltd");
    await page.getByLabel("Your WhatsApp number").fill("0700 000 009");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    await page.goto("/admin/billing");
    await expectNoHorizontalScroll(page);
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: fixture.name }) });
    await expect(row).toContainText("Standard · UGX 20,000");
    await expect(row).toContainText("Moves to Free on");
    const reminder = row.getByRole("link", { name: "Send reminder" });
    const href = decodeURIComponent((await reminder.getAttribute("href")) ?? "");
    expect(href).toContain("https://wa.me/256772555001?text=");
    expect(href).toContain(`Your Menyu Standard plan for ${fixture.name} was due on`);
    expect(href).toContain("MTN MoMo merchant code 123456 (Menyu Ltd)");

    await row.getByRole("link", { name: "Record payment" }).click();
    await expect(page.getByRole("heading", { name: "Record a payment" })).toBeVisible();
    await expect(page.getByText(/Paid until .* after this payment\./)).toBeVisible();
    const momoId = transactionId();
    await page.getByLabel("Transaction ID").fill(momoId);
    await page.getByRole("button", { name: "Record payment · UGX 20,000" }).click();
    await expect(page.getByText(/Payment recorded\. Paid until \d{1,2} \w{3} \d{4}\./)).toBeVisible();
    const billing = page.locator("#billing");
    await expect(billing.getByText("Active", { exact: true })).toBeVisible();
    await expect(billing.getByText(momoId)).toBeVisible();

    // The same MoMo transaction cannot be recorded twice.
    await page.getByLabel("Transaction ID").fill(momoId);
    await page.getByRole("button", { name: /^Record payment/ }).click();
    await expect(page.getByText("This transaction ID is already recorded.").first()).toBeVisible();

    // The owner sees the payment and how to pay next time; no overdue notice.
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const ownerPage = await context.newPage();
    await signIn(ownerPage, owner);
    await expect(ownerPage.getByText("Payment overdue")).toHaveCount(0);
    await ownerPage.getByRole("link", { name: "Plan and billing" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Plan and billing" })).toBeVisible();
    await expect(ownerPage.getByText("Next payment due on")).toBeVisible();
    await expect(ownerPage.getByText("123456")).toBeVisible();
    await expect(ownerPage.getByText(`Transaction ID: ${momoId}`)).toBeVisible();
    const sendId = ownerPage.getByRole("link", { name: "Send us the transaction ID" });
    expect(decodeURIComponent((await sendId.getAttribute("href")) ?? "")).toContain(`wa.me/256700000009?text=Hello! I paid UGX 20,000 for ${fixture.name}`);
    await expectNoHorizontalScroll(ownerPage);
    await ownerPage.screenshot({ path: "test-results/screens/owner-billing-360.png", fullPage: true });
    await context.close();
  });

  test("after the grace period the daily job moves an unpaid restaurant to Free, keeping its menu", async ({ page, request }) => {
    const fixture = await createMenuFixture({ plan: "standard", status: "active", items: 3 });
    await setSubscription(fixture.restaurantId, { paid_until: new Date(Date.now() - 10 * DAY).toISOString(), grace_days: 7 });
    const owner = await createMember(fixture.restaurantId);

    expect((await request.get("/api/cron/billing")).status()).toBe(401);
    const run = await request.get("/api/cron/billing", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(run.status()).toBe(200);
    const body = (await run.json()) as { changed: { restaurantId: string; to: string }[] };
    expect(body.changed).toContainEqual(expect.objectContaining({ restaurantId: fixture.restaurantId, to: "free" }));

    await page.goto(`/r/${fixture.slug}`);
    await expect(page.getByRole("link", { name: "Made with Menyu" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Dish 3/ })).toBeVisible();

    await signIn(page, owner);
    await expect(page.getByText("Your menu is on the Free plan, so only 30 dishes show.")).toBeVisible();
    await page.goto(`/dashboard/${fixture.restaurantId}/billing`);
    await expect(page.getByText("Nothing was deleted.")).toBeVisible();
  });

  test("staff never see billing", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    const staff = await createMember(fixture.restaurantId, "staff");
    await signIn(page, staff);
    await page.goto(`/dashboard/${fixture.restaurantId}/billing`);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});
