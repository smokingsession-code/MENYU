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
