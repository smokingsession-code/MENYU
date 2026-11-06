import "server-only";
import { manualProvider } from "./manual";
import { createPesapalProvider, PESAPAL_BASE_URLS } from "./pesapal";
import { PROVIDER_IDS, type PaymentProvider, type ProviderId } from "./types";

export type { CollectionRequest, CollectionResult, PaymentEvent, PaymentProvider, ProviderId, WebhookCall } from "./types";

let pesapal: PaymentProvider | null | undefined;

/**
 * Pesapal, from PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET, PESAPAL_IPN_ID
 * and PESAPAL_ENV ("sandbox" or "live"). PESAPAL_BASE_URL may point at a
 * local stand-in for tests, never at a plain-http host on Vercel.
 */
function pesapalFromEnv(): PaymentProvider | null {
  if (pesapal !== undefined) return pesapal;
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  const ipnId = process.env.PESAPAL_IPN_ID;
  if (!key || !secret || !ipnId) return (pesapal = null);
  const override = process.env.PESAPAL_BASE_URL;
  const safeOverride = override && (override.startsWith("https://") || (!process.env.VERCEL && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(override)));
  const baseUrl = safeOverride ? override : PESAPAL_BASE_URLS[process.env.PESAPAL_ENV === "live" ? "live" : "sandbox"];
  return (pesapal = createPesapalProvider({ consumerKey: key, consumerSecret: secret, ipnId, baseUrl }));
}

/** The provider owners pay through: PAYMENT_PROVIDER, default "manual". */
export function activeProvider(): PaymentProvider {
  if (process.env.PAYMENT_PROVIDER === "pesapal") return pesapalFromEnv() ?? manualProvider;
  return manualProvider;
}

/** A configured provider by id, for its webhook and return routes. */
export function providerById(id: string): PaymentProvider | null {
  if (!(PROVIDER_IDS as readonly string[]).includes(id)) return null;
  const providers: Partial<Record<ProviderId, PaymentProvider | null>> = { manual: manualProvider, pesapal: pesapalFromEnv() };
  return providers[id as ProviderId] ?? null;
}
