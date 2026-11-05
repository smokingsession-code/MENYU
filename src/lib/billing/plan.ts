import { PLAN_CODES, type PlanCode } from "@/config/plans";

/** The plan whose features apply now: Free while the status is "free". */
export function effectivePlan(subscription: { plan: string; status: string } | null | undefined): PlanCode {
  if (!subscription || subscription.status === "free") return "free";
  return (PLAN_CODES as readonly string[]).includes(subscription.plan) ? (subscription.plan as PlanCode) : "free";
}
