import { describe, expect, it, vi } from "vitest";
import { createAfricasTalkingProvider, interpretAfricasTalkingResponse } from "./africastalking";
import { signInCodeMessage } from "./messages";

describe("Africa's Talking provider", () => {
  it("posts a form request with the API key and E.164 number", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        SMSMessageData: {
          Message: "Sent to 1/1 Total Cost: UGX 25.0000",
          Recipients: [{ statusCode: 101, number: "+256772123456", status: "Success", cost: "UGX 25.0000", messageId: "ATXid_1" }],
        },
      }),
    );
    const provider = createAfricasTalkingProvider({ username: "menyu", apiKey: "key123", senderId: "MENYU", fetchImpl });
    const result = await provider.send("256772123456", "Hello");

    expect(result).toEqual({ ok: true, messageId: "ATXid_1", cost: "UGX 25.0000" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.africastalking.com/version1/messaging");
    expect((init.headers as Record<string, string>).apiKey).toBe("key123");
    const body = init.body as URLSearchParams;
    expect(body.get("to")).toBe("+256772123456");
    expect(body.get("username")).toBe("menyu");
    expect(body.get("from")).toBe("MENYU");
    expect(body.get("message")).toBe("Hello");
  });

  it("uses the sandbox endpoint for the sandbox username", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ SMSMessageData: { Recipients: [{ statusCode: 100, number: "+256772123456", status: "Success" }] } }),
    );
    await createAfricasTalkingProvider({ username: "sandbox", apiKey: "k", fetchImpl }).send("256772123456", "x");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain("api.sandbox.africastalking.com");
  });

  it("reports failures and which ones are worth retrying", () => {
    expect(
      interpretAfricasTalkingResponse({ SMSMessageData: { Recipients: [{ statusCode: 403, number: "+1", status: "InvalidPhoneNumber" }] } }),
    ).toEqual({ ok: false, error: "403 InvalidPhoneNumber", retryable: false });
    expect(
      interpretAfricasTalkingResponse({ SMSMessageData: { Recipients: [{ statusCode: 405, number: "+1", status: "InsufficientBalance" }] } }),
    ).toMatchObject({ ok: false, retryable: true });
    expect(interpretAfricasTalkingResponse({ SMSMessageData: { Message: "InvalidSenderId", Recipients: [] } })).toMatchObject({
      ok: false,
      error: "InvalidSenderId",
    });
  });

  it("treats network errors and server errors as retryable", async () => {
    const down = createAfricasTalkingProvider({
      username: "u",
      apiKey: "k",
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    });
    expect(await down.send("256772123456", "x")).toMatchObject({ ok: false, retryable: true });

    const broken = createAfricasTalkingProvider({ username: "u", apiKey: "k", fetchImpl: vi.fn(async () => new Response("oops", { status: 502 })) });
    expect(await broken.send("256772123456", "x")).toMatchObject({ ok: false, retryable: true });
  });
});

describe("sign-in SMS text", () => {
  it("includes the code and a WebOTP line so Android can fill it in", () => {
    const text = signInCodeMessage("482913", "https://menyu.ug");
    expect(text).toBe("Your Menyu code is 482913. It expires in 5 minutes.\n\n@menyu.ug #482913");
  });

  it("skips the WebOTP line for local development", () => {
    expect(signInCodeMessage("482913", "http://localhost:3000")).toBe("Your Menyu code is 482913. It expires in 5 minutes.");
  });
});
