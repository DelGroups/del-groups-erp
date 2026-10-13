/**
 * Server-side limit checks (prompt 12). Server only (service role).
 *
 * - Seats: in multi-tenant mode the seat limit comes from the control plane
 *   (tenant_entitlements(), the plan as sold); otherwise, or if the control plane cannot be
 *   reached, from the tenant's own tenant_limits row. The database trigger
 *   trg_profiles_seat_limit is the second layer.
 * - Storage and AI: tenant_limit_status() of the tenant database.
 *
 * Without limits (no tenant_limits row, no subscription, or before the migration) every
 * check allows everything, exactly as before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { controlPlane, getServerTenantConfig } from "@/lib/tenant/server";
import type { TenantConfigSource } from "@/lib/tenant/config";
import {
  limitState,
  parseLimitStatus,
  seatsAvailable,
  UNLIMITED,
  type LimitState,
  type LimitUsage,
  type TenantLimitStatus,
} from "./limits";

const CONTROL_PLANE_TIMEOUT_MS = 3_000;

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "")));
}

/** Limits and live usage of the tenant serving this request. */
export async function loadLimitStatus(source?: TenantConfigSource): Promise<TenantLimitStatus> {
  try {
    const admin = (await createSupabaseAdminClient(source)) as unknown as SupabaseClient;
    const { data, error } = await admin.rpc("tenant_limit_status");
    if (error) {
      if (!isMissingFunction(error)) console.warn("[limits] tenant_limit_status failed:", error.message);
      return UNLIMITED;
    }
    return parseLimitStatus(data);
  } catch (error) {
    console.warn("[limits] tenant_limit_status unavailable:", error instanceof Error ? error.message : error);
    return UNLIMITED;
  }
}

/**
 * Seat limit as the control plane sells it: a number, null (no live subscription =
 * unlimited), or undefined when not in multi-tenant mode or the lookup failed.
 */
async function controlPlaneSeatLimit(source?: TenantConfigSource): Promise<number | null | undefined> {
  const cp = controlPlane();
  if (!cp) return undefined;
  const { tenantId } = getServerTenantConfig(source);
  try {
    const response = await fetch(`${cp.url}/rest/v1/rpc/tenant_entitlements`, {
      method: "POST",
      headers: { apikey: cp.serviceRoleKey, Authorization: `Bearer ${cp.serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_tenant_id: tenantId }),
      signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = (await response.json()) as { seat_limit?: number | null }[];
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return row && typeof row.seat_limit === "number" ? row.seat_limit : null;
  } catch (error) {
    console.warn("[limits] control plane entitlements unavailable, using tenant_limits:", error instanceof Error ? error.message : error);
    return undefined;
  }
}

export interface SeatCheck {
  allowed: boolean;
  used: number;
  limit: number | null;
}

/** Whether `adding` more users may become active. */
export async function checkSeats(adding = 1, source?: TenantConfigSource): Promise<SeatCheck> {
  const [status, fromPlan] = await Promise.all([loadLimitStatus(source), controlPlaneSeatLimit(source)]);
  const users: LimitUsage = { used: status.users.used, limit: fromPlan === undefined ? status.users.limit : fromPlan };
  return { allowed: seatsAvailable(users, adding), used: users.used, limit: users.limit };
}

export interface UsageCheck {
  allowed: boolean;
  state: LimitState;
  usage: LimitUsage;
}

/** Storage for new uploads, or AI for a new question: blocked at 100 %. */
export async function checkUsage(kind: "storage" | "ai", source?: TenantConfigSource): Promise<UsageCheck> {
  const usage = (await loadLimitStatus(source))[kind];
  const state = limitState(usage);
  return { allowed: state !== "blocked", state, usage };
}
