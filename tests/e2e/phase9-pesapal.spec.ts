import { createMember, createMenuFixture, service } from "./db";
import { startFakePesapal } from "./fake-pesapal";
import { expect, expectNoHorizontalScroll, signInWithPhone, test } from "./fixtures";

/**
 * Paying online through Pesapal, end to end, against a stand-in Pesapal
 * (tests/e2e/fake-pesapal.ts). The app runs with PAYMENT_PROVIDER=pesapal and
 * PESAPAL_BASE_URL=http://127.0.0.1:4010 in .env.local.
 */
const DAY = 86_400_000;

test.describe("phase 9: paying online with Pesapal", () => {
  test("an owner pays with MTN MoMo on Pesapal's page and their plan extends by itself", async ({ page }) => {
    const pesapal = await startFakePesapal(4010, "http://localhost:3000/api/payments/pesapal");
    try {
      const fixture = await createMenuFixture({ plan: "standard", status: "active" });
      const paidUntil = new Date(Date.now() + 3 * DAY);
      await service().from("subscriptions").update({ paid_until: paidUntil.toISOString() }).eq("restaurant_id", fixture.restaurantId);
      const owner = await createMember(fixture.restaurantId);

      await page.goto("/login");
      await signInWithPhone(page, owner.digits, owner.local);
      await page.goto(`/dashboard/${fixture.restaurantId}/billing`);
      await expectNoHorizontalScroll(page);
      await page.getByRole("button", { name: "Pay UGX 20,000 now" }).click();

      await expect(page.getByRole("heading", { name: "Pay UGX 20000" })).toBeVisible();
      const [order] = [...pesapal.orders.values()];
      expect(order).toMatchObject({ amount: 20000, currency: "UGX" });
      expect(order.callbackUrl).toContain(`/api/payments/pesapal/return?rid=${fixture.restaurantId}`);

      await page.getByRole("button", { name: "Pay with MTN" }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/${fixture.restaurantId}/billing\\?pay=paid`));
      await expect(page.getByText("Payment received. Thank you! Your plan is up to date.")).toBeVisible();
      await expect(page.getByText(`Transaction ID: MP${order.trackingId.slice(0, 8).toUpperCase()}`)).toBeVisible();
      await expect(page.getByText("MTN MoMo", { exact: false }).first()).toBeVisible();

      // Pesapal got the reply its documentation asks for.
      expect(order.ipnReplies[0]).toEqual({ orderNotificationType: "IPNCHANGE", orderTrackingId: order.trackingId, orderMerchantReference: order.id, status: 200 });
      const { data: sub } = await service().from("subscriptions").select("status, paid_until").eq("restaurant_id", fixture.restaurantId).single();
      expect(sub!.status).toBe("active");
      const gained = Date.parse(sub!.paid_until!) - paidUntil.getTime();
      expect(gained).toBeGreaterThan(27 * DAY);
      expect(gained).toBeLessThan(32 * DAY);
      const { data: rows } = await service().from("payments").select("provider, status, amount_ugx").eq("restaurant_id", fixture.restaurantId);
      expect(rows).toEqual([{ provider: "pesapal", status: "succeeded", amount_ugx: 20000 }]);
    } finally {
      await pesapal.stop();
    }
  });

  test("a notification nobody can verify changes nothing", async ({ request }) => {
    // No such order at Pesapal: the app checks with Pesapal and records nothing.
    const pesapal = await startFakePesapal(4010, "http://localhost:3000/api/payments/pesapal");
    try {
      const forged = await request.post("/api/payments/pesapal", {
        data: { OrderNotificationType: "IPNCHANGE", OrderTrackingId: "00000000-0000-4000-8000-000000000000", OrderMerchantReference: "mny-forged" },
      });
      expect(forged.status()).toBe(503);
      expect((await request.get("/api/payments/pesapal?OrderNotificationType=CALLBACKURL")).status()).toBe(400);
    } finally {
      await pesapal.stop();
    }
  });
});
