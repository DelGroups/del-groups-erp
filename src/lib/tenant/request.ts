import { headers } from "next/headers";
import type { TenantConfigSource } from "./config";
import { getServerServiceRoleKey, getServerTenant, isMultiTenant, type ServerTenant } from "./server";

/**
 * The request to read the tenant from: `source` when given, otherwise (multi-tenant
 * mode only) the incoming request headers. In single-tenant mode headers() is never
 * called, so pages stay as static or dynamic as they were.
 */
export async function requestTenantSource(source?: TenantConfigSource): Promise<TenantConfigSource> {
  if (source || !isMultiTenant()) return source;
  try {
    return await headers();
  } catch {
    // Outside a request (build, scripts): no tenant.
    return undefined;
  }
}

/** Tenant of the current request. */
export async function currentTenant(source?: TenantConfigSource): Promise<ServerTenant> {
  return getServerTenant(await requestTenantSource(source));
}

/** URL and service-role key of the request's tenant, or null when it has none. */
async function tenantAdminCredentials(source?: TenantConfigSource): Promise<{ url: string; serviceRoleKey: string } | null> {
  const tenant = await currentTenant(source);
  if (!tenant.config.isConfigured) return null;
  const serviceRoleKey = await getServerServiceRoleKey(tenant.config);
  return serviceRoleKey ? { url: tenant.config.supabaseUrl, serviceRoleKey } : null;
}

// Lets the admin client (which client bundles also reach through shared modules) get the
// tenant without importing next/headers or node:crypto itself. Registered at server start
// (src/instrumentation.ts) and whenever this module is loaded (proxy, layout code).
globalThis.__erpTenantAdminCredentials = tenantAdminCredentials;
