import { describe, expect, it } from "vitest";
import {
  formatPhoneInternational,
  formatPhoneLocal,
  isAllowedSmsDestination,
  isUgandanMobile,
  maskPhone,
  mobileNetwork,
  normalizePhone,
} from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["0772 123 456", "256772123456"],
    ["0772123456", "256772123456"],
    ["772123456", "256772123456"],
    ["+256 772 123456", "256772123456"],
    ["+256772123456", "256772123456"],
    ["256772123456", "256772123456"],
    ["00256772123456", "256772123456"],
    ["(0)701-234-567", "256701234567"],
    ["0414 123 456", "256414123456"],
    ["+254 712 345 678", "254712345678"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", "0772", "+256 12", "07721234567890", "0772 12a 456", "+256 172 123 456"])(
    "rejects %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("phone helpers", () => {
  it("knows Ugandan mobile numbers and their network", () => {
    expect(isUgandanMobile("256772123456")).toBe(true);
    expect(isUgandanMobile("256414123456")).toBe(false);
    expect(mobileNetwork("256772123456")).toBe("mtn");
    expect(mobileNetwork("256752123456")).toBe("airtel");
    expect(mobileNetwork("256712123456")).toBe("other");
  });

  it("formats for display", () => {
    expect(formatPhoneInternational("256772123456")).toBe("+256 772 123 456");
    expect(formatPhoneLocal("256772123456")).toBe("0772 123 456");
    expect(formatPhoneLocal("254712345678")).toBe("+254712345678");
    expect(maskPhone("256772123456")).toBe("•••• 456");
  });

  it("only sends SMS to allowed countries", () => {
    expect(isAllowedSmsDestination("256772123456", ["256"])).toBe(true);
    expect(isAllowedSmsDestination("254712345678", ["256"])).toBe(false);
    expect(isAllowedSmsDestination("254712345678", ["256", "254"])).toBe(true);
    expect(isAllowedSmsDestination("abc", ["256"])).toBe(false);
  });
});
