import { describe, expect, it } from "vitest";
import {
  addLine,
  buildOrderMessage,
  buildTableMessage,
  cartCount,
  cartTotal,
  lineKey,
  orderAction,
  orderTypesFor,
  randomRef,
  setQty,
  toOrderLines,
  unitPrice,
  type CartLine,
  type OrderWords,
} from "./order";

const words: OrderWords = {
  newOrder: "New order",
  table: "Table {table}",
  types: { dine_in: "dine-in", takeaway: "takeaway", delivery: "delivery" },
  total: "Total",
  name: "Name",
  address: "Address",
  note: "Note",
};

function line(partial: Partial<CartLine> & Pick<CartLine, "name" | "unitPrice" | "qty">): CartLine {
  return { key: partial.name, itemId: partial.name, addons: [], ...partial };
}

describe("buildOrderMessage", () => {
  it("matches the example in the spec", () => {
    const message = buildOrderMessage(
      [
        line({ name: "Rolex", unitPrice: 5000, qty: 2, note: "no onions" }),
        line({ name: "Passion juice", sizeName: "large", unitPrice: 5000, qty: 1 }),
      ],
      { type: "dine_in", table: "5", name: "Sarah" },
      words,
    );
    expect(message).toBe(
      [
        "New order - Table 5 (dine-in)",
        "2 x Rolex - UGX 10,000",
        "  Note: no onions",
        "1 x Passion juice (large) - UGX 5,000",
        "Total: UGX 15,000",
        "Name: Sarah",
      ].join("\n"),
    );
  });

  it("lists add-ons and leaves out the table for takeaway", () => {
    const message = buildOrderMessage(
      [line({ name: "Rolex", unitPrice: 7000, qty: 1, addons: [{ id: "a", name: "Extra egg", price: 1000 }, { id: "b", name: "Cheese", price: 2000 }] })],
      { type: "takeaway", table: "5" },
      words,
    );
    expect(message).toBe(["New order (takeaway)", "1 x Rolex + Extra egg, Cheese - UGX 7,000", "Total: UGX 7,000"].join("\n"));
  });

  it("adds the address for delivery only", () => {
    const delivery = buildOrderMessage([line({ name: "Chips", unitPrice: 4000, qty: 1 })], { type: "delivery", address: "Plot 4,  Ntinda Road", name: "Sam" }, words);
    expect(delivery).toContain("New order (delivery)");
    expect(delivery.endsWith("Name: Sam\nAddress: Plot 4, Ntinda Road")).toBe(true);
    const dineIn = buildOrderMessage([line({ name: "Chips", unitPrice: 4000, qty: 1 })], { type: "dine_in", address: "Plot 4" }, words);
    expect(dineIn).not.toContain("Address");
  });

  it("works without a table (restaurant-wide QR code)", () => {
    const message = buildOrderMessage([line({ name: "Tea", unitPrice: 3000, qty: 1 })], { type: "dine_in" }, words);
    expect(message.split("\n")[0]).toBe("New order (dine-in)");
  });

  it("keeps each line on one row even if a note has new lines", () => {
    const message = buildOrderMessage([line({ name: "Rolex", unitPrice: 5000, qty: 1, note: "no\nonions\n\nplease" })], { type: "takeaway" }, words);
    expect(message).toContain("  Note: no onions please");
  });
});

describe("cart maths", () => {
  it("uses the size price instead of the base price and adds add-ons", () => {
    expect(unitPrice(5000, undefined, [])).toBe(5000);
    expect(unitPrice(null, 6000, [])).toBe(6000);
    expect(unitPrice(5000, 6000, [{ id: "a", name: "Egg", price: 1000 }])).toBe(7000);
    expect(unitPrice(null, undefined, [])).toBe(0);
  });

  it("merges identical lines and keeps different notes apart", () => {
    const a = line({ name: "Rolex", unitPrice: 5000, qty: 1, key: lineKey("rolex", undefined, [], "") });
    const b = line({ name: "Rolex", unitPrice: 5000, qty: 2, key: lineKey("rolex", undefined, [], "") });
    const c = line({ name: "Rolex", unitPrice: 5000, qty: 1, key: lineKey("rolex", undefined, [], "No onions") });
    let cart = addLine([], a);
    cart = addLine(cart, b);
    cart = addLine(cart, c);
    expect(cart).toHaveLength(2);
    expect(cart[0].qty).toBe(3);
    expect(cartCount(cart)).toBe(4);
    expect(cartTotal(cart)).toBe(20000);
  });

  it("treats add-ons in any order as the same line", () => {
    expect(lineKey("x", "s", ["b", "a"], "")).toBe(lineKey("x", "s", ["a", "b"], ""));
  });

  it("changes and removes quantities", () => {
    const cart = [line({ name: "Tea", unitPrice: 3000, qty: 2, key: "t" })];
    expect(setQty(cart, "t", 5)[0].qty).toBe(5);
    expect(setQty(cart, "t", 0)).toEqual([]);
    expect(setQty(cart, "t", 500)[0].qty).toBe(99);
  });

  it("builds waiter and bill messages with the table", () => {
    expect(buildTableMessage("Table {table}: please bring the bill.", "Garden 1", "?")).toBe("Table Garden 1: please bring the bill.");
    expect(buildTableMessage("Table {table}: please come.", undefined, "(no table)")).toBe("Table (no table): please come.");
  });
});

describe("ordering modes and payment", () => {
  it("adds the deal and how the diner will pay to the message", () => {
    const message = buildOrderMessage(
      [line({ name: "Tilapia", unitPrice: 17_500, qty: 1, percentOff: 30 })],
      { type: "dine_in", table: "5", payment: "cash" },
      { ...words, payment: "Payment", payments: { momo: "Mobile Money", cash: "Cash" } },
    );
    expect(message).toBe("New order - Table 5 (dine-in)\n1 x Tilapia (-30%) - UGX 17,500\nTotal: UGX 17,500\nPayment: Cash");
  });

  it("sends delivery on WhatsApp and everything else the branch's way", () => {
    expect(orderAction("waiter", "dine_in")).toBe("waiter");
    expect(orderAction("kitchen", "takeaway")).toBe("kitchen");
    expect(orderAction("kitchen", "delivery")).toBe("whatsapp");
    expect(orderAction("whatsapp", "dine_in")).toBe("whatsapp");
  });

  it("only offers delivery with a WhatsApp number", () => {
    const branch = { accepts_dine_in: true, accepts_takeaway: false, accepts_delivery: true, whatsapp: null };
    expect(orderTypesFor(branch)).toEqual(["dine_in"]);
    expect(orderTypesFor({ ...branch, whatsapp: "256772000111" })).toEqual(["dine_in", "delivery"]);
    expect(orderTypesFor({ ...branch, accepts_dine_in: false, accepts_delivery: false })).toEqual(["dine_in"]);
  });

  it("sends the order API ids and quantities, never prices", () => {
    const lines = toOrderLines([
      { key: "a", itemId: "rolex", name: "Rolex", addons: [{ id: "avo", name: "Avocado", price: 1000 }], unitPrice: 6000, qty: 2, note: " no onions " },
      { key: "b", itemId: "special:x", name: "Lunch deal", addons: [], unitPrice: 9000, qty: 1, sizeId: undefined },
    ]);
    expect(lines).toEqual([
      { i: "rolex", a: ["avo"], q: 2, n: "no onions" },
      { i: "special:x", q: 1 },
    ]);
  });

  it("makes random refs the API accepts", () => {
    const ref = randomRef();
    expect(ref).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(randomRef()).not.toBe(ref);
  });
});
