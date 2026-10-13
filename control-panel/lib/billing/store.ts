/**
 * Control-plane side of the subscription sync, through a Supabase client: the signed-in
 * admin's (panel) or a service-role client (scripts/tenants/usage-snapshot.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntitlementRow, SyncStore } from "./sync.ts";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function supabaseSyncStore(supabase: SupabaseClient): SyncStore {
  return {
    async entitlements(tenantId) {
      const rows = check(await supabase.rpc("tenant_entitlements", { p_tenant_id: tenantId })) as EntitlementRow[] | null;
      return rows?.[0] ?? null;
    },
    async allModules() {
      const rows = check(await supabase.from("modules").select("id").eq("is_active", true).order("id")) as { id: string }[];
      return rows.map((r) => r.id);
    },
    async projectRef(tenantId) {
      const row = check(
        await supabase.from("tenant_databases").select("supabase_project_ref").eq("tenant_id", tenantId).maybeSingle()
      ) as { supabase_project_ref: string | null } | null;
      return row?.supabase_project_ref ?? null;
    },
    async recordSync(subscriptionId, result) {
      check(
        await supabase
          .from("subscriptions")
          .update({
            sync_status: result.status,
            sync_error: result.error,
            // A failure keeps the time of the last good sync.
            ...(result.status === "synced" ? { synced_at: new Date().toISOString() } : {}),
          })
          .eq("id", subscriptionId)
      );
    },
  };
}
