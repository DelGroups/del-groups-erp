import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { controlPlaneSupabase } from "@/lib/env";

/**
 * Request-scoped client for server components and server actions. It acts as the
 * signed-in admin: RLS in the control-plane database decides what it may read or write.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = controlPlaneSupabase();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot set cookies; proxy.ts refreshes the session.
        }
      },
    },
  });
}
