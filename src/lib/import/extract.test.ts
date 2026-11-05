import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractMenu, IMPORT_MODEL, type ImportFile } from "./extract";
import { EXTRACTION_JSON_SCHEMA, type Extraction } from "./schema";

const menu: Extraction = {
  readable: true,
  problem: null,
  prices_in_thousands: false,
  sections: [
    {
      name: "Breakfast",
      items: [{ name: "Rolex", description: null, price_text: "5,000", sizes: [], addons: [], tags: [], unsure: [] }],
    },
  ],
};

const photo: ImportFile = { mime: "image/jpeg", data: Buffer.from("jpeg-bytes") };
const pdf: ImportFile = { mime: "application/pdf", data: Buffer.from("%PDF-1.7 menu") };

type Reply = { message?: Record<string, unknown>; error?: unknown };

/** Just enough of the SDK client: beta.messages.stream(...).finalMessage(). */
function fakeClient(reply: Reply) {
  const calls: { params: Record<string, unknown>; options: { signal?: AbortSignal } | undefined }[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, options?: { signal?: AbortSignal }) {
          calls.push({ params, options });
          return {
            async finalMessage() {
              if (reply.error) throw reply.error;
              return reply.message;
            },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

function textReply(text: string, extra: Record<string, unknown> = {}): Reply {
  return {
    message: {
      model: IMPORT_MODEL,
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: { input_tokens: 1200, output_tokens: 300 },
      ...extra,
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("extractMenu", () => {
  it("sends photos and PDFs with the instruction last, asking for the menu schema", async () => {
    const { client, calls } = fakeClient(textReply(JSON.stringify(menu)));
    const signal = new AbortController().signal;
    const result = await extractMenu([photo, pdf], { client, signal });

    expect(result).toEqual({ ok: true, extraction: menu, model: IMPORT_MODEL, usage: { input_tokens: 1200, output_tokens: 300 } });
    const { params, options } = calls[0];
    expect(options?.signal).toBe(signal);
    expect(params.model).toBe(IMPORT_MODEL);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config).toMatchObject({ format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA } });
    const content = (params.messages as { content: Record<string, unknown>[] }[])[0].content;
    expect(content.map((b) => b.type)).toEqual(["image", "document", "text"]);
    expect(content[0]).toMatchObject({ source: { type: "base64", media_type: "image/jpeg", data: photo.data.toString("base64") } });
    expect(content[1]).toMatchObject({ source: { type: "base64", media_type: "application/pdf" } });
  });

  it("reports refusals and replies cut off by the token limit", async () => {
    expect(await extractMenu([photo], fakeClient(textReply("", { stop_reason: "refusal" })))).toMatchObject({
      ok: false,
      code: "refused",
      retryable: false,
    });
    expect(await extractMenu([photo], fakeClient(textReply('{"readable": tr', { stop_reason: "max_tokens" })))).toMatchObject({
      ok: false,
      code: "too_long",
    });
  });

  it("never trusts the reply: broken JSON and the wrong shape are failures worth retrying", async () => {
    expect(await extractMenu([photo], fakeClient(textReply("Here is the menu!")))).toMatchObject({ ok: false, code: "failed", retryable: true });
    expect(await extractMenu([photo], fakeClient(textReply(JSON.stringify({ readable: true, sections: "none" }))))).toMatchObject({
      ok: false,
      code: "failed",
      retryable: true,
    });
  });

  it("passes on why a photo could not be read", async () => {
    const notAMenu = { ...menu, readable: false, problem: "This is a photo of a car.", sections: [] };
    expect(await extractMenu([photo], fakeClient(textReply(JSON.stringify(notAMenu))))).toEqual({
      ok: false,
      code: "unreadable",
      detail: "This is a photo of a car.",
      retryable: false,
    });
    const empty = { ...menu, sections: [{ name: "Menu", items: [] }] };
    expect(await extractMenu([photo], fakeClient(textReply(JSON.stringify(empty))))).toMatchObject({ ok: false, code: "unreadable" });
  });

  it("turns API errors into outcomes the owner can act on", async () => {
    const headers = new Headers();
    const cases: [unknown, string, boolean][] = [
      [new Anthropic.RateLimitError(429, {}, "rate limited", headers), "busy", true],
      [new Anthropic.InternalServerError(529, {}, "overloaded", headers), "busy", true],
      [new Anthropic.APIConnectionError({ message: "socket hang up" }), "busy", true],
      [new Anthropic.BadRequestError(400, {}, "image too large", headers), "rejected", false],
      [new Anthropic.AuthenticationError(401, {}, "bad key", headers), "not_configured", false],
      [new Anthropic.APIUserAbortError(), "too_slow", true],
      [new Error("something else"), "failed", true],
    ];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [error, code, retryable] of cases) {
      expect(await extractMenu([photo], fakeClient({ error }))).toMatchObject({ ok: false, code, retryable });
    }
  });

  it("checks the request before calling anyone", async () => {
    const { client, calls } = fakeClient(textReply(JSON.stringify(menu)));
    expect(await extractMenu([], { client })).toMatchObject({ ok: false, code: "unreadable" });
    const huge: ImportFile = { mime: "application/pdf", data: Buffer.alloc(23 * 1024 * 1024) };
    expect(await extractMenu([huge], { client })).toMatchObject({ ok: false, code: "too_large" });
    expect(calls).toHaveLength(0);
  });

  it("says it is not configured when there is no API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    expect(await extractMenu([photo])).toEqual({ ok: false, code: "not_configured", retryable: false });
  });
});
