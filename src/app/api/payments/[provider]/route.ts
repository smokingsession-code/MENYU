import { providerById } from "@/lib/billing/providers";
import { settleProviderPayment } from "@/lib/billing/settle";
import { expireMenu } from "@/lib/menu/expire";

/**
 * Payment-provider notifications (Pesapal's IPN, by GET or POST). The
 * provider verifies each one with its own API before anything is recorded;
 * recording is idempotent, so repeats are harmless.
 */
async function handle(request: Request, { params }: RouteContext<"/api/payments/[provider]">) {
  const { provider: id } = await params;
  const provider = providerById(id);
  if (!provider || !provider.collects) return new Response("Not found", { status: 404 });

  let call;
  try {
    call = await provider.parseWebhook(request);
  } catch (error) {
    // The provider's API could not be reached: an error makes it try again later.
    console.error("[payments] could not verify a notification", { provider: id, message: (error as Error).message });
    return new Response("Try again", { status: 503 });
  }
  if (!call) return new Response("Not a payment notification", { status: 400 });

  const settled = await settleProviderPayment(provider, call.event);
  if (settled.result === "paid") {
    if (settled.restaurantId) expireMenu(settled.restaurantId, "background");
    if (settled.referrerId) expireMenu(settled.referrerId, "background");
  }
  return call.reply(settled.result !== "error");
}

export const GET = handle;
export const POST = handle;
