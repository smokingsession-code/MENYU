import sharp from "sharp";
import type { Page } from "@playwright/test";
import { createMember, createMenuFixture, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

/**
 * The photo import end to end. The server runs with MENU_IMPORT_FAKE=1, so a
 * canned menu stands in for Claude (src/lib/import/fake.ts); file names
 * containing "unreadable" or "busy" give those failures.
 */

async function signIn(page: Page, member: { digits: string; local: string }) {
  await page.goto("/login");
  await signInWithPhone(page, member.digits, member.local);
}

async function menuPhoto() {
  return sharp({ create: { width: 1600, height: 2000, channels: 3, background: { r: 250, g: 245, b: 230 } } }).jpeg().toBuffer();
}

async function upload(page: Page, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photos or PDF" }).click();
  await (await chooser).setFiles({ name, mimeType: "image/jpeg", buffer: await menuPhoto() });
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible({ timeout: 30_000 });
}

test.describe("phase 4: menu from photos", () => {
  test("an owner imports a menu from a photo, checks it and publishes it", async ({ page }) => {
    const fixture = await createMenuFixture({ items: 3 });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);

    await page.goto(`/dashboard/${fixture.restaurantId}/menu`);
    await page.getByRole("link", { name: "Import from photos" }).click();
    await expect(page.getByRole("heading", { name: "Import your menu from photos" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await upload(page, "menu-page-1.jpg");
    await page.getByRole("button", { name: "Read my menu" }).click();

    await expect(page.getByRole("heading", { name: "Reading your menu…" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check your menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("We found 6 dishes in 3 sections.")).toBeVisible();
    // Printed in capitals, tidied for the screen.
    await expect(page.getByLabel("Section name").first()).toHaveValue("Breakfast");
    await expect(page.getByLabel("Dish name").first()).toHaveValue("Rolex");

    // Katogo's price was marked unsure; Malakwang has no price at all.
    await expect(page.getByText("Dishes to check: 2")).toBeVisible();
    await page.getByRole("button", { name: "Show only dishes to check" }).click();
    await expect(page.getByLabel("Dish name")).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/import-review-360.png", fullPage: true });

    const malakwang = page.locator("[id^=dish-]").filter({ has: page.locator('input[value="Malakwang"]') });
    await malakwang.getByLabel("Price").fill("12k");
    await expect(malakwang.getByText("Shows as UGX 12,000")).toBeVisible();
    const katogo = page.locator("[id^=dish-]").filter({ has: page.locator('input[value="Katogo"]') });
    await expect(katogo.getByLabel("Price")).toHaveValue("8,000");
    await katogo.getByRole("button", { name: "✓ Looks right" }).click();
    await expect(page.getByText("No dishes are marked to check.")).toBeVisible();
    await page.getByRole("button", { name: "Show all dishes" }).click();

    // A dish the reader missed.
    const drinks = page.locator("section").filter({ has: page.locator('input[value="Drinks"]') });
    await drinks.getByRole("button", { name: "+ Add a dish" }).click();
    await page.getByLabel("Dish name").last().fill("Spring water");
    await drinks.getByLabel("Price").last().fill("1,500/=");
    await expect(page.getByText("Changes saved")).toBeVisible({ timeout: 15_000 });

    // Edits survive a reload.
    await page.reload();
    await expect(page.getByText("We found 7 dishes in 3 sections.")).toBeVisible();
    await expect(page.getByText("Nothing is marked to check.")).toBeVisible();

    await page.getByRole("button", { name: "Publish 7 dishes" }).click();
    const sheet = page.getByRole("dialog", { name: "Publish to your menu" });
    await expect(sheet.getByText("Your current dishes (3) stay.")).toBeVisible();
    await sheet.getByRole("button", { name: "Publish", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/dashboard/${fixture.restaurantId}/menu\\?imported=7$`));
    await expect(page.getByText("7 dishes added to your menu.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Mains/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Drinks/ })).toBeVisible();

    const diner = await page.context().newPage();
    await diner.goto(`/r/${fixture.slug}`);
    await expect(diner.getByRole("button", { name: /^Malakwang/ })).toContainText("UGX 12,000");
    await expect(diner.getByRole("button", { name: /^Spring water/ })).toContainText("UGX 1,500");
    await expect(diner.getByRole("button", { name: /^Dish 1/ })).toBeVisible();
    await diner.close();

    // The photos were only kept for the review.
    const { data: row } = await service()
      .from("menu_imports")
      .select("status, files")
      .eq("restaurant_id", fixture.restaurantId)
      .single();
    expect(row?.status).toBe("published");
    const path = (row!.files as { path: string }[])[0].path;
    await expect
      .poll(async () => (await service().storage.from("uploads").list(path.split("/").slice(0, 2).join("/"))).data?.length ?? -1)
      .toBe(0);
  });

  test("a menu that cannot be read says why and what to do next", async ({ page }) => {
    const fixture = await createMenuFixture({ items: 0 });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);

    await page.goto(`/dashboard/${fixture.restaurantId}/import`);
    await upload(page, "unreadable-menu.jpg");
    await page.getByRole("button", { name: "Read my menu" }).click();
    await expect(page.getByRole("heading", { name: "We couldn't read this menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/couldn't find a menu we could read/)).toBeVisible();
    await expect(page.getByText("Note from the reader: The photo is too dark to read.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Send it to us instead" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // A busy reader can be retried with the same photos.
    await page.getByRole("link", { name: "Use different photos" }).click();
    await upload(page, "busy-menu.jpg");
    await page.getByRole("button", { name: "Read my menu" }).click();
    await expect(page.getByText("Our menu reader is busy right now. Try again in a minute.")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Reading your menu…" })).toBeVisible();
    await expect(page.getByText("Our menu reader is busy right now. Try again in a minute.")).toBeVisible({ timeout: 30_000 });

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Discard import" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/${fixture.restaurantId}/import$`));
    await expect(page.getByText("Didn't work")).toHaveCount(1);
  });

  test("Free owners are offered the setup service instead, and staff cannot import", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "free", status: "free" });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await page.goto(`/dashboard/${fixture.restaurantId}/import`);
    await expect(page.getByRole("heading", { name: "Photo import comes with Standard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Send it to us" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Read my menu" })).toHaveCount(0);

    const pro = await createMenuFixture({ plan: "pro" });
    const staff = await createMember(pro.restaurantId, "staff");
    await page.context().clearCookies();
    await signIn(page, staff);
    await page.goto(`/dashboard/${pro.restaurantId}/import`);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});
