import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

/**
 * Standard Supabase public env vars (inlined at build time on Vercel/Hostinger).
 * Fallback URL/key prevent client-side fetch from crashing when env is temporarily unset.
 */
const FALLBACK_SUPABASE_URL = "https://placeholder.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/^["']|["']$/g, "") ||
  FALLBACK_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim().replace(/^["']|["']$/g, "") ||
  FALLBACK_ANON_KEY;

const isSupabaseConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/^["']|["']$/g, "")) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim().replace(/^["']|["']$/g, ""));

if (typeof window !== "undefined" && !isSupabaseConfigured) {
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. " +
      "Auth requests will fail until environment variables are configured."
  );
}

/**
 * Browser client. Persists the session in cookies rather than localStorage so
 * `proxy.ts`, server components and route handlers can read the same session.
 */
export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);

/** Exposed for login/debug logging — never log the anon key. */
export function getSupabaseClientInfo() {
  return {
    url: supabaseUrl,
    isConfigured: isSupabaseConfigured,
  };
}
