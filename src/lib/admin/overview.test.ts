import { describe, expect, it } from "vitest";
import { kampalaMonthStart, overviewNumbers } from "./overview";

const kla = (local: string) => new Date(`${local}+03:00`);
const now = kla("2026-11-20T10:00:00");

const sub = (over: Record<string, unknown>) => ({
  plan: "standard",
  status: "active",
  billing_interval: "month",
  trial_ends_at: null,
  paid_until: kla("2026-12-10T00:00:00").toISOString(),
  grace_days: 7,
  branches: 1,
  created_at: kla("2026-06-01T00:00:00").toISOString(),
  ...over,
});

describe("admin overview numbers", () => {
  it("counts restaurants by billing status with the same rules as billing", () => {
    const n = overviewNumbers(
      {
        subscriptions: [
          sub({}),
          sub({ billing_interval: "year" }),
          sub({ plan: "pro", branches: 2 }),
          sub({ status: "trial", trial_ends_at: kla("2026-12-01T00:00:00").toISOString(), paid_until: null, created_at: kla("2026-11-02T00:00:00").toISOString() }),
          // Due 5 days ago: overdue (still inside 7 grace days), even before the daily job.
          sub({ paid_until: kla("2026-11-15T10:00:00").toISOString() }),
          sub({ plan: "free", status: "free", paid_until: null }),
        ],
        payments: [],
      },
      now,
    );
    expect(n).toMatchObject({ restaurants: 6, paying: 3, trial: 1, overdue: 1, free: 1, newThisMonth: 1 });
    // 20,000 + 200,000 / 12 + 2 x 50,000
    expect(n.mrr).toBe(20_000 + 16_667 + 100_000);
    expect(n.owed).toBe(20_000);
  });

  it("adds up money collected by Kampala calendar month", () => {
    const n = overviewNumbers(
      {
        subscriptions: [],
        payments: [
          { amount_ugx: 20_000, paid_at: kla("2026-11-01T00:30:00").toISOString() },
          { amount_ugx: 50_000, paid_at: kla("2026-11-19T12:00:00").toISOString() },
          // Late on 31 October in Kampala still counts for October.
          { amount_ugx: 7_000, paid_at: kla("2026-10-31T23:30:00").toISOString() },
          { amount_ugx: 9_000, paid_at: kla("2026-09-30T12:00:00").toISOString() },
        ],
      },
      now,
    );
    expect([n.revenueThisMonth, n.revenueLastMonth]).toEqual([70_000, 7_000]);
    expect(kampalaMonthStart(now)).toEqual(kla("2026-11-01T00:00:00"));
    expect(kampalaMonthStart(kla("2027-01-05T00:00:00"), -1)).toEqual(kla("2026-12-01T00:00:00"));
  });
});
