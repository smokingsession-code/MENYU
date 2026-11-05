import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/onboarding"];

/**
 * Refreshes the Supabase session cookie on every request to signed-in areas
 * and sends signed-out visitors to /login. Public menu pages never pass
 * through here, so they stay cacheable.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Do not put code between createServerClient and getClaims: it refreshes
  // the session and must run first.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  if (!signedIn && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  // The admin area answers 404 to everyone else, decided here before any
  // HTML streams (a check inside the page could only show a "not found"
  // screen with a 200 status).
  if (signedIn && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const { data: admin } = await supabase.from("admins").select("user_id").eq("user_id", data!.claims!.sub).maybeSingle();
    if (!admin) {
      const url = request.nextUrl.clone();
      url.pathname = "/__not-found";
      url.search = "";
      const notFound = NextResponse.rewrite(url, { status: 404 });
      for (const cookie of response.cookies.getAll()) notFound.cookies.set(cookie);
      return notFound;
    }
  }

  return response;
}
