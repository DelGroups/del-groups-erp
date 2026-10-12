import { cache } from "react";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { TenantConfigSource } from "@/lib/tenant/config";
import { getServerTenantConfig, isMultiTenant } from "@/lib/tenant/server";
import { requestTenantSource } from "@/lib/tenant/request";
import { isMissingTableError } from "@/lib/company/profile";
import {
  firstDisabledModule,
  ModuleDisabledError,
  notInPlanBody,
  resolveEnabledModules,
  TENANT_MODULES_TABLE,
  type TenantModuleRow,
} from "@/modules/enabled";

export { ModuleDisabledError };
import type { ModuleId } from "@/modules/types";

const TTL_MS = 30_000;
const FAILURE_TTL_MS = 5_000;
const TIMEOUT_MS = 1_500;
const memo = new Map<string, { rows: TenantModuleRow[] | null; expires: number }>();

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * tenant_modules rows of the tenant, read with the service role (the proxy has
 * no user session to read with) and cached in memory per tenant. Null when the
 * table does not exist yet, or cannot be read: then every module is enabled, so
 * a database hiccup never locks people out of their ERP.
 */
async function loadRows(requested?: TenantConfigSource): Promise<TenantModuleRow[] | null> {
  const source = await requestTenantSource(requested);
  const { tenantId } = getServerTenantConfig(source);
  const cached = memo.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.rows;

  let rows: TenantModuleRow[] | null = null;
  let ttl = TTL_MS;
  try {
    const admin = (await createSupabaseAdminClient(source)) as unknown as SupabaseClient;
    const { data, error } = await withTimeout(
      admin.from(TENANT_MODULES_TABLE).select("module_id, enabled, installed_at, version"),
      TIMEOUT_MS
    );
    if (error && !isMissingTableError(error)) throw new Error(error.message);
    rows = error ? null : ((data ?? []) as TenantModuleRow[]);
  } catch (error) {
    console.warn("[modules] tenant_modules unavailable, all modules enabled:", error instanceof Error ? error.message : error);
    ttl = FAILURE_TTL_MS;
  }
  memo.set(tenantId, { rows, expires: Date.now() + ttl });
  return rows;
}

/** Rows as stored (null before the migration); for the admin page. */
export async function getTenantModuleRows(source?: TenantConfigSource): Promise<TenantModuleRow[] | null> {
  return loadRows(source);
}

const enabledForRequest = cache(async (): Promise<ReadonlySet<ModuleId>> => resolveEnabledModules(await loadRows()));

/**
 * Modules enabled for the tenant serving this request (cached per request in
 * server components and actions; pass the request in the proxy).
 */
export async function getEnabledModules(source?: TenantConfigSource): Promise<ReadonlySet<ModuleId>> {
  if (source) return resolveEnabledModules(await loadRows(source));
  return enabledForRequest();
}

export async function isModuleEnabled(id: ModuleId, source?: TenantConfigSource): Promise<boolean> {
  return (await getEnabledModules(source)).has(id);
}

/** For server actions: throws ModuleDisabledError when any of the modules is disabled. */
export async function assertModulesEnabled(...ids: (ModuleId | null | undefined)[]): Promise<void> {
  const disabled = firstDisabledModule(await getEnabledModules(), ids);
  if (disabled) throw new ModuleDisabledError(disabled);
}

/** For API routes: a 403 "not in your plan" response, or null when the module is enabled. */
export async function requireModuleApi(id: ModuleId, request?: Request): Promise<NextResponse | null> {
  if (await isModuleEnabled(id, request)) return null;
  const { body, status } = notInPlanBody(id);
  return NextResponse.json(body, { status });
}

/** Drops the cached rows, e.g. after the control panel changed them. */
export function invalidateEnabledModules(source?: TenantConfigSource): void {
  // Without a request at hand in multi-tenant mode the tenant is unknown: drop all.
  if (!source && isMultiTenant()) memo.clear();
  else memo.delete(getServerTenantConfig(source).tenantId);
}
