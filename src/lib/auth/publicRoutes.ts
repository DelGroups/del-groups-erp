/** Routes accessible without an authenticated Supabase session. */
export const PUBLIC_AUTH_PATHS = [
  "/login",
  "/forgot-password",
  "/update-password",
  "/auth/callback",
  "/auth/set-password",
] as const;

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}
