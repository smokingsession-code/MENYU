import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Page } from "@playwright/test";
import { createMenuFixture, freshPhone, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

const ADMIN = { digits: "256700000001", local: "0700 000 001" };

async function signIn(page: Page, who: { digits: string; local: string }) {
  await page.goto("/login");
  await signInWithPhone(page, who.digits, who.local);
}

test.describe("phase 7: setup queue, agents, referrals and the overview", () => {
  test("the admin opens a setup request's photos, imports them and marks it done", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "free", status: "free", items: 0 });
    const db = service();
    const path = `${fixture.restaurantId}/requests/${randomUUID()}.jpg`;
    const photo = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 250, g: 245, b: 230 } } }).jpeg().toBuffer();
    const upload = await db.storage.from("uploads").upload(path, photo, { contentType: "image/jpeg" });
    if (upload.error) throw upload.error;
    await db.from("setup_requests").insert({
      restaurant_id: fixture.restaurantId,
      kind: "setup",
      notes: "Please set up our menu from this photo.",
      contact_phone: "256772000321",
      files: [{ path, name: "menu.jpg", type: "image/jpeg", size: photo.length }],
    });

    await signIn(page, ADMIN);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Open setup requests")).toBeVisible();
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Requests" }).click();
    const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: fixture.name }) });
    await expect(card.getByText("Please set up our menu from this photo.")).toBeVisible();
    await expect(card.getByRole("link", { name: "Photo 1" })).toHaveAttribute("href", /\/storage\/v1\/object\/sign\/uploads\//);
    await expect(card.getByRole("link", { name: /Chat on WhatsApp/ })).toHaveAttribute("href", /wa\.me\/256772000321/);
    await expectNoHorizontalScroll(page);

    await card.getByRole("button", { name: "Import these photos" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/${fixture.restaurantId}/import/`));
    await expect(page.getByRole("heading", { name: "Check your menu" })).toBeVisible({ timeout: 30_000 });
    // The request keeps its own photo; the import works on a copy.
    expect((await db.storage.from("uploads").download(path)).error).toBeNull();

    await page.goto("/admin/requests");
    const again = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: fixture.name }) });
    await expect(again.getByLabel("Status")).toHaveValue("in_progress");
    await again.getByLabel("Status").selectOption("done");
    await expect(page.getByRole("link", { name: fixture.name })).toHaveCount(0);
    await page.getByRole("link", { name: "Done", exact: true }).click();
    await expect(page.getByRole("link", { name: fixture.name })).toBeVisible();
  });

  test("an agent's sign-up through a referral link pays: the agent earns a fee and the referrer a free month", async ({ page, browser }) => {
    const referrer = await createMenuFixture({ plan: "standard", status: "active" });
    const db = service();
    const { data: before } = await db.from("restaurants").select("referral_code, subscriptions(paid_until)").eq("id", referrer.restaurantId).single();

    // The admin adds an agent.
    await signIn(page, ADMIN);
    await page.goto("/admin/agents");
    await page.getByLabel("Name").fill("Grace Auma");
    await page.getByLabel("Phone").fill("0772 111 222");
    await page.getByRole("button", { name: "Add agent" }).click();
    const added = page.getByText(/Agent added\. Their code is [A-Z0-9]+\./);
    await expect(added).toBeVisible();
    const agentCode = (await added.textContent())!.match(/code is ([A-Z0-9]+)\./)![1];

    // A new owner opens the referral link, signs in and signs up with the agent's code.
    const owner = freshPhone();
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const ownerPage = await context.newPage();
    await ownerPage.goto(`/join/${before!.referral_code}`);
    await expect(ownerPage).toHaveURL(/\/login/);
    await signInWithPhone(ownerPage, owner.digits, owner.local);
    await expect(ownerPage).toHaveURL(/\/onboarding/);
    const name = `Kira Grill ${Date.now() % 100000}`;
    await ownerPage.getByLabel("Restaurant name").fill(name);
    await ownerPage.getByLabel("Area").fill("Kira");
    await ownerPage.getByLabel("WhatsApp number for orders").fill("0772 444 555");
    await ownerPage.getByLabel(/Agent code/).fill(agentCode);
    await ownerPage.getByRole("button", { name: "Continue" }).click();
    await expect(ownerPage.getByRole("heading", { name: "How would you like to add your menu?" })).toBeVisible();
    await context.close();

    const { data: signedUp } = await db.from("restaurants").select("id, agent_id, referred_by").eq("name", name).single();
    expect(signedUp!.referred_by).toBe(referrer.restaurantId);
    expect(signedUp!.agent_id).not.toBeNull();

    // They pay; the admin records it.
    await page.goto(`/admin/restaurants/${signedUp!.id}#billing`);
    await page.getByLabel("Transaction ID").fill(`5${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`);
    await page.getByRole("button", { name: /^Record payment/ }).click();
    await expect(page.getByText(/Payment recorded\. Paid until/)).toBeVisible();

    // The referrer's paid period is a month longer.
    const { data: after } = await db.from("subscriptions").select("paid_until").eq("restaurant_id", referrer.restaurantId).single();
    const gained = Date.parse(after!.paid_until!) - Date.parse(before!.subscriptions!.paid_until!);
    expect(gained).toBeGreaterThan(27 * 86_400_000);
    expect(gained).toBeLessThan(32 * 86_400_000);

    // The agent is owed the default fee, and the admin pays it out.
    await page.goto("/admin/agents");
    const agent = page.getByRole("listitem").filter({ hasText: agentCode });
    await expect(agent).toContainText("Restaurants signed: 1 · Paying: 1");
    await expect(agent.getByText("UGX 20,000").first()).toBeVisible();
    await agent.getByText("Record a payout").click();
    await agent.getByRole("button", { name: "Record payout" }).click();
    await expect(agent.getByText("Payout recorded.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: agentCode }).getByText("Owed").locator("..")).toContainText("UGX 0");
    await expectNoHorizontalScroll(page);
  });
});
