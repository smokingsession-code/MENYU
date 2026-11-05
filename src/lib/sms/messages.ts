import { getTranslator } from "@/lib/i18n";

/**
 * The sign-in SMS. The last line follows the WebOTP format
 * ("@host #code") so Chrome on Android can offer to fill the code in.
 * WebOTP needs HTTPS, so it is left out for local development.
 */
export function signInCodeMessage(code: string, siteUrl: string): string {
  const text = getTranslator("en")("sms.signInCode", { code });
  let host: string | null = null;
  try {
    const url = new URL(siteUrl);
    if (url.protocol === "https:") host = url.host;
  } catch {
    host = null;
  }
  return host ? `${text}\n\n@${host} #${code}` : text;
}
