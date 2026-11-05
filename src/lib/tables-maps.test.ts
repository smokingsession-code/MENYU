import { describe, expect, it } from "vitest";
import { normaliseHours } from "./hours";
import { parseMapPosition } from "./maps";
import { parseTableLabels } from "./tables";

describe("parseTableLabels", () => {
  it("expands ranges and keeps names", () => {
    expect(parseTableLabels("1-4, VIP, Garden 1").labels).toEqual(["1", "2", "3", "4", "VIP", "Garden 1"]);
    expect(parseTableLabels("3 to 1").labels).toEqual(["3", "2", "1"]);
    expect(parseTableLabels("10–12\nBar").labels).toEqual(["10", "11", "12", "Bar"]);
  });

  it("drops blanks and duplicates, ignoring case", () => {
    expect(parseTableLabels(" , vip, VIP , 1, 1-2 ").labels).toEqual(["vip", "1", "2"]);
  });

  it("refuses huge ranges", () => {
    expect(parseTableLabels("1-500")).toEqual({ labels: [], tooMany: true });
  });
});

describe("parseMapPosition", () => {
  it.each([
    ["https://www.google.com/maps/place/Kijani/@0.3536,32.6121,17z/data=!3m1", { lat: 0.3536, lng: 32.6121 }],
    ["https://www.google.com/maps/place/X/@0.30,32.50,17z/data=!3d0.3536121!4d32.6121987", { lat: 0.353612, lng: 32.612199 }],
    ["https://maps.google.com/?q=0.3536,32.6121", { lat: 0.3536, lng: 32.6121 }],
    ["https://www.google.com/maps/search/?api=1&query=0.3536%2C32.6121", { lat: 0.3536, lng: 32.6121 }],
    ["0.3536, 32.6121", { lat: 0.3536, lng: 32.6121 }],
    ["-1.2921,36.8219", { lat: -1.2921, lng: 36.8219 }],
  ])("reads %s", (input, expected) => {
    expect(parseMapPosition(input)).toEqual(expected);
  });

  it.each(["https://maps.app.goo.gl/abc123", "Ntinda", "", "95, 200"])("returns null for %s", (input) => {
    expect(parseMapPosition(input)).toBeNull();
  });
});

describe("normaliseHours", () => {
  it("keeps valid ranges, including past midnight", () => {
    expect(normaliseHours({ mon: [["07:00", "22:00"]], fri: [["17:00", "02:00"]], sun: [] })).toEqual({
      ok: true,
      hours: { mon: [["07:00", "22:00"]], tue: [], wed: [], thu: [], fri: [["17:00", "02:00"]], sat: [], sun: [] },
    });
  });

  it("pads single-digit hours and rejects bad times", () => {
    expect(normaliseHours({ tue: [["7:30", "9:00"]] })).toMatchObject({ ok: true, hours: { tue: [["07:30", "09:00"]] } });
    expect(normaliseHours({ mon: [["07:00", ""]] })).toEqual({ ok: false });
    expect(normaliseHours({ mon: [["25:00", "22:00"]] })).toEqual({ ok: false });
    expect(normaliseHours({ mon: "07:00" } as never)).toEqual({ ok: false });
  });

  it("allows at most three ranges a day", () => {
    const four = Array.from({ length: 4 }, () => ["08:00", "09:00"]) as [string, string][];
    expect(normaliseHours({ mon: four })).toEqual({ ok: false });
  });
});
