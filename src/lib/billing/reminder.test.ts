import { describe, expect, it } from "vitest";
import { getTranslator } from "@/lib/i18n";
import { EMPTY_MOMO, hasMomo, paidMessage, payMethods, reminderMessage } from "./reminder";
import { billingSummary, reminderKind, type SubscriptionState } from "./status";

const t = getTranslator("en");
const kla = (local: string) => new Date(`${local}+03:00`);
const momo = { mtn_code: "123456", mtn_name: "Menyu Ltd", airtel_code: "654321", airtel_name: "" };

function summary(over: Partial<SubscriptionState>, now = kla("2026-11-20T10:00:00")) {
  const sub = { plan: "standard", status: "active", billing_interval: "month", trial_ends_at: null, paid_until: null, grace_days: 7, ...over };
  return billingSummary(sub, now);
}

describe("payment reminders", () => {
  it("names the restaurant, amount, due date and where to pay", () => {
    const s = summary({ paid_until: kla("2026-11-25T00:00:00").toISOString() });
    const text = reminderMessage(t, { kind: reminderKind(s)!, summary: s, restaurant: "Kijani Café", ownerName: "Sarah Nakato", momo });
    expect(text).toBe(
      [
        "Hello Sarah!",
        "",
        "Your Menyu Standard plan for Kijani Café is due on 25 Nov 2026: UGX 20,000.",
        "Pay with MTN MoMo merchant code 123456 (Menyu Ltd) or Airtel Money merchant code 654321.",
        "Then reply here with the transaction ID. Thank you!",
      ].join("\n"),
    );
  });

  it("gives the date the menu moves to Free when a payment is overdue", () => {
    const s = summary({ plan: "pro", paid_until: kla("2026-11-15T00:00:00").toISOString() });
    const text = reminderMessage(t, { kind: "overdue", summary: s, restaurant: "Kijani Café", momo });
    expect(text).toContain("was due on 15 Nov 2026: UGX 50,000. Please pay by 22 Nov 2026");
    expect(text.startsWith("Hello!")).toBe(true);
  });

  it("reassures owners on Free that nothing was deleted", () => {
    const s = summary({ status: "free", paid_until: kla("2026-10-01T00:00:00").toISOString() });
    const text = reminderMessage(t, { kind: "lapsed", summary: s, restaurant: "Kijani Café", momo });
    expect(text).toContain("shows only 30 dishes");
    expect(text).toContain("Nothing was deleted: pay UGX 20,000");
  });

  it("works before the merchant codes are set up", () => {
    const s = summary({ status: "trial", trial_ends_at: kla("2026-11-30T00:00:00").toISOString() });
    const text = reminderMessage(t, { kind: "trial_ending", summary: s, restaurant: "Rolex Hub", momo: EMPTY_MOMO });
    expect(text).toContain("trial for Rolex Hub ends on 30 Nov 2026");
    expect(text).toContain("Reply to this message and we'll tell you how to pay.");
    expect(text).not.toContain("Then reply here");
    expect(hasMomo(EMPTY_MOMO)).toBe(false);
    expect(payMethods(t, { ...EMPTY_MOMO, airtel_code: " 777 " })).toBe("Airtel Money merchant code 777");
  });

  it("prefills the owner's 'I paid' message with the amount", () => {
    const s = summary({ paid_until: kla("2026-11-25T00:00:00").toISOString() });
    expect(paidMessage(t, { restaurant: "Kijani Café", summary: s })).toBe(
      "Hello! I paid UGX 20,000 for Kijani Café (Standard plan). Transaction ID: ",
    );
  });
});
