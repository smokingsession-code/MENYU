import { kampalaClock, parseTime } from "./hours";

export interface SpecialWindow {
  /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
  days: number[];
  start: string;
  end: string;
  starts_on?: string | null;
  ends_on?: string | null;
}

/**
 * Whether a special (daily deal, happy hour) is on right now in Kampala.
 * start = end means all day; end before start runs past midnight, and then
 * the early-morning part belongs to the previous day's special.
 */
export function isSpecialActive(special: SpecialWindow, now: Date): boolean {
  const { day, minutes, date } = kampalaClock(now);
  const isoDay = day + 1;
  const start = parseTime(special.start) ?? 0;
  const end = parseTime(special.end) ?? 0;

  const onDate = (d: string) => (!special.starts_on || d >= special.starts_on) && (!special.ends_on || d <= special.ends_on);

  if (start === end) return special.days.includes(isoDay) && onDate(date);
  if (start < end) return special.days.includes(isoDay) && minutes >= start && minutes < end && onDate(date);

  // Overnight: today's evening part, or yesterday's special still running.
  if (minutes >= start) return special.days.includes(isoDay) && onDate(date);
  if (minutes < end) {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const y = kampalaClock(yesterday);
    return special.days.includes(y.day + 1) && onDate(y.date);
  }
  return false;
}
