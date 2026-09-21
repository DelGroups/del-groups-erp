import { NextResponse, type NextRequest } from "next/server";
import { hasAuthenticatedSession } from "@/lib/auth/homeRouteAuth";
import { isPublicAuthPath } from "@/lib/auth/publicRoutes";

/** Query params Supabase attaches to invite/recovery/magic-link redirects. */
const AUTH_LINK_PARAMS = ["code", "token_hash"] as const;

function hasUnconsumedAuthLinkParams(url: URL): boolean {
  return AUTH_LINK_PARAMS.some((key) => url.searchParams.has(key));
}

/**
 * Next.js 16+ request proxy (successor to middleware.ts).
 * Redirects unauthenticated visitors on protected routes to /login.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAuthPath(pathname)) {
    return NextResponse.next();
  }

  // Invite/recovery links must land on the set-password flow even if the
  // Supabase project's configured redirect URL (or a stale email template)
  // sends them somewhere else — never bounce an unconsumed auth code to
  // /login, since that strands the user and burns their one-time link.
  if (hasUnconsumedAuthLinkParams(request.nextUrl)) {
    const isRecovery = request.nextUrl.searchParams.get("type") === "recovery";
    const rescueUrl = new URL(isRecovery ? "/update-password" : "/auth/set-password", request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      rescueUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(rescueUrl);
  }

  const authenticated = await hasAuthenticatedSession(request);
  if (!authenticated) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
