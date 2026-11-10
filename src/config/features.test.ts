import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import {
  effectiveOrderMode,
  effectiveSwitches,
  featureStatus,
  LAUNCH_DEFAULTS,
  planFeatureOn,
  SWITCHES,
  SWITCH_KEYS,
  visiblePlanLines,
  type Switches,
} from "./features";

const allOn = Object.fromEntries(SWITCH_KEYS.map((k) => [k, true])) as Switches;
const allOff = Object.fromEntries(SWITCH_KEYS.map((k) => [k, false])) as Switches;

describe("feature switches", () => {
  it("launch as specified: these on, the rest off", () => {
    const on = SWITCHES.filter((s) => s.launchDefault).map((s) => s.key);
    expect(on.sort()).toEqual(["christmas", "order_waiter", "order_whatsapp", "payments", "specials", "waiter_call"].sort());
    const off = SWITCHES.filter((s) => !s.launchDefault).map((s) => s.key);
    expect(off.sort()).toEqual(["directory", "insights", "kitchen_screen", "loyalty", "menu_import", "order_kitchen", "rankings", "ratings"].sort());
    expect(LAUNCH_DEFAULTS.specials).toBe(true);
    expect(LAUNCH_DEFAULTS.ratings).toBe(false);
  });

  it("are grouped Diner, Owner, Network, each with a name and description", () => {
    const group = (g: string) => SWITCHES.filter((s) => s.group === g).map((s) => s.key);
    expect(group("diner")).toEqual(["specials", "order_waiter", "order_whatsapp", "order_kitchen", "payments", "waiter_call", "ratings", "loyalty", "christmas"]);
    expect(group("owner")).toEqual(["menu_import", "insights", "kitchen_screen"]);
    expect(group("network")).toEqual(["directory", "rankings"]);
    for (const key of SWITCH_KEYS) {
      const item = (en.switches.items as Record<string, { name: string; description: string }>)[key];
      expect(item?.name, key).toBeTruthy();
      expect(item?.description, key).toBeTruthy();
    }
  });

  it("work for a restaurant only if on globally and not turned off there", () => {
    const global = { ...allOn, loyalty: false };
    const s = effectiveSwitches(global, { specials: false, loyalty: true, ratings: true });
    expect(s.specials).toBe(false); // off here
    expect(s.loyalty).toBe(false); // "On" here cannot beat a global Off
    expect(s.ratings).toBe(true);
    expect(s.insights).toBe(true); // no override: the global switch
    expect(effectiveSwitches(new Map([["specials", true]])).specials).toBe(true);
    expect(effectiveSwitches(new Map()).specials).toBe(false);
  });

  it("need the plan as well as the switch", () => {
    expect(planFeatureOn("pro", "loyalty", allOn)).toBe(true);
    expect(planFeatureOn("pro", "loyalty", { ...allOn, loyalty: false })).toBe(false);
    expect(planFeatureOn("standard", "loyalty", allOn)).toBe(false);
    expect(planFeatureOn("standard", "momo_pay", { ...allOn, payments: false })).toBe(false);
    // Features without a switch follow the plan alone.
    expect(planFeatureOn("standard", "table_qr", allOff)).toBe(true);
    expect(planFeatureOn("pro", "kitchen", { ...allOn, kitchen_screen: false })).toBe(false);
  });

  it("fall back to another way of ordering when the chosen one is off", () => {
    const wa = "256772000111";
    expect(effectiveOrderMode("kitchen", wa, "pro", allOn)).toBe("kitchen");
    expect(effectiveOrderMode("kitchen", wa, "pro", { ...allOn, kitchen_screen: false })).toBe("whatsapp");
    expect(effectiveOrderMode("kitchen", null, "pro", { ...allOn, order_kitchen: false })).toBe("waiter");
    expect(effectiveOrderMode("whatsapp", wa, "standard", { ...allOn, order_whatsapp: false })).toBe("waiter");
    expect(effectiveOrderMode("waiter", wa, "standard", { ...allOn, order_waiter: false })).toBe("whatsapp");
    expect(effectiveOrderMode("waiter", null, "standard", { ...allOn, order_waiter: false })).toBeNull();
    expect(effectiveOrderMode("whatsapp", wa, "free", allOn)).toBeNull();
  });

  it("explain why a feature is not working for a restaurant", () => {
    const base = { plan: "pro" as const, global: allOn, overrides: {}, christmasTheme: false, listed: true };
    expect(featureStatus("loyalty", base)).toEqual({ active: true, reason: "active" });
    expect(featureStatus("loyalty", { ...base, plan: "standard" }).reason).toBe("plan");
    expect(featureStatus("loyalty", { ...base, global: { ...allOn, loyalty: false }, overrides: { loyalty: true } }).reason).toBe("global");
    expect(featureStatus("loyalty", { ...base, overrides: { loyalty: false } }).reason).toBe("here");
    expect(featureStatus("order_kitchen", { ...base, global: { ...allOn, kitchen_screen: false } })).toEqual({ active: false, reason: "needs", needs: ["kitchen_screen"] });
    expect(featureStatus("christmas", base).reason).toBe("owner");
    expect(featureStatus("christmas", { ...base, christmasTheme: true }).active).toBe(true);
    expect(featureStatus("christmas", { ...base, overrides: { christmas: true } }).active).toBe(true);
    expect(featureStatus("directory", { ...base, listed: false }).reason).toBe("listing");
    expect(featureStatus("rankings", { ...base, global: { ...allOn, directory: false } }).reason).toBe("needs");
  });

  it("leave switched-off features out of the plan lists", () => {
    const strings = {
      "features.pro.everything": "Everything in Standard",
      "features.pro.loyalty": "Loyalty stamps",
      "features.pro.staff": "Staff accounts",
      "features.standard.items": "Unlimited dishes",
    };
    expect(visiblePlanLines(strings, "pro", allOn)).toEqual(["Everything in Standard", "Loyalty stamps", "Staff accounts"]);
    expect(visiblePlanLines(strings, "pro", { ...allOn, loyalty: false }, ["features.pro.everything"])).toEqual(["Staff accounts"]);
  });
});
