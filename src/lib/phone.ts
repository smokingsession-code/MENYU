/**
 * Phone numbers are stored as international digits without "+", the same
 * way Supabase Auth stores them: 256772123456.
 */
export const UGANDA_COUNTRY_CODE = "256";

const MTN_PREFIXES = ["76", "77", "78", "79"];
const AIRTEL_PREFIXES = ["70", "74", "75"];

/**
 * Accepts the ways people type Ugandan numbers ("0772 123 456",
 * "772123456", "+256 772 123456", "256772123456") and international numbers
 * written with "+" or "00". Returns null when the input is not a number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  // Only digits, spaces, dashes, dots, brackets and a leading + are allowed.
  if (!/^\+?[\d\s\-().]+$/.test(raw)) return null;

  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return isPlausibleInternational(digits) ? digits : null;
  }
  if (hasPlus) {
    if (digits.startsWith(UGANDA_COUNTRY_CODE)) return isValidUgandan(digits) ? digits : null;
    return isPlausibleInternational(digits) ? digits : null;
  }

  // "256 772 ..." written without the plus.
  if (digits.startsWith(UGANDA_COUNTRY_CODE) && digits.length === 12) {
    return isValidUgandan(digits) ? digits : null;
  }
  // "0772 123 456" (a trunk 0 also appears as "(0)772...").
  if (digits.startsWith("0") && digits.length === 10) {
    const candidate = UGANDA_COUNTRY_CODE + digits.slice(1);
    return isValidUgandan(candidate) ? candidate : null;
  }
  // "772 123 456"
  if (digits.length === 9) {
    const candidate = UGANDA_COUNTRY_CODE + digits;
    return isValidUgandan(candidate) ? candidate : null;
  }
  return null;
}

/** 256 + 9 digits, starting with a mobile (7), landline (4, 3) or 20x prefix. */
export function isValidUgandan(digits: string): boolean {
  return /^256(7\d{8}|4\d{8}|3\d{8}|20\d{7})$/.test(digits);
}

export function isUgandanMobile(digits: string | null | undefined): boolean {
  return !!digits && /^2567\d{8}$/.test(digits);
}

function isPlausibleInternational(digits: string): boolean {
  return /^[1-9]\d{7,14}$/.test(digits);
}

export type MobileNetwork = "mtn" | "airtel" | "other";

export function mobileNetwork(digits: string): MobileNetwork {
  if (!isUgandanMobile(digits)) return "other";
  const prefix = digits.slice(3, 5);
  if (MTN_PREFIXES.includes(prefix)) return "mtn";
  if (AIRTEL_PREFIXES.includes(prefix)) return "airtel";
  return "other";
}

/** "+256 772 123 456" */
export function formatPhoneInternational(digits: string): string {
  if (digits.startsWith(UGANDA_COUNTRY_CODE) && digits.length === 12) {
    return `+256 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  return `+${digits}`;
}

/** "0772 123 456" for Ugandan numbers, international format otherwise. */
export function formatPhoneLocal(digits: string): string {
  if (digits.startsWith(UGANDA_COUNTRY_CODE) && digits.length === 12) {
    return `0${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  return formatPhoneInternational(digits);
}

/** "•••• 456": safe to show on screens that anyone can open. */
export function maskPhone(digits: string): string {
  return `•••• ${digits.slice(-3)}`;
}

/** E.164 with plus, for APIs and tel: links. */
export function toE164(digits: string): string {
  return `+${digits}`;
}

/**
 * Whether we may send an SMS to this number. SMS sign-in codes only go to
 * allowed country codes, which blocks SMS-pumping fraud to premium numbers.
 */
export function isAllowedSmsDestination(digits: string, allowedCountryCodes: readonly string[]): boolean {
  if (!/^\d{8,15}$/.test(digits)) return false;
  return allowedCountryCodes.some((cc) => digits.startsWith(cc));
}
