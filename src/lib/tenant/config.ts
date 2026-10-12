/**
 * Runtime Supabase config for the current tenant.
 *
 * Every Supabase client (browser via /api/public-config, server, admin and
 * the proxy auth check) gets its URL and keys from here, never from
 * process.env.NEXT_PUBLIC_* directly. Those references are inlined by
 * `next build`, so a build made without them could never serve a tenant.
 *
 * Single-tenant mode (no control plane configured): one tenant, read from the
 * server env at request time, exactly as before. Multi-tenant mode
 * (CONTROL_PLANE_URL + CONTROL_PLANE_SERVICE_ROLE_KEY set): server code reads the
 * tenant from the signed headers src/proxy.ts adds (src/lib/tenant/server.ts);
 * this module then never falls back to the env project on the server.
 *
 * Kept free of Next/React imports and `@/` aliases so `node --test` can load it.
 */

export type SupabaseConfigIssue = "missing" | "bad_url" | "bad_key" | null;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Anything a caller has at hand: a Request, a Headers object, or nothing. */
export type TenantConfigSource = Request | Headers | { headers: Headers } | null | undefined;

export interface TenantConfig {
  /** Stable id of the tenant; "default" until multi-tenant lookup exists. */
  tenantId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  isConfigured: boolean;
  issue: SupabaseConfigIssue;
  /** First 32 chars of the raw URL, for error screens. */
  urlPreview: string;
  /** Set when the tenant came from the control plane (multi-tenant mode). */
  fromControlPlane?: boolean;
}

/** The part of a tenant config that is safe to send to the browser. */
export interface PublicTenantConfig {
  url: string;
  anonKey: string;
  /**
   * Present only for a control-plane tenant: its URL may be any https URL (or local http
   * in development), not only *.supabase.co. Absent in single-tenant mode.
   */
  controlPlane?: true;
}

export const DEFAULT_TENANT_ID = "default";

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const SERVICE_ROLE_VAR = "SUPABASE_SERVICE_ROLE_KEY";

/**
 * Values `next build` inlined, if the build had them. Used only as a fallback
 * when the runtime env lacks a value, so existing deployments keep working.
 * These must stay literal `process.env.X` reads for Next to inline them.
 */
function buildTimeEnv(): EnvSource {
  return {
    [URL_VAR]: process.env.NEXT_PUBLIC_SUPABASE_URL,
    [ANON_KEY_VAR]: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Live process env. A computed lookup is never inlined at build time. */
function runtimeEnv(): EnvSource {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

export function cleanEnvValue(value: string | undefined): string {
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

/**
 * URL a control-plane tenant may use: any https URL; plain http only for localhost
 * (local Supabase stacks) outside production. Env values keep isValidSupabaseUrl.
 */
export function isAllowedTenantApiUrl(url: string, production: boolean): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:" || production) return false;
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** True on the server when a control plane is configured (multi-tenant mode). */
export function isMultiTenantEnv(env: EnvSource = runtimeEnv()): boolean {
  return Boolean(cleanEnvValue(env.CONTROL_PLANE_URL) && cleanEnvValue(env.CONTROL_PLANE_SERVICE_ROLE_KEY));
}

export function isValidSupabaseAnonKey(key: string): boolean {
  if (key.startsWith("eyJ") && key.length > 40) return true;
  if (key.startsWith("sb_publishable_") && key.length > 24) return true;
  return false;
}

/** First non-empty value of `name` across the sources, in order. */
function pick(name: string, sources: readonly EnvSource[]): string {
  for (const source of sources) {
    const value = cleanEnvValue(source[name]);
    if (value) return value;
  }
  return "";
}

/** Pure resolution from env sources, highest priority first. */
export function resolveTenantConfigFromEnv(
  sources: readonly EnvSource[],
  tenantId: string = DEFAULT_TENANT_ID
): TenantConfig {
  const rawUrl = pick(URL_VAR, sources);
  const rawKey = pick(ANON_KEY_VAR, sources);
  const urlValid = isValidSupabaseUrl(rawUrl);
  const keyValid = isValidSupabaseAnonKey(rawKey);
  const issue: SupabaseConfigIssue =
    !rawUrl || !rawKey ? "missing" : !urlValid ? "bad_url" : !keyValid ? "bad_key" : null;

  return {
    tenantId,
    supabaseUrl: urlValid ? rawUrl.replace(/\/+$/, "") : "",
    supabaseAnonKey: keyValid ? rawKey : "",
    isConfigured: urlValid && keyValid,
    issue,
    urlPreview: rawUrl.slice(0, 32),
  };
}

/** Config of a tenant that could not be resolved: every client built from it fails. */
export function unresolvedTenantConfig(tenantId = "unresolved"): TenantConfig {
  return { tenantId, supabaseUrl: "", supabaseAnonKey: "", isConfigured: false, issue: "missing", urlPreview: "" };
}

/**
 * Single-tenant config from the env. In multi-tenant mode on the server this is
 * "unresolved": server code gets the tenant from src/lib/tenant/server.ts instead,
 * so a request can never fall through to the env project by accident.
 */
export function getTenantConfig(source?: TenantConfigSource): TenantConfig {
  void source;
  if (typeof window === "undefined" && isMultiTenantEnv()) return unresolvedTenantConfig();
  return resolveTenantConfigFromEnv([runtimeEnv(), buildTimeEnv()]);
}

/** Browser-safe subset, or null when the tenant is not configured. */
export function toPublicTenantConfig(config: TenantConfig): PublicTenantConfig | null {
  if (!config.isConfigured) return null;
  return config.fromControlPlane
    ? { url: config.supabaseUrl, anonKey: config.supabaseAnonKey, controlPlane: true }
    : { url: config.supabaseUrl, anonKey: config.supabaseAnonKey };
}

const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/**
 * URL/key to construct a client with. Falls back to a placeholder when the
 * tenant is not configured, so prerendering and error screens don't crash on
 * client construction; any request then fails instead.
 */
export function supabaseClientCredentials(config: TenantConfig): PublicTenantConfig {
  return toPublicTenantConfig(config) ?? { url: PLACEHOLDER_URL, anonKey: PLACEHOLDER_ANON_KEY };
}

/** Global the root layout sets so the browser has its config before any code runs. */
export const PUBLIC_CONFIG_GLOBAL = "__ERP_SUPABASE_CONFIG__";

/** Inline script that sets PUBLIC_CONFIG_GLOBAL, safe to embed in HTML. */
export function publicConfigScript(config: PublicTenantConfig | null): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `window.${PUBLIC_CONFIG_GLOBAL}=${json};`;
}

/** Validates an untrusted value (embedded global or API payload) as a public config. */
export function parsePublicTenantConfig(value: unknown): PublicTenantConfig | null {
  if (!value || typeof value !== "object") return null;
  const { url, anonKey, controlPlane } = value as Record<string, unknown>;
  if (typeof url !== "string" || typeof anonKey !== "string") return null;
  if (!isValidSupabaseAnonKey(anonKey)) return null;
  if (controlPlane === true) {
    return isAllowedTenantApiUrl(url, process.env.NODE_ENV === "production") ? { url, anonKey, controlPlane: true } : null;
  }
  return isValidSupabaseUrl(url) ? { url, anonKey } : null;
}

/** Service-role key of the tenant. Server only; never send it to the browser. */
export function getTenantServiceRoleKey(
  config: TenantConfig,
  env: EnvSource = runtimeEnv()
): string {
  void config;
  return cleanEnvValue(env[SERVICE_ROLE_VAR]);
}
