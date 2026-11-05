import { z } from "zod";

/**
 * What the AI returns for a photographed menu. Prices are copied exactly as
 * printed ("15k", "15,000/=") and converted by our own tested parser, so the
 * model never does arithmetic on money.
 */
const TAGS = ["popular", "spicy", "vegetarian", "new"] as const;
const UNSURE = ["name", "description", "price", "sizes"] as const;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

const optionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "price_text"],
  properties: {
    name: { type: "string", description: "Size or add-on name as printed, e.g. Large, Half, Extra egg" },
    price_text: { type: "string", description: "Price exactly as printed for this size or add-on" },
  },
};

/** JSON Schema for structured outputs (every object closed, every field required). */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "problem", "prices_in_thousands", "sections"],
  properties: {
    readable: { type: "boolean", description: "False when the images are not a menu or cannot be read at all" },
    problem: { ...nullableString, description: "Short reason when something could not be read; null otherwise" },
    prices_in_thousands: {
      type: "boolean",
      description: "True when the menu writes prices in thousands of shillings (e.g. 15 meaning UGX 15,000)",
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "items"],
        properties: {
          name: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "description", "price_text", "sizes", "addons", "tags", "unsure"],
              properties: {
                name: { type: "string" },
                description: nullableString,
                price_text: { ...nullableString, description: "Price exactly as printed; null when priced by size or not shown" },
                sizes: { type: "array", items: optionSchema },
                addons: { type: "array", items: optionSchema },
                tags: { type: "array", items: { type: "string", enum: TAGS } },
                unsure: { type: "array", items: { type: "string", enum: UNSURE } },
              },
            },
          },
        },
      },
    },
  },
} as const;

const optionZ = z.object({ name: z.string(), price_text: z.string() });

/** Validates the response again on our side (never trust, always check). */
export const extractionZ = z.object({
  readable: z.boolean(),
  problem: z.string().nullable(),
  prices_in_thousands: z.boolean(),
  sections: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          description: z.string().nullable(),
          price_text: z.string().nullable(),
          sizes: z.array(optionZ),
          addons: z.array(optionZ),
          tags: z.array(z.enum(TAGS)),
          unsure: z.array(z.enum(UNSURE)),
        }),
      ),
    }),
  ),
});

export type Extraction = z.infer<typeof extractionZ>;
