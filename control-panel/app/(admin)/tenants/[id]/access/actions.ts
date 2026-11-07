"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createManagementApi } from "@/lib/provisioning/managementApi";
import { provisioningConfig } from "@/lib/provisioning/server";
import { supabaseTenantAuth } from "@/lib/provisioning/tenantAuth";
import {
  createAdminLink,
  reapplyEmailSettings,
  type AccessError,
  type AccessTenant,
} from "@/lib/provisioning/tenantAccess";
import type { ProvisioningConfig } from "@/lib/provisioning/config";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AccessActionError = AccessError | "notConfigured";

export type ReapplyResult = { ok: true; customSmtp: boolean } | { ok: false; error: AccessActionError; detail?: string };

export type LinkResult =
  | { ok: true; link: string; kind: "invite" | "recovery"; email: string; validForSeconds: number; expiresAt: string }
  | { ok: false; error: AccessActionError; detail?: string };

async function loadTenant(supabase: Supabase, tenantId: string): Promise<AccessTenant | null> {
  const [tenantRes, dbRes, domainRes] = await Promise.all([
    supabase.from("tenants").select("name, slug, status, language").eq("id", tenantId).maybeSingle(),
    supabase.from("tenant_databases").select("supabase_project_ref").eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("tenant_domains").select("domain").eq("tenant_id", tenantId).eq("is_primary", true).maybeSingle(),
  ]);
  const tenant = tenantRes.data as { name: string; slug: string; status: string; language: AccessTenant["language"] } | null;
  if (!tenant) return null;
  return {
    ...tenant,
    projectRef: (dbRes.data?.supabase_project_ref as string | null) ?? null,
    primaryDomain: (domainRes.data?.domain as string | null) ?? null,
  };
}

/** The admin named when the tenant was provisioned (latest provisioning job). */
async function loadAdmin(supabase: Supabase, tenantId: string): Promise<{ email: string; fullName: string } | null> {
  const { data } = await supabase
    .from("provisioning_jobs")
    .select("options")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const options = (data?.options ?? {}) as { adminEmail?: unknown; adminName?: unknown };
  return typeof options.adminEmail === "string" && options.adminEmail
    ? { email: options.adminEmail, fullName: typeof options.adminName === "string" ? options.adminName : "" }
    : null;
}

function api(config: ProvisioningConfig) {
  return createManagementApi({ token: config.managementToken, fetch: (input, init) => fetch(input, init) });
}

async function audit(supabase: Supabase, tenantId: string, action: string, details: Record<string, unknown>) {
  await supabase.rpc("log_platform_action", {
    p_action: action,
    p_entity_table: "tenants",
    p_entity_id: tenantId,
    p_details: details,
  });
}

/** "Re-apply email settings": the same Auth config call as the configure_auth step. */
export async function reapplyTenantEmailSettings(tenantId: string): Promise<ReapplyResult> {
  await requireAdmin();
  const { config } = provisioningConfig();
  if (!config) return { ok: false, error: "notConfigured" };
  const supabase = await createClient();
  const tenant = await loadTenant(supabase, tenantId);
  if (!tenant) return { ok: false, error: "notProvisioned" };

  const result = await reapplyEmailSettings({ api: api(config), config }, tenant);
  await audit(supabase, tenantId, "auth_config", result.ok
    ? { outcome: "applied", custom_smtp: result.value.customSmtp, site_url: result.value.siteUrl }
    : { outcome: result.error, error: result.detail ?? null });
  revalidatePath(`/tenants/${tenantId}`);
  return result.ok ? { ok: true, customSmtp: result.value.customSmtp } : { ok: false, error: result.error, detail: result.detail };
}

/**
 * "Copy invite link": a fresh invite (or set-password) link for the tenant's admin. The link
 * goes back to the dialog only; the audit row records who asked, for whom and which kind.
 */
export async function createTenantAdminLink(tenantId: string): Promise<LinkResult> {
  await requireAdmin();
  const { config } = provisioningConfig();
  if (!config) return { ok: false, error: "notConfigured" };
  const supabase = await createClient();
  const [tenant, admin] = await Promise.all([loadTenant(supabase, tenantId), loadAdmin(supabase, tenantId)]);
  if (!tenant) return { ok: false, error: "notProvisioned" };

  const result = await createAdminLink({ api: api(config), auth: supabaseTenantAuth, config, now: Date.now }, tenant, admin);
  await audit(supabase, tenantId, "admin_link", result.ok
    ? { outcome: "created", kind: result.value.kind, email: result.value.email, valid_for_seconds: result.value.validForSeconds }
    : { outcome: result.error, email: admin?.email ?? null, error: result.detail ?? null });
  revalidatePath(`/tenants/${tenantId}`);
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };
  return { ok: true, ...result.value };
}
