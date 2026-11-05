/**
 * "1-12, VIP, Garden 1" -> ["1", ..., "12", "VIP", "Garden 1"].
 * Ranges count up or down; duplicates (any case) are dropped.
 */
export const MAX_TABLES_AT_ONCE = 200;

export function parseTableLabels(input: string): { labels: string[]; tooMany: boolean } {
  const labels: string[] = [];
  const seen = new Set<string>();
  const add = (label: string) => {
    const clean = label.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    labels.push(clean);
  };

  for (const part of input.split(/[,;\n]+/)) {
    const range = /^\s*(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})\s*$/i.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Math.abs(b - a) >= MAX_TABLES_AT_ONCE) return { labels: [], tooMany: true };
      const step = a <= b ? 1 : -1;
      for (let n = a; n !== b + step; n += step) add(String(n));
    } else {
      add(part);
    }
    if (labels.length > MAX_TABLES_AT_ONCE) return { labels: [], tooMany: true };
  }
  return { labels, tooMany: false };
}
