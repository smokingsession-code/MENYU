/** Colour helpers so any restaurant colour stays readable. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** White or near-black text, whichever reads better on `background`. */
export function textOn(background: string): "#ffffff" | "#1a1a1a" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#1a1a1a") ? "#ffffff" : "#1a1a1a";
}

/** Mixes the colour with white: amount 0 = colour, 1 = white. */
export function tint(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#ffffff";
  return `#${rgb.map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A version of the brand colour dark enough for text on white (4.5:1).
 * Light brand colours (yellow, pink) are darkened step by step.
 */
export function readableBrand(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#1e5b3a";
  let [r, g, b] = rgb;
  for (let i = 0; i < 20 && contrastRatio(toHex([r, g, b]), "#ffffff") < 4.5; i++) {
    r = Math.round(r * 0.88);
    g = Math.round(g * 0.88);
    b = Math.round(b * 0.88);
  }
  return toHex([r, g, b]);
}

function toHex(rgb: [number, number, number]) {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
