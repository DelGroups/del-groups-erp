/**
 * Centralized environment variable access for server and client.
 * Never hardcode secrets — always read from process.env.
 */

const requiredServerVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const requiredAdminVars = ["SUPABASE_SERVICE_ROLE_KEY"] as const;

// Supabase URL and keys are resolved per tenant at runtime in
// src/lib/tenant/config.ts; don't read them from process.env here.
export type { SupabaseConfigIssue } from "@/lib/tenant/config";

/** True while `next build` is prerendering pages (env may be unset on CI). */
export function isNextBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  }

  return "http://localhost:3000";
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
