import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { getTenantConfig, toPublicTenantConfig } from "@/lib/tenant/config";

/** Returns true when the incoming request has a valid Supabase auth session. */
export async function hasAuthenticatedSession(request: NextRequest): Promise<boolean> {
  const config = toPublicTenantConfig(getTenantConfig(request));
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
