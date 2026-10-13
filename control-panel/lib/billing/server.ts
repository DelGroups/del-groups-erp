/**
 * Server helpers of the billing screens: copying a subscription to the tenant database with
 * the Management API token from env (the same token as provisioning and migrations).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createManagementApi } from "../provisioning/managementApi.ts";
import { migrationConfigFromEnv } from "../migrations/config.ts";
import { supabaseSyncStore } from "./store.ts";
import { syncTenant } from "./sync.ts";

export type SyncView =
  | { status: "synced" }
  | { status: "failed"; error: string }
  | { status: "skipped" }
  | { status: "not_configured" };

export async function syncTenantNow(supabase: SupabaseClient, tenantId: string): Promise<SyncView> {
  const { config } = migrationConfigFromEnv(process.env, process.cwd());
  if (!config) return { status: "not_configured" };
  const api = createManagementApi({ token: config.managementToken, fetch: (input, init) => fetch(input, init) });
  const outcome = await syncTenant({ store: supabaseSyncStore(supabase), api, secrets: [config.managementToken] }, tenantId);
  await supabase.rpc("log_platform_action", {
    p_action: "tenant_sync",
    p_entity_table: "tenants",
    p_entity_id: tenantId,
    p_details: outcome.status === "failed" ? { status: "failed" } : { status: outcome.status },
  });
  if (outcome.status === "synced") return { status: "synced" };
  if (outcome.status === "skipped") return { status: "skipped" };
  return { status: "failed", error: outcome.error };
}
