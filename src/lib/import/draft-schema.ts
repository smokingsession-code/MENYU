import { z } from "zod";
import { LIMITS, TAGS } from "./draft";

/**
 * Shape check for drafts coming back from the browser (autosave and
 * publish). Kept apart from draft.ts so the review screen does not ship zod.
 */
const optionZ = z.object({
  id: z.string().max(64),
  name: z.string().max(60),
  price: z.number().int().min(0).max(100_000_000).nullable(),
  unsure: z.boolean(),
});

export const draftZ = z.object({
  version: z.literal(1),
  sections: z
    .array(
      z.object({
        id: z.string().max(64),
        name: z.string().max(80),
        items: z
          .array(
            z.object({
              id: z.string().max(64),
              name: z.string().max(120),
              description: z.string().max(300),
              price: z.number().int().min(0).max(100_000_000).nullable(),
              sizes: z.array(optionZ).max(LIMITS.options),
              addons: z.array(optionZ).max(LIMITS.options),
              tags: z.array(z.enum(TAGS)).max(4),
              unsure: z.object({ name: z.boolean(), description: z.boolean(), price: z.boolean(), sizes: z.boolean() }),
            }),
          )
          .max(LIMITS.itemsPerSection),
      }),
    )
    .max(LIMITS.sections),
});
