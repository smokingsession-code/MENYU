/**
 * Prices are whole Ugandan shillings. Displayed as "UGX 15,000".
 * Formatting is done by hand (not Intl) so server and browser always agree.
 */
export function groupThousands(value: number): string {
  const whole = Math.round(Math.abs(value));
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUGX(amount: number): string {
  if (!Number.isFinite(amount)) return "UGX 0";
  const sign = amount < 0 ? "-" : "";
  return `${sign}UGX ${groupThousands(amount)}`;
}

/** Sum of line totals, always a whole number. */
export function sumUGX(values: readonly number[]): number {
  return values.reduce((total, v) => total + Math.round(v), 0);
}

/**
 * Applies a percentage change and rounds to a friendly step, the way
 * restaurants price things (UGX 5,500 rather than 5,523).
 */
export function adjustPrice(price: number, percent: number, roundTo = 500): number {
  const raw = price * (1 + percent / 100);
  if (roundTo <= 1) return Math.max(0, Math.round(raw));
  return Math.max(0, Math.round(raw / roundTo) * roundTo);
}
