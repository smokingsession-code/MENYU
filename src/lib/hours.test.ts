import { describe, expect, it } from "vitest";
import { formatClock, kampalaClock, openStatus, todaysHours, type OpeningHours } from "./hours";
import { isSpecialActive, specialOnAt, specialsScript } from "./specials";

/** A Kampala wall-clock time as a Date (Kampala is UTC+3). */
function kampala(iso: string): Date {
  return new Date(`${iso}+03:00`);
}

// 2026-11-02 is a Monday.
const cafe: OpeningHours = {
  mon: [["07:00", "22:00"]],
  tue: [["07:00", "22:00"]],
  wed: [["07:00", "22:00"]],
  thu: [["07:00", "22:00"]],
  fri: [["07:00", "22:00"]],
  sat: [["08:00", "23:00"]],
  sun: [],
};

const lounge: OpeningHours = {
  fri: [["17:00", "02:00"]],
  sat: [["17:00", "02:00"]],
  sun: [["17:00", "01:00"]],
};

describe("kampalaClock", () => {
  it("uses Kampala time whatever the server's timezone", () => {
    expect(kampalaClock(new Date("2026-11-02T21:30:00Z"))).toEqual({ day: 1, minutes: 30, date: "2026-11-03" });
  });
});

describe("openStatus", () => {
  it("is open during the day", () => {
    expect(openStatus(cafe, kampala("2026-11-02T12:00:00"))).toEqual({ known: true, open: true, closesAt: 22 * 60 });
  });

  it("is closed at closing time and says when it opens", () => {
    expect(openStatus(cafe, kampala("2026-11-02T22:00:00"))).toMatchObject({ open: false, opensDay: 1, opensAt: 7 * 60 });
  });

  it("skips closed days", () => {
    // Saturday night after closing; Sunday is closed, so it opens Monday 7am.
    expect(openStatus(cafe, kampala("2026-11-07T23:30:00"))).toMatchObject({ open: false, opensDay: 0, opensAt: 7 * 60 });
  });

  it("handles bars that close after midnight", () => {
    expect(openStatus(lounge, kampala("2026-11-07T01:00:00"))).toMatchObject({ open: true, closesAt: 120 }); // Sat 1am, Friday's night
    expect(openStatus(lounge, kampala("2026-11-07T03:00:00"))).toMatchObject({ open: false, opensDay: 5, opensAt: 17 * 60 });
  });

  it("handles a Sunday night that runs into Monday", () => {
    expect(openStatus(lounge, kampala("2026-11-09T00:30:00"))).toMatchObject({ open: true, closesAt: 60 });
    expect(openStatus(lounge, kampala("2026-11-09T01:30:00"))).toMatchObject({ open: false, opensDay: 4 });
  });

  it("is unknown without hours", () => {
    expect(openStatus({}, new Date())).toEqual({ known: false });
    expect(openStatus(null, new Date())).toEqual({ known: false });
    expect(openStatus({ mon: [["bad", "22:00"]] }, new Date())).toEqual({ known: false });
  });

  it("treats a same open and close time as 24 hours", () => {
    expect(openStatus({ mon: [["00:00", "00:00"]] }, kampala("2026-11-02T23:59:00"))).toMatchObject({ open: true });
  });
});

describe("formatting", () => {
  it("writes times the Kampala way", () => {
    expect(formatClock(7 * 60)).toBe("7am");
    expect(formatClock(22 * 60 + 30)).toBe("10:30pm");
    expect(formatClock(12 * 60)).toBe("12pm");
    expect(formatClock(0)).toBe("12am");
    expect(formatClock(1440 + 60)).toBe("1am");
  });

  it("shows today's hours", () => {
    expect(todaysHours(cafe, kampala("2026-11-02T10:00:00"))).toBe("7am – 10pm");
    expect(todaysHours(cafe, kampala("2026-11-08T10:00:00"))).toBe("");
  });
});

describe("isSpecialActive", () => {
  const breakfast = { days: [1, 2, 3, 4, 5], start: "07:00", end: "10:00" };
  const happyHour = { days: [5, 6], start: "22:00", end: "02:00" };

  it("is on only inside its days and times", () => {
    expect(isSpecialActive(breakfast, kampala("2026-11-02T08:00:00"))).toBe(true);
    expect(isSpecialActive(breakfast, kampala("2026-11-02T10:00:00"))).toBe(false);
    expect(isSpecialActive(breakfast, kampala("2026-11-07T08:00:00"))).toBe(false); // Saturday
  });

  it("runs past midnight into the next day", () => {
    expect(isSpecialActive(happyHour, kampala("2026-11-06T23:00:00"))).toBe(true); // Fri 11pm
    expect(isSpecialActive(happyHour, kampala("2026-11-07T01:00:00"))).toBe(true); // Sat 1am (Friday's)
    expect(isSpecialActive(happyHour, kampala("2026-11-09T01:00:00"))).toBe(false); // Mon 1am (Sunday has none)
  });

  it("respects start and end dates", () => {
    const limited = { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "00:00", starts_on: "2026-11-03", ends_on: "2026-11-04" };
    expect(isSpecialActive(limited, kampala("2026-11-02T12:00:00"))).toBe(false);
    expect(isSpecialActive(limited, kampala("2026-11-03T12:00:00"))).toBe(true);
    expect(isSpecialActive(limited, kampala("2026-11-05T12:00:00"))).toBe(false);
  });
});

describe("specialOnAt as an inline script", () => {
  it("is self-contained, so it works the same when turned into text and run on the phone", () => {
    const copy = new Function(`return ${specialOnAt.toString()}`)() as typeof specialOnAt;
    const at = (local: string) => new Date(`${local}+03:00`).getTime();
    const cases: [number[], string, string, number][] = [
      [[1, 2, 3, 4, 5], "07:00", "10:00", at("2026-11-02T08:00:00")],
      [[1, 2, 3, 4, 5], "07:00", "10:00", at("2026-11-07T08:00:00")],
      [[5, 6], "22:00", "02:00", at("2026-11-07T01:00:00")],
      [[1], "00:00", "00:00", at("2026-11-02T23:59:00")],
    ];
    for (const [days, start, end, now] of cases) {
      expect(copy(days, start, end, null, null, now)).toBe(specialOnAt(days, start, end, null, null, now));
    }
    expect(() => new Function(specialsScript("menu-specials"))).not.toThrow();
  });
});
