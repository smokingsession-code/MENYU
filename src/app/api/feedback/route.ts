import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Private diner feedback (1 to 5 stars and an optional comment). Only menus
 * whose plan includes feedback accept it; submit_feedback rate-limits per
 * phone and per branch so the owner's inbox cannot be flooded.
 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_BODY = 4096;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });
  let body: { s?: unknown; r?: unknown; c?: unknown; tb?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const slug = typeof body.s === "string" && SLUG.test(body.s) && body.s.length <= 80 ? body.s : null;
  const rating = typeof body.r === "number" && Number.isInteger(body.r) && body.r >= 1 && body.r <= 5 ? body.r : null;
  if (!slug || rating === null) return new Response(null, { status: 400 });
  const comment = typeof body.c === "string" ? body.c.slice(0, 1000) : null;
  const table = typeof body.tb === "string" && CODE.test(body.tb) && body.tb.length <= 24 ? body.tb : null;

  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = createHash("sha256").update(ip).digest("hex").slice(0, 16);

  const { data, error } = await createAdminClient().rpc("submit_feedback", {
    p_slug: slug,
    p_rating: rating,
    p_comment: comment ?? undefined,
    p_table: table ?? undefined,
    p_rate_key: rateKey,
  });
  if (error) {
    console.error("[feedback] submit failed", { message: error.message });
    return new Response(null, { status: 503 });
  }
  const status = { ok: 200, too_many: 429, invalid: 400, not_found: 404, not_available: 404 }[data as string] ?? 503;
  return Response.json({ result: data }, { status, headers: { "Cache-Control": "no-store" } });
}
