import { NextResponse } from "next/server";
import { providerById } from "@/lib/billing/providers";
import { settleProviderPayment } from "@/lib/billing/settle";
import { publicEnv } from "@/lib/env";
import { expireMenu } from "@/lib/menu/expire";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where the provider sends the owner back after checkout. Checks the
 * payment with the provider (the link itself proves nothing), records it if
 * confirmed, and shows the owner the billing page with the outcome.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/payments/[provider]/return">) {
  const { provider: id } = await params;
  const url = new URL(request.url);
  const rid = url.searchParams.get("rid") ?? "";
  const trackingId = url.searchParams.get("OrderTrackingId") ?? "";
  const provider = providerById(id);

  let outcome = "unknown";
  let restaurantId = UUID.test(rid) ? rid : null;
  if (provider?.collects && trackingId) {
    try {
      const event = await provider.checkStatus(trackingId);
      if (event) {
        const settled = await settleProviderPayment(provider, event);
        // The IPN usually arrives first; for the owner it is the same news.
        outcome = settled.result === "already_paid" ? "paid" : settled.result;
        restaurantId = settled.restaurantId ?? restaurantId;
        if (settled.result === "paid") {
          if (settled.restaurantId) expireMenu(settled.restaurantId, "background");
          if (settled.referrerId) expireMenu(settled.referrerId, "background");
        }
      }
    } catch (error) {
      console.error("[payments] could not check a returning payment", { provider: id, message: (error as Error).message });
      outcome = "pending";
    }
  }
  const target = restaurantId ? `/dashboard/${restaurantId}/billing?pay=${outcome}` : "/dashboard";
  return NextResponse.redirect(new URL(target, publicEnv.siteUrl));
}
