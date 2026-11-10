import sharp from "sharp";
import { BRAND } from "@/config/brand";
import { effectiveOrderMode } from "@/config/features";
import { planHas } from "@/config/plans";
import { loadRestaurantSwitches } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { getTranslator } from "@/lib/i18n";
import { imageUrl, pickWidth } from "@/lib/images/shared";
import { buildPrintPdf, type PrintEntry } from "@/lib/print/pdf";
import { menuLink } from "@/lib/qr";
import { loadPrintableRestaurant, printedTableLabel } from "@/lib/qr-access";

const t = getTranslator("en");

/**
 * GET /api/print/:restaurantId?layout=tents|stickers&branch=<id>
 * A print-ready PDF: the restaurant-wide code first, then every table.
 * Owners and admins only.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/print/[restaurantId]">) {
  const { restaurantId } = await params;
  const restaurant = await loadPrintableRestaurant(restaurantId);
  if (!restaurant) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const branch = restaurant.branches.find((b) => b.id === url.searchParams.get("branch")) ?? restaurant.branches[0];
  if (!branch) return new Response("Not found", { status: 404 });
  const layout = url.searchParams.get("layout") === "stickers" ? "stickers" : "tents";

  const entries: PrintEntry[] = [
    { label: null, url: menuLink(branch.slug) },
    ...branch.tables.map((table) => ({ label: printedTableLabel(table.label), url: menuLink(branch.slug, table.code) })),
  ];

  // Logos are stored as WebP; PDFs need PNG.
  let logoPng: Buffer | null = null;
  if (restaurant.logo) {
    try {
      const response = await fetch(imageUrl(restaurant.logo, pickWidth(restaurant.logo, 96)), { signal: AbortSignal.timeout(5000) });
      if (response.ok) logoPng = await sharp(Buffer.from(await response.arrayBuffer())).png().toBuffer();
    } catch {
      logoPng = null; // print without the logo rather than fail
    }
  }

  // "Order on WhatsApp" only when that is how this branch takes orders now.
  const supabase = await createClient();
  const [{ data: settings }, { switches }] = await Promise.all([
    supabase.from("branches").select("order_mode, whatsapp").eq("id", branch.id).maybeSingle(),
    loadRestaurantSwitches(supabase, restaurant.id),
  ]);
  const mode = settings ? effectiveOrderMode(settings.order_mode as "waiter" | "whatsapp" | "kitchen", settings.whatsapp, restaurant.plan, switches) : null;
  const ordering = mode === "whatsapp";
  const pdf = await buildPrintPdf({
    restaurantName: restaurant.name,
    brandColor: restaurant.brandColor,
    logoPng,
    entries,
    layout,
    words: {
      scanForMenu: t("print.scanForMenu"),
      tagline: ordering ? t("print.tagline") : t("print.taglineView"),
      foldHere: t("print.foldHere"),
    },
    credit: planHas(restaurant.plan, "hide_footer") ? null : t("print.credit", { brand: BRAND.name }),
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${branch.slug}-${layout}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
