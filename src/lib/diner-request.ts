import "server-only";
import { createHash } from "node:crypto";

/** Shared checks for the anonymous diner endpoints (orders, loyalty, events). */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TABLE_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ORDER_REF = /^[A-Za-z0-9_-]{12,40}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function validSlug(value: unknown): string | null {
  return typeof value === "string" && SLUG.test(value) && value.length <= 80 ? value : null;
}

/** A short hash of the client IP, so raw IPs are never stored. */
export function rateKeyOf(request: Request): string {
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/**
 * The phone's random loyalty id, hashed. Only the hash is stored, so a copy
 * of the database cannot be used to spend someone's reward.
 */
export function deviceHashOf(value: unknown): string | null {
  return typeof value === "string" && DEVICE_ID.test(value) ? createHash("sha256").update(`menyu-loyalty:${value}`).digest("hex") : null;
}

/** Reads a small JSON body; null when too big or not JSON. */
export async function readJson<T>(request: Request, maxBytes: number): Promise<T | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
