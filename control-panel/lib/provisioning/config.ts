/**
 * Provisioning settings from the control panel's env (server only). Provisioning is off
 * when any required value is missing; the panel then shows why instead of the button.
 * The Management API token is only read here and only sent in an Authorization header.
 */
import path from "node:path";

export interface ProvisioningConfig {
  managementToken: string;
  organizationSlug: string;
  /** Supabase smart region group; EU by default (plan §4.3). */
  regionGroup: "emea" | "americas" | "apac";
  /** Tenants are served at <slug>.<baseDomain>. */
  baseDomain: string;
  /** Folder holding the ERP's baseline/, modules/ and migrations/ SQL. */
  sqlDir: string;
}

export type MissingSetting = "SUPABASE_MANAGEMENT_API_TOKEN" | "SUPABASE_ORG_SLUG" | "TENANT_BASE_DOMAIN";

export function provisioningConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string
): { config: ProvisioningConfig | null; missing: MissingSetting[] } {
  const value = (name: string) => (env[name] ?? "").trim();
  const missing: MissingSetting[] = [];
  const managementToken = value("SUPABASE_MANAGEMENT_API_TOKEN");
  const organizationSlug = value("SUPABASE_ORG_SLUG");
  const baseDomain = value("TENANT_BASE_DOMAIN").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!managementToken) missing.push("SUPABASE_MANAGEMENT_API_TOKEN");
  if (!organizationSlug) missing.push("SUPABASE_ORG_SLUG");
  if (!baseDomain) missing.push("TENANT_BASE_DOMAIN");
  const group = value("SUPABASE_REGION_GROUP");
  const regionGroup = group === "americas" || group === "apac" ? group : "emea";
  const sqlDir = value("ERP_SQL_DIR") || path.resolve(cwd, "..", "supabase");
  if (missing.length) return { config: null, missing };
  return { config: { managementToken, organizationSlug, regionGroup, baseDomain, sqlDir }, missing };
}
