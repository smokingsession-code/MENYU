import { emailCode, expect, expectNoHorizontalScroll, randomUgPhone, signInWithPhone, test } from "./fixtures";

const ADMIN = { digits: "256700000001", local: "0700 000 001", email: "admin@menyu.test" };

test.describe("phase 1: sign in, admin creates a restaurant, owner accepts", () => {
  test("signed-out visitors are sent to sign in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a wrong phone number gets a friendly error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Phone number").fill("12345");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText("Enter a valid Ugandan phone number")).toBeVisible();
  });

  test("a wrong code is rejected", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Phone number").fill(ADMIN.local);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That code is wrong or has expired")).toBeVisible();
  });

  test("admin signs in by email and lands in the admin panel", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Use email instead" }).click();
    await page.getByLabel("Email address").fill(ADMIN.email);
    const since = Date.now();
    await page.getByRole("button", { name: "Send code" }).click();
    const code = await emailCode(ADMIN.email, since);
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // The admin home is the overview.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("admin creates a restaurant and the owner signs in from the invite", async ({ page, browser }) => {
    // Admin, by phone.
    await page.goto("/login");
    await signInWithPhone(page, ADMIN.digits, ADMIN.local);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/restaurants");
    await expect(page.getByRole("heading", { name: "Restaurants" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/admin-restaurants-360.png", fullPage: true });

    await page.getByRole("link", { name: "New restaurant" }).first().click();
    await expect(page.getByRole("heading", { name: "New restaurant" })).toBeVisible();

    // Validation first.
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page.getByText("Enter the restaurant's name")).toBeVisible();
    await expect(page.getByText("Enter a valid WhatsApp number")).toBeVisible();

    const owner = randomUgPhone();
    const name = `Mama Rose Kitchen ${Date.now() % 10000}`;
    await page.getByLabel("Restaurant name").fill(name);
    await page.getByLabel("Area").fill("Kira");
    await page.getByLabel("Restaurant WhatsApp number").fill("0772 555 111");
    await page.getByLabel("Owner's name").fill("Rose Nakato");
    await page.getByLabel("Owner's phone number").fill(owner.local);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/admin-new-restaurant-360.png", fullPage: true });
    await page.getByRole("button", { name: "Create restaurant" }).click();

    await expect(page.getByRole("heading", { name: `${name} is ready` })).toBeVisible();
    const inviteUrl = (await page.locator("p.font-mono").nth(1).textContent())!.trim();
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{32}$/);
    const wa = page.getByRole("link", { name: "Send on WhatsApp" });
    const href = (await wa.getAttribute("href"))!;
    expect(href).toContain(`https://wa.me/${owner.digits}?text=`);
    const message = decodeURIComponent(href.split("text=")[1]);
    expect(message).toContain("Hello Rose!");
    expect(message).toContain(inviteUrl);
    expect(message).toMatch(/\/r\/mama-rose-kitchen-\d+-kira/);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/admin-created-360.png", fullPage: true });

    // Owner, in a separate browser, opens the invite.
    const ownerContext = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(inviteUrl);
    await expect(ownerPage.getByText(`You've been invited to manage ${name}`)).toBeVisible();
    await expect(ownerPage.getByText(`ending in ${owner.digits.slice(-3)}`)).toBeVisible();
    await expectNoHorizontalScroll(ownerPage);
    await ownerPage.screenshot({ path: "test-results/screens/invite-360.png", fullPage: true });
    await ownerPage.getByRole("link", { name: "Sign in to accept" }).click();
    await signInWithPhone(ownerPage, owner.digits, owner.local);

    // One restaurant, so straight to its dashboard.
    await expect(ownerPage).toHaveURL(/\/dashboard\/[0-9a-f-]{36}$/);
    await expect(ownerPage.getByRole("heading", { name })).toBeVisible();
    await expect(ownerPage.getByText("Free trial until")).toBeVisible();
    await expectNoHorizontalScroll(ownerPage);
    await ownerPage.screenshot({ path: "test-results/screens/owner-dashboard-360.png", fullPage: true });

    // The owner is not an admin.
    const adminResponse = await ownerPage.goto("/admin/restaurants");
    expect(adminResponse?.status()).toBe(404);
    await ownerContext.close();
  });

  test("the sign-in screen fits a 360px phone", async ({ page }) => {
    await page.goto("/login");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/login-360.png", fullPage: true });
  });
});
