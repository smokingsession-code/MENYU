import { beforeAll, describe, expect, it } from "vitest";
import type { PaymentEvent, PaymentProvider } from "@/lib/billing/providers/types";
import { recordPayment } from "@/lib/billing/record";
import { reconcilePendingPayments, settleProviderPayment } from "@/lib/billing/settle";
import { addMonths } from "@/lib/billing/status";
import { selfServeRestaurant, serviceClient, setSubscription, signedInUser, uniq, type CreatedRestaurant } from "./helpers";

const DAY = 86_400_000;

/** Pesapal as far as settlement is concerned: what it says about each order. */
function fakeProvider(states: Map<string, Partial<PaymentEvent>>): PaymentProvider {
  return {
    id: "pesapal",
    collects: true,
    async startCollection() {
      return { ok: false, error: "not_supported" };
    },
    async checkStatus(ref) {
      const state = states.get(ref);
      return state ? event(ref, state) : null;
    },
    async parseWebhook() {
      return null;
    },
  };
}

function event(ref: string, over: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    providerRef: ref,
    reference: "mny-test",
    status: "succeeded",
    amountUgx: 20_000,
    currency: "UGX",
    method: "mtn_momo",
    transactionId: `MP${Math.floor(Math.random() * 1e9)}`,
    paidAt: new Date(),
    raw: {},
    ...over,
  };
}

async function pendingPayment(r: CreatedRestaurant, amount = 20_000): Promise<string> {
  const ref = uniq("trk");
  const result = await recordPayment({
    restaurantId: r.restaurant_id,
    kind: "subscription",
    plan: "standard",
    interval: "month",
    amountUgx: amount,
    method: "other",
    provider: "pesapal",
    providerRef: ref,
    status: "pending",
    paidAt: new Date(),
  });
  if (!result.ok) throw new Error(result.code);
  return ref;
}

async function subscription(id: string) {
  return (await serviceClient().from("subscriptions").select("status, paid_until").eq("restaurant_id", id).single()).data!;
}

async function payment(ref: string) {
  return (await serviceClient().from("payments").select("status, method, transaction_id, period_end").eq("provider_ref", ref).single()).data!;
}

describe("online payments", () => {
  let r: CreatedRestaurant;
  const paidUntil = new Date(Date.now() + 5 * DAY);

  beforeAll(async () => {
    r = await selfServeRestaurant(await signedInUser(), `Online ${uniq()}`);
    await setSubscription(r.restaurant_id, { status: "active", paid_until: paidUntil.toISOString(), trial_ends_at: null });
  });

  it("credits a confirmed payment once, however often it is confirmed", async () => {
    const ref = await pendingPayment(r);
    // Pending orders change nothing.
    expect(Date.parse((await subscription(r.restaurant_id)).paid_until!)).toBe(paidUntil.getTime());
    const provider = fakeProvider(new Map());
    const confirmed = event(ref);

    expect(await settleProviderPayment(provider, confirmed)).toMatchObject({ result: "paid", restaurantId: r.restaurant_id });
    expect(await payment(ref)).toMatchObject({ status: "succeeded", method: "mtn_momo", transaction_id: confirmed.transactionId });
    const after = await subscription(r.restaurant_id);
    expect(after.status).toBe("active");
    expect(Date.parse(after.paid_until!)).toBe(addMonths(paidUntil, 1).getTime());

    expect((await settleProviderPayment(provider, confirmed)).result).toBe("already_paid");
    expect(Date.parse((await subscription(r.restaurant_id)).paid_until!)).toBe(addMonths(paidUntil, 1).getTime());
  });

  it("never credits a payment that does not match the bill, and marks failed ones", async () => {
    const provider = fakeProvider(new Map());
    const before = (await subscription(r.restaurant_id)).paid_until;

    const short = await pendingPayment(r);
    expect((await settleProviderPayment(provider, event(short, { amountUgx: 2_000 }))).result).toBe("mismatch");
    expect((await settleProviderPayment(provider, event(short, { currency: "KES" }))).result).toBe("mismatch");
    expect((await payment(short)).status).toBe("pending");
    expect((await subscription(r.restaurant_id)).paid_until).toBe(before);

    const declined = await pendingPayment(r);
    expect((await settleProviderPayment(provider, event(declined, { status: "failed" }))).result).toBe("failed");
    expect((await payment(declined)).status).toBe("failed");
    expect((await settleProviderPayment(provider, event(declined, { status: "pending" }))).result).toBe("pending");

    expect((await settleProviderPayment(provider, event(uniq("nobody")))).result).toBe("unknown");
  });

  it("catches up on missed notifications every day and gives up on week-old orders", async () => {
    const db = serviceClient();
    const missed = await pendingPayment(r);
    const abandoned = await pendingPayment(r);
    await db.from("payments").update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq("provider_ref", missed);
    await db.from("payments").update({ created_at: new Date(Date.now() - 8 * DAY).toISOString() }).eq("provider_ref", abandoned);
    const before = Date.parse((await subscription(r.restaurant_id)).paid_until!);

    const result = await reconcilePendingPayments(fakeProvider(new Map([[missed, {}]])));
    expect(result.paid).toContain(r.restaurant_id);
    expect((await payment(missed)).status).toBe("succeeded");
    expect((await payment(abandoned)).status).toBe("failed");
    expect(Date.parse((await subscription(r.restaurant_id)).paid_until!)).toBe(addMonths(new Date(before), 1).getTime());
  });
});
