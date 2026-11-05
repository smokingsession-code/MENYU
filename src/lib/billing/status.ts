import { PLANS, type PlanCode } from "@/config/plans";
import { effectivePlan } from "./plan";

/**
 * The billing rules, in one place and without side effects, so they can be
 * tested and shown on screen exactly as they are applied.
 *
 *   trial ──(trial ends)──▶ overdue ──(grace days pass)──▶ free
 *   active ─(paid period ends)─▶ overdue ──(grace days pass)──▶ free
 *   any ──(subscription payment)──▶ active
 *
 * While overdue the restaurant keeps its plan; on "free" the menu falls back
 * to the Free plan (first 30 dishes, no ordering) and nothing is deleted.
 */

export type BillingStatus = "trial" | "active" | "overdue" | "free";
export type BillingInterval = "month" | "year";

export interface SubscriptionState {
  plan: string;
  status: string;
  billing_interval: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  grace_days: number;
}

const DAY = 86_400_000;
/** Kampala is UTC+3 all year (no daylight saving). */
const KAMPALA_OFFSET = 3 * 3_600_000;

function ms(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Adds calendar months in Kampala time, keeping the time of day. A period
 * that starts on the 31st ends on the last day of a shorter month.
 */
export function addMonths(date: Date, months: number): Date {
  const local = new Date(date.getTime() + KAMPALA_OFFSET);
  const day = local.getUTCDate();
  const target = new Date(local.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return new Date(target.getTime() - KAMPALA_OFFSET);
}

/** When payment is (or was) due: the end of the trial or of the paid period. */
export function dueAt(sub: SubscriptionState): Date | null {
  const due = sub.status === "trial" ? ms(sub.trial_ends_at) : (ms(sub.paid_until) ?? ms(sub.trial_ends_at));
  return due === null ? null : new Date(due);
}

/** The last day of grace: after this an unpaid restaurant moves to Free. */
export function graceEndsAt(sub: SubscriptionState): Date | null {
  const due = dueAt(sub);
  return due ? new Date(due.getTime() + Math.max(0, sub.grace_days) * DAY) : null;
}

/** The status the subscription should have at `now`. */
export function computeStatus(sub: SubscriptionState, now: Date): BillingStatus {
  if (sub.status === "free") return "free";
  const trial = sub.status === "trial";
  const due = dueAt(sub);
  // No end date: an open-ended trial or plan set by the Menyu team.
  if (!due) return trial ? "trial" : "active";
  if (now.getTime() < due.getTime()) return trial ? "trial" : "active";
  return now.getTime() < graceEndsAt(sub)!.getTime() ? "overdue" : "free";
}

/** True for a restaurant that chose the Free plan (as opposed to one that stopped paying). */
export function choseFree(sub: SubscriptionState): boolean {
  return sub.plan === "free";
}

/** The price of one period, or null when the plan has no such option (Pro is monthly only). */
export function priceFor(plan: PlanCode, interval: BillingInterval, branches = 1): number | null {
  const def = PLANS[plan];
  const base = interval === "year" ? def.priceYearlyUgx : def.priceMonthlyUgx;
  if (base === null) return null;
  return def.pricePerBranch ? base * Math.max(1, branches) : base;
}

export function isPaidPlan(plan: string): plan is Exclude<PlanCode, "free"> {
  return plan === "standard" || plan === "pro";
}

/**
 * The period a subscription payment buys. Renewals continue from the due
 * date, so paying early loses nothing and paying late gains nothing; a
 * payment during the trial starts when the trial ends; a restaurant that
 * already moved to Free starts again from today.
 */
export function nextPeriod(
  sub: SubscriptionState,
  input: { interval: BillingInterval; periods: number; now: Date },
): { start: Date; end: Date } {
  const status = computeStatus(sub, input.now);
  const due = dueAt(sub);
  let start = input.now;
  if (status !== "free" && due) {
    if (status === "trial") start = due.getTime() > input.now.getTime() ? due : input.now;
    else start = due;
  }
  const months = (input.interval === "year" ? 12 : 1) * Math.max(1, Math.floor(input.periods));
  return { start, end: addMonths(start, months) };
}

export interface BillingSummary {
  status: BillingStatus;
  /** The plan the restaurant pays for (or tried); kept when it moves to Free. */
  plan: PlanCode;
  /** The plan whose features apply now. */
  effective: PlanCode;
  interval: BillingInterval;
  dueAt: Date | null;
  graceEndsAt: Date | null;
  /** Whole days until the due date (negative once passed). */
  daysLeft: number | null;
  /** What the next period costs, or null when nothing is owed. */
  amountUgx: number | null;
  /** A restaurant on Free because it stopped paying, not by choice. */
  lapsed: boolean;
}

export function billingSummary(sub: SubscriptionState, now: Date, branches = 1): BillingSummary {
  const status = computeStatus(sub, now);
  const plan = ((PLANS as Record<string, unknown>)[sub.plan] ? sub.plan : "free") as PlanCode;
  const interval: BillingInterval = sub.billing_interval === "year" ? "year" : "month";
  const due = dueAt(sub);
  const lapsed = status === "free" && isPaidPlan(plan);
  const owes = isPaidPlan(plan);
  return {
    status,
    plan,
    effective: effectivePlan({ plan, status }),
    interval,
    dueAt: status === "free" && !lapsed ? null : due,
    graceEndsAt: status === "free" ? null : graceEndsAt(sub),
    daysLeft: due ? Math.ceil((due.getTime() - now.getTime()) / DAY) : null,
    amountUgx: owes ? (priceFor(plan, interval, branches) ?? priceFor(plan, "month", branches)) : null,
    lapsed,
  };
}

export type ReminderKind = "trial_ending" | "due_soon" | "overdue" | "lapsed";

/** Which reminder fits now, or null when nothing is owed. */
export function reminderKind(summary: BillingSummary): ReminderKind | null {
  if (summary.amountUgx === null) return null;
  switch (summary.status) {
    case "trial":
      return "trial_ending";
    case "active":
      return "due_soon";
    case "overdue":
      return "overdue";
    case "free":
      return summary.lapsed ? "lapsed" : null;
  }
}

/** Days before the due date when owners start seeing a reminder. */
export const REMIND_DAYS_BEFORE = 7;

/** Whether the owner's dashboard should show a payment notice now. */
export function needsAttention(summary: BillingSummary): boolean {
  if (summary.status === "overdue" || summary.lapsed) return true;
  if (summary.amountUgx === null || summary.daysLeft === null) return false;
  return (summary.status === "trial" || summary.status === "active") && summary.daysLeft <= REMIND_DAYS_BEFORE;
}
