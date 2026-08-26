import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Standard Supabase public env vars (inlined at build time on Vercel/Hostinger).
 */
const FALLBACK_SUPABASE_URL = "https://placeholder.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

function readEnv(key: string): string {
  return process.env[key]?.trim().replace(/^["']|["']$/g, "") || "";
}

function getConfig() {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") || FALLBACK_SUPABASE_URL;
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || FALLBACK_ANON_KEY;
  const isConfigured = Boolean(readEnv("NEXT_PUBLIC_SUPABASE_URL")) &&
    Boolean(readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  return { url, anonKey, isConfigured };
}

let browserClient: SupabaseClient<Database> | null = null;

function createClient(): SupabaseClient<Database> {
  const { url, anonKey } = getConfig();
  return createBrowserClient<Database>(url, anonKey);
}

/** Lazy browser client — avoids SSR/module-init crashes on Vercel. */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (typeof window === "undefined") {
    return createClient();
  }
  if (!browserClient) {
    browserClient = createClient();
  }
  return browserClient;
}

/** @deprecated use getSupabaseClient() — kept for existing imports */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Exposed for login/debug logging — never log the anon key. */
export function getSupabaseClientInfo() {
  const { url, isConfigured } = getConfig();
  return { url, isConfigured };
}

if (typeof window !== "undefined") {
  const { isConfigured } = getConfig();
  if (!isConfigured) {
    console.warn(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. " +
        "Auth requests will fail until environment variables are configured."
    );
  }
}
