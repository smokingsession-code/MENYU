import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limit backed by Postgres, so it holds across serverless
 * instances. Returns true when the call is allowed.
 *
 * `failOpen` decides what happens if the check itself fails: public
 * analytics fail open (never block diners), anything that costs money
 * (SMS, AI calls) fails closed.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: { failOpen?: boolean } = {},
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] check failed", { key: key.split(":")[0], message: error.message });
    return options.failOpen ?? false;
  }
  return data === true;
}

/** A short hash of the client IP, so raw IPs are never stored. */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}
