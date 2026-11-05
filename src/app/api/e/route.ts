import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Anonymous diner events (menu views, item views, WhatsApp order clicks,
 * waiter calls). Also returns the menu's live version and sold-out list, so
 * a menu cached on the phone is corrected in the same round trip.
 *
 * Rate limited per client inside record_event; over the limit the event is
 * dropped but the live state is still returned. Crawlers are not counted.
 */
const TYPES = new Set(["menu_view", "item_view", "whatsapp_order", "order_copy", "waiter_call", "bill_request", "momo_view"]);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse/i;
const MAX_BODY = 1024;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });

  let body: { s?: unknown; t?: unknown; tb?: unknown; i?: unknown; sid?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const slug = typeof body.s === "string" && SLUG.test(body.s) && body.s.length <= 80 ? body.s : null;
  const type = typeof body.t === "string" && TYPES.has(body.t) ? body.t : null;
  if (!slug || !type) return new Response(null, { status: 400 });

  const table = typeof body.tb === "string" && CODE.test(body.tb) && body.tb.length <= 24 ? body.tb : null;
  const item = typeof body.i === "string" && UUID.test(body.i) ? body.i : null;
  const session = typeof body.sid === "string" ? body.sid.slice(0, 40) : null;

  const ua = request.headers.get("user-agent") ?? "";
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = createHash("sha256").update(ip).digest("hex").slice(0, 16);

  const { data, error } = await createAdminClient().rpc("record_event", {
    p_slug: slug,
    // Crawlers get the live state but are never counted.
    p_type: BOT.test(ua) ? "ignored" : type,
    p_table: table ?? undefined,
    p_item: item ?? undefined,
    p_session: session ?? undefined,
    p_rate_key: rateKey,
  });
  if (error) {
    console.error("[events] record_event failed", { message: error.message });
    return new Response(null, { status: 503 });
  }
  if (!data) return new Response(null, { status: 404 });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
