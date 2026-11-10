/**
 * Feature switches: the admin turns features on and off for the whole app
 * (Admin > Features) or for one restaurant (Features on its admin page),
 * with no redeploy. Stored in public.feature_flags and
 * public.restaurant_features; the database applies the same rules (see
 * supabase/migrations/20261110090000_feature_switches.sql).
 *
 * A feature works for a restaurant only if it is on globally AND not turned
 * off for that restaurant, and the restaurant's plan includes it. Nothing is
 * deleted when a feature is off: switching it back on restores everything.
 */
import { planHas, type Feature, type PlanCode } from "./plans";

export const SWITCH_KEYS = [
  "specials",
  "order_waiter",
  "order_whatsapp",
  "order_kitchen",
  "payments",
  "waiter_call",
  "ratings",
  "loyalty",
  "christmas",
  "menu_import",
  "insights",
  "kitchen_screen",
  "directory",
  "rankings",
] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];
export type SwitchGroup = "diner" | "owner" | "network";
export type Switches = Record<SwitchKey, boolean>;

export interface SwitchDefinition {
  key: SwitchKey;
  group: SwitchGroup;
  /** How it is set at launch (the migration seeds the same values). */
  launchDefault: boolean;
  /** The plan feature a restaurant also needs, if any. */
  planFeature?: Feature;
  /** Other switches it needs to work. */
  needs?: SwitchKey[];
}

export const SWITCHES: readonly SwitchDefinition[] = [
  { key: "specials", group: "diner", launchDefault: true, planFeature: "specials" },
  { key: "order_waiter", group: "diner", launchDefault: true, planFeature: "whatsapp_ordering" },
  { key: "order_whatsapp", group: "diner", launchDefault: true, planFeature: "whatsapp_ordering" },
  { key: "order_kitchen", group: "diner", launchDefault: false, planFeature: "kitchen", needs: ["kitchen_screen"] },
  { key: "payments", group: "diner", launchDefault: true, planFeature: "momo_pay" },
  { key: "waiter_call", group: "diner", launchDefault: true, planFeature: "waiter_call" },
  { key: "ratings", group: "diner", launchDefault: false, planFeature: "feedback" },
  { key: "loyalty", group: "diner", launchDefault: false, planFeature: "loyalty" },
  { key: "christmas", group: "diner", launchDefault: true },
  { key: "menu_import", group: "owner", launchDefault: false, planFeature: "menu_editing" },
  { key: "insights", group: "owner", launchDefault: false, planFeature: "insights" },
  { key: "kitchen_screen", group: "owner", launchDefault: false, planFeature: "kitchen" },
  { key: "directory", group: "network", launchDefault: false, planFeature: "directory_listing" },
  { key: "rankings", group: "network", launchDefault: false, planFeature: "directory_listing", needs: ["directory"] },
];

export const SWITCH_GROUPS: readonly SwitchGroup[] = ["diner", "owner", "network"];

/**
 * Which switch guards a plan feature. Must match private.feature_switch_for()
 * in the database (an integration test checks).
 */
export const PLAN_FEATURE_SWITCH: Partial<Record<Feature, SwitchKey>> = {
  specials: "specials",
  feedback: "ratings",
  loyalty: "loyalty",
  kitchen: "kitchen_screen",
  insights: "insights",
  waiter_call: "waiter_call",
  momo_pay: "payments",
  directory_listing: "directory",
  featured_listing: "directory",
};

/** The launch settings: what the app assumes if the switches cannot be read. */
export const LAUNCH_DEFAULTS: Switches = Object.fromEntries(SWITCHES.map((s) => [s.key, s.launchDefault])) as Switches;

/**
 * On for a restaurant: on globally AND not turned off for it. An "On"
 * override cannot beat a global Off. Must match private.switch_on().
 */
export function effectiveSwitches(global: ReadonlyMap<string, boolean> | Record<string, boolean>, overrides: ReadonlyMap<string, boolean> | Record<string, boolean> = {}): Switches {
  const get = (source: ReadonlyMap<string, boolean> | Record<string, boolean>, key: string) =>
    source instanceof Map ? source.get(key) : (source as Record<string, boolean>)[key];
  return Object.fromEntries(SWITCH_KEYS.map((k) => [k, get(global, k) === true && get(overrides, k) !== false])) as Switches;
}

/** The plan includes the feature and its switch (if it has one) is on. Mirrors private.plan_allows(). */
export function planFeatureOn(plan: PlanCode, feature: Feature, switches: Switches): boolean {
  if (!planHas(plan, feature)) return false;
  const key = PLAN_FEATURE_SWITCH[feature];
  return key ? switches[key] : true;
}

/**
 * Lines of the plan lists (billing.features.*) that describe a switchable
 * feature: hidden on the price list and billing page while it is off.
 */
export const PLAN_LINE_SWITCH: Record<string, SwitchKey> = {
  "features.standard.whatsapp": "order_whatsapp",
  "features.standard.waiter": "order_waiter",
  "features.standard.listing": "directory",
  "features.pro.specials": "specials",
  "features.pro.sellToday": "specials",
  "features.pro.insights": "insights",
  "features.pro.feedback": "ratings",
  "features.pro.waiter": "waiter_call",
  "features.pro.loyalty": "loyalty",
  "features.pro.kitchen": "kitchen_screen",
  "features.pro.featured": "directory",
};

/** The plan list lines to show, given which switches are on. */
export function visiblePlanLines(strings: Record<string, string>, plan: PlanCode, switches: Switches, skip: readonly string[] = []): string[] {
  return Object.entries(strings)
    .filter(([key]) => key.startsWith(`features.${plan}.`) && !skip.includes(key))
    .filter(([key]) => {
      const sw = PLAN_LINE_SWITCH[key];
      return !sw || switches[sw];
    })
    .map(([, text]) => text);
}

export type OrderMode = "waiter" | "whatsapp" | "kitchen";

/**
 * How a branch takes orders right now: its own choice when that is switched
 * on and possible, otherwise WhatsApp (with a number) or showing a waiter,
 * whichever is on; null when no way of ordering is on. Mirrors
 * private.order_mode() (the diner menu gets the database's answer).
 */
export function effectiveOrderMode(chosen: OrderMode, whatsapp: string | null, plan: PlanCode, switches: Switches): OrderMode | null {
  if (!planHas(plan, "whatsapp_ordering")) return null;
  const kitchen = planFeatureOn(plan, "kitchen", switches) && switches.order_kitchen;
  const viaWhatsapp = Boolean(whatsapp) && switches.order_whatsapp;
  if (chosen === "kitchen" && kitchen) return "kitchen";
  if (chosen === "whatsapp" && viaWhatsapp) return "whatsapp";
  if (chosen === "waiter" && switches.order_waiter) return "waiter";
  if (viaWhatsapp) return "whatsapp";
  if (switches.order_waiter) return "waiter";
  return null;
}

export type FeatureReason = "active" | "plan" | "global" | "here" | "needs" | "owner" | "listing";

export interface FeatureStatus {
  active: boolean;
  reason: FeatureReason;
  /** For "needs": the other switches that are off. */
  needs?: SwitchKey[];
}

/**
 * Whether a feature works for one restaurant now, and if not, why. Mirrors
 * private.feature_active() (the admin's "On for X of Y restaurants").
 */
export function featureStatus(
  key: SwitchKey,
  r: {
    plan: PlanCode;
    global: Switches;
    overrides: Partial<Record<SwitchKey, boolean>>;
    /** The owner's own Christmas theme choice. */
    christmasTheme: boolean;
    /** Approved for Menus near me. */
    listed: boolean;
  },
): FeatureStatus {
  const def = SWITCHES.find((s) => s.key === key)!;
  const switches = effectiveSwitches(r.global, r.overrides);
  if (def.planFeature && !planHas(r.plan, def.planFeature)) return { active: false, reason: "plan" };
  if (!r.global[key]) return { active: false, reason: "global" };
  if (r.overrides[key] === false) return { active: false, reason: "here" };
  const missing = (def.needs ?? []).filter((n) => !switches[n]);
  if (missing.length) return { active: false, reason: "needs", needs: missing };
  if (key === "christmas" && r.overrides.christmas !== true && !r.christmasTheme) return { active: false, reason: "owner" };
  if ((key === "directory" || key === "rankings") && !r.listed) return { active: false, reason: "listing" };
  return { active: true, reason: "active" };
}
