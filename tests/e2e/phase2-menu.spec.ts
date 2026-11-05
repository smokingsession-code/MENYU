import { createMenuFixture } from "./db";
import { expect, expectNoHorizontalScroll, signInWithPhone, test, throttle } from "./fixtures";

const DEMO = "/r/kijani-cafe-ntinda";

test.describe("phase 2: the diner menu", () => {
  test("stays under 200 KB before images, with no layout jumps, and paints fast on slow 3G", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    const cdp = await throttle(page, "slow3g");
    const sizes = new Map<string, number>();
    const kinds = new Map<string, string>();
    cdp.on("Network.responseReceived", (e) => kinds.set(e.requestId, e.type));
    cdp.on("Network.loadingFinished", (e) => sizes.set(e.requestId, e.encodedDataLength));
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    await page.goto(`${DEMO}?t=5`, { waitUntil: "load" });
    await page.waitForTimeout(1500);

    let beforeImages = 0;
    for (const [id, bytes] of sizes) if (kinds.get(id) !== "Image") beforeImages += bytes;
    const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    console.log(`menu weight before images: ${(beforeImages / 1024).toFixed(1)} KB, FCP on slow 3G: ${Math.round(fcp)} ms, CLS: ${cls.toFixed(3)}`);

    expect(beforeImages).toBeLessThan(200 * 1024);
    expect(cls).toBeLessThan(0.05);
    expect(fcp).toBeGreaterThan(0);
    expect(fcp).toBeLessThan(7000);
    await context.close();
  });

  test("shows the restaurant, opening status and contact buttons at 360px", async ({ page }) => {
    await page.goto(DEMO);
    await expect(page.getByRole("heading", { level: 1, name: "Kijani Café" })).toBeVisible();
    await expect(page.getByText(/^(Open now|Closed)$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Map" })).toHaveAttribute("href", /google\.com\/maps/);
    await expect(page.getByText("Demo menu: orders are not sent anywhere.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/menu-360.png" });
  });

  test("search finds dishes and says when nothing matches", async ({ page }) => {
    await page.goto(DEMO);
    const search = page.getByLabel("Search the menu");
    await search.fill("juice");
    await expect(page.getByText("6 dishes found")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Passion juice/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Rolex/ })).toHaveCount(0);
    await search.fill("ROLEX");
    await expect(page.getByRole("button", { name: /^Rolex/ })).toBeVisible();
    await search.fill("pizza");
    await expect(page.getByText('No dishes match "pizza".')).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByRole("button", { name: /^Rolex/ })).toBeVisible();
  });

  test("hidden items never show and sold-out items cannot be added", async ({ page }) => {
    await page.goto(DEMO);
    await expect(page.getByText("Staff lunch")).toHaveCount(0);
    const nsenene = page.getByRole("button", { name: /^Nsenene/ });
    await expect(nsenene).toContainText("Sold out");
    await expect(page.getByRole("button", { name: "Add Nsenene" })).toHaveCount(0);
    await nsenene.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: /Add to order/ })).toHaveCount(0);
  });

  test("builds an order with sizes, add-ons and notes; the phone's back button closes sheets", async ({ page }) => {
    await page.goto(`${DEMO}?t=5`);
    await page.getByRole("button", { name: /^Passion juice/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Large").check();
    await sheet.getByRole("button", { name: "One more" }).click();
    await expect(sheet.getByRole("button", { name: "Add to order · UGX 12,000" })).toBeVisible();
    await sheet.getByRole("button", { name: /Add to order/ }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: /^Rolex/ }).click();
    await page.getByRole("dialog").getByLabel("Extra egg").check();
    await page.getByRole("dialog").getByLabel("Note for the kitchen").fill("no onions");
    await page.getByRole("dialog").getByRole("button", { name: /Add to order/ }).click();

    await page.getByRole("button", { name: "Add Chapati" }).click();
    const bar = page.getByRole("button", { name: /View order/ });
    await expect(bar).toContainText("4 items · UGX 19,000");

    // Back closes a sheet instead of leaving the menu.
    await page.getByRole("button", { name: /^Mango juice/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).toHaveURL(/kijani-cafe-ntinda\?t=5/);

    // The cart survives a reload.
    await page.reload();
    await expect(page.getByRole("button", { name: /View order/ })).toContainText("4 items");

    await page.getByRole("button", { name: /View order/ }).click();
    const cart = page.getByRole("dialog");
    await expect(cart.getByLabel("Table")).toHaveValue("5");
    await cart.getByText("Delivery", { exact: true }).click();
    await cart.getByRole("link", { name: "Send order on WhatsApp" }).click();
    await expect(cart.getByText("Add your delivery address.")).toBeVisible();
    await cart.getByLabel("Delivery address").fill("Plot 4, Ntinda Road");
    await cart.getByLabel("Your name").fill("Sarah");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/cart-360.png" });
    await cart.getByRole("link", { name: "Send order on WhatsApp" }).click();

    // Demo menus show the message instead of opening WhatsApp.
    await expect(cart.getByText("This is the message the restaurant would get")).toBeVisible();
    const message = await cart.locator("pre").textContent();
    expect(message).toBe(
      [
        "New order (delivery)",
        "2 x Passion juice (Large) - UGX 12,000",
        "1 x Rolex + Extra egg - UGX 6,000",
        "  Note: no onions",
        "1 x Chapati - UGX 1,000",
        "Total: UGX 19,000",
        "Name: Sarah",
        "Address: Plot 4, Ntinda Road",
      ].join("\n"),
    );
  });

  test("a real menu opens WhatsApp with the order, and offers the text when WhatsApp does not open", async ({ page, context }) => {
    const fixture = await createMenuFixture({ whatsapp: "256772000999" });
    context.on("page", (popup) => popup.close().catch(() => undefined));
    await page.goto(`/r/${fixture.slug}?t=7`);
    await expect(page.getByText("Made with")).toHaveCount(0);
    await page.getByRole("button", { name: "Add Dish 2" }).click();
    await page.getByRole("button", { name: /View order/ }).click();
    const link = page.getByRole("dialog").getByRole("link", { name: "Send order on WhatsApp" });
    const href = (await link.getAttribute("href"))!;
    expect(href.startsWith("https://wa.me/256772000999?text=")).toBe(true);
    expect(decodeURIComponent(href.split("text=")[1])).toBe(
      ["New order - Table 7 (dine-in)", "1 x Dish 2 - UGX 2,000", "Total: UGX 2,000"].join("\n"),
    );
    await link.click();
    await expect(page.getByText("WhatsApp didn't open?")).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole("button", { name: "Copy order text" })).toBeVisible();
  });

  test("Free menus show at most 30 items, no ordering, and the Menyu footer", async ({ page }) => {
    const fixture = await createMenuFixture({ plan: "standard", status: "free", items: 34 });
    await page.goto(`/r/${fixture.slug}`);
    await expect(page.getByRole("button", { name: /^Dish \d+/ })).toHaveCount(30);
    await expect(page.getByRole("button", { name: /^Dish 31/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Add Dish/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Made with Menyu" })).toBeVisible();
    await page.getByRole("button", { name: /^Dish 1\b/ }).click();
    await expect(page.getByRole("button", { name: /Add to order/ })).toHaveCount(0);
  });

  test("unknown menus show a friendly 404", async ({ page }) => {
    const response = await page.goto("/r/no-such-restaurant-anywhere");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Menu not found" })).toBeVisible();
  });

  test("a second scan opens from the phone's cache, even offline", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true });
    const page = await context.newPage();
    await page.goto(`${DEMO}?t=3`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    // Load once more so the now-active worker stores the page.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await page.goto(`${DEMO}?t=8`);
    await expect(page.getByRole("heading", { level: 1, name: "Kijani Café" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Rolex/ })).toBeVisible();
    await context.close();
  });
});

test.describe("phase 2: QR codes and print PDFs", () => {
  test("owners and admins download QR codes and PDFs; everyone else gets 404", async ({ page, browser }) => {
    const fixture = await createMenuFixture({});
    const anonymous = await page.request.get(`/api/qr/${fixture.restaurantId}?format=png`);
    expect(anonymous.status()).toBe(404);

    await page.goto("/login");
    await signInWithPhone(page, "256700000001", "0700 000 001");
    await expect(page).toHaveURL(/\/admin/);

    const png = await page.request.get(`/api/qr/${fixture.restaurantId}?format=png`);
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    expect(png.headers()["content-disposition"]).toContain(`${fixture.slug}.png`);

    const svg = await page.request.get(`/api/qr/${fixture.restaurantId}?format=svg`);
    expect(svg.headers()["content-type"]).toBe("image/svg+xml");
    expect(await svg.text()).toContain("<svg");

    const pdf = await page.request.get(`/api/print/${fixture.restaurantId}?layout=tents`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

    await page.goto(`/dashboard/${fixture.restaurantId}/qr`);
    await expect(page.getByRole("heading", { name: "QR codes" })).toBeVisible();
    await expect(page.getByText("Table 7")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "test-results/screens/qr-page-360.png", fullPage: true });

    // Another owner cannot download this restaurant's codes.
    const other = await browser.newContext();
    const res = await other.request.get(`/api/print/${fixture.restaurantId}?layout=tents`);
    expect(res.status()).toBe(404);
    await other.close();
  });
});
