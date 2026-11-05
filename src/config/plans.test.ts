import { describe, expect, it } from "vitest";
import { FEATURES, PLANS, monthlyPriceUgx, planHas, withinLimit, yearlyPriceUgx } from "./plans";

describe("plan config", () => {
  it("matches the published prices", () => {
    expect(PLANS.free.priceMonthlyUgx).toBe(0);
    expect(PLANS.standard.priceMonthlyUgx).toBe(20000);
    expect(PLANS.standard.priceYearlyUgx).toBe(200000);
    expect(PLANS.pro.priceMonthlyUgx).toBe(50000);
  });

  it("charges Pro per branch", () => {
    expect(monthlyPriceUgx("pro", 1)).toBe(50000);
    expect(monthlyPriceUgx("pro", 3)).toBe(150000);
    expect(monthlyPriceUgx("standard", 3)).toBe(20000);
    expect(monthlyPriceUgx("pro", 0)).toBe(50000);
    expect(yearlyPriceUgx("standard")).toBe(200000);
    expect(yearlyPriceUgx("pro")).toBeNull();
  });

  it("limits Free to 30 items and one QR code, with the footer", () => {
    expect(PLANS.free.limits.items).toBe(30);
    expect(PLANS.free.limits.qrCodes).toBe(1);
    expect(planHas("free", "hide_footer")).toBe(false);
    expect(planHas("free", "menu_editing")).toBe(false);
    expect(planHas("free", "whatsapp_ordering")).toBe(false);
  });

  it("gives Standard ordering, table QR codes and the dashboard, without Pro extras", () => {
    for (const f of ["dashboard", "menu_editing", "table_qr", "whatsapp_ordering", "directory_listing", "hide_footer"] as const) {
      expect(planHas("standard", f)).toBe(true);
    }
    for (const f of ["specials", "insights", "feedback", "waiter_call", "photo_enhance", "staff", "branches", "featured_listing"] as const) {
      expect(planHas("standard", f)).toBe(false);
    }
    expect(PLANS.standard.limits.items).toBeNull();
  });

  it("gives Pro every feature", () => {
    for (const f of FEATURES) expect(planHas("pro", f)).toBe(true);
  });

  it("every plan lists every feature", () => {
    for (const plan of Object.values(PLANS)) {
      expect(Object.keys(plan.features).sort()).toEqual([...FEATURES].sort());
    }
  });

  it("checks limits", () => {
    expect(withinLimit(30, 29)).toBe(true);
    expect(withinLimit(30, 30)).toBe(false);
    expect(withinLimit(null, 10_000)).toBe(true);
  });
});
