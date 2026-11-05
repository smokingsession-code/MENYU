import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";

const REFERRAL_COOKIE = "menyu_ref";

/**
 * A restaurant's referral link (menyu.app/join/ABC123). Remembers the code
 * for 30 days, through signing in, and opens signup.
 */
export async function GET(_request: Request, { params }: RouteContext<"/join/[code]">) {
  const { code } = await params;
  const response = NextResponse.redirect(new URL("/onboarding", publicEnv.siteUrl));
  const value = code.trim().toUpperCase();
  if (/^[A-Z0-9]{4,12}$/.test(value)) {
    response.cookies.set(REFERRAL_COOKIE, value, { maxAge: 30 * 86_400, httpOnly: true, sameSite: "lax", path: "/" });
  }
  return response;
}
