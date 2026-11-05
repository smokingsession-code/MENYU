import { PLANS } from "@/config/plans";
import { formatDate } from "@/lib/dates";
import type { Translator } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import type { BillingSummary, ReminderKind } from "./status";

/** The business's own merchant codes, where owners pay (admin settings). */
export interface BusinessMomo {
  mtn_code: string;
  mtn_name: string;
  airtel_code: string;
  airtel_name: string;
}

export const EMPTY_MOMO: BusinessMomo = { mtn_code: "", mtn_name: "", airtel_code: "", airtel_name: "" };

export function hasMomo(momo: BusinessMomo): boolean {
  return Boolean(momo.mtn_code.trim() || momo.airtel_code.trim());
}

/** "MTN MoMo merchant code 123456 (Menyu Ltd) or Airtel Money merchant code 654321" */
export function payMethods(t: Translator, momo: BusinessMomo): string {
  const methods: string[] = [];
  const named = (text: string, name: string) => (name.trim() ? `${text} (${name.trim()})` : text);
  if (momo.mtn_code.trim()) methods.push(named(t("billing.reminder.payMtn", { code: momo.mtn_code.trim() }), momo.mtn_name));
  if (momo.airtel_code.trim()) methods.push(named(t("billing.reminder.payAirtel", { code: momo.airtel_code.trim() }), momo.airtel_name));
  return methods.join(` ${t("billing.reminder.or")} `);
}

/**
 * The WhatsApp message the Menyu team sends an owner about paying. Plain
 * text, short lines: it is read on a phone.
 */
export function reminderMessage(
  t: Translator,
  input: { kind: ReminderKind; summary: BillingSummary; restaurant: string; ownerName?: string | null; momo: BusinessMomo },
): string {
  const { summary } = input;
  const vars = {
    restaurant: input.restaurant,
    plan: PLANS[summary.plan].name,
    amount: formatUGX(summary.amountUgx ?? 0),
    date: formatDate(summary.dueAt),
    grace: formatDate(summary.graceEndsAt),
    limit: PLANS.free.limits.items ?? 0,
  };
  const name = input.ownerName?.trim().split(/\s+/)[0];
  const hello = name ? t("billing.reminder.helloName", { name }) : t("billing.reminder.hello");
  const body = t(`billing.reminder.${input.kind}`, vars);
  const methods = payMethods(t, input.momo);
  const pay = methods ? t("billing.reminder.payWith", { methods }) : t("billing.reminder.payAsk");
  return [hello, "", body, pay, methods ? t("billing.reminder.thanks") : null].filter((line) => line !== null).join("\n");
}

/** What an owner sends the Menyu team after paying, with the transaction ID to fill in. */
export function paidMessage(t: Translator, input: { restaurant: string; summary: BillingSummary }): string {
  return t("billing.paidMessage", {
    restaurant: input.restaurant,
    plan: PLANS[input.summary.plan].name,
    amount: formatUGX(input.summary.amountUgx ?? 0),
  });
}
