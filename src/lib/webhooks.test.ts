import { describe, expect, it } from "vitest";
import { signStandardWebhook, verifyStandardWebhook } from "./webhooks";

const secret = "v1,whsec_" + Buffer.from("a-test-secret-of-32-bytes-long!!").toString("base64");
const body = JSON.stringify({ user: { phone: "256772123456" }, sms: { otp: "123456" } });

describe("Standard Webhooks verification", () => {
  it("accepts a correctly signed request", () => {
    const headers = new Headers(signStandardWebhook({ body, secret }));
    expect(verifyStandardWebhook({ body, headers, secret })).toBe(true);
  });

  it("rejects a changed body", () => {
    const headers = new Headers(signStandardWebhook({ body, secret }));
    expect(verifyStandardWebhook({ body: body.replace("123456", "000000"), headers, secret })).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const headers = new Headers(signStandardWebhook({ body, secret }));
    const other = "v1,whsec_" + Buffer.from("another-secret-of-32-bytes-long!").toString("base64");
    expect(verifyStandardWebhook({ body, headers, secret: other })).toBe(false);
  });

  it("rejects old or future timestamps", () => {
    const old = new Headers(signStandardWebhook({ body, secret, nowMs: Date.now() - 10 * 60_000 }));
    expect(verifyStandardWebhook({ body, headers: old, secret })).toBe(false);
    const future = new Headers(signStandardWebhook({ body, secret, nowMs: Date.now() + 10 * 60_000 }));
    expect(verifyStandardWebhook({ body, headers: future, secret })).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyStandardWebhook({ body, headers: new Headers(), secret })).toBe(false);
  });

  it("accepts when any listed signature matches (secret rotation)", () => {
    const signed = signStandardWebhook({ body, secret });
    const headers = new Headers({ ...signed, "webhook-signature": `v1,bm90LXJpZ2h0 ${signed["webhook-signature"]}` });
    expect(verifyStandardWebhook({ body, headers, secret })).toBe(true);
  });
});
