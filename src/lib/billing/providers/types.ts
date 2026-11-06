/**
 * Billing goes through a payment provider. Today it is "manual": owners pay
 * the business's MoMo merchant code and the admin records the payment. A
 * Flutterwave or Pesapal provider implements the same interface to collect
 * mobile money in the app and confirm it by webhook, and its confirmed
 * payments go through the same recordPayment() as manual ones.
 */
export const PROVIDER_IDS = ["manual", "flutterwave", "pesapal"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface CollectionRequest {
  restaurantId: string;
  amountUgx: number;
  /** International digits, e.g. 256772123456. */
  phone: string;
  /** Our reference, echoed back in the webhook. Letters, digits and - _ . : only. */
  reference: string;
  description: string;
  /** Where the provider sends the owner back after paying. */
  callbackUrl: string;
  /** For providers that push a prompt to one network directly. */
  network?: "mtn" | "airtel";
}

export type CollectionResult =
  | { ok: true; providerRef: string; status: "pending" | "succeeded"; redirectUrl?: string }
  | { ok: false; error: "not_supported" | "declined" | "unavailable" };

/** A payment's state at the provider, verified with the provider itself. */
export interface PaymentEvent {
  providerRef: string;
  reference: string;
  status: "succeeded" | "failed" | "pending";
  amountUgx: number;
  currency: string;
  method: "mtn_momo" | "airtel_money" | "card" | "other";
  transactionId: string | null;
  paidAt: Date;
  raw: unknown;
}

/** A webhook the provider sent, with the reply it expects. */
export interface WebhookCall {
  event: PaymentEvent;
  /** The response to send: `processed` is false when we could not record it (the provider retries). */
  reply(processed: boolean): Response;
}

export interface PaymentProvider {
  id: ProviderId;
  /** True when owners can pay inside the app. False for manual payments. */
  collects: boolean;
  /** Starts a payment: a checkout page to send the owner to, or a prompt on their phone. */
  startCollection(request: CollectionRequest): Promise<CollectionResult>;
  /** The payment's current state, asked of the provider (never taken from a request). */
  checkStatus(providerRef: string): Promise<PaymentEvent | null>;
  /**
   * Reads a webhook and verifies it with the provider. Null when the request
   * is not a payment notification this provider sent.
   */
  parseWebhook(request: Request): Promise<WebhookCall | null>;
}
