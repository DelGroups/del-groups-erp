/**
 * Getting a provisioned tenant's admin in (tenant page → "Admin access"):
 *
 * - reapplyEmailSettings: sends the same Auth settings configure_auth sends (site URL,
 *   invite-only, language templates, custom SMTP when set), for tenants created before.
 * - createAdminLink: a fresh invite link, or a set-password (recovery) link when the admin
 *   already exists, that Del sends himself (WhatsApp, email). The tenant's server key is
 *   fetched fresh from the Management API, used once and dropped; the link is returned to
 *   the caller and never stored or logged.
 */
import type { ProvisioningConfig } from "./config.ts";
import { configSecrets, projectApiUrl, tenantAuthConfig, type TenantAuth } from "./engine.ts";
import { redactSecrets, type ManagementApi } from "./managementApi.ts";

/** Tenants whose admin may get a link (not while provisioning, nor once suspended or cancelled). */
export const LINK_STATUSES = ["trial", "active"] as const;

export interface AccessTenant {
  name: string;
  slug: string;
  status: string;
  language: "az" | "en" | "ru";
  /** Supabase project ref from tenant_databases. */
  projectRef: string | null;
  /** Primary domain from tenant_domains; <slug>.<TENANT_BASE_DOMAIN> when there is none. */
  primaryDomain: string | null;
}

export type AccessError = "notProvisioned" | "notLinkable" | "noAdminEmail" | "failed";

export type AccessResult<T> = { ok: true; value: T } | { ok: false; error: AccessError; detail?: string };

export function tenantSiteUrl(tenant: Pick<AccessTenant, "slug" | "primaryDomain">, config: ProvisioningConfig): string {
  return `https://${tenant.primaryDomain || `${tenant.slug}.${config.baseDomain}`}`;
}

function failure(error: unknown, config: ProvisioningConfig, secrets: string[] = []): { ok: false; error: "failed"; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: "failed", detail: redactSecrets(message, [...configSecrets(config), ...secrets]) };
}

export async function reapplyEmailSettings(
  deps: { api: ManagementApi; config: ProvisioningConfig },
  tenant: AccessTenant
): Promise<AccessResult<{ customSmtp: boolean; siteUrl: string }>> {
  if (!tenant.projectRef) return { ok: false, error: "notProvisioned" };
  const siteUrl = tenantSiteUrl(tenant, deps.config);
  try {
    await deps.api.updateAuthConfig(tenant.projectRef, tenantAuthConfig(tenant, siteUrl, deps.config));
    return { ok: true, value: { customSmtp: Boolean(deps.config.smtp), siteUrl } };
  } catch (error) {
    return failure(error, deps.config);
  }
}

export interface AdminLink {
  link: string;
  kind: "invite" | "recovery";
  email: string;
  /** How long the link works, in seconds (the project's mailer_otp_exp). */
  validForSeconds: number;
  expiresAt: string;
}

export async function createAdminLink(
  deps: { api: ManagementApi; auth: TenantAuth; config: ProvisioningConfig; now(): number },
  tenant: AccessTenant,
  admin: { email: string; fullName: string } | null
): Promise<AccessResult<AdminLink>> {
  if (!tenant.projectRef) return { ok: false, error: "notProvisioned" };
  if (!(LINK_STATUSES as readonly string[]).includes(tenant.status)) return { ok: false, error: "notLinkable" };
  if (!admin?.email) return { ok: false, error: "noAdminEmail" };

  const ref = tenant.projectRef;
  let serviceRoleKey = "";
  try {
    // Fetched fresh, like invite_admin: the control panel never reads keys back from Vault.
    serviceRoleKey = (await deps.api.getKeys(ref)).serviceRoleKey;
    const { link, kind } = await deps.auth.generateAdminLink({
      apiUrl: projectApiUrl(ref),
      serviceRoleKey,
      email: admin.email,
      fullName: admin.fullName || admin.email,
      redirectTo: `${tenantSiteUrl(tenant, deps.config)}/auth/set-password`,
    });
    const validForSeconds = await deps.api.getLinkLifetime(ref);
    return {
      ok: true,
      value: {
        link,
        kind,
        email: admin.email,
        validForSeconds,
        expiresAt: new Date(deps.now() + validForSeconds * 1000).toISOString(),
      },
    };
  } catch (error) {
    return failure(error, deps.config, [serviceRoleKey]);
  }
}
