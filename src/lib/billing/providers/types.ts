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
  network: "mtn" | "airtel";
  /** Our reference, echoed back in the webhook. */
  reference: string;
  description: string;
}

export type CollectionResult =
  | { ok: true; providerRef: string; status: "pending" | "succeeded"; redirectUrl?: string }
  | { ok: false; error: "not_supported" | "declined" | "unavailable" };

/** A provider's webhook, verified and translated into our terms. */
export interface PaymentEvent {
  providerRef: string;
  reference: string;
  status: "succeeded" | "failed" | "pending";
  amountUgx: number;
  method: "mtn_momo" | "airtel_money" | "card" | "other";
  transactionId: string | null;
  paidAt: Date;
  raw: unknown;
}

export interface PaymentProvider {
  id: ProviderId;
  /** True when owners can pay inside the app. False for manual payments. */
  collects: boolean;
  /** Asks the owner's phone to approve a mobile money payment. */
  startCollection(request: CollectionRequest): Promise<CollectionResult>;
  /**
   * Verifies a webhook (signature, and the payment's status with the
   * provider's API) and returns it as a payment event, or null when the
   * request is not a payment event this provider sent.
   */
  parseWebhook(request: Request): Promise<PaymentEvent | null>;
}
