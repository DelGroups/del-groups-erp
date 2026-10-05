import { isAdminRole, type UserProfile } from "@/types/database.types";

/**
 * Feature flag for the native Claude assistant.
 *
 *   AI_NATIVE_ENABLED=1        turn it on (off by default, so merging changes nothing)
 *   AI_NATIVE_AUDIENCE=admins  who sees it: "admins" (default) or "all"
 *   ANTHROPIC_API_KEY          required; set on the server only, never in the repo
 *   AI_MODEL_FAST / AI_MODEL_STANDARD / AI_MODEL_DEEP   optional model overrides
 */

function cleanEnv(value: string | undefined): string {
  return (value || "").trim().replace(/^["']|["']$/g, "");
}

export type NativeAssistantAccess =
  | { enabled: true; apiKey: string }
  | { enabled: false; reason: "disabled" | "no_api_key" | "not_in_audience" };

export function nativeAssistantAccess(profile: UserProfile | null): NativeAssistantAccess {
  const flag = cleanEnv(process.env.AI_NATIVE_ENABLED).toLowerCase();
  if (flag !== "1" && flag !== "true") return { enabled: false, reason: "disabled" };
  const apiKey = cleanEnv(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) return { enabled: false, reason: "no_api_key" };
  const audience = cleanEnv(process.env.AI_NATIVE_AUDIENCE).toLowerCase() || "admins";
  if (audience !== "all" && !isAdminRole(profile?.role)) {
    return { enabled: false, reason: "not_in_audience" };
  }
  return { enabled: true, apiKey };
}
