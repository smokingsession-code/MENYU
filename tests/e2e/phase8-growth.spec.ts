import sharp from "sharp";
import type { Page } from "@playwright/test";
import { createMember, createMenuFixture, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

const ADMIN = { digits: "256700000001", local: "0700 000 001" };

async function signIn(page: Page, who: { digits: string; local: string }) {
  await page.goto("/login");
  await signInWithPhone(page, who.digits, who.local);
}

test.describe("phase 8: marketing site, directory, branches, staff and photo auto-fix", () => {
  test("the marketing site explains the product, shows prices and opens WhatsApp and the demo", async ({ page, browser }) => {
    // The WhatsApp button uses the number from Admin > Settings.
    await signIn(page, ADMIN);
    await page.goto("/admin/settings");
    await page.getByLabel("Your WhatsApp number").fill("0700 000 009");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    const visitor = await browser.newPage({ viewport: { width: 360, height: 740 }, isMobile: true });
    await visitor.goto("/");
    await expect(visitor.getByRole("heading", { level: 1, name: "Your menu, on every phone." })).toBeVisible();
    await expect(visitor.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(visitor.getByText("UGX 20,000 a month")).toBeVisible();
    await expect(visitor.getByText("UGX 50,000 a month per branch")).toBeVisible();
    await expect(visitor.getByRole("link", { name: "Chat with us on WhatsApp" }).first()).toHaveAttribute("href", /^https:\/\/wa\.me\/256700000009\?text=/);
    await expectNoHorizontalScroll(visitor);
    await visitor.screenshot({ path: "test-results/screens/home-360.png", fullPage: true });
    await visitor.getByRole("link", { name: "See a demo menu" }).first().click();
    await expect(visitor).toHaveURL(/\/r\/kijani-cafe-ntinda/);
    await visitor.close();
  });

  test("the directory stays hidden until switched on; then diners find menus by dish", async ({ page, browser }) => {
    const fixture = await createMenuFixture({ plan: "standard", status: "active" });
    const db = service();
    const { data: cat } = await db.from("categories").select("id, menu_id").eq("restaurant_id", fixture.restaurantId).limit(1).single();
    await db.from("items").insert({ restaurant_id: fixture.restaurantId, menu_id: cat!.menu_id, category_id: cat!.id, name: "Rolex deluxe", price_ugx: 6000, sort_order: 9, description: null });
    await db.from("settings").upsert({ key: "directory_enabled", value: false });

    // The owner asks to be listed.
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await page.goto(`/dashboard/${fixture.restaurantId}/profile`);
    await page.getByRole("button", { name: "List my restaurant" }).click();
    await expect(page.getByText("Waiting for the Menyu team to approve.")).toBeVisible();

    const diner = await browser.newPage({ viewport: { width: 360, height: 740 }, isMobile: true });
    await diner.goto("/menus");
    await expect(diner.getByText("Page not found")).toBeVisible();

    // The admin approves it and switches the directory on.
    await page.context().clearCookies();
    await signIn(page, ADMIN);
    await page.goto("/admin/directory");
    const pending = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: fixture.name }) });
    await pending.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("listitem").filter({ has: page.getByRole("link", { name: fixture.name }) }).getByRole("button", { name: "Remove" })).toBeVisible();
    await page.getByRole("button", { name: "Switch the directory on" }).click();
    await expect(page.getByText("The directory is on.")).toBeVisible();

    await diner.goto("/menus?q=rolex");
    await expect(diner.getByRole("heading", { name: "Menus near me" })).toBeVisible();
    const card = diner.getByRole("link", { name: new RegExp(fixture.name) });
    await expect(card).toContainText("Has Rolex deluxe");
    await expect(card).toHaveAttribute("href", `/r/${fixture.slug}`);
    await diner.getByLabel("Area").selectOption({ index: 0 });
    await expectNoHorizontalScroll(diner);
    await diner.screenshot({ path: "test-results/screens/directory-360.png", fullPage: true });
    await diner.close();

    await page.getByRole("button", { name: "Switch the directory off" }).click();
    await expect(page.getByText("The directory is off.")).toBeVisible();
  });

  test("Pro owners add a branch with a copy of the menu, switch between branches and invite staff", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await page.getByRole("link", { name: /^Branches/ }).click();
    await page.getByLabel("Branch name").fill("Najjera branch");
    await page.getByLabel("Area").fill("Najjera");
    await page.getByText("A copy to change separately").click();
    await page.getByRole("button", { name: "Add branch" }).click();
    await expect(page.getByText("Branch added.")).toBeVisible();
    await expect(page.getByText("With 2 branches, Pro is UGX 100,000 a month.")).toBeVisible();

    // The dashboard now shows the new branch, with its own copy of the menu.
    const switcher = page.getByLabel("Branch", { exact: true });
    await expect(switcher.locator("option:checked")).toHaveText("Najjera branch");
    await page.goto(`/dashboard/${fixture.restaurantId}/menu`);
    await expect(page.getByRole("button", { name: /^Dish 1/ })).toBeVisible();
    await page.getByLabel("Branch", { exact: true }).selectOption({ label: `${fixture.name} · Kira` });
    await expect(page.getByLabel("Branch", { exact: true }).locator("option:checked")).toHaveText(`${fixture.name} · Kira`);
    await expectNoHorizontalScroll(page);

    await page.goto(`/dashboard/${fixture.restaurantId}/staff`);
    await page.getByLabel("Their phone number").fill("0772 999 111");
    await page.getByRole("button", { name: "Create invite" }).click();
    await expect(page.getByText("Invite ready. Send them the link:")).toBeVisible();
    await expect(page.getByRole("link", { name: "Send on WhatsApp" })).toHaveAttribute("href", /wa\.me\/256772999111\?text=/);
    await expect(page.getByText("0772 999 111")).toBeVisible();
  });

  test("Pro owners auto-fix a dish photo and choose between before and after", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await page.goto(`/dashboard/${fixture.restaurantId}/menu`);
    await page.getByRole("button", { name: /^Dish 1/ }).click();
    const sheet = page.getByRole("dialog");
    const dull = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 120, g: 112, b: 104 } } }).jpeg().toBuffer();
    const chooser = page.waitForEvent("filechooser");
    await sheet.getByRole("button", { name: "Add photo" }).click();
    await (await chooser).setFiles({ name: "dish.jpg", mimeType: "image/jpeg", buffer: dull });
    await page.getByRole("dialog", { name: "Adjust the photo" }).getByRole("button", { name: "Use this photo" }).click();
    await expect(sheet.getByRole("button", { name: "Change photo" })).toBeVisible({ timeout: 30_000 });

    const { data: before } = await service().from("items").select("photo").eq("restaurant_id", fixture.restaurantId).eq("name", "Dish 1").single();
    await sheet.getByRole("button", { name: "✨ Auto-fix photo" }).click();
    const compare = sheet.getByRole("group", { name: "Before and after" });
    await expect(compare.getByRole("img", { name: "Before" })).toBeVisible({ timeout: 30_000 });
    await expect(compare.getByRole("img", { name: "After" })).toBeVisible();
    await compare.getByRole("button", { name: "Use the fixed photo" }).click();
    await expect(compare).toHaveCount(0);
    await expect
      .poll(async () => ((await service().from("items").select("photo").eq("restaurant_id", fixture.restaurantId).eq("name", "Dish 1").single()).data?.photo as { path: string } | null)?.path)
      .not.toBe((before!.photo as { path: string }).path);
  });
});
