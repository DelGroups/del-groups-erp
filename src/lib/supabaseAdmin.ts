import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isNextBuildPhase } from "@/lib/env";
import {
  getTenantConfig,
  getTenantServiceRoleKey,
  isMultiTenantEnv,
  supabaseClientCredentials,
  unresolvedTenantConfig,
  type TenantConfigSource,
} from "@/lib/tenant/config";

/**
 * URL and service-role key of the request's tenant in multi-tenant mode, registered by
 * src/lib/tenant/request.ts (server only, loaded from src/instrumentation.ts). This file
 * must not import that module, next/headers or node:crypto: some client bundles import
 * modules that import this file.
 */
async function multiTenantCredentials(source?: TenantConfigSource): Promise<{ url: string; serviceRoleKey: string }> {
  const credentials = await globalThis.__erpTenantAdminCredentials?.(source);
  // No helper or no tenant: an unusable client, never another tenant's database.
  return credentials ?? { url: supabaseClientCredentials(unresolvedTenantConfig()).url, serviceRoleKey: "" };
}

/**
 * Service-role client — bypasses RLS, so it must never be imported from a
 * client component. Only reachable from server code.
 *
 * Async because in multi-tenant mode it needs the request's tenant (signed proxy
 * headers) and that tenant's service-role key from the control plane. In
 * single-tenant mode it uses SUPABASE_SERVICE_ROLE_KEY exactly as before.
 */
export async function createSupabaseAdminClient(source?: TenantConfigSource) {
  let url: string;
  let serviceRoleKey: string;
  if (isMultiTenantEnv()) {
    ({ url, serviceRoleKey } = await multiTenantCredentials(source));
  } else {
    const tenant = getTenantConfig(source);
    url = supabaseClientCredentials(tenant).url;
    serviceRoleKey = getTenantServiceRoleKey(tenant);
  }
  if (!serviceRoleKey) {
    if (!isNextBuildPhase()) {
      throw new Error(
        isMultiTenantEnv()
          ? "No tenant resolved for this request (or the control plane has no service key for it)."
          : "SUPABASE_SERVICE_ROLE_KEY is not configured."
      );
    }
    serviceRoleKey = "build-placeholder-service-role-key";
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
