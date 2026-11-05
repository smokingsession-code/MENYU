/**
 * Opening hours, always in Kampala time (UTC+3 all year, no daylight saving).
 * Stored as {"mon": [["07:00","22:00"]], ..., "sun": []}. A closing time at
 * or before the opening time means the range runs past midnight, which is
 * how lounges and bars work ("17:00" to "02:00").
 */
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type OpeningHours = Partial<Record<DayKey, [string, string][]>>;

const MINUTES_PER_DAY = 1440;
const WEEK = 7 * MINUTES_PER_DAY;
const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Day of week (0 = Monday) and minutes since midnight, in Kampala. */
export function kampalaClock(now: Date): { day: number; minutes: number; date: string } {
  const t = new Date(now.getTime() + KAMPALA_OFFSET_MS);
  return {
    day: (t.getUTCDay() + 6) % 7,
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
    date: t.toISOString().slice(0, 10),
  };
}

export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** Opening ranges as [start, end) minutes from Monday 00:00 (end may pass the week). */
export function weeklyRanges(hours: OpeningHours | null | undefined): [number, number][] {
  const ranges: [number, number][] = [];
  if (!hours || typeof hours !== "object") return ranges;
  DAY_KEYS.forEach((key, day) => {
    for (const range of hours[key] ?? []) {
      if (!Array.isArray(range) || range.length !== 2) continue;
      const open = parseTime(range[0]);
      const close = parseTime(range[1]);
      if (open === null || close === null) continue;
      const start = day * MINUTES_PER_DAY + open;
      const end = day * MINUTES_PER_DAY + close + (close <= open ? MINUTES_PER_DAY : 0);
      ranges.push([start, end]);
    }
  });
  return ranges;
}

export type OpenStatus =
  | { known: false }
  | { known: true; open: true; closesAt: number }
  | { known: true; open: false; opensDay: number; opensAt: number; inMinutes: number };

export function openStatus(hours: OpeningHours | null | undefined, now: Date): OpenStatus {
  const ranges = weeklyRanges(hours);
  if (ranges.length === 0) return { known: false };
  const { day, minutes } = kampalaClock(now);
  const t = day * MINUTES_PER_DAY + minutes;

  for (const [start, end] of ranges) {
    // A Sunday-night range that runs into Monday morning wraps around the week.
    if ((t >= start && t < end) || (t + WEEK >= start && t + WEEK < end)) {
      return { known: true, open: true, closesAt: end % MINUTES_PER_DAY };
    }
  }

  let best = Infinity;
  let bestStart = 0;
  for (const [start] of ranges) {
    let diff = start - t;
    if (diff <= 0) diff += WEEK;
    if (diff < best) {
      best = diff;
      bestStart = start % WEEK;
    }
  }
  return {
    known: true,
    open: false,
    opensDay: Math.floor(bestStart / MINUTES_PER_DAY),
    opensAt: bestStart % MINUTES_PER_DAY,
    inMinutes: best,
  };
}

/** "7am", "10:30pm", "12pm" — how times are usually written in Kampala. */
export function formatClock(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12}${suffix}` : `${h12}:${String(min).padStart(2, "0")}${suffix}`;
}

/** Today's hours as text, e.g. "7am – 10pm" or "" when closed all day. */
export function todaysHours(hours: OpeningHours | null | undefined, now: Date): string {
  const { day } = kampalaClock(now);
  const ranges = hours?.[DAY_KEYS[day]] ?? [];
  return ranges
    .map(([o, c]) => {
      const open = parseTime(o);
      const close = parseTime(c);
      return open === null || close === null ? "" : `${formatClock(open)} – ${formatClock(close)}`;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Checks hours from a form: every day present, each range two valid times,
 * at most three ranges a day. Times are padded ("7:30" -> "07:30").
 */
export function normaliseHours(input: unknown): { ok: true; hours: Record<DayKey, [string, string][]> } | { ok: false } {
  if (!input || typeof input !== "object") return { ok: false };
  const source = input as Record<string, unknown>;
  const hours = {} as Record<DayKey, [string, string][]>;
  for (const day of DAY_KEYS) {
    const ranges = source[day] ?? [];
    if (!Array.isArray(ranges) || ranges.length > 3) return { ok: false };
    hours[day] = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2) return { ok: false };
      const open = typeof range[0] === "string" ? parseTime(range[0]) : null;
      const close = typeof range[1] === "string" ? parseTime(range[1]) : null;
      if (open === null || close === null) return { ok: false };
      hours[day].push([toClock(open), toClock(close)]);
    }
  }
  return { ok: true, hours };
}

function toClock(minutes: number): string {
  const m = minutes % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
