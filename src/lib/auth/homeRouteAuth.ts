import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { toPublicTenantConfig, type TenantConfigSource } from "@/lib/tenant/config";
import { getServerTenantConfig } from "@/lib/tenant/server";

/**
 * Returns true when the incoming request has a valid Supabase auth session.
 * `tenant` is where the tenant comes from (the proxy passes its signed headers);
 * defaults to the request.
 */
export async function hasAuthenticatedSession(
  request: NextRequest,
  tenant: TenantConfigSource = request
): Promise<boolean> {
  const config = toPublicTenantConfig(getServerTenantConfig(tenant));
  if (!config) return false;

  try {
    const supabase = createServerClient<Database>(
      config.url,
      config.anonKey,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {
            // Read-only check in proxy; session refresh happens in route handlers.
          },
        },
      }
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    return Boolean(user) && !error;
  } catch {
    return false;
  }
}
