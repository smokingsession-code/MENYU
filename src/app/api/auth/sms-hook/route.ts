import { publicEnv } from "@/lib/env";
import { isAllowedSmsDestination } from "@/lib/phone";
import { serverEnv } from "@/lib/server-env";
import { getSmsProvider } from "@/lib/sms";
import { signInCodeMessage } from "@/lib/sms/messages";
import { verifyStandardWebhook } from "@/lib/webhooks";

/**
 * Supabase Auth "Send SMS" hook. Supabase generates the sign-in code and
 * calls this endpoint (signed with Standard Webhooks); we deliver it through
 * Africa's Talking, which routes directly to MTN and Airtel Uganda.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifyStandardWebhook({ body, headers: request.headers, secret: serverEnv.smsHookSecret })) {
    return Response.json({ error: { http_code: 401, message: "Invalid signature" } }, { status: 401 });
  }

  let payload: { user?: { phone?: string }; sms?: { otp?: string; phone?: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    return hookError(400, "Invalid payload");
  }

  const phone = String(payload.user?.phone || payload.sms?.phone || "").replace(/\D/g, "");
  const otp = String(payload.sms?.otp ?? "");
  if (!phone || !/^\d{4,10}$/.test(otp)) return hookError(400, "Missing phone number or code");

  if (!isAllowedSmsDestination(phone, serverEnv.smsAllowedCountryCodes)) {
    return hookError(400, "SMS codes are only sent to Ugandan numbers. Use email instead.");
  }

  const result = await getSmsProvider().send(phone, signInCodeMessage(otp, publicEnv.siteUrl));
  if (!result.ok) {
    // Never log the code or full number.
    console.error("[sms-hook] delivery failed", { error: result.error, to: `…${phone.slice(-3)}` });
    return hookError(result.retryable ? 503 : 400, "We could not send the SMS. Try again or use email.");
  }
  return Response.json({});
}

/**
 * Supabase Auth reads the error object only from a 200 response; other
 * status codes are reported as a generic hook failure (and 429/503 make it
 * retry, which could send a second SMS). So errors are 200 + { error }.
 */
function hookError(httpCode: number, message: string) {
  return Response.json({ error: { http_code: httpCode, message } }, { status: 200 });
}
