import { parsePrice } from "@/lib/price";
import type { Extraction } from "./schema";

/**
 * The editable review draft built from the AI result. Every field the owner
 * should check carries an `unsure` flag; the review screen highlights them.
 * Nothing in a draft is live until it is published.
 */
export const TAGS = ["popular", "spicy", "vegetarian", "new"] as const;
export type Tag = (typeof TAGS)[number];

export interface DraftOption {
  id: string;
  name: string;
  price: number | null;
  unsure: boolean;
}

export interface DraftItem {
  id: string;
  name: string;
  description: string;
  price: number | null;
  sizes: DraftOption[];
  addons: DraftOption[];
  tags: Tag[];
  unsure: { name: boolean; description: boolean; price: boolean; sizes: boolean };
}

export interface DraftSection {
  id: string;
  name: string;
  items: DraftItem[];
}

export interface ImportDraft {
  version: 1;
  sections: DraftSection[];
}

export const LIMITS = { sections: 60, itemsPerSection: 200, options: 20 } as const;

let fallbackCounter = 0;
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  fallbackCounter += 1;
  return `id-${Date.now().toString(36)}-${fallbackCounter}`;
}

function cleanText(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** ALL-CAPS NAMES from printed menus read better in title case. */
export function tidyName(value: string, max = 120): string {
  const text = cleanText(value, max);
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) {
    return text.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  }
  return text;
}

/**
 * Reads one printed price. When the whole menu is written in thousands
 * ("15" meaning UGX 15,000), small numbers are multiplied and still flagged
 * so the owner confirms them.
 */
export function readPrice(text: string | null, pricesInThousands: boolean): { price: number | null; unsure: boolean } {
  if (text === null || !text.trim()) return { price: null, unsure: false };
  const parsed = parsePrice(text);
  if (parsed.value === null) return { price: null, unsure: true };
  if (parsed.suggestion && pricesInThousands) return { price: parsed.suggestion, unsure: true };
  return { price: parsed.value, unsure: parsed.unsure };
}

export function toDraft(extraction: Extraction): ImportDraft {
  const thousands = extraction.prices_in_thousands;
  const sections: DraftSection[] = [];
  for (const section of extraction.sections.slice(0, LIMITS.sections)) {
    const items: DraftItem[] = [];
    for (const raw of section.items.slice(0, LIMITS.itemsPerSection)) {
      const name = tidyName(raw.name);
      if (!name) continue;
      const option = (o: { name: string; price_text: string }): DraftOption => {
        const p = readPrice(o.price_text, thousands);
        return { id: newId(), name: cleanText(o.name, 60), price: p.price, unsure: p.unsure || p.price === null };
      };
      const sizes = raw.sizes.slice(0, LIMITS.options).map(option).filter((o) => o.name);
      const addons = raw.addons.slice(0, LIMITS.options).map(option).filter((o) => o.name);
      const price = sizes.length ? { price: null, unsure: false } : readPrice(raw.price_text, thousands);
      const flagged = new Set(raw.unsure);
      items.push({
        id: newId(),
        name,
        description: cleanText(raw.description, 300),
        price: price.price,
        sizes,
        addons,
        tags: [...new Set(raw.tags)],
        unsure: {
          name: flagged.has("name"),
          description: flagged.has("description"),
          // A dish with no price at all also needs a look.
          price: flagged.has("price") || price.unsure || (price.price === null && sizes.length === 0),
          sizes: flagged.has("sizes") || sizes.some((s) => s.unsure) || addons.some((a) => a.unsure),
        },
      });
    }
    if (items.length) sections.push({ id: newId(), name: tidyName(section.name, 80) || "Menu", items });
  }
  return { version: 1, sections };
}

/** How many fields the owner still needs to check. */
export function countUnsure(draft: ImportDraft): number {
  let n = 0;
  for (const s of draft.sections) {
    for (const i of s.items) n += Object.values(i.unsure).filter(Boolean).length;
  }
  return n;
}

export function countItems(draft: ImportDraft): number {
  return draft.sections.reduce((n, s) => n + s.items.length, 0);
}

export type DraftProblem =
  | { kind: "empty" }
  | { kind: "section_name"; sectionId: string }
  | { kind: "item_name"; itemId: string }
  | { kind: "option"; itemId: string };

/**
 * What must be fixed before publishing. Unsure fields are only warnings;
 * these are hard stops (things the menu cannot show).
 */
export function publishProblems(draft: ImportDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (countItems(draft) === 0) problems.push({ kind: "empty" });
  for (const s of draft.sections) {
    if (!s.name.trim() && s.items.length) problems.push({ kind: "section_name", sectionId: s.id });
    for (const i of s.items) {
      if (!i.name.trim()) problems.push({ kind: "item_name", itemId: i.id });
      if ([...i.sizes, ...i.addons].some((o) => !o.name.trim() || o.price === null)) problems.push({ kind: "option", itemId: i.id });
    }
  }
  return problems;
}
