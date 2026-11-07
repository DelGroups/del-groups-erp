/**
 * Provisioning settings from the control panel's env (server only). Provisioning is off
 * when any required value is missing; the panel then shows why instead of the button.
 * The Management API token is only read here and only sent in an Authorization header.
 */
import path from "node:path";
import { tenantSmtpFromEnv, type SmtpSetting, type TenantSmtp } from "./smtp.ts";

export interface ProvisioningConfig {
  managementToken: string;
  organizationSlug: string;
  /** Supabase smart region group; EU by default (plan §4.3). */
  regionGroup: "emea" | "americas" | "apac";
  /** Tenants are served at <slug>.<baseDomain>. */
  baseDomain: string;
  /** Folder holding the ERP's baseline/, modules/ and migrations/ SQL. */
  sqlDir: string;
  /** Custom SMTP for the tenants' Auth emails (TENANT_SMTP_*); null = Supabase's default email. */
  smtp?: TenantSmtp | null;
}

/** A TENANT_SMTP_* name appears only when SMTP is partly set or invalid (all unset is fine). */
export type MissingSetting = "SUPABASE_MANAGEMENT_API_TOKEN" | "SUPABASE_ORG_SLUG" | "TENANT_BASE_DOMAIN" | SmtpSetting;

/** Folder with the ERP's baseline/, modules/ and migrations/ SQL (ERP_SQL_DIR, else ../supabase). */
export function erpSqlDir(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  return (env.ERP_SQL_DIR ?? "").trim() || path.resolve(cwd, "..", "supabase");
}

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
  const sqlDir = erpSqlDir(env, cwd);
  // Half-filled SMTP blocks provisioning: a tenant created then would silently fall back to
  // Supabase's default email, which never reaches a real admin.
  const { smtp, missing: smtpMissing } = tenantSmtpFromEnv(env);
  missing.push(...smtpMissing);
  if (missing.length) return { config: null, missing };
  return { config: { managementToken, organizationSlug, regionGroup, baseDomain, sqlDir, smtp }, missing };
}
