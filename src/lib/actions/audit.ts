"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import { isValidUuid } from "@/lib/auth/validate";
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  type AuditAction,
  type AuditLogFilters,
  type AuditLogListResult,
  type AuditLogRow,
  type AuditModule,
} from "@/lib/audit/types";
import type { Json } from "@/types/database.types";
import { parseAuditConfig, AUDIT_CONFIG_KEY, auditRetentionCutoffIso } from "@/lib/audit/config";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function sanitizeIlike(term: string): string {
  return term.replace(/[%_,()]/g, "").trim().slice(0, 80);
}

function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isAuditModule(value: string): value is AuditModule {
  return (AUDIT_MODULES as readonly string[]).includes(value);
}

export async function listAuditLogsAction(
  filters: AuditLogFilters = {}
): Promise<ActionResult<AuditLogListResult>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();

    const { data: configRow } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", AUDIT_CONFIG_KEY)
      .maybeSingle();
    const cutoff = auditRetentionCutoffIso(parseAuditConfig(configRow?.value).log_retention_days);
    if (cutoff) {
      await admin.from("audit_logs").delete().lt("created_at", cutoff);
      await admin.from("audit_alerts").delete().lt("created_at", cutoff);
    }

    const limit = Math.min(Math.max(Number(filters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const search = sanitizeIlike(filters.search ?? "");
    const moduleFilter =
      filters.module && isAuditModule(filters.module) ? filters.module : null;
    const actionFilter =
      filters.action && isAuditAction(filters.action) ? filters.action : null;

    let matchingUserIds: string[] = [];
    if (search) {
      const { data: people } = await admin
        .from("profiles")
        .select("id")
        .or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
        .limit(50);
      matchingUserIds = (people ?? []).map((row) => String(row.id));
    }

    let query = admin
      .from("audit_logs")
      .select(
        "id, user_id, action, module, table_name, record_id, old_values_json, new_values_json, ip_address, created_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (moduleFilter) query = query.eq("module", moduleFilter);
    if (actionFilter) query = query.eq("action", actionFilter);
    if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);

    if (search) {
      const parts: string[] = [`table_name.ilike.%${search}%`];
      if (isValidUuid(search)) parts.push(`record_id.eq.${search}`);
      if (matchingUserIds.length > 0) {
        parts.push(`user_id.in.(${matchingUserIds.join(",")})`);
      }
      query = query.or(parts.join(","));
    }

    const { data, error, count } = await query;
    if (error) return { success: false, error: error.message };

    const rows = (data ?? []) as Array<{
      id: string;
      user_id: string | null;
      action: string;
      module: string;
      table_name: string | null;
      record_id: string | null;
      old_values_json: Json | null;
      new_values_json: Json | null;
      ip_address: string | null;
      created_at: string;
    }>;

    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))] as string[];
    const nameById = new Map<string, { full_name: string | null; email: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const profile of profiles ?? []) {
        nameById.set(String(profile.id), {
          full_name: (profile.full_name as string | null) ?? null,
          email: (profile.email as string | null) ?? null,
        });
      }
    }

    const mapped: AuditLogRow[] = rows.map((row) => {
      const profile = row.user_id ? nameById.get(row.user_id) : undefined;
      return {
        id: row.id,
        user_id: row.user_id,
        user_name: profile?.full_name ?? null,
        user_email: profile?.email ?? null,
        action: isAuditAction(row.action) ? row.action : "UPDATE",
        module: isAuditModule(row.module) ? row.module : "FINANCE",
        table_name: row.table_name,
        record_id: row.record_id,
        old_values_json: row.old_values_json,
        new_values_json: row.new_values_json,
        ip_address: row.ip_address,
        created_at: row.created_at,
      };
    });

    return { success: true, data: { rows: mapped, total: count ?? mapped.length } };
  } catch (err) {
    return catchActionError(err, "Audit jurnalı yüklənmədi");
  }
}

export async function logAuditReadEventAction(input?: {
  module?: AuditModule;
  tableName?: string;
  meta?: Json;
}): Promise<ActionResult<{ id: string | null }>> {
  try {
    await requirePermissionAction("can_view_financial_reports");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("audit_log_read_event", {
      p_module: input?.module || "FINANCE",
      p_table: input?.tableName || "transactions",
      p_meta: input?.meta ?? {},
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: (data as string | null) ?? null } };
  } catch (err) {
    return catchActionError(err, "Oxunma qeydə alınmadı");
  }
}
