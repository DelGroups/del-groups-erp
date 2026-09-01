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
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

function cleanEnv(value: string | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

export function isValidSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export function isValidSupabaseAnonKey(key: string): boolean {
  if (key.startsWith("eyJ") && key.length > 40) return true;
  if (key.startsWith("sb_publishable_") && key.length > 24) return true;
  return false;
}

export type SupabaseConfigIssue = "missing" | "bad_url" | "bad_key" | null;

export function getPublicSupabaseConfigStatus() {
  const rawUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const rawKey = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const urlValid = isValidSupabaseUrl(rawUrl);
  const keyValid = isValidSupabaseAnonKey(rawKey);
  const configIssue: SupabaseConfigIssue = !rawUrl || !rawKey
    ? "missing"
    : !urlValid
      ? "bad_url"
      : !keyValid
        ? "bad_key"
        : null;

  return {
    url: urlValid ? rawUrl : BUILD_PLACEHOLDER_URL,
    anonKey: keyValid ? rawKey : BUILD_PLACEHOLDER_ANON_KEY,
    isConfigured: urlValid && keyValid,
    configIssue,
    rawUrlPreview: rawUrl ? rawUrl.slice(0, 32) : "",
  };
}

export function isSupabaseConfigured(): boolean {
  return getPublicSupabaseConfigStatus().isConfigured;
}

export function getPublicSupabaseUrl(): string {
  return getPublicSupabaseConfigStatus().url;
}

export function getPublicSupabaseAnonKey(): string {
  return getPublicSupabaseConfigStatus().anonKey;
}

/** True while `next build` is prerendering pages (env may be unset on CI). */
export function isNextBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function getServiceRoleKey(): string {
  const value = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (value) return value;
  if (isNextBuildPhase()) return "build-placeholder-service-role-key";
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
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
