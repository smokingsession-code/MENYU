import { describe, expect, it } from "vitest";
import { dealCss, dealIsOn, dealPrice, dealsByItem, dealsScript, endsAtKampala, DEAL_STYLE_ID } from "./deals";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-09T12:00:00Z");

describe("Sell it today deals", () => {
  it("takes the discount off and rounds to the nearest UGX 100", () => {
    expect(dealPrice(25_000, 30)).toBe(17_500);
    expect(dealPrice(1_500, 10)).toBe(1_400);
    expect(dealPrice(2_350, 30)).toBe(1_600);
    expect(dealPrice(5_000, 50)).toBe(2_500);
    expect(dealPrice(0, 30)).toBe(0);
  });

  it("is on until its end time", () => {
    expect(dealIsOn({ ends_at: "2026-11-09T12:00:01Z" }, NOW)).toBe(true);
    expect(dealIsOn({ ends_at: "2026-11-09T12:00:00Z" }, NOW)).toBe(false);
    expect(dealIsOn({ ends_at: "not a date" }, NOW)).toBe(false);
  });

  it("keeps the biggest discount per dish", () => {
    const map = dealsByItem([
      { item_id: A, percent: 50, ends_at: "x" },
      { item_id: A, percent: 20, ends_at: "x" },
      { item_id: B, percent: 10, ends_at: "x" },
    ]);
    expect([...map.values()].map((d) => d.percent)).toEqual([50, 10]);
  });

  it("writes a style sheet that shows only the deals that are on", () => {
    expect(dealCss([], NOW)).toBe(".dl-on,.dl-card,#menu-deals{display:none}");
    const css = dealCss([[A, NOW + 1], [B, NOW - 1]], NOW);
    expect(css).toContain(`.dl-on[data-dl="${A}"]{display:inline}`);
    expect(css).toContain(`.dl-off[data-dl="${A}"]{display:none}`);
    expect(css).toContain(`.dl-card[data-dl="${A}"]{display:block}`);
    expect(css).not.toContain(B);
    expect(css.endsWith("#menu-deals{display:block}")).toBe(true);
    // Nothing but dish ids can get into the style sheet.
    expect(dealCss([['"]{}body{display:none', NOW + 1]], NOW)).toBe(".dl-on,.dl-card,#menu-deals{display:none}");
  });

  it("the inline script works on its own, before React", () => {
    const head: { id: string; textContent: string }[] = [];
    const document = {
      getElementById: (id: string) => head.find((e) => e.id === id) ?? null,
      createElement: () => ({ id: "", textContent: "" }),
      head: { appendChild: (el: { id: string; textContent: string }) => head.push(el) },
    };
    const script = dealsScript([{ item_id: A, percent: 30, ends_at: new Date(Date.now() + 60_000).toISOString() }]);
    new Function("document", script)(document);
    expect(head).toHaveLength(1);
    expect(head[0].id).toBe(DEAL_STYLE_ID);
    expect(head[0].textContent).toContain(`.dl-on[data-dl="${A}"]{display:inline}`);
  });

  it("works out an end time today in Kampala, or tomorrow when the time has passed", () => {
    const morning = new Date("2026-11-09T06:00:00Z"); // 09:00 in Kampala
    expect(endsAtKampala("21:00", morning)?.toISOString()).toBe("2026-11-09T18:00:00.000Z");
    expect(endsAtKampala("08:00", morning)?.toISOString()).toBe("2026-11-10T05:00:00.000Z");
    expect(endsAtKampala("25:00", morning)).toBeNull();
  });
});
