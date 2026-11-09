import { createAdminClient } from "@/lib/supabase/admin";
import { deviceHashOf, NO_STORE, ORDER_REF, rateKeyOf, readJson, TABLE_CODE, validSlug } from "@/lib/diner-request";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Orders from the menu: shown to a waiter, sent on WhatsApp or sent to the
 * kitchen screen. place_order prices every line from the menu itself (the
 * phone only says which dishes, sizes and add-ons), rate-limits, numbers
 * kitchen orders and adds the loyalty stamp.
 *
 * GET ?s=<menu>&ref=<order> lets the phone follow a kitchen order; the
 * random order ref is what proves it is theirs.
 */
const MAX_BODY = 16_384;
const MODES = new Set(["waiter", "whatsapp", "kitchen"]);
const TYPES = new Set(["dine_in", "takeaway", "delivery"]);
const STATUS: Record<string, number> = {
  ok: 200,
  sold_out: 409,
  changed: 409,
  mode_changed: 409,
  invalid: 400,
  too_many: 429,
  not_found: 404,
  not_available: 404,
};

interface Body {
  slug?: unknown;
  ref?: unknown;
  mode?: unknown;
  type?: unknown;
  table?: unknown;
  tableLabel?: unknown;
  name?: unknown;
  address?: unknown;
  payment?: unknown;
  lines?: unknown;
  device?: unknown;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : undefined);

export async function POST(request: Request) {
  const body = await readJson<Body>(request, MAX_BODY);
  if (!body) return Response.json({ result: "invalid" }, { status: 400, headers: NO_STORE });

  const slug = validSlug(body.slug);
  const ref = typeof body.ref === "string" && ORDER_REF.test(body.ref) ? body.ref : null;
  const mode = typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : null;
  const type = typeof body.type === "string" && TYPES.has(body.type) ? body.type : null;
  if (!slug || !ref || !mode || !type || !Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 50) {
    return Response.json({ result: "invalid" }, { status: 400, headers: NO_STORE });
  }

  const { data, error } = await createAdminClient().rpc("place_order", {
    p: {
      slug,
      ref,
      mode,
      type,
      table: typeof body.table === "string" && TABLE_CODE.test(body.table) && body.table.length <= 24 ? body.table : null,
      table_label: text(body.tableLabel, 40) ?? null,
      name: text(body.name, 80) ?? null,
      address: text(body.address, 300) ?? null,
      payment: body.payment === "momo" || body.payment === "cash" ? body.payment : null,
      lines: body.lines as Json,
    },
    p_rate_key: rateKeyOf(request),
    p_device_hash: deviceHashOf(body.device) ?? undefined,
  });
  if (error) {
    console.error("[orders] place_order failed", { message: error.message });
    return Response.json({ result: "error" }, { status: 503, headers: NO_STORE });
  }
  const result = data as { result?: string } | null;
  return Response.json(result, { status: STATUS[result?.result ?? ""] ?? 503, headers: NO_STORE });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = validSlug(url.searchParams.get("s"));
  const ref = url.searchParams.get("ref");
  if (!slug || !ref || !ORDER_REF.test(ref)) return new Response(null, { status: 400 });
  const { data, error } = await createAdminClient().rpc("order_status", { p_slug: slug, p_ref: ref });
  if (error) {
    console.error("[orders] order_status failed", { message: error.message });
    return new Response(null, { status: 503 });
  }
  if (!data) return new Response(null, { status: 404, headers: NO_STORE });
  return Response.json({ order: data }, { headers: NO_STORE });
}
