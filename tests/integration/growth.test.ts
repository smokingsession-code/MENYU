import { beforeAll, describe, expect, it } from "vitest";
import { recordPayment, removePayment } from "@/lib/billing/record";
import { addMonths } from "@/lib/billing/status";
import { serviceClient, setSubscription, signedInUser, uniq, type CreatedRestaurant, type TestUser } from "./helpers";

const DAY = 86_400_000;
const momoId = () => String(Math.floor(Math.random() * 1e11)).padStart(11, "0");

/** A new owner signs up (owners may only create a few restaurants themselves). */
async function signUp(_by: TestUser, extra: { p_agent_code?: string; p_referral_code?: string } = {}): Promise<CreatedRestaurant> {
  const owner = await signedInUser();
  const { data, error } = await owner.client.rpc("create_restaurant", { p_name: `Cafe ${uniq()}`, p_area: "Kira", p_whatsapp: "256772000111", ...extra });
  if (error) throw error;
  return data as unknown as CreatedRestaurant;
}

const pay = (restaurantId: string) =>
  recordPayment({ restaurantId, kind: "subscription", plan: "standard", interval: "month", amountUgx: 20_000, method: "mtn_momo", transactionId: momoId(), paidAt: new Date() });

async function subscription(restaurantId: string) {
  const { data } = await serviceClient().from("subscriptions").select("*").eq("restaurant_id", restaurantId).single();
  return data!;
}

describe("agents and referrals", () => {
  let owner: TestUser;
  let agentCode: string;
  let agentId: string;

  beforeAll(async () => {
    owner = await signedInUser();
    agentCode = `AG${Math.floor(Math.random() * 1e6)}`;
    const { data, error } = await serviceClient().from("agents").insert({ name: "Grace Auma", code: agentCode, commission_ugx: 15_000 }).select("id").single();
    if (error) throw error;
    agentId = data.id;
  });

  it("pays the agent's flat fee once per restaurant that pays, and takes it back with a removed payment", async () => {
    const r = await signUp(owner, { p_agent_code: agentCode.toLowerCase() });
    const commissions = async () =>
      (await serviceClient().from("agent_commissions").select("amount_ugx, deleted_at").eq("restaurant_id", r.restaurant_id)).data ?? [];

    const first = await pay(r.restaurant_id);
    expect(first.ok).toBe(true);
    expect(await commissions()).toEqual([{ amount_ugx: 15_000, deleted_at: null }]);
    await pay(r.restaurant_id);
    expect(await commissions()).toHaveLength(1);

    await removePayment(first.ok ? first.paymentId : "", owner.id);
    expect((await commissions())[0].deleted_at).not.toBeNull();
    await pay(r.restaurant_id);
    expect(await commissions()).toEqual([{ amount_ugx: 15_000, deleted_at: null }]);
    const { data: agent } = await serviceClient().from("agent_commissions").select("agent_id").eq("restaurant_id", r.restaurant_id).single();
    expect(agent?.agent_id).toBe(agentId);
  });

  it("gives the referrer a free month when the restaurant they invited pays, once", async () => {
    const referrer = await signUp(owner);
    const { data: code } = await serviceClient().from("restaurants").select("referral_code").eq("id", referrer.restaurant_id).single();
    const invited = await signUp(owner, { p_referral_code: code!.referral_code.toLowerCase() });
    const before = await subscription(referrer.restaurant_id);
    expect(before.status).toBe("trial");

    const paid = await pay(invited.restaurant_id);
    expect(paid).toMatchObject({ ok: true, rewardedReferrerId: referrer.restaurant_id });
    const after = await subscription(referrer.restaurant_id);
    // Still a trial, a month longer.
    expect(after.status).toBe("trial");
    expect(Date.parse(after.trial_ends_at!)).toBe(addMonths(new Date(before.trial_ends_at!), 1).getTime());
    const { data: referral } = await serviceClient().from("referrals").select("status, qualifying_payment_id").eq("referred_id", invited.restaurant_id).single();
    expect(referral).toMatchObject({ status: "rewarded", qualifying_payment_id: paid.ok ? paid.paymentId : null });

    const again = await pay(invited.restaurant_id);
    expect(again).toMatchObject({ ok: true, rewardedReferrerId: null });
    expect((await subscription(referrer.restaurant_id)).trial_ends_at).toBe(after.trial_ends_at);
  });

  it("adds the month to a paid period, or gives a month of Standard to a referrer on Free", async () => {
    const paying = await signUp(owner);
    const onFree = await signUp(owner);
    const paidUntil = new Date(Date.now() + 10 * DAY);
    await setSubscription(paying.restaurant_id, { status: "active", paid_until: paidUntil.toISOString(), trial_ends_at: null });
    await setSubscription(onFree.restaurant_id, { plan: "free", status: "free", trial_ends_at: null, paid_until: null });
    const codes = await serviceClient().from("restaurants").select("id, referral_code").in("id", [paying.restaurant_id, onFree.restaurant_id]);
    const codeOf = (id: string) => codes.data!.find((c) => c.id === id)!.referral_code;

    await pay((await signUp(owner, { p_referral_code: codeOf(paying.restaurant_id) })).restaurant_id);
    expect(Date.parse((await subscription(paying.restaurant_id)).paid_until!)).toBe(addMonths(paidUntil, 1).getTime());

    const start = Date.now();
    await pay((await signUp(owner, { p_referral_code: codeOf(onFree.restaurant_id) })).restaurant_id);
    const gifted = await subscription(onFree.restaurant_id);
    expect(gifted).toMatchObject({ plan: "standard", status: "active" });
    expect(Date.parse(gifted.paid_until!)).toBeGreaterThanOrEqual(addMonths(new Date(start), 1).getTime() - 5_000);
  });
});
