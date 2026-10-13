"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { migrateTenant, type TenantOutcome } from "@/lib/migrations/runner";
import { migrationConfig, migrationDeps } from "@/lib/migrations/server";
import { SKIPPED_STATUSES } from "@/lib/migrations/plan";
import { loadMigrationView, type MigrationView } from "./view";

export interface MigrateResult {
  /** i18n key under migrations.outcomes, or migrations.errors for a refusal. */
  outcome: TenantOutcome | "notConfigured" | "notMigratable" | "failedToStart";
  applied: string[];
  version: string | null;
  error: string | null;
  view: MigrationView;
}

/** "Migrate this tenant": applies every pending migration file to this tenant only. */
export async function migrateTenantNow(tenantId: string): Promise<MigrateResult> {
  await requireAdmin();
  const supabase = await createClient();
  const refuse = async (outcome: MigrateResult["outcome"]): Promise<MigrateResult> => ({
    outcome,
    applied: [],
    version: null,
    error: null,
    view: await loadMigrationView(supabase, tenantId),
  });

  const { config } = migrationConfig();
  if (!config) return refuse("notConfigured");
  let deps;
  try {
    deps = migrationDeps(supabase, config);
  } catch {
    return refuse("failedToStart");
  }
  const target = (await deps.store.listTenants()).find((t) => t.id === tenantId);
  if (!target || !target.projectRef || (SKIPPED_STATUSES as readonly string[]).includes(target.status)) {
    return refuse("notMigratable");
  }

  const result = await migrateTenant(deps, target, { runId: `panel-${Date.now()}`, dryRun: false });
  await supabase.rpc("log_platform_action", {
    p_action: "migrate",
    p_entity_table: "tenants",
    p_entity_id: tenantId,
    p_details: { outcome: result.outcome, applied: result.applied, version: result.version },
  });
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath("/tenants");
  return {
    outcome: result.outcome,
    applied: result.applied,
    version: result.version,
    error: result.error,
    view: await loadMigrationView(supabase, tenantId),
  };
}

/** Marks this tenant as the canary (the one that gets new migrations first), or unmarks it. */
export async function setCanary(tenantId: string, isCanary: boolean): Promise<MigrationView> {
  await requireAdmin();
  const supabase = await createClient();
  if (isCanary) {
    // At most one canary (unique index): clear the old one first.
    await supabase.from("tenant_databases").update({ is_canary: false }).eq("is_canary", true).neq("tenant_id", tenantId);
  }
  const { error } = await supabase.from("tenant_databases").update({ is_canary: isCanary }).eq("tenant_id", tenantId);
  if (!error) {
    await supabase.rpc("log_platform_action", {
      p_action: "canary",
      p_entity_table: "tenants",
      p_entity_id: tenantId,
      p_details: { is_canary: isCanary },
    });
  }
  revalidatePath(`/tenants/${tenantId}`);
  return loadMigrationView(supabase, tenantId);
}
