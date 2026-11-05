import { describe, expect, it } from "vitest";
import { contrastRatio, readableBrand, textOn, tint } from "./color";
import { matchesQuery, searchable } from "./text";

describe("colour", () => {
  it("picks readable text for any brand colour", () => {
    expect(textOn("#1E5B3A")).toBe("#ffffff");
    expect(textOn("#F4B400")).toBe("#1a1a1a");
    expect(textOn("#ffffff")).toBe("#1a1a1a");
  });

  it("darkens light brand colours until they are readable on white", () => {
    for (const color of ["#F4B400", "#FFC0CB", "#7FFFD4", "#1E5B3A"]) {
      expect(contrastRatio(readableBrand(color), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableBrand("#1E5B3A")).toBe("#1e5b3a");
  });

  it("tints towards white", () => {
    expect(tint("#000000", 1)).toBe("#ffffff");
    expect(tint("#000000", 0)).toBe("#000000");
  });
});

describe("search text", () => {
  it("ignores case and accents", () => {
    expect(searchable("  Kijani CAFÉ ")).toBe("kijani cafe");
    expect(matchesQuery("Passion juice Fresh passion fruit", "PASSION")).toBe(true);
    expect(matchesQuery("Rolex chapati egg", "egg rolex")).toBe(true);
    expect(matchesQuery("Rolex chapati egg", "pork")).toBe(false);
    expect(matchesQuery("anything", "  ")).toBe(true);
  });
});
