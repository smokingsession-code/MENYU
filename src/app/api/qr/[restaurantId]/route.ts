import { downloadName, menuLink, qrPng, qrSvg } from "@/lib/qr";
import { loadPrintableRestaurant } from "@/lib/qr-access";

/**
 * GET /api/qr/:restaurantId?branch=<id>&table=<id>&format=png|svg&size=1024
 * Without `table` it is the restaurant-wide code. Owners and admins only.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/qr/[restaurantId]">) {
  const { restaurantId } = await params;
  const restaurant = await loadPrintableRestaurant(restaurantId);
  if (!restaurant) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const branch = restaurant.branches.find((b) => b.id === url.searchParams.get("branch")) ?? restaurant.branches[0];
  if (!branch) return new Response("Not found", { status: 404 });

  const tableId = url.searchParams.get("table");
  const table = tableId ? branch.tables.find((t) => t.id === tableId) : null;
  // Asking for a table the plan does not include (or that does not exist).
  if (tableId && !table) return new Response("Not found", { status: 404 });

  const link = menuLink(branch.slug, table?.code);
  const format = url.searchParams.get("format") === "svg" ? "svg" : "png";
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="${downloadName(branch.slug, table?.code ?? null, format)}"`,
  };

  if (format === "svg") {
    return new Response(await qrSvg(link), { headers: { ...headers, "Content-Type": "image/svg+xml" } });
  }
  const size = Number(url.searchParams.get("size") ?? 1024);
  const png = await qrPng(link, Number.isFinite(size) ? size : 1024);
  return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
}
