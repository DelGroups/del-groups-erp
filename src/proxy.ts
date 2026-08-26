import { NextResponse, type NextRequest } from "next/server";
import { hasAuthenticatedSession } from "@/lib/auth/homeRouteAuth";
import { isPublicAuthPath } from "@/lib/auth/publicRoutes";

/**
 * Next.js 16+ request proxy (successor to middleware.ts).
 * Redirects unauthenticated visitors on protected routes to /login.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAuthPath(pathname)) {
    return NextResponse.next();
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
