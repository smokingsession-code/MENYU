export interface SpecialWindow {
  /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
  days: number[];
  start: string;
  end: string;
  starts_on?: string | null;
  ends_on?: string | null;
}

/**
 * Whether a special (daily deal, happy hour) is on at `nowMs`, in Kampala
 * time (UTC+3, no daylight saving). start = end means all day; end before
 * start runs past midnight, and then the early-morning part belongs to the
 * previous day's special.
 *
 * Deliberately self-contained (no imports or outside names): the diner page
 * also runs it as an inline script, so the right specials are showing before
 * the page first paints and nothing jumps once React starts.
 */
export function specialOnAt(
  days: number[],
  start: string,
  end: string,
  startsOn: string | null,
  endsOn: string | null,
  nowMs: number,
): boolean {
  const minutesOf = (value: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  const clock = (ms: number) => {
    const t = new Date(ms + 3 * 3600 * 1000);
    return { day: ((t.getUTCDay() + 6) % 7) + 1, minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), date: t.toISOString().slice(0, 10) };
  };
  const onDate = (d: string) => (!startsOn || d >= startsOn) && (!endsOn || d <= endsOn);
  const now = clock(nowMs);
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === to) return days.indexOf(now.day) >= 0 && onDate(now.date);
  if (from < to) return days.indexOf(now.day) >= 0 && now.minutes >= from && now.minutes < to && onDate(now.date);
  if (now.minutes >= from) return days.indexOf(now.day) >= 0 && onDate(now.date);
  if (now.minutes < to) {
    const yesterday = clock(nowMs - 86_400_000);
    return days.indexOf(yesterday.day) >= 0 && onDate(yesterday.date);
  }
  return false;
}

export function isSpecialActive(special: SpecialWindow, now: Date): boolean {
  return specialOnAt(special.days, special.start, special.end, special.starts_on ?? null, special.ends_on ?? null, now.getTime());
}

/**
 * The inline script: shows the specials that are on now (by the phone's
 * clock) as soon as the browser reads them, before anything below is drawn.
 * Each special is an element with data-special="[days, start, end, startsOn, endsOn]".
 */
export function specialsScript(containerId: string): string {
  return `(function(){var on=${specialOnAt.toString()};var n=Date.now();var box=document.getElementById(${JSON.stringify(containerId)});if(!box)return;var any=false;box.querySelectorAll("[data-special]").forEach(function(el){var d=JSON.parse(el.getAttribute("data-special"));var a=on(d[0],d[1],d[2],d[3],d[4],n);el.hidden=!a;if(a)any=true;});box.hidden=!any;})();`;
}
