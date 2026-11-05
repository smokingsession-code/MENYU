import "server-only";
import { manualProvider } from "./manual";
import { PROVIDER_IDS, type PaymentProvider, type ProviderId } from "./types";

export type { CollectionRequest, CollectionResult, PaymentEvent, PaymentProvider, ProviderId } from "./types";

const providers: Partial<Record<ProviderId, PaymentProvider>> = {
  manual: manualProvider,
  // flutterwave and pesapal are added in phase 9.
};

/** The provider owners pay through (PAYMENT_PROVIDER, default "manual"). */
export function activeProvider(): PaymentProvider {
  const id = process.env.PAYMENT_PROVIDER ?? "manual";
  return providers[id as ProviderId] ?? manualProvider;
}

/** A configured provider by id, for its webhook route. */
export function providerById(id: string): PaymentProvider | null {
  return (PROVIDER_IDS as readonly string[]).includes(id) ? (providers[id as ProviderId] ?? null) : null;
}
