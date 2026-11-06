import type { CollectionRequest, CollectionResult, PaymentEvent, PaymentProvider, WebhookCall } from "./types";

/**
 * Pesapal API 3.0 (https://developer.pesapal.com, "API 3.0 - JSON").
 *
 * The owner is sent to Pesapal's payment page, where they choose MTN Mobile
 * Money, Airtel Money or a card and approve the payment. Pesapal then calls
 * our IPN URL and sends the owner back to our callback URL. Neither carries
 * the payment's status (by design), so every one is verified by asking
 * GetTransactionStatus.
 */

export const PESAPAL_BASE_URLS = {
  sandbox: "https://cybqa.pesapal.com/pesapalv3",
  live: "https://pay.pesapal.com/v3",
} as const;

export interface PesapalConfig {
  consumerKey: string;
  consumerSecret: string;
  /** The ipn_id from RegisterIPN (see scripts/pesapal-ipn.ts). */
  ipnId: string;
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Merchant references: letters, digits, - _ . : and at most 50 characters. */
export const PESAPAL_REFERENCE = /^[A-Za-z0-9\-_.:]{1,50}$/;
const TRACKING_ID = /^[A-Za-z0-9-]{8,64}$/;

interface StatusResponse {
  payment_method?: string | null;
  amount?: number | string | null;
  created_date?: string | null;
  confirmation_code?: string | null;
  payment_status_description?: string | null;
  status_code?: number | null;
  merchant_reference?: string | null;
  currency?: string | null;
  error?: { code?: string | null; message?: string | null } | null;
  status?: string | null;
}

export class PesapalError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** "MTN" / "MTN Mobile Money" / "Airtel" / "Visa" ... in our terms. */
export function paymentMethodOf(value: string | null | undefined): PaymentEvent["method"] {
  const v = (value ?? "").toLowerCase();
  if (v.includes("mtn")) return "mtn_momo";
  if (v.includes("airtel")) return "airtel_money";
  if (/visa|master|card|amex|american/.test(v)) return "card";
  return "other";
}

/** status_code: 0 INVALID, 1 COMPLETED, 2 FAILED, 3 REVERSED. */
export function statusOf(code: number | null | undefined): PaymentEvent["status"] {
  if (code === 1) return "succeeded";
  if (code === 2 || code === 3) return "failed";
  return "pending";
}

/** Pesapal's dates carry no zone (e.g. "2022-04-30T07:41:09.763"); its API works in UTC. */
function parseDate(value: string | null | undefined, fallback: number): Date {
  if (!value) return new Date(fallback);
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? new Date(fallback) : new Date(t);
}

/** Uganda numbers as Pesapal shows them on its form: 0772 123 456 -> "0772123456". */
function localPhone(digits: string): string {
  return digits.startsWith("256") && digits.length === 12 ? `0${digits.slice(3)}` : digits;
}

export function createPesapalProvider(config: PesapalConfig): PaymentProvider {
  const http = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const base = config.baseUrl.replace(/\/+$/, "");
  let token: { value: string; expiresAt: number } | null = null;

  async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; auth?: boolean }): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (init.auth !== false) headers.Authorization = `Bearer ${await accessToken()}`;
    const res = await http(`${base}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: T & { error?: { message?: string | null } | null };
    try {
      data = JSON.parse(text);
    } catch {
      throw new PesapalError(`Pesapal returned a non-JSON response (${res.status})`, res.status);
    }
    if (!res.ok) throw new PesapalError(`Pesapal ${path} failed (${res.status})`, res.status);
    if (data?.error && data.error.message) throw new PesapalError(`Pesapal ${path}: ${data.error.message}`, res.status);
    return data;
  }

  /** Tokens last up to 5 minutes; reuse one until shortly before it expires. */
  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - 30_000 > now()) return token.value;
    const data = await call<{ token?: string; expiryDate?: string }>("/api/Auth/RequestToken", {
      method: "POST",
      auth: false,
      body: { consumer_key: config.consumerKey, consumer_secret: config.consumerSecret },
    });
    if (!data.token) throw new PesapalError("Pesapal returned no token");
    const expires = data.expiryDate ? parseDate(data.expiryDate, now() + 4 * 60_000).getTime() : now() + 4 * 60_000;
    token = { value: data.token, expiresAt: Math.min(expires, now() + 5 * 60_000) };
    return token.value;
  }

  async function checkStatus(trackingId: string): Promise<PaymentEvent | null> {
    if (!TRACKING_ID.test(trackingId)) return null;
    const data = await call<StatusResponse>(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`, { method: "GET" });
    return {
      providerRef: trackingId,
      reference: data.merchant_reference ?? "",
      status: statusOf(data.status_code ?? null),
      amountUgx: Math.round(Number(data.amount ?? 0)),
      currency: (data.currency ?? "").toUpperCase(),
      method: paymentMethodOf(data.payment_method),
      transactionId: data.confirmation_code || null,
      paidAt: parseDate(data.created_date, now()),
      raw: data,
    };
  }

  return {
    id: "pesapal",
    collects: true,

    async startCollection(request: CollectionRequest): Promise<CollectionResult> {
      if (!PESAPAL_REFERENCE.test(request.reference) || !Number.isInteger(request.amountUgx) || request.amountUgx <= 0) {
        return { ok: false, error: "declined" };
      }
      try {
        const data = await call<{ order_tracking_id?: string; redirect_url?: string }>("/api/Transactions/SubmitOrderRequest", {
          method: "POST",
          body: {
            id: request.reference,
            currency: "UGX",
            amount: request.amountUgx,
            description: request.description.slice(0, 100),
            callback_url: request.callbackUrl,
            notification_id: config.ipnId,
            billing_address: { phone_number: localPhone(request.phone), country_code: "UG" },
          },
        });
        if (!data.order_tracking_id || !data.redirect_url) return { ok: false, error: "unavailable" };
        return { ok: true, providerRef: data.order_tracking_id, status: "pending", redirectUrl: data.redirect_url };
      } catch (error) {
        console.error("[pesapal] SubmitOrderRequest failed", { message: (error as Error).message });
        return { ok: false, error: "unavailable" };
      }
    },

    checkStatus,

    async parseWebhook(request: Request): Promise<WebhookCall | null> {
      // GET: query parameters; POST: a JSON body. Same three fields either way.
      let fields: Record<string, unknown> = {};
      if (request.method === "GET") {
        fields = Object.fromEntries(new URL(request.url).searchParams);
      } else {
        try {
          fields = (await request.json()) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      const trackingId = typeof fields.OrderTrackingId === "string" ? fields.OrderTrackingId : "";
      const reference = typeof fields.OrderMerchantReference === "string" ? fields.OrderMerchantReference : "";
      const type = typeof fields.OrderNotificationType === "string" ? fields.OrderNotificationType : "";
      if (type !== "IPNCHANGE" || !TRACKING_ID.test(trackingId)) return null;

      const event = await checkStatus(trackingId);
      if (!event) return null;
      return {
        event,
        reply: (processed) =>
          Response.json({
            orderNotificationType: "IPNCHANGE",
            orderTrackingId: trackingId,
            orderMerchantReference: reference,
            status: processed ? 200 : 500,
          }),
      };
    },
  };
}

/** Registers our IPN URL with Pesapal and returns its ipn_id (run once per environment). */
export async function registerPesapalIpn(config: Omit<PesapalConfig, "ipnId">, url: string): Promise<string> {
  const http = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, "");
  const auth = await http(`${base}/api/Auth/RequestToken`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ consumer_key: config.consumerKey, consumer_secret: config.consumerSecret }),
  });
  const { token } = (await auth.json()) as { token?: string };
  if (!token) throw new PesapalError("Pesapal returned no token: check the consumer key and secret");
  const res = await http(`${base}/api/URLSetup/RegisterIPN`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url, ipn_notification_type: "POST" }),
  });
  const data = (await res.json()) as { ipn_id?: string; error?: { message?: string } | null };
  if (!data.ipn_id) throw new PesapalError(`RegisterIPN failed: ${data.error?.message ?? res.status}`);
  return data.ipn_id;
}
