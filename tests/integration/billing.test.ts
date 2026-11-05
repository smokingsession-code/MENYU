import { beforeAll, describe, expect, it } from "vitest";
import { changeSubscription, recordPayment, removePayment } from "@/lib/billing/record";
import { refreshBillingStatuses } from "@/lib/billing/refresh";
import { addMonths } from "@/lib/billing/status";
import { anonClient, selfServeRestaurant, serviceClient, setSubscription, signedInUser, uniq, type CreatedRestaurant, type TestUser } from "./helpers";

const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

async function subscription(restaurantId: string) {
  const { data, error } = await serviceClient().from("subscriptions").select("*").eq("restaurant_id", restaurantId).single();
  if (error) throw error;
  return data;
}

async function publicPlan(slug: string): Promise<string> {
  const { data } = await anonClient().rpc("get_public_menu", { p_slug: slug });
  return (data as { plan: string }).plan;
}

const transaction = () => String(Math.floor(Math.random() * 1e11)).padStart(11, "0");

describe("billing", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let staff: TestUser;
  let r: CreatedRestaurant;

  beforeAll(async () => {
    [owner, stranger, staff] = await Promise.all([signedInUser(), signedInUser(), signedInUser()]);
    r = await selfServeRestaurant(owner, "Billing Cafe");
    await selfServeRestaurant(stranger, "Stranger Cafe");
    const { error } = await serviceClient().from("memberships").insert({ restaurant_id: r.restaurant_id, user_id: staff.id, role: "staff" });
    if (error) throw error;
  });

  it("lets only server code change billing, and only owners read it", async () => {
    for (const client of [owner.client, anonClient()]) {
      const { error } = await client.rpc("record_payment", { p: { restaurant_id: r.restaurant_id, amount_ugx: 20000, method: "mtn_momo" } });
      expect(error?.code).toBe("42501");
      expect((await client.rpc("apply_billing_status", { p_restaurant_id: r.restaurant_id, p_from: "trial", p_to: "free" })).error?.code).toBe("42501");
    }
    const update = await owner.client.from("subscriptions").update({ status: "active" }).eq("restaurant_id", r.restaurant_id).select();
    expect(update.error?.code ?? (update.data?.length === 0 ? "no-rows" : "updated")).not.toBe("updated");

    await recordPayment({ restaurantId: r.restaurant_id, kind: "setup_fee", amountUgx: 50_000, method: "cash", paidAt: new Date() });
    expect((await owner.client.from("payments").select("id").eq("restaurant_id", r.restaurant_id)).data).toHaveLength(1);
    expect((await stranger.client.from("payments").select("id").eq("restaurant_id", r.restaurant_id)).data).toHaveLength(0);
    expect((await staff.client.from("payments").select("id").eq("restaurant_id", r.restaurant_id)).data).toHaveLength(0);
    expect((await staff.client.from("subscriptions").select("plan").eq("restaurant_id", r.restaurant_id)).data).toHaveLength(0);
    expect((await subscription(r.restaurant_id)).setup_fee_ugx).toBe(50_000);
  });

  it("starts a payment made during the trial when the trial ends, and refuses the same MoMo ID twice", async () => {
    const before = await subscription(r.restaurant_id);
    expect(before.status).toBe("trial");
    const id = transaction();
    const paid = await recordPayment({
      restaurantId: r.restaurant_id,
      kind: "subscription",
      plan: "standard",
      interval: "month",
      periods: 1,
      amountUgx: 20_000,
      method: "mtn_momo",
      transactionId: id,
      paidAt: new Date(),
    });
    expect(paid).toMatchObject({ ok: true, status: "active", duplicate: false });
    const after = await subscription(r.restaurant_id);
    expect(after.status).toBe("active");
    expect(Date.parse(after.paid_until!)).toBe(addMonths(new Date(before.trial_ends_at!), 1).getTime());

    const again = await recordPayment({ restaurantId: r.restaurant_id, kind: "other", amountUgx: 1000, method: "mtn_momo", transactionId: id, paidAt: new Date() });
    expect(again).toEqual({ ok: false, code: "duplicate_transaction" });

    const { data: audit } = await serviceClient().from("audit_log").select("details").eq("restaurant_id", r.restaurant_id).eq("action", "payment.recorded");
    expect(audit?.some((a) => (a.details as { status_before?: string }).status_before === "trial")).toBe(true);
  });

  it("refuses to apply a payment computed from stale data", async () => {
    const { error } = await serviceClient().rpc("record_payment", {
      p: {
        restaurant_id: r.restaurant_id,
        kind: "subscription",
        amount_ugx: 20000,
        method: "cash",
        plan: "standard",
        billing_interval: "month",
        period_start: new Date().toISOString(),
        period_end: daysFromNow(30).toISOString(),
        new_status: "active",
        expected_updated_at: "2020-01-01T00:00:00Z",
      },
    });
    expect(error?.code).toBe("40001");
  });

  it("records a provider's payment once, however many times the webhook arrives", async () => {
    const ref = uniq("flw");
    const base = { restaurantId: r.restaurant_id, kind: "subscription" as const, plan: "standard" as const, interval: "month" as const, amountUgx: 20_000, method: "mtn_momo" as const, provider: "flutterwave" as const, providerRef: ref, paidAt: new Date() };
    const pending = await recordPayment({ ...base, status: "pending" });
    expect(pending.ok).toBe(true);
    const untouched = (await subscription(r.restaurant_id)).paid_until;

    const first = await recordPayment(base);
    const second = await recordPayment(base);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    const { data: rows } = await serviceClient().from("payments").select("status").eq("provider_ref", ref);
    expect(rows).toEqual([{ status: "succeeded" }]);
    expect(Date.parse((await subscription(r.restaurant_id)).paid_until!)).toBe(addMonths(new Date(untouched!), 1).getTime());
  });

  it("moves unpaid restaurants to overdue, then to Free after the grace days, without deleting the menu", async () => {
    const lapsing = await selfServeRestaurant(owner, "Lapsing Grill");
    const late = await selfServeRestaurant(owner, "Late Grill");
    await setSubscription(lapsing.restaurant_id, { status: "active", paid_until: daysFromNow(-10).toISOString(), grace_days: 7 });
    await setSubscription(late.restaurant_id, { status: "active", paid_until: daysFromNow(-2).toISOString(), grace_days: 7 });
    await owner.client.from("categories").insert({ restaurant_id: lapsing.restaurant_id, menu_id: lapsing.menu_id, name: "Grills" });

    const { changed } = await refreshBillingStatuses();
    expect(changed).toEqual(
      expect.arrayContaining([
        { restaurantId: lapsing.restaurant_id, from: "active", to: "free" },
        { restaurantId: late.restaurant_id, from: "active", to: "overdue" },
      ]),
    );
    expect((await subscription(lapsing.restaurant_id)).plan).toBe("standard");
    expect(await publicPlan(lapsing.slug)).toBe("free");
    expect(await publicPlan(late.slug)).toBe("standard");
    const { count } = await serviceClient().from("categories").select("id", { count: "exact", head: true }).eq("restaurant_id", lapsing.restaurant_id).is("deleted_at", null);
    expect(count).toBe(1);

    // Running again changes nothing.
    const again = await refreshBillingStatuses();
    expect(again.changed.filter((c) => [lapsing.restaurant_id, late.restaurant_id].includes(c.restaurantId))).toEqual([]);

    // Paying brings everything back, starting today; undoing the payment puts it back on Free.
    const paid = await recordPayment({ restaurantId: lapsing.restaurant_id, kind: "subscription", plan: "standard", interval: "month", amountUgx: 20_000, method: "airtel_money", transactionId: transaction(), paidAt: new Date() });
    expect(paid).toMatchObject({ ok: true, status: "active" });
    expect(await publicPlan(lapsing.slug)).toBe("standard");
    const removed = await removePayment(paid.ok ? paid.paymentId : "", owner.id);
    expect(removed.ok).toBe(true);
    const reverted = await subscription(lapsing.restaurant_id);
    expect(reverted.status).toBe("free");
    expect(Date.parse(reverted.paid_until!)).toBeLessThan(Date.now() - 9 * DAY);
  });

  it("lets the admin set a trial or a renewal date, refusing changes made from stale data", async () => {
    const deal = await selfServeRestaurant(owner, "Yearly Deal Cafe");
    const sub = await subscription(deal.restaurant_id);
    const renewal = daysFromNow(365);
    const changed = await changeSubscription(
      deal.restaurant_id,
      { plan: "standard", mode: "paid", interval: "year", until: renewal, graceDays: 14 },
      owner.id,
      sub.updated_at,
    );
    expect(changed).toEqual({ ok: true, status: "active" });
    expect(await subscription(deal.restaurant_id)).toMatchObject({ status: "active", billing_interval: "year", grace_days: 14 });

    const stale = await changeSubscription(deal.restaurant_id, { plan: "pro", mode: "trial", interval: "month", until: daysFromNow(5), graceDays: 7 }, owner.id, sub.updated_at);
    expect(stale).toEqual({ ok: false, code: "stale" });
  });
});
