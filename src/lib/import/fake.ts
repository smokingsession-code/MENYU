import "server-only";
import { publicEnv } from "@/lib/env";
import type { ExtractOutcome } from "./extract";
import type { Extraction } from "./schema";

/**
 * A stand-in for the Claude call, for end-to-end tests and local development
 * without an API key. It only switches on next to a local Supabase and
 * never on Vercel, so a stray MENU_IMPORT_FAKE=1 in production does nothing.
 */
export function fakeImportEnabled(): boolean {
  if (process.env.MENU_IMPORT_FAKE !== "1" || process.env.VERCEL) return false;
  try {
    const host = new URL(publicEnv.supabaseUrl).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

const item = (over: Partial<Extraction["sections"][number]["items"][number]> & { name: string }) => ({
  description: null,
  price_text: null,
  sizes: [],
  addons: [],
  tags: [],
  unsure: [],
  ...over,
});

/** A small Kampala café menu covering every case the review screen handles. */
export const FAKE_EXTRACTION: Extraction = {
  readable: true,
  problem: null,
  prices_in_thousands: false,
  sections: [
    {
      name: "BREAKFAST",
      items: [
        item({
          name: "ROLEX",
          description: "Chapati rolled with eggs, tomato and cabbage",
          price_text: "5,000/=",
          addons: [{ name: "Extra egg", price_text: "1,000" }],
          tags: ["popular"],
        }),
        item({ name: "Katogo", price_text: "8k", unsure: ["price"] }),
      ],
    },
    {
      name: "Local dishes",
      items: [
        item({ name: "Luwombo (chicken)", description: "Steamed in banana leaves", price_text: "UGX 25,000" }),
        item({ name: "Malakwang", price_text: null }),
      ],
    },
    {
      name: "Drinks",
      items: [
        item({ name: "Passion juice", sizes: [{ name: "Glass", price_text: "3,000" }, { name: "Jug", price_text: "10,000" }] }),
        item({ name: "Soda", price_text: "2,500" }),
      ],
    },
  ],
};

/**
 * File names steer the outcome so tests can reach the failure screens:
 * "unreadable" in a name gives an unreadable menu, "busy" a busy service.
 */
export async function fakeExtract(fileNames: string[]): Promise<ExtractOutcome> {
  // Long enough for the progress screen to show, like a real read.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  if (fileNames.some((n) => /unreadable/i.test(n))) {
    return { ok: false, code: "unreadable", detail: "The photo is too dark to read.", retryable: false };
  }
  if (fileNames.some((n) => /busy/i.test(n))) return { ok: false, code: "busy", retryable: true };
  return { ok: true, extraction: structuredClone(FAKE_EXTRACTION), model: "fake-menu-reader", usage: {} };
}
