import { NextResponse, type NextRequest } from "next/server";

/**
 * Minimal proxy — auth/session checks run client-side on protected pages.
 * Full Supabase Edge middleware was causing 500 on Vercel for /login.
 */
export async function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
