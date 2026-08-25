/**
 * Centralized environment variable access for server and client.
 * Never hardcode secrets — always read from process.env.
 */

const requiredServerVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const requiredAdminVars = ["SUPABASE_SERVICE_ROLE_KEY"] as const;

const BUILD_PLACEHOLDER_URL = "https://placeholder.supabase.co";
const BUILD_PLACEHOLDER_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.build-placeholder";

/** True while `next build` is prerendering pages (env may be unset on CI). */
export function isNextBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function getPublicSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (value) return value;
  if (isNextBuildPhase()) return BUILD_PLACEHOLDER_URL;
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
}

export function getPublicSupabaseAnonKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (value) return value;
  if (isNextBuildPhase()) return BUILD_PLACEHOLDER_ANON_KEY;
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured.");
}

/** Browser-safe values — never throw during module init / prerender. */
export function getBrowserSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (url && anonKey) return { url, anonKey };
  if (isNextBuildPhase()) {
    return { url: BUILD_PLACEHOLDER_URL, anonKey: BUILD_PLACEHOLDER_ANON_KEY };
  }
  return { url: url || BUILD_PLACEHOLDER_URL, anonKey: anonKey || BUILD_PLACEHOLDER_ANON_KEY };
}

export function getServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (value) return value;
  if (isNextBuildPhase()) return "build-placeholder-service-role-key";
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
}

export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim()?.replace(/^/, "https://") ||
    "http://localhost:3000"
  );
}

export function assertPublicEnv(): void {
  for (const key of requiredServerVars) {
    if (!process.env[key]?.trim()) {
      throw new Error(`${key} is missing. Copy .env.example to .env.local and fill values.`);
    }
  }
}

export function assertAdminEnv(): void {
  assertPublicEnv();
  for (const key of requiredAdminVars) {
    if (!process.env[key]?.trim()) {
      throw new Error(`${key} is required for admin/backup operations.`);
    }
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
