import type { PaymentProvider } from "./types";

/** Owners pay the business merchant code; the admin records it by hand. */
export const manualProvider: PaymentProvider = {
  id: "manual",
  collects: false,
  async startCollection() {
    return { ok: false, error: "not_supported" };
  },
  async parseWebhook() {
    return null;
  },
};
