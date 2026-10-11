/** Routes accessible without an authenticated Supabase session. */
export const PUBLIC_AUTH_PATHS = [
  "/login",
  "/forgot-password",
  "/update-password",
  "/auth/callback",
  "/auth/set-password",
  // Tenant status pages (src/proxy.ts rewrites to them before anyone can sign in).
  "/tenant",
] as const;

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}
