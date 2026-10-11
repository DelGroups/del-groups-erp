import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isNextBuildPhase } from "@/lib/env";
import {
  getTenantConfig,
  getTenantServiceRoleKey,
  supabaseClientCredentials,
  type TenantConfigSource,
} from "@/lib/tenant/config";

/**
 * Service-role client — bypasses RLS, so it must never be imported from a
 * client component. Only reachable from route handlers under /api.
 */
export function createSupabaseAdminClient(source?: TenantConfigSource) {
  const tenant = getTenantConfig(source);
  const { url } = supabaseClientCredentials(tenant);
  let serviceRoleKey = getTenantServiceRoleKey(tenant);
  if (!serviceRoleKey) {
    if (!isNextBuildPhase()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
    serviceRoleKey = "build-placeholder-service-role-key";
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
