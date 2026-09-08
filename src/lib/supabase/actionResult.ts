import { ActionAuthError } from "@/lib/auth/serverActionAuth";

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export function actionOk<T>(data?: T): { success: true; data?: T } {
  return { success: true, data };
}

export function actionFail(error: string): { success: false; error: string } {
  return { success: false, error };
}

export function catchActionError(err: unknown, fallback = "Failed"): ActionResult {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? err.message : fallback };
}
