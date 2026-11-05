import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Standard Webhooks signature (used by Supabase Auth hooks).
 * Signed content is `${webhook-id}.${webhook-timestamp}.${body}`, HMAC-SHA256
 * with the base64 secret, sent as "v1,<base64>" (several may be listed).
 */
export function verifyStandardWebhook(options: {
  body: string;
  headers: Headers;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  const { body, headers, secret, toleranceSeconds = 300, nowMs = Date.now() } = options;
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return false;

  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  return signatureHeader.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Builds headers for a signed request (used by tests and local tools). */
export function signStandardWebhook(options: { body: string; secret: string; id?: string; nowMs?: number }) {
  const id = options.id ?? `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = Math.floor((options.nowMs ?? Date.now()) / 1000).toString();
  const key = Buffer.from(options.secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${options.body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` };
}
