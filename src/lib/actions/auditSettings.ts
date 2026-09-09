"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import {
  AUDIT_CONFIG_KEY,
  auditRetentionCutoffIso,
  parseAuditConfig,
  type AuditConfig,
} from "@/lib/audit/config";

export interface AuditAlertRow {
  id: string;
  audit_log_id: string | null;
  module: string;
  table_name: string | null;
  record_id: string | null;
  user_id: string | null;
  message: string;
  email_to: string | null;
  email_status: string;
  created_at: string;
}

async function purgeExpiredAuditLogs(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  config: AuditConfig
): Promise<void> {
  const cutoff = auditRetentionCutoffIso(config.log_retention_days);
  if (!cutoff) return;
  await admin.from("audit_logs").delete().lt("created_at", cutoff);
  await admin.from("audit_alerts").delete().lt("created_at", cutoff);
}

export async function getAuditConfigAction(): Promise<ActionResult<AuditConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", AUDIT_CONFIG_KEY)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data: parseAuditConfig(data?.value) };
  } catch (err) {
    return catchActionError(err, "Audit ayarları yüklənmədi");
  }
}

export async function saveAuditConfigAction(
  input: AuditConfig
): Promise<ActionResult<AuditConfig>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const config = parseAuditConfig(input);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("system_settings").upsert(
      {
        key: AUDIT_CONFIG_KEY,
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { success: false, error: error.message };
    await purgeExpiredAuditLogs(admin, config);
    return { success: true, data: config };
  } catch (err) {
    return catchActionError(err, "Audit ayarları yadda saxlanılmadı");
  }
}

export async function listAuditAlertsAction(
  limit = 20
): Promise<ActionResult<AuditAlertRow[]>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("audit_alerts")
      .select(
        "id, audit_log_id, module, table_name, record_id, user_id, message, email_to, email_status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 50));
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as AuditAlertRow[] };
  } catch (err) {
    return catchActionError(err, "Audit xəbərdarlıqları yüklənmədi");
  }
}
