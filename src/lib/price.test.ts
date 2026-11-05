import { describe, expect, it } from "vitest";
import { parsePrice } from "./price";

describe("parsePrice", () => {
  it.each([
    ["15k", 15000],
    ["15K", 15000],
    ["15 k", 15000],
    ["15,000/=", 15000],
    ["15000/=", 15000],
    ["15000", 15000],
    ["15,000", 15000],
    ["15.000", 15000],
    ["15 000", 15000],
    ["UGX 15,000", 15000],
    ["Ugx15000", 15000],
    ["Shs. 15,000", 15000],
    ["Sh 15,000", 15000],
    ["USh 15,000", 15000],
    ["15,000 UGX", 15000],
    ["UGX15,000=", 15000],
    ["15,000.00", 15000],
    ["1.5k", 1500],
    ["2,5k", 2500],
    ["1,250,000", 1250000],
    ["500", 500],
  ])("reads %s as %i", (input, expected) => {
    const result = parsePrice(input);
    expect(result.value).toBe(expected);
    expect(result.unsure).toBe(false);
  });

  it("accepts plain numbers", () => {
    expect(parsePrice(15000)).toEqual({ value: 15000, unsure: false });
  });

  it("treats empty and placeholder values as no price", () => {
    for (const input of ["", "  ", "-", "—", "N/A", null, undefined]) {
      const result = parsePrice(input);
      expect(result.value).toBeNull();
      expect(result.unsure).toBe(false);
    }
  });

  it("flags prices that look like thousands and suggests the full amount", () => {
    expect(parsePrice("15")).toEqual({ value: 15, unsure: true, reason: "too_small", suggestion: 15000 });
  });

  it("flags ranges and keeps the first value", () => {
    expect(parsePrice("10,000 - 15,000")).toMatchObject({ value: 10000, unsure: true, reason: "range" });
  });

  it("flags two prices written together (usually two sizes)", () => {
    expect(parsePrice("15,000/20,000")).toMatchObject({ value: 15000, unsure: true, reason: "multiple" });
  });

  it("flags implausibly large prices", () => {
    expect(parsePrice("150,000,000")).toMatchObject({ unsure: true, reason: "too_large" });
  });

  it("flags text that is not a price", () => {
    expect(parsePrice("ask waiter")).toMatchObject({ value: null, unsure: true, reason: "not_a_price" });
  });

  it("flags extra words so a person can check them", () => {
    expect(parsePrice("15,000 per plate")).toMatchObject({ value: 15000, unsure: true });
  });

  it("never returns fractions of a shilling", () => {
    expect(parsePrice("1.5")).toMatchObject({ value: 2, unsure: true });
    expect(Number.isInteger(parsePrice("2.75k").value)).toBe(true);
  });
});
