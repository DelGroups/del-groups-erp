import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import {
  getPublicSupabaseAnonKey,
  getPublicSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/env";

/** Returns true when the incoming request has a valid Supabase auth session. */
export async function hasAuthenticatedSession(request: NextRequest): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  try {
    const supabase = createServerClient<Database>(
      getPublicSupabaseUrl(),
      getPublicSupabaseAnonKey(),
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
