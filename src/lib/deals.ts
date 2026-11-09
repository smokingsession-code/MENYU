/**
 * "Sell it today" deals: a discount on one dish until a time today.
 *
 * Whether a deal is on depends on the clock, and the menu page is cached
 * for everyone. So the page never decides it while rendering: every price
 * is sent both ways, and a small style sheet (written by an inline script
 * before the dishes are drawn, then every half minute) shows the right one.
 * Nothing moves when React starts and nothing differs between server and
 * browser.
 */

export interface DealLike {
  item_id: string;
  percent: number;
  ends_at: string;
}

/** The discounted price, rounded to the nearest UGX 100. Must match private.deal_price(). */
export function dealPrice(price: number, percent: number): number {
  return Math.round((price * (100 - percent)) / 10000) * 100;
}

/** A deal is on until its end time. */
export function dealIsOn(deal: Pick<DealLike, "ends_at">, nowMs: number): boolean {
  const end = Date.parse(deal.ends_at);
  return Number.isFinite(end) && end > nowMs;
}

/** The biggest discount per dish (the menu sends them biggest first). */
export function dealsByItem<T extends DealLike>(deals: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const deal of deals) if (!map.has(deal.item_id)) map.set(deal.item_id, deal);
  return map;
}

/**
 * The style sheet for the deals that are on at `now`. Elements carry
 * data-dl="<dish id>" and one of the classes:
 *   dl-on   shown only during the deal (the discounted price)
 *   dl-off  hidden during the deal (the normal price)
 *   dl-card the dish's card in the "Today only" list
 * and the list itself is #menu-deals.
 *
 * Deliberately self-contained (no imports or outside names): it also runs
 * as an inline script.
 */
export function dealCss(deals: [string, number][], now: number): string {
  let css = ".dl-on,.dl-card,#menu-deals{display:none}";
  let any = false;
  for (const [id, ends] of deals) {
    if (ends > now && /^[0-9a-f-]{36}$/i.test(id)) {
      any = true;
      const sel = '[data-dl="' + id + '"]';
      css += ".dl-on" + sel + "{display:inline}.dl-off" + sel + "{display:none}.dl-card" + sel + "{display:block}";
    }
  }
  if (any) css += "#menu-deals{display:block}";
  return css;
}

export const DEAL_STYLE_ID = "menu-deal-css";

/** [dish id, end time in ms] for each deal. */
export function dealTimes(deals: readonly DealLike[]): [string, number][] {
  return deals.map((d) => [d.item_id, Date.parse(d.ends_at)]);
}

/** The inline script: writes the style sheet before the dishes are drawn. */
export function dealsScript(deals: readonly DealLike[]): string {
  const data = JSON.stringify(dealTimes(deals)).replace(/</g, "\\u003c");
  return `(function(){var css=${dealCss.toString()};var s=document.getElementById(${JSON.stringify(DEAL_STYLE_ID)});if(!s){s=document.createElement("style");s.id=${JSON.stringify(DEAL_STYLE_ID)};document.head.appendChild(s);}s.textContent=css(${data},Date.now());})();`;
}

/** Rewrites the style sheet (the page calls this every half minute). */
export function applyDealCss(deals: readonly DealLike[], now: number) {
  let style = document.getElementById(DEAL_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = DEAL_STYLE_ID;
    document.head.appendChild(style);
  }
  const css = dealCss(dealTimes(deals), now);
  if (style.textContent !== css) style.textContent = css;
}

/** Ends at the given Kampala wall-clock time today (or tomorrow if it has passed). */
export function endsAtKampala(time: string, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  const local = new Date(now.getTime() + 3 * 3_600_000);
  let end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hours, minutes) - 3 * 3_600_000;
  if (end <= now.getTime()) end += 86_400_000;
  return new Date(end);
}
