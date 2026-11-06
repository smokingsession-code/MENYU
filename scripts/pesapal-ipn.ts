/**
 * Registers this site's Pesapal IPN (payment notification) URL, once per
 * environment, and prints the ipn_id to set as PESAPAL_IPN_ID.
 *
 * Usage (with PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET, PESAPAL_ENV and
 * NEXT_PUBLIC_SITE_URL in .env.local, or in the shell):
 *
 *   npm run pesapal:ipn
 */
import { PESAPAL_BASE_URLS, registerPesapalIpn } from "../src/lib/billing/providers/pesapal";

async function main() {
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (!key || !secret) throw new Error("Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET first.");
  if (!site.startsWith("https://")) throw new Error("NEXT_PUBLIC_SITE_URL must be the public https address (Pesapal must reach it).");
  const env = process.env.PESAPAL_ENV === "live" ? "live" : "sandbox";
  const url = `${site}/api/payments/pesapal`;
  const ipnId = await registerPesapalIpn({ consumerKey: key, consumerSecret: secret, baseUrl: PESAPAL_BASE_URLS[env] }, url);
  console.log(`Registered ${url} with Pesapal (${env}).`);
  console.log(`Set PESAPAL_IPN_ID=${ipnId}`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
