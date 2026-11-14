"use server";

import { isValidUuid } from "@/lib/auth/validate";
import {
  dashboardFromJson,
  findingFromRow,
  notificationStateFromJson,
  normalizeReason,
  reportFromRow,
  ruleFromRow,
  runFromRow,
  compareRuleCodes,
  isSeverity,
  isStatus,
  GUARD_ACTIVE_STATUSES,
  type GuardDashboard,
  type GuardFinding,
  type GuardNotificationState,
  type GuardReport,
  type GuardRule,
  type GuardRun,
  type GuardSeverity,
  type GuardStatus,
  type ParamValue,
} from "@/lib/guard/findings";
import { guardDb, guardFail, guardMessage, guardRows, requireGuardAdmin, type GuardActionResult, type GuardDb } from "@/lib/guard/server";
import { scheduleFromJson, validateSchedule, type GuardScheduleState, type ScheduleSettings } from "@/lib/guard/schedule";
import { fetchProfileDisplayNames, type ProfileNamesClient } from "@/lib/profiles/displayNames";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * GUARD-3: reads and actions of the Accounting Guard section (/finance/guard), its buttons on the
 * sales and purchase lists, the bell and the home widget. Every call needs ACCOUNTING_GUARD=true and
 * an admin (requireGuardAdmin); data is read and written with the admin's own session, so the
 * guard tables' row-level security applies and the database knows who acted. Only the names of
 * people (profile_display_names) come from the service client. The guard never changes a
 * document: these actions change findings, rules, reports and "what I have seen" only.
 */

const FINDINGS_LIMIT = 5000;
const CHUNK = 200;

function ids(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && isValidUuid(v)))];
}

async function inChunks(db: GuardDb, table: string, columns: string, values: readonly string[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const { data, error } = await db.from(table).select(columns).in("id", values.slice(i, i + CHUNK));
    if (error) break;
    out.push(...guardRows(data));
  }
  return out;
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export async function guardDashboardAction(): Promise<GuardActionResult<GuardDashboard>> {
  try {
    await requireGuardAdmin();
    const { data, error } = await (await guardDb()).rpc("guard_dashboard");
    if (error) return { success: false, error: guardMessage(error.message) };
    return { success: true, data: dashboardFromJson(data) };
  } catch (err) {
    return guardFail(err);
  }
}

// ── Findings ────────────────────────────────────────────────────────────────

export interface GuardFindingsData {
  findings: GuardFinding[];
  /** True when there are more findings than the screen reads. */
  truncated: boolean;
  /** People and partners found in the findings, for the filters. */
  creators: { id: string; name: string }[];
  partners: { id: string; name: string }[];
}

/** Every finding (newest first, at most 5000) with the partner's name and the document's creator. */
export async function listGuardFindingsAction(): Promise<GuardActionResult<GuardFindingsData>> {
  try {
    await requireGuardAdmin();
    const db = await guardDb();
    const { data, error } = await db
      .from("guard_findings")
      .select("id, rule_code, severity, status, entity_type, entity_id, doc_no, doc_date, partner_id, amount, details, note, first_seen_at, last_seen_at, resolved_at, guard_rules(category)")
      .order("first_seen_at", { ascending: false })
      .limit(FINDINGS_LIMIT);
    if (error) return { success: false, error: guardMessage(error.message) };
    const rows = guardRows(data);

    const partnerIds = ids(rows.map((r) => (typeof r.partner_id === "string" ? r.partner_id : null)));
    const saleIds = ids(rows.filter((r) => r.entity_type === "sale").map((r) => (typeof r.entity_id === "string" ? r.entity_id : null)));
    const purchaseIds = ids(rows.filter((r) => r.entity_type === "purchase").map((r) => (typeof r.entity_id === "string" ? r.entity_id : null)));
    const [partnerRows, saleRows, purchaseRows] = await Promise.all([
      inChunks(db, "partners", "id, name", partnerIds),
      inChunks(db, "sales", "id, created_by", saleIds),
      inChunks(db, "purchases", "id, created_by", purchaseIds),
    ]);
    const partnerNames = new Map(partnerRows.map((p) => [String(p.id), String(p.name ?? "")]));
    const creatorOf = new Map<string, string>();
    for (const r of [...saleRows, ...purchaseRows]) if (typeof r.created_by === "string") creatorOf.set(String(r.id), r.created_by);
    const creatorIds = ids([...creatorOf.values()]);
    const names = creatorIds.length ? await fetchProfileDisplayNames((await createSupabaseAdminClient()) as unknown as ProfileNamesClient, creatorIds) : new Map<string, string>();

    const findings: GuardFinding[] = [];
    for (const r of rows) {
      const creator = typeof r.entity_id === "string" ? (creatorOf.get(r.entity_id) ?? null) : null;
      const f = findingFromRow(r, {
        partnerName: typeof r.partner_id === "string" ? (partnerNames.get(r.partner_id) ?? null) : null,
        createdBy: creator,
        createdByName: creator ? (names.get(creator.toLowerCase()) ?? null) : null,
      });
      if (f) findings.push(f);
    }
    const distinct = <T extends { id: string }>(list: T[]) => [...new Map(list.map((x) => [x.id, x])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {
      success: true,
      data: {
        findings,
        truncated: rows.length >= FINDINGS_LIMIT,
        creators: distinct(findings.filter((f) => f.createdBy && f.createdByName).map((f) => ({ id: f.createdBy as string, name: f.createdByName as string }))),
        partners: distinct(findings.filter((f) => f.partnerId && f.partnerName).map((f) => ({ id: f.partnerId as string, name: f.partnerName as string }))),
      },
    };
  } catch (err) {
    return guardFail(err);
  }
}

export interface GuardFindingEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

/** The history of one finding: who set which status, when and why (oldest first). */
export async function guardFindingEventsAction(findingId: string): Promise<GuardActionResult<GuardFindingEvent[]>> {
  try {
    await requireGuardAdmin();
    if (!isValidUuid(findingId)) return { success: false, error: "guard.errors.notFound" };
    const { data, error } = await (await guardDb())
      .from("guard_finding_events")
      .select("id, actor, from_status, to_status, note, created_at")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return { success: false, error: guardMessage(error.message) };
    const rows = guardRows(data);
    const actors = ids(rows.map((r) => (typeof r.actor === "string" ? r.actor : null)));
    const names = actors.length ? await fetchProfileDisplayNames((await createSupabaseAdminClient()) as unknown as ProfileNamesClient, actors) : new Map<string, string>();
    return {
      success: true,
      data: rows.map((r) => ({
        id: String(r.id),
        fromStatus: typeof r.from_status === "string" ? r.from_status : null,
        toStatus: String(r.to_status ?? ""),
        note: typeof r.note === "string" && r.note !== "" ? r.note : null,
        actorName: typeof r.actor === "string" ? (names.get(r.actor.toLowerCase()) ?? null) : null,
        createdAt: String(r.created_at ?? ""),
      })),
    };
  } catch (err) {
    return guardFail(err);
  }
}

const CHANGEABLE: readonly GuardStatus[] = ["open", "acknowledged", "resolved", "false_positive"];

/**
 * Acknowledge, resolve (with a reason), mark "not an error" (with a reason) or reopen one or many
 * findings. Returns how many changed. The reason is required for resolved and false_positive.
 */
export async function setGuardFindingsStatusAction(findingIds: string[], status: GuardStatus, note?: string | null): Promise<GuardActionResult<{ changed: number }>> {
  try {
    await requireGuardAdmin();
    if (!Array.isArray(findingIds) || findingIds.length === 0 || !findingIds.every(isValidUuid)) return { success: false, error: "guard.errors.notFound" };
    if (findingIds.length > 500) return { success: false, error: "guard.errors.tooMany" };
    if (!isStatus(status) || !CHANGEABLE.includes(status)) return { success: false, error: "guard.errors.invalidInput" };
    const reason = normalizeReason(note);
    if ((status === "resolved" || status === "false_positive") && !reason) return { success: false, error: "guard.errors.reasonRequired" };
    const db = await guardDb();
    if (findingIds.length === 1) {
      const { error } = await db.rpc("guard_set_finding_status", { p_id: findingIds[0], p_status: status, p_note: reason });
      if (error) return { success: false, error: guardMessage(error.message) };
      return { success: true, data: { changed: 1 } };
    }
    const { data, error } = await db.rpc("guard_bulk_set_status", { p_ids: findingIds, p_status: status, p_note: reason });
    if (error) return { success: false, error: guardMessage(error.message) };
    return { success: true, data: { changed: Number(data) || 0 } };
  } catch (err) {
    return guardFail(err);
  }
}

// ── Scans ───────────────────────────────────────────────────────────────────

export interface GuardScanResult {
  runId: string;
  status: string;
  newCount: number;
  openCount: number;
  resolvedCount: number;
  failedRules: string[];
}

const SCOPE_ITEM = /^[A-Za-z][A-Za-z0-9_]{0,19}$/;

/**
 * Runs guard_scan: all rules (scope null: "Scan now") or some categories / rule codes (the
 * "Find suspicious documents" buttons). trigger: 'manual' for the section, 'button' for the lists.
 */
export async function runGuardScanAction(scope: string[] | null, trigger: "manual" | "button" = "manual"): Promise<GuardActionResult<GuardScanResult>> {
  try {
    await requireGuardAdmin();
    if (scope !== null && (!Array.isArray(scope) || scope.length === 0 || scope.length > 20 || !scope.every((s) => typeof s === "string" && SCOPE_ITEM.test(s)))) {
      return { success: false, error: "guard.errors.invalidInput" };
    }
    const db = await guardDb();
    const { data: runId, error } = await db.rpc("guard_scan", { p_scope: scope, p_trigger: trigger === "button" ? "button" : "manual" });
    if (error) return { success: false, error: guardMessage(error.message) };
    if (typeof runId !== "string" || !isValidUuid(runId)) return { success: false, error: "Failed" };
    const { data: run } = await db.from("guard_runs").select("id, status, new_count, open_count, resolved_count, rule_errors").eq("id", runId).maybeSingle();
    const r = (run ?? {}) as Record<string, unknown>;
    return {
      success: true,
      data: {
        runId,
        status: typeof r.status === "string" ? r.status : "ok",
        newCount: Number(r.new_count) || 0,
        openCount: Number(r.open_count) || 0,
        resolvedCount: Number(r.resolved_count) || 0,
        failedRules: Object.keys((r.rule_errors as Record<string, unknown> | null) ?? {}),
      },
    };
  } catch (err) {
    return guardFail(err);
  }
}

// ── Rules ───────────────────────────────────────────────────────────────────

export async function listGuardRulesAction(): Promise<GuardActionResult<GuardRule[]>> {
  try {
    await requireGuardAdmin();
    const { data, error } = await (await guardDb()).from("guard_rules").select("code, category, default_severity, enabled, params, description_key").limit(200);
    if (error) return { success: false, error: guardMessage(error.message) };
    const rules = guardRows(data).flatMap((r) => {
      const rule = ruleFromRow(r);
      return rule ? [rule] : [];
    });
    return { success: true, data: rules.sort((a, b) => compareRuleCodes(a.code, b.code)) };
  } catch (err) {
    return guardFail(err);
  }
}

/** Enable / disable a rule, change its severity and thresholds (validated again by the database). */
export async function updateGuardRuleAction(code: string, change: { enabled?: boolean; severity?: GuardSeverity; params?: Record<string, ParamValue> }): Promise<GuardActionResult<GuardRule>> {
  try {
    await requireGuardAdmin();
    if (typeof code !== "string" || !/^[A-Z]\d{1,2}$/.test(code)) return { success: false, error: "guard.errors.notFound" };
    if (change.severity !== undefined && !isSeverity(change.severity)) return { success: false, error: "guard.errors.invalidInput" };
    const params = change.params && Object.keys(change.params).length > 0 ? change.params : null;
    const { data, error } = await (await guardDb()).rpc("guard_update_rule", {
      p_code: code,
      p_enabled: typeof change.enabled === "boolean" ? change.enabled : null,
      p_severity: change.severity ?? null,
      p_params: params,
    });
    if (error) return { success: false, error: guardMessage(error.message) };
    const rule = ruleFromRow((data ?? {}) as Record<string, unknown>);
    if (!rule) return { success: false, error: "Failed" };
    return { success: true, data: rule };
  } catch (err) {
    return guardFail(err);
  }
}

// ── Runs ────────────────────────────────────────────────────────────────────

export async function listGuardRunsAction(): Promise<GuardActionResult<GuardRun[]>> {
  try {
    await requireGuardAdmin();
    const { data, error } = await (await guardDb())
      .from("guard_runs")
      .select("id, trigger, scope, started_at, finished_at, status, rules_run, new_count, open_count, resolved_count, error, rule_errors")
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) return { success: false, error: guardMessage(error.message) };
    return {
      success: true,
      data: guardRows(data).flatMap((r) => {
        const run = runFromRow(r);
        return run ? [run] : [];
      }),
    };
  } catch (err) {
    return guardFail(err);
  }
}

// ── Reports ─────────────────────────────────────────────────────────────────

/** The saved reports (newest first, at most 200), without their text: open one to read it. */
export async function listGuardReportsAction(): Promise<GuardActionResult<GuardReport[]>> {
  try {
    await requireGuardAdmin();
    const { data, error } = await (await guardDb())
      .from("guard_reports")
      .select("id, kind, title, period_start, period_end, model, created_by_type, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { success: false, error: guardMessage(error.message) };
    return {
      success: true,
      data: guardRows(data).flatMap((r) => {
        const report = reportFromRow(r);
        return report ? [report] : [];
      }),
    };
  } catch (err) {
    return guardFail(err);
  }
}

export async function getGuardReportAction(reportId: string): Promise<GuardActionResult<GuardReport>> {
  try {
    await requireGuardAdmin();
    if (!isValidUuid(reportId)) return { success: false, error: "guard.errors.notFound" };
    const { data, error } = await (await guardDb())
      .from("guard_reports")
      .select("id, kind, title, period_start, period_end, body, summary, model, created_by_type, created_by, created_at")
      .eq("id", reportId)
      .maybeSingle();
    if (error) return { success: false, error: guardMessage(error.message) };
    const report = data ? reportFromRow(data as Record<string, unknown>) : null;
    return report ? { success: true, data: report } : { success: false, error: "guard.errors.notFound" };
  } catch (err) {
    return guardFail(err);
  }
}

/** Saves a dated snapshot of the findings (kind 'scan') the screen built in the user's language. */
export async function saveGuardScanReportAction(input: { title: string; body: string; summary: Record<string, unknown> }): Promise<GuardActionResult<{ id: string }>> {
  try {
    await requireGuardAdmin();
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";
    if (!title) return { success: false, error: "guard.errors.titleRequired" };
    const body = typeof input.body === "string" ? input.body.slice(0, 200_000) : "";
    const summary = input.summary && typeof input.summary === "object" && !Array.isArray(input.summary) ? input.summary : {};
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await (await guardDb()).rpc("guard_create_report", {
      p_kind: "scan",
      p_title: title,
      p_body: body,
      p_summary: summary,
      p_period_start: today,
      p_period_end: today,
    });
    if (error) return { success: false, error: guardMessage(error.message) };
    if (typeof data !== "string") return { success: false, error: "Failed" };
    return { success: true, data: { id: data } };
  } catch (err) {
    return guardFail(err);
  }
}

// ── The bell, the widget and the document chip ─────────────────────────────

export async function guardNotificationStateAction(): Promise<GuardActionResult<GuardNotificationState>> {
  try {
    await requireGuardAdmin();
    const { data, error } = await (await guardDb()).rpc("guard_notification_state");
    if (error) return { success: false, error: guardMessage(error.message) };
    return { success: true, data: notificationStateFromJson(data) };
  } catch (err) {
    return guardFail(err);
  }
}

export async function markGuardSeenAction(what: "findings" | "reports" | "all"): Promise<GuardActionResult<null>> {
  try {
    await requireGuardAdmin();
    if (what !== "findings" && what !== "reports" && what !== "all") return { success: false, error: "guard.errors.invalidInput" };
    const { error } = await (await guardDb()).rpc("guard_mark_seen", { p_what: what });
    if (error) return { success: false, error: guardMessage(error.message) };
    return { success: true, data: null };
  } catch (err) {
    return guardFail(err);
  }
}

export interface DocumentFindings {
  /** Documents with open or acknowledged findings: id → how many, and the worst severity. */
  byDocument: Record<string, { count: number; severity: GuardSeverity }>;
}

const WORST: GuardSeverity[] = ["critical", "high", "medium", "low"];

/** Which of these documents (sales or purchases) have findings to look at (the chip in the document view). */
export async function guardFindingsForDocumentsAction(entityType: "sale" | "purchase", documentIds: string[]): Promise<GuardActionResult<DocumentFindings>> {
  try {
    await requireGuardAdmin();
    if (entityType !== "sale" && entityType !== "purchase") return { success: false, error: "guard.errors.invalidInput" };
    const wanted = ids(Array.isArray(documentIds) ? documentIds.slice(0, 200) : []);
    if (wanted.length === 0) return { success: true, data: { byDocument: {} } };
    const { data, error } = await (await guardDb())
      .from("guard_findings")
      .select("entity_id, severity, status")
      .eq("entity_type", entityType)
      .in("entity_id", wanted)
      .in("status", [...GUARD_ACTIVE_STATUSES])
      .limit(2000);
    if (error) return { success: false, error: guardMessage(error.message) };
    const byDocument: DocumentFindings["byDocument"] = {};
    for (const r of guardRows(data)) {
      const id = typeof r.entity_id === "string" ? r.entity_id : null;
      if (!id || !isSeverity(r.severity)) continue;
      const cur = byDocument[id];
      byDocument[id] = { count: (cur?.count ?? 0) + 1, severity: cur && WORST.indexOf(cur.severity) < WORST.indexOf(r.severity) ? cur.severity : r.severity };
    }
    return { success: true, data: { byDocument } };
  } catch (err) {
    return guardFail(err);
  }
}

// ── The automatic scan (GUARD-4) ───────────────────────────────────────────

/** The schedule: settings, the pg_cron jobs, the next runs and the last scheduled scan. */
export async function guardScheduleStateAction(): Promise<GuardActionResult<GuardScheduleState>> {
  try {
    await requireGuardAdmin();
    const { data, error } = await (await guardDb()).rpc("guard_schedule_state");
    if (error) return { success: false, error: guardMessage(error.message) };
    return { success: true, data: scheduleFromJson(data) };
  } catch (err) {
    return guardFail(err);
  }
}

/**
 * Turn the automatic scan on or off and set when it runs (the database checks the ranges again and
 * writes the change to the audit log). The jobs are (re)created when pg_cron is installed.
 */
export async function guardSetScheduleAction(input: ScheduleSettings): Promise<GuardActionResult<GuardScheduleState>> {
  try {
    await requireGuardAdmin();
    const checked = validateSchedule({
      enabled: input?.enabled === true,
      incrementalMinutes: Number(input?.incrementalMinutes),
      nightlyHourUtc: Number(input?.nightlyHourUtc),
      retentionDays: Number(input?.retentionDays),
    });
    if (!checked.ok) return { success: false, error: "guard.errors.invalidSchedule" };
    const { data, error } = await (await guardDb()).rpc("guard_set_schedule", {
      p_enabled: checked.value.enabled,
      p_incremental_minutes: checked.value.incrementalMinutes,
      p_nightly_hour_utc: checked.value.nightlyHourUtc,
      p_retention_days: checked.value.retentionDays,
    });
    if (error) return { success: false, error: guardMessage(error.message) };
    return { success: true, data: scheduleFromJson(data) };
  } catch (err) {
    return guardFail(err);
  }
}
