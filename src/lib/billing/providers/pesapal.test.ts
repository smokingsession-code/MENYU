import { describe, expect, it } from "vitest";
import { createPesapalProvider, paymentMethodOf, statusOf } from "./pesapal";

const BASE = "https://cybqa.pesapal.com/pesapalv3";
const TRACKING = "b945e4af-80a5-4ec1-8706-e03f8332fb04";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A stand-in for Pesapal that answers each path with the documented shapes. */
function fakePesapal(overrides: Record<string, (body: unknown) => { status?: number; json: unknown }> = {}) {
  const calls: Call[] = [];
  let tokens = 0;
  let clock = Date.parse("2026-11-06T08:00:00Z");
  const routes: Record<string, (body: unknown) => { status?: number; json: unknown }> = {
    "/api/Auth/RequestToken": () => ({
      json: { token: `token-${tokens++}`, expiryDate: new Date(clock + 5 * 60_000).toISOString(), error: null, status: "200", message: "Request processed successfully" },
    }),
    "/api/Transactions/SubmitOrderRequest": (body) => ({
      json: {
        order_tracking_id: TRACKING,
        merchant_reference: (body as { id: string }).id,
        redirect_url: `https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index/?OrderTrackingId=${TRACKING}`,
        error: null,
        status: "200",
      },
    }),
    "/api/Transactions/GetTransactionStatus": () => ({
      json: {
        payment_method: "MTN",
        amount: 20000,
        created_date: "2026-11-06T08:01:09.763",
        confirmation_code: "MP1234567",
        payment_status_description: "Completed",
        description: "",
        message: "Request processed successfully",
        payment_account: "25677****456",
        status_code: 1,
        merchant_reference: "mny-1",
        currency: "UGX",
        error: { error_type: null, code: null, message: null, call_back_url: null },
        status: "200",
      },
    }),
    ...overrides,
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname.replace("/pesapalv3", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body });
    const route = routes[path];
    if (!route) return new Response("not found", { status: 404 });
    const { status = 200, json } = route(body);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const provider = createPesapalProvider({ consumerKey: "key", consumerSecret: "secret", ipnId: "ipn-1", baseUrl: BASE, fetch, now: () => clock });
  return { provider, calls, advance: (ms: number) => (clock += ms) };
}

const request = {
  restaurantId: "r1",
  amountUgx: 20000,
  phone: "256772123456",
  reference: "mny-7f9c2a",
  description: "Menyu Standard plan for Kijani Café",
  callbackUrl: "https://menyu.app/api/payments/pesapal/return?rid=r1",
};

describe("Pesapal provider", () => {
  it("creates an order on Pesapal's payment page, in shillings, with our IPN", async () => {
    const { provider, calls } = fakePesapal();
    const result = await provider.startCollection(request);
    expect(result).toEqual({
      ok: true,
      providerRef: TRACKING,
      status: "pending",
      redirectUrl: `https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index/?OrderTrackingId=${TRACKING}`,
    });
    expect(calls.map((c) => [c.method, new URL(c.url).pathname])).toEqual([
      ["POST", "/pesapalv3/api/Auth/RequestToken"],
      ["POST", "/pesapalv3/api/Transactions/SubmitOrderRequest"],
    ]);
    expect(calls[0].body).toEqual({ consumer_key: "key", consumer_secret: "secret" });
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[1].headers.Authorization).toBe("Bearer token-0");
    expect(calls[1].body).toEqual({
      id: "mny-7f9c2a",
      currency: "UGX",
      amount: 20000,
      description: "Menyu Standard plan for Kijani Café",
      callback_url: request.callbackUrl,
      notification_id: "ipn-1",
      billing_address: { phone_number: "0772123456", country_code: "UG" },
    });
  });

  it("reuses a token until shortly before it expires", async () => {
    const { provider, calls, advance } = fakePesapal();
    await provider.startCollection(request);
    advance(60_000);
    await provider.checkStatus(TRACKING);
    expect(calls.filter((c) => c.url.endsWith("RequestToken"))).toHaveLength(1);
    advance(4 * 60_000);
    await provider.checkStatus(TRACKING);
    expect(calls.filter((c) => c.url.endsWith("RequestToken"))).toHaveLength(2);
  });

  it("refuses references Pesapal would reject, and reports Pesapal being down", async () => {
    const { provider, calls } = fakePesapal();
    expect(await provider.startCollection({ ...request, reference: "has space" })).toEqual({ ok: false, error: "declined" });
    expect(calls).toHaveLength(0);
    const down = fakePesapal({ "/api/Transactions/SubmitOrderRequest": () => ({ status: 500, json: { error: { message: "Server error" } } }) });
    expect(await down.provider.startCollection(request)).toEqual({ ok: false, error: "unavailable" });
  });

  it("reads the payment status: completed, failed, reversed and not yet paid", async () => {
    const { provider } = fakePesapal();
    expect(await provider.checkStatus(TRACKING)).toMatchObject({
      providerRef: TRACKING,
      reference: "mny-1",
      status: "succeeded",
      amountUgx: 20000,
      currency: "UGX",
      method: "mtn_momo",
      transactionId: "MP1234567",
      paidAt: new Date("2026-11-06T08:01:09.763Z"),
    });
    expect([statusOf(0), statusOf(1), statusOf(2), statusOf(3)]).toEqual(["pending", "succeeded", "failed", "failed"]);
    expect([paymentMethodOf("MTN"), paymentMethodOf("Airtel Money"), paymentMethodOf("Visa"), paymentMethodOf("MPESA")]).toEqual([
      "mtn_momo",
      "airtel_money",
      "card",
      "other",
    ]);
    expect(await provider.checkStatus("not a tracking id!")).toBeNull();
  });

  it("verifies IPN calls (POST or GET) with Pesapal and replies the way Pesapal expects", async () => {
    const { provider, calls } = fakePesapal();
    const post = new Request("https://menyu.app/api/payments/pesapal", {
      method: "POST",
      body: JSON.stringify({ OrderNotificationType: "IPNCHANGE", OrderTrackingId: TRACKING, OrderMerchantReference: "mny-1" }),
    });
    const call = await provider.parseWebhook(post);
    expect(call?.event.status).toBe("succeeded");
    expect(calls.some((c) => c.url.includes(`GetTransactionStatus?orderTrackingId=${TRACKING}`))).toBe(true);
    expect(await call!.reply(true).json()).toEqual({ orderNotificationType: "IPNCHANGE", orderTrackingId: TRACKING, orderMerchantReference: "mny-1", status: 200 });
    expect(await call!.reply(false).json()).toMatchObject({ status: 500 });

    const get = new Request(`https://menyu.app/api/payments/pesapal?OrderTrackingId=${TRACKING}&OrderMerchantReference=mny-1&OrderNotificationType=IPNCHANGE`);
    expect((await provider.parseWebhook(get))?.event.providerRef).toBe(TRACKING);
  });

  it("ignores anything that is not an IPN, and never treats a Pesapal error as paid", async () => {
    const { provider } = fakePesapal();
    const callback = new Request(`https://menyu.app/x?OrderTrackingId=${TRACKING}&OrderMerchantReference=mny-1&OrderNotificationType=CALLBACKURL`);
    expect(await provider.parseWebhook(callback)).toBeNull();
    expect(await provider.parseWebhook(new Request("https://menyu.app/x", { method: "POST", body: "not json" }))).toBeNull();

    const failing = fakePesapal({
      "/api/Transactions/GetTransactionStatus": () => ({ json: { error: { error_type: "api_error", code: "invalid_order", message: "Order not found" }, status: "500" } }),
    });
    await expect(failing.provider.checkStatus(TRACKING)).rejects.toThrow(/Order not found/);
  });
});
