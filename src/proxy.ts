import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl, isSupabaseConfigured } from "@/lib/env";

/**
 * Next.js middleware entry (`src/proxy.ts`).
 * Session-only gate — RBAC is enforced client-side via PageLayout / PermissionGuard.
 */

/** Routes reachable without a signed-in session. Never redirect these to `/`. */
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/update-password",
  "/auth/callback",
  "/auth/set-password",
] as const;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

function createMiddlewareClient(request: NextRequest, response: NextResponse) {
  return createServerClient(
    getPublicSupabaseUrl(),
    getPublicSupabaseAnonKey(),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // API routes and Next internals are never auth-gated here.
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  if (!isSupabaseConfigured()) {
    if (isPublicPath(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    // Public auth pages — no session required (invite, forgot password, login, etc.).
    if (isPublicPath(pathname)) {
      if (pathname === "/login") {
        let response = NextResponse.next({ request });
        const supabase = createMiddlewareClient(request, response);
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          return NextResponse.redirect(new URL("/", request.url));
        }
        return response;
      }

      return NextResponse.next();
    }

    // Protected app routes — require a valid session.
    let response = NextResponse.next({ request });
    const supabase = createMiddlewareClient(request, response);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const loginUrl = new URL("/login", request.url);
      if (pathname !== "/") {
        loginUrl.searchParams.set("next", `${pathname}${search}`);
      }
      return NextResponse.redirect(loginUrl);
    }

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileRow?.is_active === false) {
      await supabase.auth.signOut();
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "account_inactive");
      return NextResponse.redirect(loginUrl);
    }

    return response;
  } catch (error) {
    console.error("[proxy] middleware error:", error);
    if (isPublicPath(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
