import { describe, expect, it } from "vitest";
import { countItems, countUnsure, publishProblems, readPrice, tidyName, toDraft } from "./draft";
import { draftZ } from "./draft-schema";
import { extractionZ, type Extraction } from "./schema";

function extraction(partial: Partial<Extraction>): Extraction {
  return { readable: true, problem: null, prices_in_thousands: false, sections: [], ...partial };
}

const item = (over: Partial<Extraction["sections"][number]["items"][number]>) => ({
  name: "Rolex",
  description: null,
  price_text: "5,000",
  sizes: [],
  addons: [],
  tags: [],
  unsure: [],
  ...over,
});

describe("readPrice", () => {
  it("reads the usual ways prices are printed", () => {
    expect(readPrice("15k", false)).toEqual({ price: 15000, unsure: false });
    expect(readPrice("15,000/=", false)).toEqual({ price: 15000, unsure: false });
    expect(readPrice("15000", false)).toEqual({ price: 15000, unsure: false });
    expect(readPrice(null, false)).toEqual({ price: null, unsure: false });
  });

  it("multiplies menus written in thousands, but still asks the owner to check", () => {
    expect(readPrice("15", true)).toEqual({ price: 15000, unsure: true });
    expect(readPrice("15", false)).toEqual({ price: 15, unsure: true });
  });

  it("flags text that is not a price", () => {
    expect(readPrice("ask waiter", false)).toEqual({ price: null, unsure: true });
  });
});

describe("toDraft", () => {
  it("turns the AI result into sections and dishes with parsed prices", () => {
    const draft = toDraft(
      extraction({
        sections: [
          {
            name: "BREAKFAST",
            items: [
              item({ name: "ROLEX", price_text: "5k", addons: [{ name: "Extra egg", price_text: "1,000/=" }], tags: ["popular"] }),
              item({ name: "Passion juice", price_text: null, sizes: [{ name: "Small", price_text: "4k" }, { name: "Large", price_text: "6,000" }] }),
            ],
          },
        ],
      }),
    );
    expect(countItems(draft)).toBe(2);
    expect(draft.sections[0].name).toBe("Breakfast");
    const [rolex, juice] = draft.sections[0].items;
    expect(rolex).toMatchObject({ name: "Rolex", price: 5000, tags: ["popular"] });
    expect(rolex.addons[0]).toMatchObject({ name: "Extra egg", price: 1000, unsure: false });
    expect(juice.price).toBeNull();
    expect(juice.sizes.map((s) => s.price)).toEqual([4000, 6000]);
    expect(juice.unsure.price).toBe(false);
    expect(countUnsure(draft)).toBe(0);
  });

  it("highlights what the AI or the price parser was unsure about", () => {
    const draft = toDraft(
      extraction({
        sections: [
          {
            name: "Grills",
            items: [
              item({ name: "Pork", price_text: "10,000 - 15,000", unsure: ["name"] }),
              item({ name: "Goat", price_text: null }),
              item({ name: "Fish", sizes: [{ name: "Whole", price_text: "?" }] }),
            ],
          },
        ],
      }),
    );
    const [pork, goat, fish] = draft.sections[0].items;
    expect(pork.unsure).toMatchObject({ name: true, price: true });
    expect(pork.price).toBe(10000);
    expect(goat.unsure.price).toBe(true); // no price at all
    expect(fish.unsure.sizes).toBe(true);
    expect(countUnsure(draft)).toBe(4);
  });

  it("drops nameless dishes and empty sections, and names unnamed sections", () => {
    const draft = toDraft(extraction({ sections: [{ name: "", items: [item({ name: "  " }), item({ name: "Chapati" })] }, { name: "Empty", items: [] }] }));
    expect(draft.sections).toHaveLength(1);
    expect(draft.sections[0].name).toBe("Menu");
    expect(draft.sections[0].items.map((i) => i.name)).toEqual(["Chapati"]);
  });

  it("produces drafts that pass the browser-side shape check", () => {
    const draft = toDraft(extraction({ sections: [{ name: "Drinks", items: [item({ name: "Soda", price_text: "2,500" })] }] }));
    expect(draftZ.safeParse(draft).success).toBe(true);
  });
});

describe("publishProblems", () => {
  it("blocks empty drafts, nameless dishes and sizes without prices", () => {
    expect(publishProblems({ version: 1, sections: [] })).toEqual([{ kind: "empty" }]);
    const draft = toDraft(extraction({ sections: [{ name: "Mains", items: [item({ name: "Stew" })] }] }));
    draft.sections[0].items[0].name = " ";
    draft.sections[0].items[0].sizes = [{ id: "s", name: "Large", price: null, unsure: true }];
    expect(publishProblems(draft).map((p) => p.kind)).toEqual(["item_name", "option"]);
  });

  it("allows dishes without a price (some menus say 'ask the waiter')", () => {
    const draft = toDraft(extraction({ sections: [{ name: "Mains", items: [item({ price_text: null })] }] }));
    expect(publishProblems(draft)).toEqual([]);
  });
});

describe("tidyName", () => {
  it("title-cases shouted names and leaves normal ones alone", () => {
    expect(tidyName("CHIPS AND CHICKEN")).toBe("Chips And Chicken");
    expect(tidyName("Rolex (2 eggs)")).toBe("Rolex (2 eggs)");
    expect(tidyName("BBQ")).toBe("BBQ");
  });
});

describe("extraction schema", () => {
  it("rejects responses that do not match", () => {
    expect(extractionZ.safeParse({ readable: true }).success).toBe(false);
    expect(extractionZ.safeParse(extraction({})).success).toBe(true);
  });
});
