import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getPublicSupabaseUrl, getServiceRoleKey } from "@/lib/env";

/**
 * Service-role client — bypasses RLS, so it must never be imported from a
 * client component. Only reachable from route handlers under /api.
 */
export function createSupabaseAdminClient() {
  const url = getPublicSupabaseUrl();
  const serviceRoleKey = getServiceRoleKey();

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
