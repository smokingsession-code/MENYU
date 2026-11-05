import { TIMEZONE } from "@/config/brand";

/** Dates are always shown in Kampala time (UTC+3, no daylight saving). */
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIMEZONE });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIMEZONE,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormat.format(date);
}

const KAMPALA_OFFSET_MS = 3 * 3_600_000;

/** A date as an <input type="date"> value ("2026-12-05"), on the Kampala calendar. */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + KAMPALA_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Reads an <input type="date"> value as a moment in Kampala: the end of that
 * day for "paid until" dates (the day itself is covered), or midday for the
 * day something happened. Null when the value is not a real date.
 */
export function fromDateInput(value: string, at: "end" | "midday" = "end"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${at === "end" ? "23:59:59" : "12:00:00"}+03:00`);
  return Number.isNaN(date.getTime()) || toDateInput(date) !== value ? null : date;
}
