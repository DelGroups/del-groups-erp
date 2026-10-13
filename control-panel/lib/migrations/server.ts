/**
 * Builds the migration engine's dependencies for a server action: the signed-in admin's
 * control-plane client and the Management API (token from env).
 */
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { baselineVersion } from "../provisioning/plan.ts";
import { createManagementApi } from "../provisioning/managementApi.ts";
import { migrationConfigFromEnv, type MigrationConfig } from "./config.ts";
import { latestVersion, migrationFiles } from "./plan.ts";
import type { MigrationDeps } from "./runner.ts";
import { managementApiExecutor, supabaseMigrationStore } from "./store.ts";

export function migrationConfig(): ReturnType<typeof migrationConfigFromEnv> {
  return migrationConfigFromEnv(process.env, process.cwd());
}

export function migrationDeps(supabase: SupabaseClient, config: MigrationConfig): MigrationDeps {
  const api = createManagementApi({ token: config.managementToken, fetch: (input, init) => fetch(input, init) });
  return {
    store: supabaseMigrationStore(supabase),
    executor: managementApiExecutor(api),
    files: migrationFiles(config.sqlDir),
    baselineVersion: baselineVersion(config.sqlDir),
    readFile: (path) => readFileSync(path, "utf8"),
    now: Date.now,
    secrets: [config.managementToken],
  };
}

/** Newest ERP migration version in the repo, or null when the SQL folder is not there. */
export function repoLatestVersion(sqlDir: string): string | null {
  try {
    return latestVersion(sqlDir);
  } catch {
    return null;
  }
}
