import { formatUGX } from "./money";

/**
 * Cart maths and the WhatsApp order message. Pure functions, shared by the
 * diner page and the tests.
 */
export interface CartAddon {
  id: string;
  name: string;
  price: number;
}

export interface CartLine {
  /** Same item with the same size, add-ons and note = same line. */
  key: string;
  itemId: string;
  name: string;
  sizeId?: string;
  sizeName?: string;
  addons: CartAddon[];
  /** Price of one, including size and add-ons. */
  unitPrice: number;
  qty: number;
  note?: string;
  /** A "Sell it today" discount already in unitPrice, shown as "(-30%)". */
  percentOff?: number;
}

export const MAX_QTY = 99;

export function lineKey(itemId: string, sizeId: string | undefined, addonIds: string[], note: string | undefined): string {
  return [itemId, sizeId ?? "", [...addonIds].sort().join("+"), (note ?? "").trim().toLowerCase()].join("|");
}

/** The size price replaces the base price; add-ons are added on top. */
export function unitPrice(basePrice: number | null, sizePrice: number | undefined, addons: CartAddon[]): number {
  const base = sizePrice ?? basePrice ?? 0;
  return Math.round(base + addons.reduce((sum, a) => sum + a.price, 0));
}

export function lineTotal(line: Pick<CartLine, "unitPrice" | "qty">): number {
  return Math.round(line.unitPrice * line.qty);
}

export function cartTotal(lines: readonly Pick<CartLine, "unitPrice" | "qty">[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

export function cartCount(lines: readonly Pick<CartLine, "qty">[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

/** Adds a line, merging with an identical one. */
export function addLine(lines: readonly CartLine[], line: CartLine): CartLine[] {
  const existing = lines.find((l) => l.key === line.key);
  if (!existing) return [...lines, { ...line, qty: Math.min(MAX_QTY, Math.max(1, line.qty)) }];
  return lines.map((l) => (l.key === line.key ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty) } : l));
}

/** Changes a line's quantity; 0 removes it. */
export function setQty(lines: readonly CartLine[], key: string, qty: number): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, Math.round(qty)) } : l));
}

export type OrderType = "dine_in" | "takeaway" | "delivery";
export type PaymentChoice = "momo" | "cash";
export type OrderMode = "waiter" | "whatsapp" | "kitchen";

export interface OrderDetails {
  type: OrderType;
  /** Table name from the QR link, e.g. "5" or "Garden 1". */
  table?: string;
  name?: string;
  address?: string;
  payment?: PaymentChoice | null;
}

/** Translated words used in the message (from the translation files). */
export interface OrderWords {
  newOrder: string;
  /** Contains {table}. */
  table: string;
  types: Record<OrderType, string>;
  total: string;
  name: string;
  address: string;
  note: string;
  /** Optional so older callers keep working. */
  payment?: string;
  payments?: Record<PaymentChoice, string>;
}

function clean(text: string | undefined, max = 200): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Builds the message, e.g.
 *   New order - Table 5 (dine-in)
 *   2 x Rolex - UGX 10,000
 *     Note: no onions
 *   1 x Passion juice (large) - UGX 5,000
 *   Total: UGX 15,000
 *   Name: Sarah
 */
export function buildOrderMessage(lines: readonly CartLine[], details: OrderDetails, words: OrderWords): string {
  const table = clean(details.table, 40);
  const where = details.type === "dine_in" && table ? ` - ${words.table.replace("{table}", table)}` : "";
  const out = [`${words.newOrder}${where} (${words.types[details.type]})`];

  for (const line of lines) {
    let label = `${line.qty} x ${clean(line.name, 120)}`;
    if (line.sizeName) label += ` (${clean(line.sizeName, 60)})`;
    if (line.addons.length) label += ` + ${line.addons.map((a) => clean(a.name, 60)).join(", ")}`;
    if (line.percentOff) label += ` (-${line.percentOff}%)`;
    out.push(`${label} - ${formatUGX(lineTotal(line))}`);
    const note = clean(line.note);
    if (note) out.push(`  ${words.note}: ${note}`);
  }

  out.push(`${words.total}: ${formatUGX(cartTotal(lines))}`);
  const name = clean(details.name, 80);
  if (name) out.push(`${words.name}: ${name}`);
  const address = clean(details.address, 300);
  if (details.type === "delivery" && address) out.push(`${words.address}: ${address}`);
  if (details.payment && words.payment && words.payments) out.push(`${words.payment}: ${words.payments[details.payment]}`);
  return out.join("\n");
}

/**
 * What the final button does: delivery orders always go on WhatsApp (there
 * is no waiter or table); everything else follows the branch's mode.
 */
export function orderAction(mode: OrderMode, type: OrderType): OrderMode {
  return type === "delivery" ? "whatsapp" : mode;
}

/** The order types a branch offers. Delivery needs WhatsApp (a number, and "Send on WhatsApp" switched on). */
export function orderTypesFor(
  branch: {
    accepts_dine_in: boolean;
    accepts_takeaway: boolean;
    accepts_delivery: boolean;
    whatsapp: string | null;
  },
  whatsappOrders = true,
): OrderType[] {
  const types: OrderType[] = [];
  if (branch.accepts_dine_in) types.push("dine_in");
  if (branch.accepts_takeaway) types.push("takeaway");
  if (branch.accepts_delivery && branch.whatsapp && whatsappOrders) types.push("delivery");
  if (types.length === 0) types.push("dine_in");
  return types;
}

/** The cart as the order API takes it: ids only, never prices. */
export interface OrderLineInput {
  i: string;
  s?: string;
  a?: string[];
  q: number;
  n?: string;
}

export function toOrderLines(lines: readonly CartLine[]): OrderLineInput[] {
  return lines.map((l) => ({
    i: l.itemId,
    ...(l.sizeId ? { s: l.sizeId } : {}),
    ...(l.addons.length ? { a: l.addons.map((a) => a.id) } : {}),
    q: l.qty,
    ...(l.note?.trim() ? { n: l.note.trim().slice(0, 120) } : {}),
  }));
}

/** A random id for an order (or a phone), from the browser's crypto. */
export function randomRef(length = 22): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** "Call the waiter" / "Bring the bill": a short message with the table. */
export function buildTableMessage(template: string, table: string | undefined, fallbackTable: string): string {
  return template.replace("{table}", clean(table, 40) || fallbackTable);
}
