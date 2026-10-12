/**
 * The tenant of the current request, on the server (prompt 8).
 *
 * - Single-tenant mode (no CONTROL_PLANE_URL / CONTROL_PLANE_SERVICE_ROLE_KEY): the
 *   tenant comes from NEXT_PUBLIC_SUPABASE_* and SUPABASE_SERVICE_ROLE_KEY, exactly as
 *   before this change.
 * - Multi-tenant mode: src/proxy.ts resolves the Host through the control plane and adds
 *   signed x-erp-tenant-* headers; this module verifies them. No verified headers means
 *   "unresolved": clients built from it fail instead of reaching another tenant's data.
 *   The service-role key is fetched from the control plane by tenant id, kept in memory
 *   and never sent to the browser.
 *
 * No Next imports (src/lib/tenant/request.ts adds the headers() helper).
 */
import {
  cleanEnvValue,
  getTenantConfig as getEnvTenantConfig,
  getTenantServiceRoleKey as getEnvServiceRoleKey,
  isAllowedTenantApiUrl,
  isValidSupabaseAnonKey,
  unresolvedTenantConfig,
  type TenantConfig,
  type TenantConfigSource,
} from "./config";
import {
  controlPlaneFromEnv,
  createTenantResolver,
  tenantHeaderKey,
  verifyTenantHeaders,
  type ControlPlaneEnv,
  type TenantResolver,
  type TenantStatus,
} from "./resolve";

export interface ServerTenant {
  config: TenantConfig;
  /** Null in single-tenant mode (no control plane, no statuses). */
  status: TenantStatus | null;
  slug: string | null;
}

export function controlPlane(): ControlPlaneEnv | null {
  return controlPlaneFromEnv(process.env);
}

/** True when a control plane is configured. */
export function isMultiTenant(): boolean {
  return controlPlane() !== null;
}

declare global {
  // One resolver (and cache) per process, shared by the proxy and route code.
  var __erpTenantResolver: { url: string; resolver: TenantResolver } | undefined;
  // Admin-client credentials of the request's tenant, registered by src/lib/tenant/request.ts.
  var __erpTenantAdminCredentials:
    | ((source?: TenantConfigSource) => Promise<{ url: string; serviceRoleKey: string } | null>)
    | undefined;
}

/** The control-plane resolver, or null in single-tenant mode. */
export function tenantResolver(): TenantResolver | null {
  const cp = controlPlane();
  if (!cp) return null;
  if (globalThis.__erpTenantResolver?.url !== cp.url) {
    globalThis.__erpTenantResolver = {
      url: cp.url,
      resolver: createTenantResolver({
        controlPlane: cp,
        fetch: (input, init) => fetch(input, init),
        production: process.env.NODE_ENV === "production",
      }),
    };
  }
  return globalThis.__erpTenantResolver.resolver;
}

function headersOf(source: TenantConfigSource): Pick<Headers, "get"> | null {
  if (!source) return null;
  if (source instanceof Headers) return source;
  if (typeof Request !== "undefined" && source instanceof Request) return source.headers;
  const maybe = source as { headers?: unknown; get?: unknown };
  if (typeof maybe.get === "function") return source as unknown as Pick<Headers, "get">;
  if (maybe.headers && typeof (maybe.headers as { get?: unknown }).get === "function") {
    return maybe.headers as Pick<Headers, "get">;
  }
  return null;
}

/** Tenant of the request `source` belongs to (sync: reads the proxy's signed headers). */
export function getServerTenant(source?: TenantConfigSource): ServerTenant {
  const cp = controlPlane();
  if (!cp) return { config: getEnvTenantConfig(source), status: null, slug: null };

  const headers = headersOf(source);
  const tenant = headers ? verifyTenantHeaders(headers, tenantHeaderKey(cp)) : null;
  if (!tenant) return { config: unresolvedTenantConfig(), status: null, slug: null };

  const production = process.env.NODE_ENV === "production";
  const ok = isAllowedTenantApiUrl(tenant.apiUrl, production) && isValidSupabaseAnonKey(tenant.anonKey);
  return {
    config: {
      tenantId: tenant.tenantId,
      supabaseUrl: ok ? tenant.apiUrl : "",
      supabaseAnonKey: ok ? tenant.anonKey : "",
      isConfigured: ok,
      issue: ok ? null : "bad_url",
      urlPreview: tenant.apiUrl.slice(0, 32),
      fromControlPlane: true,
    },
    status: tenant.status,
    slug: tenant.slug,
  };
}

export function getServerTenantConfig(source?: TenantConfigSource): TenantConfig {
  return getServerTenant(source).config;
}

/** Service-role key of the tenant. Server only; never send it to the browser. */
export async function getServerServiceRoleKey(config: TenantConfig): Promise<string> {
  const resolver = tenantResolver();
  if (!resolver) return getEnvServiceRoleKey(config);
  if (!config.isConfigured) return "";
  const record = await resolver.byId(config.tenantId);
  return cleanEnvValue(record?.serviceRoleKey);
}
