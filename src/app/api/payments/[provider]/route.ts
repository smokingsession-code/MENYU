import { recordPayment } from "@/lib/billing/record";
import { providerById } from "@/lib/billing/providers";
import { expireMenu } from "@/lib/menu/expire";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Payment-provider webhooks (Flutterwave or Pesapal, phase 9). The provider
 * verifies the request; confirmed payments go through recordPayment, the
 * same path as payments the admin records by hand. Our reference is the
 * pending payment's id, created when the owner started paying.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/payments/[provider]">) {
  const { provider: id } = await params;
  const provider = providerById(id);
  if (!provider || !provider.collects) return new Response("Not found", { status: 404 });

  const event = await provider.parseWebhook(request);
  if (!event) return new Response("Ignored", { status: 400 });
  if (event.status !== "succeeded") return Response.json({ received: true });

  const { data: pending } = await createAdminClient()
    .from("payments")
    .select("id, restaurant_id, kind, plan, billing_interval")
    .eq("provider", provider.id)
    .eq("provider_ref", event.providerRef)
    .maybeSingle();
  if (!pending) return new Response("Unknown payment", { status: 404 });

  const result = await recordPayment({
    restaurantId: pending.restaurant_id,
    kind: pending.kind as "subscription" | "setup_fee" | "other",
    amountUgx: event.amountUgx,
    method: event.method,
    provider: provider.id,
    providerRef: event.providerRef,
    transactionId: event.transactionId,
    paidAt: event.paidAt,
    raw: event.raw as never,
    plan: (pending.plan ?? undefined) as "standard" | "pro" | undefined,
    interval: (pending.billing_interval ?? undefined) as "month" | "year" | undefined,
  });
  if (!result.ok) {
    console.error("[payments] webhook payment not recorded", { provider: provider.id, code: result.code });
    // Providers retry on errors, and recording is idempotent.
    return new Response("Not recorded", { status: 500 });
  }
  expireMenu(pending.restaurant_id, "background");
  if (result.rewardedReferrerId) expireMenu(result.rewardedReferrerId, "background");
  return Response.json({ received: true });
}
