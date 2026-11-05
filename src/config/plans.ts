/**
 * The one place where plans, prices and limits are defined.
 *
 * The database keeps a copy in public.plans (used by row-level security to
 * enforce features). After changing anything here run:
 *
 *   npm run plans:sql
 *
 * which writes a new migration that syncs the table. An integration test
 * fails if the database and this file disagree.
 */

export const PLAN_CODES = ["free", "standard", "pro"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const FEATURES = [
  /** Owner dashboard and self-service edits. Free menus are changed on request. */
  "dashboard",
  "menu_editing",
  /** A QR code per table (Free gets one restaurant-wide QR code). */
  "table_qr",
  /** Cart and "Order on WhatsApp". */
  "whatsapp_ordering",
  /** Show the restaurant's MTN and Airtel merchant codes to diners. */
  "momo_pay",
  "directory_listing",
  /** No "Made with Menyu" footer. */
  "hide_footer",
  "specials",
  "insights",
  "feedback",
  /** "Call the waiter" and "Bring the bill". */
  "waiter_call",
  "photo_enhance",
  "staff",
  "branches",
  "featured_listing",
] as const;
export type Feature = (typeof FEATURES)[number];

export interface PlanLimits {
  /** Items shown on the menu. null = unlimited. */
  items: number | null;
  /** QR codes the owner can download. null = unlimited. */
  qrCodes: number | null;
  /** Item photos shown on the menu. null = unlimited. */
  itemPhotos: number | null;
  /** Branches (locations). null = unlimited. */
  branches: number | null;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  /** Monthly price in UGX. For per-branch plans this is per branch. */
  priceMonthlyUgx: number;
  /** Yearly price in UGX, or null when there is no yearly option. */
  priceYearlyUgx: number | null;
  /** When true the price is charged for every active branch. */
  pricePerBranch: boolean;
  limits: PlanLimits;
  features: Record<Feature, boolean>;
}

function features(enabled: readonly Feature[]): Record<Feature, boolean> {
  return Object.fromEntries(FEATURES.map((f) => [f, enabled.includes(f)])) as Record<Feature, boolean>;
}

const STANDARD_FEATURES = [
  "dashboard",
  "menu_editing",
  "table_qr",
  "whatsapp_ordering",
  "momo_pay",
  "directory_listing",
  "hide_footer",
] as const satisfies readonly Feature[];

export const PLANS: Record<PlanCode, PlanDefinition> = {
  free: {
    code: "free",
    name: "Free",
    priceMonthlyUgx: 0,
    priceYearlyUgx: 0,
    pricePerBranch: false,
    // Item photos on Free: 0 means the menu shows logo and cover only.
    limits: { items: 30, qrCodes: 1, itemPhotos: 0, branches: 1 },
    features: features([]),
  },
  standard: {
    code: "standard",
    name: "Standard",
    priceMonthlyUgx: 20_000,
    priceYearlyUgx: 200_000,
    pricePerBranch: false,
    limits: { items: null, qrCodes: null, itemPhotos: null, branches: 1 },
    features: features(STANDARD_FEATURES),
  },
  pro: {
    code: "pro",
    name: "Pro",
    // Charged for every branch: 2 branches = UGX 100,000 a month.
    priceMonthlyUgx: 50_000,
    priceYearlyUgx: null,
    pricePerBranch: true,
    limits: { items: null, qrCodes: null, itemPhotos: null, branches: null },
    features: features(FEATURES),
  },
};

/** New restaurants start on a Standard trial. The admin can change the length. */
export const TRIAL = { plan: "standard" as PlanCode, defaultDays: 30 };

/** Days after a missed due date before a restaurant moves to Free. */
export const GRACE_DAYS_DEFAULT = 7;

export function getPlan(code: PlanCode): PlanDefinition {
  return PLANS[code];
}

export function planHas(code: PlanCode, feature: Feature): boolean {
  return PLANS[code].features[feature];
}

/** Monthly price for a plan, counting branches on per-branch plans. */
export function monthlyPriceUgx(code: PlanCode, branchCount = 1): number {
  const plan = PLANS[code];
  return plan.pricePerBranch ? plan.priceMonthlyUgx * Math.max(1, branchCount) : plan.priceMonthlyUgx;
}

/** Yearly price, or null when the plan has no yearly option. */
export function yearlyPriceUgx(code: PlanCode, branchCount = 1): number | null {
  const plan = PLANS[code];
  if (plan.priceYearlyUgx === null) return null;
  return plan.pricePerBranch ? plan.priceYearlyUgx * Math.max(1, branchCount) : plan.priceYearlyUgx;
}

/** Whether adding one more of something stays within a limit. */
export function withinLimit(limit: number | null, currentCount: number): boolean {
  return limit === null || currentCount < limit;
}

/** The rows the database plans table should contain. */
export function plansAsRows() {
  return PLAN_CODES.map((code, index) => {
    const p = PLANS[code];
    return {
      code: p.code,
      name: p.name,
      price_monthly_ugx: p.priceMonthlyUgx,
      price_yearly_ugx: p.priceYearlyUgx,
      price_per_branch: p.pricePerBranch,
      limits: p.limits,
      features: p.features,
      sort_order: index,
    };
  });
}
