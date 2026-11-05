import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Only signed-in areas. Menu pages (/r/...), the home page and static
  // files skip the proxy so they stay fast and cacheable.
  matcher: ["/dashboard/:path*", "/admin/:path*", "/onboarding/:path*", "/login", "/invite/:path*"],
};
