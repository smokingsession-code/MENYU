import { billingSummary, isPaidPlan, priceFor, type SubscriptionState } from "@/lib/billing/status";

/**
 * The admin overview's business numbers, computed from subscriptions and
 * payments with the same billing rules the rest of the app uses. Demo
 * restaurants are left out by the caller.
 */
export interface OverviewInput {
  subscriptions: (SubscriptionState & { branches: number; created_at: string })[];
  /** Succeeded, not removed. */
  payments: { amount_ugx: number; paid_at: string }[];
}

export interface OverviewNumbers {
  restaurants: number;
  trial: number;
  paying: number;
  overdue: number;
  free: number;
  /** Monthly recurring revenue from paying restaurants (yearly plans / 12). */
  mrr: number;
  /** What overdue restaurants owe for their next period. */
  owed: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  newThisMonth: number;
}

const KAMPALA_OFFSET = 3 * 3_600_000;

/** The start of the Kampala calendar month `offset` months from now's. */
export function kampalaMonthStart(now: Date, offset = 0): Date {
  const local = new Date(now.getTime() + KAMPALA_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, 1) - KAMPALA_OFFSET);
}

export function overviewNumbers(input: OverviewInput, now: Date): OverviewNumbers {
  const thisMonth = kampalaMonthStart(now).getTime();
  const lastMonth = kampalaMonthStart(now, -1).getTime();
  const out: OverviewNumbers = {
    restaurants: input.subscriptions.length,
    trial: 0,
    paying: 0,
    overdue: 0,
    free: 0,
    mrr: 0,
    owed: 0,
    revenueThisMonth: 0,
    revenueLastMonth: 0,
    newThisMonth: 0,
  };
  for (const sub of input.subscriptions) {
    const summary = billingSummary(sub, now, sub.branches);
    if (Date.parse(sub.created_at) >= thisMonth) out.newThisMonth += 1;
    if (summary.status === "trial") out.trial += 1;
    else if (summary.status === "overdue") {
      out.overdue += 1;
      out.owed += summary.amountUgx ?? 0;
    } else if (summary.status === "free") out.free += 1;
    else if (isPaidPlan(summary.plan)) {
      out.paying += 1;
      const monthly =
        summary.interval === "year" && priceFor(summary.plan, "year") !== null
          ? Math.round((priceFor(summary.plan, "year") ?? 0) / 12)
          : (priceFor(summary.plan, "month", sub.branches) ?? 0);
      out.mrr += monthly;
    }
  }
  for (const p of input.payments) {
    const at = Date.parse(p.paid_at);
    if (at >= thisMonth && at <= now.getTime()) out.revenueThisMonth += p.amount_ugx;
    else if (at >= lastMonth && at < thisMonth) out.revenueLastMonth += p.amount_ugx;
  }
  return out;
}
