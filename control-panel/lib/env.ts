/**
 * The control panel's own Supabase project (never an ERP / tenant project).
 * Values come from control-panel/.env.local (see .env.example).
 */
export function controlPlaneSupabase(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Control panel is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in control-panel/.env.local"
    );
  }
  return { url, anonKey };
}
