import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { fetchUserProfile } from "@/lib/auth/profile";
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl } from "@/lib/env";

/**
 * Request-scoped Supabase client for server components and route handlers.
 * Reads and refreshes the session from the incoming cookies.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    getPublicSupabaseUrl(),
    getPublicSupabaseAnonKey(),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot write cookies; proxy.ts refreshes them.
          }
        },
      },
    }
  );
}

/** Session user plus the joined profile/role, or nulls when signed out. */
export async function getServerAuthContext() {
  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) return { client, user: null, profile: null, isActive: false };

  const profile = await fetchUserProfile(client, user.id);
  const isActive = profile?.is_active !== false;

  return { client, user, profile, isActive };
}
