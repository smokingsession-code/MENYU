import sharp from "sharp";
import type { Page } from "@playwright/test";
import { createMember, createMenuFixture, freshPhone, service } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

async function signIn(page: Page, member: { digits: string; local: string }) {
  await page.goto("/login");
  await signInWithPhone(page, member.digits, member.local);
}

test.describe("phase 3: owner dashboard", () => {
  test("an owner builds their menu and diners see each change", async ({ page }) => {
    const fixture = await createMenuFixture({ items: 0 });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await expect(page).toHaveURL(new RegExp(`/dashboard/${fixture.restaurantId}$`));
    await expect(page.getByRole("heading", { name: "Finish setting up" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/owner-home-360.png", fullPage: true });

    // Menu tab.
    await page.getByRole("navigation", { name: fixture.name }).getByRole("link", { name: "Menu" }).click();
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();
    await page.getByLabel("Add a section").fill("Breakfast");
    await page.getByRole("button", { name: "Add a section" }).click();
    await expect(page.getByRole("heading", { name: /^Breakfast/ })).toBeVisible();

    await page.getByRole("button", { name: "+ Add a dish" }).last().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Name", { exact: true }).fill("Rolex");
    await sheet.getByLabel("Price (UGX)").fill("5k");
    await expect(sheet.getByText("Shows as UGX 5,000.")).toBeVisible();
    await sheet.getByRole("button", { name: "Popular" }).click();
    await sheet.getByRole("button", { name: "+ Add an add-on" }).click();
    await sheet.getByLabel("Add-on", { exact: true }).fill("Extra egg");
    await sheet.getByLabel("Price", { exact: true }).fill("1,000/=");
    await sheet.getByRole("button", { name: "Save dish" }).click();
    // The sheet stays open on the new dish so a photo can be added.
    await expect(sheet.getByRole("heading", { name: "Edit dish" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Add photo" })).toBeVisible();

    // Upload and crop a photo.
    const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
    const chooser = page.waitForEvent("filechooser");
    await sheet.getByRole("button", { name: "Add photo" }).click();
    await (await chooser).setFiles({ name: "rolex.jpg", mimeType: "image/jpeg", buffer: photo });
    await page.getByRole("dialog", { name: "Adjust the photo" }).getByRole("button", { name: "Use this photo" }).click();
    await expect(sheet.getByRole("button", { name: "Change photo" })).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole("button", { name: "Close" }).click();

    const row = page.getByRole("button", { name: /^Rolex/ });
    await expect(row).toContainText("UGX 5,000");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/menu-editor-360.png", fullPage: true });

    // Diners see it straight away, with the add-on and the photo.
    const diner = await page.context().newPage();
    await diner.goto(`/r/${fixture.slug}`);
    await expect(diner.getByRole("button", { name: /^Rolex/ })).toContainText("UGX 5,000");
    await expect(diner.locator('img[src*="/item/"]')).toHaveCount(1);
    await diner.getByRole("button", { name: /^Rolex/ }).click();
    await expect(diner.getByRole("dialog").getByText("Extra egg")).toBeVisible();

    // One tap: sold out. Diners see it on their next load.
    await page.getByRole("switch", { name: "Mark Rolex sold out" }).click();
    await expect(page.getByRole("switch", { name: "Mark Rolex available" })).toBeVisible();
    await diner.reload();
    await expect(diner.getByRole("button", { name: /^Rolex/ })).toContainText("Sold out");
    await page.getByRole("switch", { name: "Mark Rolex available" }).click();
    await expect(page.getByRole("switch", { name: "Mark Rolex sold out" })).toBeVisible();

    // Bulk price change: +10%, rounded to 500.
    await page.getByRole("button", { name: "Change prices" }).click();
    await page.getByRole("dialog").getByLabel("Change (%)").fill("10");
    await expect(page.getByRole("dialog").getByText("Example: UGX 5,000 becomes UGX 5,500.")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: /^Change 2 prices$/ }).click();
    await expect(page.getByRole("dialog").getByText("2 prices changed.")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: /^Rolex/ })).toContainText("UGX 5,500");

    // A second section, moved above the first.
    await page.getByLabel("Add a section").fill("Drinks");
    await page.getByRole("button", { name: "Add a section" }).click();
    await expect(page.getByRole("heading", { name: /^Drinks/ })).toBeVisible();
    await page.locator("section").filter({ hasText: "Drinks" }).getByLabel("Section options").click();
    await page.getByRole("button", { name: "Move up" }).click();
    // The fixture already has a "Mains" section at the top.
    const order = () => page.locator("section h2").evaluateAll((els) => els.map((e) => e.textContent?.split(" · ")[0]));
    await expect.poll(order).toEqual(["Mains", "Drinks", "Breakfast"]);
    await page.reload();
    await expect.poll(order).toEqual(["Mains", "Drinks", "Breakfast"]);

    // Hiding a dish removes it from the diner menu.
    await page.getByRole("button", { name: /^Rolex/ }).click();
    await page.getByRole("dialog").getByLabel("Hide this dish from the menu").check();
    await page.getByRole("dialog").getByRole("button", { name: "Save dish" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await diner.reload();
    await expect(diner.getByRole("button", { name: /^Rolex/ })).toHaveCount(0);
  });

  test("an owner updates the profile, hours and payment codes", async ({ page }) => {
    const fixture = await createMenuFixture({});
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await page.goto(`/dashboard/${fixture.restaurantId}/profile`);
    await page.getByLabel("Restaurant name").fill("Mama Rose Kitchen");
    await page.getByLabel("Short description").fill("Local food, fast.");
    await page.getByRole("button", { name: "Ugandan" }).click();
    await page.getByLabel("Area").fill("Najjera");
    await page.getByLabel("Or paste a Google Maps link").fill("https://www.google.com/maps/place/x/@0.3765,32.6259,17z");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("Pin set: 0.3765, 32.6259")).toBeVisible();
    await page.getByLabel("MTN MoMo merchant code").fill("123456");
    await page.getByLabel("Monday: Opens").fill("07:30");
    await page.getByLabel("Monday: Closes").fill("02:00");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/profile-360.png", fullPage: true });
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Saved. Your menu shows the changes now.")).toBeVisible();

    const db = service();
    const { data: branch } = await db.from("branches").select("area, lat, lng, momo_mtn_code, opening_hours").eq("id", fixture.branchId).single();
    expect(branch).toMatchObject({ area: "Najjera", lat: 0.3765, lng: 32.6259, momo_mtn_code: "123456" });
    expect((branch!.opening_hours as Record<string, string[][]>).mon).toEqual([["07:30", "02:00"]]);

    await page.goto(`/r/${fixture.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Mama Rose Kitchen" })).toBeVisible();
    await expect(page.getByText("Local food, fast.")).toBeVisible();
  });

  test("an owner adds tables and downloads their QR codes", async ({ page }) => {
    const fixture = await createMenuFixture({});
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await page.goto(`/dashboard/${fixture.restaurantId}/tables`);
    await page.getByLabel("Add tables").fill("1-3, VIP");
    await page.getByRole("button", { name: "Add tables" }).click();
    await expect(page.getByText("4 tables added.")).toBeVisible();
    for (const label of ["Table 1", "Table 2", "Table 3", "VIP", "Table 7"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
    const png = page.locator("li").filter({ hasText: "VIP" }).getByRole("link", { name: "PNG" });
    const response = await page.request.get((await png.getAttribute("href"))!);
    expect(response.headers()["content-type"]).toBe("image/png");
    await expectNoHorizontalScroll(page);
    page.once("dialog", (d) => d.accept());
    await page.locator("li").filter({ hasText: "VIP" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("VIP", { exact: true })).toHaveCount(0);
  });

  test("staff on Pro only see the sold-out list", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "pro" });
    const staff = await createMember(fixture.restaurantId, "staff");
    await signIn(page, staff);
    await page.goto(`/dashboard/${fixture.restaurantId}/menu`);
    await expect(page.getByRole("heading", { name: "Sold out today" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: fixture.name });
    // Staff on Pro also read diners' feedback.
    await expect(nav.getByRole("link")).toHaveText(["Home", "Menu", "Feedback"]);
    await expect(page.getByRole("button", { name: "Change prices" })).toHaveCount(0);
    await page.getByRole("switch", { name: /Dish 1/ }).click();
    await expect(page.getByRole("switch", { name: /Dish 1/ })).toHaveAttribute("aria-checked", "true");
    // The switch flips at once; the save follows in the background.
    await expect
      .poll(async () => (await service().from("sold_out").select("item_id").eq("branch_id", fixture.branchId)).data?.length)
      .toBe(1);
    const profile = await page.goto(`/dashboard/${fixture.restaurantId}/request`);
    expect(profile?.status()).toBe(200);
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("Free owners cannot edit, but can ask the Menyu team for changes", async ({ page }) => {
    const fixture = await createMenuFixture({ status: "free" });
    const owner = await createMember(fixture.restaurantId);
    await signIn(page, owner);
    await expect(page.getByRole("heading", { name: "You're on the Free plan" })).toBeVisible();
    await page.goto(`/dashboard/${fixture.restaurantId}/menu`);
    await expect(page.getByText("On the Free plan, our team updates your menu for you.")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add a dish" })).toHaveCount(0);
    await page.getByRole("link", { name: "Ask us to change it" }).click();
    await page.getByLabel("What should we change?").fill("Rolex is now UGX 6,000.");
    await page.getByRole("button", { name: "Send to the Menyu team" }).click();
    await expect(page.getByText("Thank you! We got your request")).toBeVisible();
    const { data } = await service().from("setup_requests").select("kind, notes, status").eq("restaurant_id", fixture.restaurantId);
    expect(data).toEqual([{ kind: "change", notes: "Rolex is now UGX 6,000.", status: "new" }]);
  });

  test("a new owner signs up and sets up their restaurant", async ({ page }) => {
    const phone = freshPhone();
    await signIn(page, phone);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("link", { name: "Set up my restaurant" }).click();
    await page.getByLabel("Restaurant name").fill("Najjera Juice Bar");
    await page.getByLabel("Area").fill("Najjera");
    await page.getByLabel("WhatsApp number for orders").fill("0772 333 444");
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "How would you like to add your menu?" })).toBeVisible();
    await expect(page.getByText("Add your logo")).toBeVisible();
    await page.getByRole("link", { name: /Type it in/ }).click();
    await expect(page.getByText(/Your menu is empty/)).toBeVisible();
    const { data } = await service().from("branches").select("slug, whatsapp").like("slug", "najjera-juice-bar%").order("created_at", { ascending: false }).limit(1).single();
    expect(data!.whatsapp).toBe("256772333444");
  });
});
