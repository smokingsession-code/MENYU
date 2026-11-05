/**
 * Reads prices the way they appear on Ugandan menus and in owner input:
 * "15k", "15,000/=", "UGX 15,000", "Shs. 15000", "15.000", "1.5k" ...
 *
 * Returns whole shillings plus an `unsure` flag for anything a person should
 * double-check (ranges, two prices, values too small to be real prices).
 */
export interface ParsedPrice {
  value: number | null;
  unsure: boolean;
  reason?: "empty" | "not_a_price" | "range" | "multiple" | "too_small" | "too_large" | "decimal";
  /** A likely correction, e.g. 15 -> 15000 when menus write prices in thousands. */
  suggestion?: number;
}

// Currency words may be glued to the number ("ugx15000"), so no trailing \b.
const CURRENCY = /\b(ugx|ushs?|shs?|sh|ksh|tsh)\.?(?=[\s\d]|$)|\/=|=\/|=|\/-/gi;
/** Below this, a menu price is almost certainly written in thousands. */
const SMALLEST_LIKELY_PRICE = 100;
const LARGEST_LIKELY_PRICE = 10_000_000;

export function parsePrice(input: string | number | null | undefined): ParsedPrice {
  if (input === null || input === undefined) return { value: null, unsure: false, reason: "empty" };
  if (typeof input === "number") return checkRange(input, false);

  let text = input.trim().toLowerCase();
  if (!text || /^(-+|n\/a|free|—)$/.test(text)) return { value: null, unsure: false, reason: "empty" };

  text = text.replace(CURRENCY, " ").replace(/\s+/g, " ").trim();

  // Two numbers: a range ("10,000 - 15,000") or two prices ("15,000/20,000").
  const numbers = text.match(/\d[\d.,\s]*k?/g) ?? [];
  const meaningful = numbers.map((n) => n.trim()).filter((n) => /\d/.test(n));
  if (meaningful.length > 1) {
    const first = parseNumberToken(meaningful[0]);
    const isRange = /\d\s*(-|–|to)\s*\d/.test(text);
    return {
      value: first,
      unsure: true,
      reason: isRange ? "range" : "multiple",
    };
  }
  if (meaningful.length === 0) return { value: null, unsure: true, reason: "not_a_price" };

  const token = meaningful[0];
  const value = parseNumberToken(token);
  if (value === null) return { value: null, unsure: true, reason: "not_a_price" };
  const leftover = text.replace(token, "").trim();
  // "15,000.00" is fine; "1.5" (a real fraction) needs a second look.
  const hadDecimal = !token.endsWith("k") && /[.,]\d{1,2}$/.test(token) && !/[.,]0{1,2}$/.test(token);
  const result = checkRange(value, hadDecimal);
  if (leftover && /[a-z]/.test(leftover)) {
    // e.g. "15,000 per plate" is fine, but flag it so a person sees the note.
    return { ...result, unsure: true };
  }
  return result;
}

/** "15,000" | "15.000" | "15 000" | "15k" | "1.5k" | "2,5k" | "15000.00" */
function parseNumberToken(token: string): number | null {
  let t = token.replace(/\s+/g, "");
  const isK = t.endsWith("k");
  if (isK) t = t.slice(0, -1);
  if (!t) return null;

  if (isK) {
    // In "1.5k" or "2,5k" the separator is a decimal point.
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }

  // Trailing decimals like "15,000.00" or "15.000,00": drop them.
  t = t.replace(/[.,]\d{2}$/, (m) => (/^[.,]00$/.test(m) ? "" : m));

  // Thousands separators: "15,000", "15.000", "1,250,000".
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  if (/^\d+$/.test(t)) return Number(t);

  // Anything else with a separator is a real decimal ("1.5"): keep it whole.
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function checkRange(value: number, hadDecimal: boolean): ParsedPrice {
  if (!Number.isFinite(value) || value < 0) return { value: null, unsure: true, reason: "not_a_price" };
  const whole = Math.round(value);
  if (whole > LARGEST_LIKELY_PRICE) return { value: whole, unsure: true, reason: "too_large" };
  if (whole > 0 && whole < SMALLEST_LIKELY_PRICE) {
    return { value: whole, unsure: true, reason: "too_small", suggestion: whole * 1000 };
  }
  if (hadDecimal) return { value: whole, unsure: true, reason: "decimal" };
  return { value: whole, unsure: false };
}
