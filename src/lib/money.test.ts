import { describe, expect, it } from "vitest";
import { adjustPrice, formatUGX, groupThousands, sumUGX } from "./money";

describe("money", () => {
  it("formats whole shillings", () => {
    expect(formatUGX(15000)).toBe("UGX 15,000");
    expect(formatUGX(0)).toBe("UGX 0");
    expect(formatUGX(999)).toBe("UGX 999");
    expect(formatUGX(1250000)).toBe("UGX 1,250,000");
    expect(formatUGX(-5000)).toBe("-UGX 5,000");
    expect(formatUGX(Number.NaN)).toBe("UGX 0");
    expect(groupThousands(1234567)).toBe("1,234,567");
  });

  it("sums to whole numbers", () => {
    expect(sumUGX([10000, 5000])).toBe(15000);
  });

  it("applies bulk price changes with friendly rounding", () => {
    expect(adjustPrice(5000, 10)).toBe(5500);
    expect(adjustPrice(4500, 10)).toBe(5000); // 4950 -> 5000
    expect(adjustPrice(3000, 10, 100)).toBe(3300);
    expect(adjustPrice(3333, 0, 1)).toBe(3333);
    expect(adjustPrice(1000, -100)).toBe(0);
  });
});
