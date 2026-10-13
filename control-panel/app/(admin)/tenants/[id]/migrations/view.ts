import type { createClient } from "@/lib/supabase/server";

export interface MigrationLogLine {
  id: number;
  run_id: string;
  migration: string | null;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
}

export interface MigrationView {
  isCanary: boolean;
  status: "idle" | "running" | "succeeded" | "failed";
  error: string | null;
  log: MigrationLogLine[];
}

const LOG_LIMIT = 100;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The tenant's migration state and its latest log lines, for the tenant page. */
export async function loadMigrationView(supabase: Supabase, tenantId: string): Promise<MigrationView> {
  const [dbRes, logRes] = await Promise.all([
    supabase
      .from("tenant_databases")
      .select("is_canary, migration_status, migration_error")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("tenant_migration_log")
      .select("id, run_id, migration, level, message, created_at")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: false })
      .limit(LOG_LIMIT),
  ]);
  const db = dbRes.data as { is_canary: boolean; migration_status: MigrationView["status"]; migration_error: string | null } | null;
  return {
    isCanary: db?.is_canary === true,
    status: db?.migration_status ?? "idle",
    error: db?.migration_error ?? null,
    log: ((logRes.data ?? []) as MigrationLogLine[]).reverse(),
  };
}
