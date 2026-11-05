import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_JSON_SCHEMA, extractionZ, type Extraction } from "./schema";

/**
 * Reads menu photos and PDFs with Claude (vision) and returns structured
 * sections and dishes. Runs on the server only: the API key never reaches the
 * browser.
 */
export const IMPORT_MODEL = process.env.MENU_IMPORT_MODEL || "claude-opus-5-5";
// Medium is the model's default: reading a menu is mostly careful copying,
// and the owner is waiting on screen. Raise it with MENU_IMPORT_EFFORT.
const EFFORT = (process.env.MENU_IMPORT_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "medium";

export const SYSTEM_PROMPT = `You read photos and PDFs of restaurant, café, bar and lounge menus from Uganda and turn them into structured data for a digital menu. The restaurant owner reviews everything you return before it goes live, so mark anything you are not sure about instead of guessing.

How to read the menu:
- Copy dish names as they are written, including local names (Rolex, Katogo, Luwombo, Kikomando, Matooke, Gonja, Nsenene, Malakwang). Do not translate them or add words. Fix only letter case when a name is written in capitals.
- Group dishes under the sections the menu shows (for example Breakfast, Local dishes, Grills, Drinks). If the menu has no sections, use a single section named "Menu". Keep sections and dishes in the order they appear.
- price_text: copy the price exactly as printed, such as "15k", "15,000/=", "UGX 15,000", "Shs 15000" or "15". Do not convert, add up or round prices. Use null when no price is shown for the dish.
- When one dish has several prices for different sizes or portions (Small/Large, Half/Full, Glass/Bottle, 1/4 kg, Single/Double), put each one in sizes with its own price_text and set price_text to null.
- Extras that cost something on top of the dish ("+ egg 1,000", "Extra cheese 2,000", "add avocado 1,000") go in addons.
- description: only what the menu itself says about the dish. Use null when it says nothing. Never invent descriptions.
- tags: only when the menu marks the dish that way (a chilli sign means spicy, a V or leaf sign means vegetarian, "new" means new, "bestseller", "chef's special" or a star means popular). Otherwise an empty list.
- unsure: list each field you could not read with confidence because of blur, glare, folds, handwriting or a cut-off edge: "name", "description", "price" or "sizes".
- prices_in_thousands: true only when the menu clearly writes prices in thousands of shillings, for example every price is a small number like 5, 12 or 25.
- If several images are pages of the same menu, combine them in page order. When two photos overlap, list each dish only once.
- Ignore anything that is not a dish or drink: phone numbers, addresses, opening hours, Wi-Fi passwords, slogans and notes about service charges.
- Set readable to false only when the images are not a menu at all or nothing can be read; then explain why in problem and return no sections. When only part of the menu can be read, return what you can, mark the rest unsure and describe what is missing in problem.`;

const USER_PROMPT = "Read this menu and return every dish and drink on it.";

export type ImportFile = { mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; data: Buffer };

export type ExtractFailure =
  | "not_configured"
  | "unreadable"
  | "refused"
  | "too_long"
  | "too_large"
  | "busy"
  | "too_slow"
  | "rejected"
  | "failed";

export type ExtractOutcome =
  | { ok: true; extraction: Extraction; model: string; usage: Record<string, unknown> }
  | { ok: false; code: ExtractFailure; detail?: string; retryable: boolean };

/** A request body larger than this is refused by the API (32 MB). Base64 adds a third. */
const MAX_TOTAL_BYTES = 22 * 1024 * 1024;

function contentFor(files: ImportFile[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = files.map((file) =>
    file.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: file.mime, data: file.data.toString("base64") } },
  );
  blocks.push({ type: "text", text: USER_PROMPT });
  return blocks;
}

/**
 * `signal` bounds the whole call. The SDK's own timeout only covers the wait
 * for response headers, not the stream that follows, and the serverless
 * function is stopped at its time limit without a chance to record why.
 */
export async function extractMenu(
  files: ImportFile[],
  options: { client?: Anthropic; signal?: AbortSignal } = {},
): Promise<ExtractOutcome> {
  if (files.length === 0) return { ok: false, code: "unreadable", retryable: false };
  if (files.reduce((n, f) => n + f.data.length, 0) > MAX_TOTAL_BYTES) return { ok: false, code: "too_large", retryable: false };

  let client = options.client;
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return { ok: false, code: "not_configured", retryable: false };
    client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  }

  try {
    const stream = client.beta.messages.stream({
      model: IMPORT_MODEL,
      // Long menus produce long JSON; streaming keeps the request alive.
      max_tokens: 32_000,
      // If a safety check declines the request, the API retries it on the
      // recommended fallback model instead of failing the import.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: { effort: EFFORT, format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: contentFor(files) }],
    }, { signal: options.signal });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") return { ok: false, code: "refused", retryable: false };
    if (message.stop_reason === "max_tokens") return { ok: false, code: "too_long", retryable: false };

    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, code: "failed", detail: "response was not JSON", retryable: true };
    }
    const parsed = extractionZ.safeParse(json);
    if (!parsed.success) return { ok: false, code: "failed", detail: "response did not match the schema", retryable: true };
    if (!parsed.data.readable || parsed.data.sections.every((s) => s.items.length === 0)) {
      return { ok: false, code: "unreadable", detail: parsed.data.problem ?? undefined, retryable: false };
    }
    return { ok: true, extraction: parsed.data, model: message.model, usage: { ...message.usage } };
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || options.signal?.aborted) {
      return { ok: false, code: "too_slow", retryable: true };
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("[import] Claude API credentials rejected", { status: error.status });
      return { ok: false, code: "not_configured", retryable: false };
    }
    if (error instanceof Anthropic.BadRequestError) {
      // Usually a file the API cannot take (damaged image, PDF with too many pages).
      console.error("[import] Claude API rejected the request", { message: error.message.slice(0, 300) });
      return { ok: false, code: "rejected", detail: error.message.slice(0, 200), retryable: false };
    }
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
      return { ok: false, code: "busy", retryable: true };
    }
    console.error("[import] extraction failed", { message: (error as Error).message });
    return { ok: false, code: "failed", retryable: true };
  }
}
