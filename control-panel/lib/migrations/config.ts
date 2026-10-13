/**
 * Tenant migration settings from the control panel's env (server only). The "Migrate this
 * tenant" button needs only the Management API token; without it the panel says so.
 */
import { erpSqlDir } from "../provisioning/config.ts";

export interface MigrationConfig {
  managementToken: string;
  sqlDir: string;
}

export function migrationConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string
): { config: MigrationConfig | null; missing: "SUPABASE_MANAGEMENT_API_TOKEN"[] } {
  const managementToken = (env.SUPABASE_MANAGEMENT_API_TOKEN ?? "").trim();
  if (!managementToken) return { config: null, missing: ["SUPABASE_MANAGEMENT_API_TOKEN"] };
  return { config: { managementToken, sqlDir: erpSqlDir(env, cwd) }, missing: [] };
}
