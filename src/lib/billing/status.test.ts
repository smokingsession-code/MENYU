import { describe, expect, it } from "vitest";
import { PLANS } from "@/config/plans";
import {
  addMonths,
  billingSummary,
  computeStatus,
  graceEndsAt,
  needsAttention,
  nextPeriod,
  priceFor,
  reminderKind,
  type SubscriptionState,
} from "./status";

/** Kampala time, written the way people read it. */
const kla = (local: string) => new Date(`${local}+03:00`);

function sub(over: Partial<SubscriptionState>): SubscriptionState {
  return { plan: "standard", status: "active", billing_interval: "month", trial_ends_at: null, paid_until: null, grace_days: 7, ...over };
}

describe("addMonths", () => {
  it("adds calendar months in Kampala time and keeps the time of day", () => {
    expect(addMonths(kla("2026-11-05T10:00:00"), 1)).toEqual(kla("2026-12-05T10:00:00"));
    expect(addMonths(kla("2026-12-20T08:30:00"), 1)).toEqual(kla("2027-01-20T08:30:00"));
    expect(addMonths(kla("2026-11-05T10:00:00"), 12)).toEqual(kla("2027-11-05T10:00:00"));
  });

  it("ends periods that start on the 31st on the last day of shorter months", () => {
    expect(addMonths(kla("2027-01-31T09:00:00"), 1)).toEqual(kla("2027-02-28T09:00:00"));
    expect(addMonths(kla("2028-01-31T09:00:00"), 1)).toEqual(kla("2028-02-29T09:00:00"));
    expect(addMonths(kla("2027-03-31T09:00:00"), 1)).toEqual(kla("2027-04-30T09:00:00"));
  });

  it("uses the Kampala date, not the UTC one, near midnight", () => {
    // 1 February 01:30 in Kampala is still 31 January in UTC.
    expect(addMonths(kla("2027-02-01T01:30:00"), 1)).toEqual(kla("2027-03-01T01:30:00"));
  });
});

describe("computeStatus", () => {
  const trial = sub({ status: "trial", trial_ends_at: kla("2026-12-01T12:00:00").toISOString() });

  it("keeps a trial until it ends, then gives the grace period, then moves to Free", () => {
    expect(computeStatus(trial, kla("2026-11-30T12:00:00"))).toBe("trial");
    expect(computeStatus(trial, kla("2026-12-01T12:00:00"))).toBe("overdue");
    expect(computeStatus(trial, kla("2026-12-08T11:59:00"))).toBe("overdue");
    expect(computeStatus(trial, kla("2026-12-08T12:00:00"))).toBe("free");
  });

  it("does the same when a paid period ends", () => {
    const paid = sub({ paid_until: kla("2027-01-05T00:00:00").toISOString(), grace_days: 3 });
    expect(computeStatus(paid, kla("2027-01-04T23:00:00"))).toBe("active");
    expect(computeStatus(paid, kla("2027-01-06T00:00:00"))).toBe("overdue");
    expect(computeStatus(paid, kla("2027-01-08T00:00:00"))).toBe("free");
    expect(computeStatus({ ...paid, grace_days: 0 }, kla("2027-01-05T00:00:01"))).toBe("free");
  });

  it("counts an unpaid trial's grace from the end of the trial", () => {
    const lapsing = { ...trial, status: "overdue" };
    expect(computeStatus(lapsing, kla("2026-12-03T00:00:00"))).toBe("overdue");
    expect(computeStatus(lapsing, kla("2026-12-09T00:00:00"))).toBe("free");
  });

  it("leaves Free alone until a payment, and treats missing dates as open-ended", () => {
    expect(computeStatus(sub({ status: "free", paid_until: kla("2030-01-01T00:00:00").toISOString() }), kla("2027-01-01T00:00:00"))).toBe("free");
    expect(computeStatus(sub({ status: "trial" }), kla("2027-01-01T00:00:00"))).toBe("trial");
    expect(computeStatus(sub({ status: "active" }), kla("2027-01-01T00:00:00"))).toBe("active");
  });
});

describe("nextPeriod", () => {
  const now = kla("2026-11-20T10:00:00");

  it("starts after the trial when an owner pays during it", () => {
    const s = sub({ status: "trial", trial_ends_at: kla("2026-12-01T12:00:00").toISOString() });
    expect(nextPeriod(s, { interval: "month", periods: 1, now })).toEqual({ start: kla("2026-12-01T12:00:00"), end: kla("2027-01-01T12:00:00") });
  });

  it("continues from the due date when renewing early or paying a little late", () => {
    const early = sub({ paid_until: kla("2026-11-25T00:00:00").toISOString() });
    expect(nextPeriod(early, { interval: "month", periods: 1, now }).end).toEqual(kla("2026-12-25T00:00:00"));
    const late = sub({ status: "overdue", paid_until: kla("2026-11-15T00:00:00").toISOString() });
    expect(nextPeriod(late, { interval: "month", periods: 2, now })).toEqual({ start: kla("2026-11-15T00:00:00"), end: kla("2027-01-15T00:00:00") });
    const lateTrial = sub({ status: "overdue", trial_ends_at: kla("2026-11-18T09:00:00").toISOString() });
    expect(nextPeriod(lateTrial, { interval: "year", periods: 1, now }).end).toEqual(kla("2027-11-18T09:00:00"));
  });

  it("starts from today once the restaurant has moved to Free, even before the daily job has run", () => {
    expect(nextPeriod(sub({ status: "free" }), { interval: "month", periods: 1, now })).toEqual({ start: now, end: kla("2026-12-20T10:00:00") });
    const stale = sub({ status: "active", paid_until: kla("2026-10-01T00:00:00").toISOString() });
    expect(nextPeriod(stale, { interval: "month", periods: 1, now }).start).toEqual(now);
  });
});

describe("prices and summaries", () => {
  it("prices plans from the config, Pro per branch and monthly only", () => {
    expect(priceFor("standard", "month")).toBe(PLANS.standard.priceMonthlyUgx);
    expect(priceFor("standard", "year")).toBe(200_000);
    expect(priceFor("pro", "month", 3)).toBe(150_000);
    expect(priceFor("pro", "year")).toBeNull();
    expect(priceFor("free", "month")).toBe(0);
  });

  it("keeps the plan's features through the grace period and switches to Free after", () => {
    const due = kla("2026-12-01T00:00:00");
    const s = sub({ plan: "pro", paid_until: due.toISOString() });
    const overdue = billingSummary(s, kla("2026-12-03T00:00:00"), 2);
    expect(overdue).toMatchObject({ status: "overdue", plan: "pro", effective: "pro", amountUgx: 100_000, daysLeft: -2, lapsed: false });
    expect(overdue.graceEndsAt).toEqual(graceEndsAt(s));
    const lapsed = billingSummary({ ...s, status: "free" }, kla("2026-12-10T00:00:00"), 2);
    expect(lapsed).toMatchObject({ status: "free", effective: "free", lapsed: true });
    expect(PLANS[lapsed.effective].limits.items).toBe(30);
  });

  it("asks only the right restaurants to pay, with the right reminder", () => {
    const now = kla("2026-11-20T10:00:00");
    const soon = billingSummary(sub({ paid_until: kla("2026-11-25T00:00:00").toISOString() }), now);
    const later = billingSummary(sub({ paid_until: kla("2026-12-25T00:00:00").toISOString() }), now);
    const trialEnding = billingSummary(sub({ status: "trial", trial_ends_at: kla("2026-11-22T00:00:00").toISOString() }), now);
    const chosenFree = billingSummary(sub({ plan: "free", status: "free" }), now);
    expect([needsAttention(soon), needsAttention(later), needsAttention(trialEnding), needsAttention(chosenFree)]).toEqual([true, false, true, false]);
    expect([reminderKind(soon), reminderKind(trialEnding), reminderKind(chosenFree)]).toEqual(["due_soon", "trial_ending", null]);
    expect(chosenFree.amountUgx).toBeNull();
    expect(reminderKind(billingSummary(sub({ status: "free" }), now))).toBe("lapsed");
  });
});

describe("date inputs", async () => {
  const { fromDateInput, toDateInput } = await import("@/lib/dates");
  it("reads and writes form dates on the Kampala calendar", () => {
    expect(fromDateInput("2026-12-05")).toEqual(kla("2026-12-05T23:59:59"));
    expect(fromDateInput("2026-12-05", "midday")).toEqual(kla("2026-12-05T12:00:00"));
    expect(fromDateInput("2026-02-30")).toBeNull();
    expect(fromDateInput("5/12/2026")).toBeNull();
    // 22:30 UTC on 4 December is already 5 December in Kampala.
    expect(toDateInput(new Date("2026-12-04T22:30:00Z"))).toBe("2026-12-05");
  });
});
