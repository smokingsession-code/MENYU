import sharp from "sharp";
import { BRAND } from "@/config/brand";
import { planHas } from "@/config/plans";
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

  const ordering = planHas(restaurant.plan, "whatsapp_ordering");
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
