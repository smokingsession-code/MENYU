import { createAdminClient } from "@/lib/supabase/admin";
import { deviceHashOf, NO_STORE, rateKeyOf, readJson, validSlug } from "@/lib/diner-request";

/**
 * The diner uses a waiting loyalty reward (in front of the waiter, who sees
 * the "Reward used" screen with the time). Stamps themselves are added by
 * the order endpoint, at most one a day per phone.
 */
export async function POST(request: Request) {
  const body = await readJson<{ slug?: unknown; device?: unknown }>(request, 1024);
  const slug = validSlug(body?.slug);
  const device = deviceHashOf(body?.device);
  if (!slug || !device) return Response.json({ result: "invalid" }, { status: 400, headers: NO_STORE });

  const { data, error } = await createAdminClient().rpc("redeem_loyalty", {
    p_slug: slug,
    p_device_hash: device,
    p_rate_key: rateKeyOf(request),
  });
  if (error) {
    console.error("[loyalty] redeem failed", { message: error.message });
    return Response.json({ result: "error" }, { status: 503, headers: NO_STORE });
  }
  const result = data as { result?: string } | null;
  const status = { ok: 200, not_ready: 409, too_many: 429, not_available: 404 }[result?.result ?? ""] ?? 503;
  return Response.json(result, { status, headers: NO_STORE });
}
