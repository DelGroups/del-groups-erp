import { supabase } from "@/lib/supabase";

/** Removes Supabase auth entries from browser storage. */
export function clearSupabaseAuthStorage(): void {
  if (typeof window === "undefined") return;

  for (const storage of [localStorage, sessionStorage]) {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (key.startsWith("sb-") || key.includes("supabase.auth")) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      storage.removeItem(key);
    }
  }
}

/** Signs out, clears persisted auth state, and hard-navigates to login. */
export async function signOutAndRedirect(loginPath = "/login"): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    console.warn("[auth] signOut failed:", error);
  }

  clearSupabaseAuthStorage();

  if (typeof window !== "undefined") {
    window.location.replace(loginPath);
  }
}
