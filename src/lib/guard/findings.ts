import { ACCOUNTING_GUARD_STATUSES, type AccountingGuardStatus } from "@/lib/features/accountingGuard";

/**
 * GUARD-3: the Accounting Guard section. Pure helpers (no React, no database) for the findings,
 * the dashboard figures, the URL state of the screens and the saved reports, so they run under
 * `node --test`. What the rules write is described in docs/accounting-guard-plan.md.
 */

export const GUARD_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type GuardSeverity = (typeof GUARD_SEVERITIES)[number];

export const GUARD_CATEGORIES = ["ledger", "documents", "cash", "partners", "products", "stock"] as const;
export type GuardCategory = (typeof GUARD_CATEGORIES)[number];

export const GUARD_TABS = ["dashboard", "findings", "reports", "rules", "runs"] as const;
export type GuardTab = (typeof GUARD_TABS)[number];

export type GuardStatus = AccountingGuardStatus;
/** What an admin still has to look at. */
export const GUARD_ACTIVE_STATUSES: readonly GuardStatus[] = ["open", "acknowledged"];

const SEVERITY_RANK: Record<GuardSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function isSeverity(value: unknown): value is GuardSeverity {
  return typeof value === "string" && (GUARD_SEVERITIES as readonly string[]).includes(value);
}
export function isCategory(value: unknown): value is GuardCategory {
  return typeof value === "string" && (GUARD_CATEGORIES as readonly string[]).includes(value);
}
export function isStatus(value: unknown): value is GuardStatus {
  return typeof value === "string" && (ACCOUNTING_GUARD_STATUSES as readonly string[]).includes(value);
}

// ── Findings ────────────────────────────────────────────────────────────────

export interface GuardFinding {
  id: string;
  rule: string;
  category: GuardCategory;
  severity: GuardSeverity;
  status: GuardStatus;
  entityType: string | null;
  entityId: string | null;
  docNo: string | null;
  /** yyyy-mm-dd */
  docDate: string | null;
  partnerId: string | null;
  partnerName: string | null;
  amount: number | null;
  details: Record<string, unknown>;
  note: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  /** The person who made the document (sales, purchases): the "created by" filter. */
  createdBy: string | null;
  createdByName: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A guard_findings row (with its rule's category) → a finding; rows of an unknown shape are dropped. */
export function findingFromRow(row: Record<string, unknown>, extra: { partnerName?: string | null; createdBy?: string | null; createdByName?: string | null } = {}): GuardFinding | null {
  const rule = row.guard_rules && typeof row.guard_rules === "object" ? (row.guard_rules as Record<string, unknown>) : {};
  const category = isCategory(row.category) ? row.category : isCategory(rule.category) ? rule.category : null;
  if (typeof row.id !== "string" || typeof row.rule_code !== "string" || !isSeverity(row.severity) || !isStatus(row.status) || !category) return null;
  return {
    id: row.id,
    rule: row.rule_code,
    category,
    severity: row.severity,
    status: row.status,
    entityType: text(row.entity_type),
    entityId: text(row.entity_id),
    docNo: text(row.doc_no),
    docDate: text(row.doc_date),
    partnerId: text(row.partner_id),
    partnerName: extra.partnerName ?? null,
    amount: num(row.amount),
    details: row.details && typeof row.details === "object" && !Array.isArray(row.details) ? (row.details as Record<string, unknown>) : {},
    note: text(row.note),
    firstSeenAt: typeof row.first_seen_at === "string" ? row.first_seen_at : "",
    lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : "",
    resolvedAt: text(row.resolved_at),
    createdBy: extra.createdBy ?? null,
    createdByName: extra.createdByName ?? null,
  };
}

/** Critical first, then high, medium, low; newest first inside a severity. */
export function sortFindings(list: readonly GuardFinding[]): GuardFinding[] {
  return [...list].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.firstSeenAt.localeCompare(a.firstSeenAt) || a.id.localeCompare(b.id),
  );
}

// ── Where a finding's document opens ───────────────────────────────────────

/** The screen of a finding's document (null: there is none, e.g. a journal entry or a rule-wide finding). */
export function findingDocHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "sale":
      return `/sales/${entityId}`;
    case "purchase":
      return `/purchases?record=${entityId}`;
    case "product":
      return `/products?highlight=${entityId}`;
    case "partner":
      return `/dashboard/partners/${entityId}`;
    case "account":
      return "/cash-bank";
    case "inventory_count":
      return `/inventory/counts/${entityId}`;
    case "import":
      return `/imports/${entityId}`;
    default:
      return null;
  }
}

export function partnerHref(partnerId: string | null): string | null {
  return partnerId ? `/dashboard/partners/${partnerId}` : null;
}

// ── Health score ────────────────────────────────────────────────────────────

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** Points taken off the score for each open finding of a severity (shown in the score's tooltip). */
export const SCORE_WEIGHTS: Readonly<SeverityCounts> = { critical: 10, high: 5, medium: 2, low: 1 };

/** 100 minus the weighted open findings, never below 0 and always a whole number. */
export function healthScore(open: Partial<SeverityCounts>): number {
  let points = 0;
  for (const s of GUARD_SEVERITIES) points += Math.max(0, Math.floor(open[s] ?? 0)) * SCORE_WEIGHTS[s];
  return Math.max(0, 100 - points);
}

export type ScoreTone = "good" | "attention" | "bad";
export function scoreTone(score: number): ScoreTone {
  return score >= 90 ? "good" : score >= 60 ? "attention" : "bad";
}

export function countsFromJson(raw: unknown): SeverityCounts & { total: number } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const c = { critical: num(o.critical) ?? 0, high: num(o.high) ?? 0, medium: num(o.medium) ?? 0, low: num(o.low) ?? 0 };
  return { ...c, total: num(o.total) ?? c.critical + c.high + c.medium + c.low };
}

export interface GuardDashboard {
  open: SeverityCounts & { total: number };
  acknowledged: number;
  score: number;
  byCategory: { category: GuardCategory; counts: SeverityCounts & { total: number } }[];
  lastRun: { id: string; trigger: string; startedAt: string; finishedAt: string | null; status: string; newCount: number; openCount: number; resolvedCount: number } | null;
  trend: { startedAt: string; status: string; openCount: number; newCount: number }[];
  top: GuardFinding[];
}

/** The guard_dashboard() answer, with the score worked out from the open counts. */
export function dashboardFromJson(raw: unknown): GuardDashboard {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const open = countsFromJson(o.open);
  const run = o.last_run && typeof o.last_run === "object" ? (o.last_run as Record<string, unknown>) : null;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    open,
    acknowledged: num(o.acknowledged) ?? 0,
    score: healthScore(open),
    byCategory: list(o.by_category).flatMap((c) => (isCategory(c.category) ? [{ category: c.category, counts: countsFromJson(c) }] : [])),
    lastRun:
      run && typeof run.id === "string"
        ? {
            id: run.id,
            trigger: String(run.trigger ?? ""),
            startedAt: String(run.started_at ?? ""),
            finishedAt: text(run.finished_at),
            status: String(run.status ?? ""),
            newCount: num(run.new_count) ?? 0,
            openCount: num(run.open_count) ?? 0,
            resolvedCount: num(run.resolved_count) ?? 0,
          }
        : null,
    trend: list(o.trend).map((t) => ({ startedAt: String(t.started_at ?? ""), status: String(t.status ?? ""), openCount: num(t.open_count) ?? 0, newCount: num(t.new_count) ?? 0 })),
    top: list(o.top).flatMap((r) => {
      const f = findingFromRow(r);
      return f ? [f] : [];
    }),
  };
}

/** Points (0..1 on both axes) of the trend line of open findings, oldest first; empty for fewer than two runs. */
export function trendPoints(trend: readonly { openCount: number }[]): { x: number; y: number }[] {
  if (trend.length < 2) return [];
  const max = Math.max(1, ...trend.map((t) => t.openCount));
  return trend.map((t, i) => ({ x: i / (trend.length - 1), y: 1 - t.openCount / max }));
}

// ── The filters of the Findings tab (the URL is the state) ──────────────────

export interface GuardQuery {
  tab: GuardTab;
  severity: GuardSeverity | null;
  category: GuardCategory | null;
  rule: string | null;
  /** "active" = open and acknowledged (the default), "all", or one status. */
  status: "active" | "all" | GuardStatus;
  from: string | null;
  to: string | null;
  partner: string | null;
  creator: string | null;
  /** The kind of document ("sale", "purchase", ...), from the buttons on the lists. */
  entity: string | null;
  search: string;
  /** The finding open in the side panel. */
  finding: string | null;
}

export const DEFAULT_GUARD_QUERY: GuardQuery = {
  tab: "dashboard",
  severity: null,
  category: null,
  rule: null,
  status: "active",
  from: null,
  to: null,
  partner: null,
  creator: null,
  entity: null,
  search: "",
  finding: null,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RULE = /^[A-Z]\d{1,2}$/;
const ENTITY = /^[a-z_]{2,30}$/;

type Params = { get(name: string): string | null };

export function parseGuardQuery(params: Params): GuardQuery {
  const tab = params.get("tab");
  const status = params.get("status");
  const from = params.get("from");
  const to = params.get("to");
  const rule = params.get("rule");
  const entity = params.get("entity");
  const partner = params.get("partner");
  const creator = params.get("creator");
  const finding = params.get("finding");
  const severity = params.get("severity");
  const category = params.get("category");
  return {
    tab: (GUARD_TABS as readonly string[]).includes(tab ?? "") ? (tab as GuardTab) : finding ? "findings" : "dashboard",
    severity: isSeverity(severity) ? severity : null,
    category: isCategory(category) ? category : null,
    rule: rule && RULE.test(rule) ? rule : null,
    status: status === "all" || status === "active" ? status : isStatus(status) ? status : "active",
    from: from && DAY.test(from) ? from : null,
    to: to && DAY.test(to) ? to : null,
    partner: partner && UUID.test(partner) ? partner : null,
    creator: creator && UUID.test(creator) ? creator : null,
    entity: entity && ENTITY.test(entity) ? entity : null,
    search: (params.get("q") ?? "").trim().slice(0, 100),
    finding: finding && UUID.test(finding) ? finding : null,
  };
}

/** The query string of a state: only what differs from the defaults, in a fixed order. */
export function guardQueryString(q: GuardQuery): string {
  const p = new URLSearchParams();
  if (q.tab !== DEFAULT_GUARD_QUERY.tab) p.set("tab", q.tab);
  if (q.severity) p.set("severity", q.severity);
  if (q.category) p.set("category", q.category);
  if (q.rule) p.set("rule", q.rule);
  if (q.status !== "active") p.set("status", q.status);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.partner) p.set("partner", q.partner);
  if (q.creator) p.set("creator", q.creator);
  if (q.entity) p.set("entity", q.entity);
  if (q.search) p.set("q", q.search);
  if (q.finding) p.set("finding", q.finding);
  return p.toString();
}

/** A link to the Findings tab with some filters (the buttons on the lists, the bell, the widget). */
export function guardFindingsHref(filters: Partial<GuardQuery> = {}): string {
  const qs = guardQueryString({ ...DEFAULT_GUARD_QUERY, tab: "findings", ...filters });
  return qs ? `/finance/guard?${qs}` : "/finance/guard";
}

/** The day (yyyy-mm-dd) a finding is dated by: its document's date, else the day it was first seen. */
export function findingDay(f: Pick<GuardFinding, "docDate" | "firstSeenAt">): string {
  return f.docDate ?? f.firstSeenAt.slice(0, 10);
}

export function matchesQuery(f: GuardFinding, q: GuardQuery): boolean {
  if (q.severity && f.severity !== q.severity) return false;
  if (q.category && f.category !== q.category) return false;
  if (q.rule && f.rule !== q.rule) return false;
  if (q.status === "active" ? !GUARD_ACTIVE_STATUSES.includes(f.status) : q.status !== "all" && f.status !== q.status) return false;
  const day = findingDay(f);
  if (q.from && day < q.from) return false;
  if (q.to && day > q.to) return false;
  if (q.partner && f.partnerId !== q.partner) return false;
  if (q.creator && f.createdBy !== q.creator) return false;
  if (q.entity && f.entityType !== q.entity) return false;
  if (q.search) {
    const needle = q.search.toLowerCase();
    const hay = [f.rule, f.docNo, f.partnerName, f.createdByName, f.note].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function filterFindings(list: readonly GuardFinding[], q: GuardQuery): GuardFinding[] {
  return sortFindings(list.filter((f) => matchesQuery(f, q)));
}

/** Findings by severity (for the chips above the table). */
export function countBySeverity(list: readonly GuardFinding[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of list) c[f.severity] += 1;
  return c;
}

// ── Rules ───────────────────────────────────────────────────────────────────

export interface GuardRule {
  code: string;
  category: GuardCategory;
  severity: GuardSeverity;
  enabled: boolean;
  params: Record<string, unknown>;
  descriptionKey: string;
}

export function ruleFromRow(row: Record<string, unknown>): GuardRule | null {
  if (typeof row.code !== "string" || !isCategory(row.category) || !isSeverity(row.default_severity)) return null;
  return {
    code: row.code,
    category: row.category,
    severity: row.default_severity,
    enabled: row.enabled !== false,
    params: row.params && typeof row.params === "object" && !Array.isArray(row.params) ? (row.params as Record<string, unknown>) : {},
    descriptionKey: typeof row.description_key === "string" ? row.description_key : `guard.rule.${row.code}`,
  };
}

/** A..F, then the number: A1, A2, ... A10, B1 ... (not "A10" before "A2"). */
export function compareRuleCodes(a: string, b: string): number {
  const [, la, na] = /^([A-Z])(\d+)$/.exec(a) ?? [, a, "0"];
  const [, lb, nb] = /^([A-Z])(\d+)$/.exec(b) ?? [, b, "0"];
  return String(la).localeCompare(String(lb)) || Number(na) - Number(nb);
}

export type ParamValue = number | string | string[];

/** The text a threshold shows in its field (a list as "a, b"). */
export function paramToText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
}

/**
 * The value a field's text means for a threshold of the same kind as `current` (a number stays a
 * number, a list a list of text, text text); null when it cannot be read that way. The database
 * checks the ranges again (guard_update_rule).
 */
export function paramFromText(current: unknown, input: string): ParamValue | null {
  const value = input.trim();
  if (typeof current === "number") {
    if (value === "") return null;
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (Array.isArray(current)) {
    const items = value.split(",").map((s) => s.trim());
    return items.length > 0 && items.every((s) => s !== "") ? items : null;
  }
  return value === "" ? null : value;
}

/** The thresholds of a rule that differ from what it has now, as the patch to send (null when none). */
export function paramsPatch(rule: GuardRule, edited: Readonly<Record<string, string>>): { patch: Record<string, ParamValue>; invalid: string[] } {
  const patch: Record<string, ParamValue> = {};
  const invalid: string[] = [];
  for (const [key, current] of Object.entries(rule.params)) {
    if (!(key in edited)) continue;
    const next = paramFromText(current, edited[key]);
    if (next === null) {
      invalid.push(key);
    } else if (JSON.stringify(next) !== JSON.stringify(current)) {
      patch[key] = next;
    }
  }
  return { patch, invalid };
}

// ── Runs and reports ────────────────────────────────────────────────────────

export interface GuardRun {
  id: string;
  trigger: string;
  scope: string[];
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rulesRun: string[];
  newCount: number;
  openCount: number;
  resolvedCount: number;
  error: string | null;
  ruleErrors: Record<string, string>;
}

export function runFromRow(row: Record<string, unknown>): GuardRun | null {
  if (typeof row.id !== "string") return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const errors = row.rule_errors && typeof row.rule_errors === "object" && !Array.isArray(row.rule_errors) ? (row.rule_errors as Record<string, unknown>) : {};
  return {
    id: row.id,
    trigger: String(row.trigger ?? ""),
    scope: strings(row.scope),
    startedAt: String(row.started_at ?? ""),
    finishedAt: text(row.finished_at),
    status: String(row.status ?? ""),
    rulesRun: strings(row.rules_run),
    newCount: num(row.new_count) ?? 0,
    openCount: num(row.open_count) ?? 0,
    resolvedCount: num(row.resolved_count) ?? 0,
    error: text(row.error),
    ruleErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, String(v)])),
  };
}

/** Seconds a run took; null while it runs. */
export function runSeconds(run: Pick<GuardRun, "startedAt" | "finishedAt">): number | null {
  if (!run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null;
}

export const REPORT_KINDS = ["daily", "monthly", "on_demand", "scan"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface GuardReport {
  id: string;
  kind: ReportKind;
  title: string;
  periodStart: string | null;
  periodEnd: string | null;
  body: string;
  summary: Record<string, unknown>;
  model: string | null;
  createdByType: "system" | "ai" | "user";
  createdBy: string | null;
  createdAt: string;
}

export function reportFromRow(row: Record<string, unknown>): GuardReport | null {
  const kind = row.kind;
  const by = row.created_by_type;
  if (typeof row.id !== "string" || typeof row.title !== "string" || !(REPORT_KINDS as readonly unknown[]).includes(kind)) return null;
  return {
    id: row.id,
    kind: kind as ReportKind,
    title: row.title,
    periodStart: text(row.period_start),
    periodEnd: text(row.period_end),
    body: typeof row.body === "string" ? row.body : "",
    summary: row.summary && typeof row.summary === "object" && !Array.isArray(row.summary) ? (row.summary as Record<string, unknown>) : {},
    model: text(row.model),
    createdByType: by === "ai" || by === "system" ? by : "user",
    createdBy: text(row.created_by),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/**
 * The Markdown body of a saved snapshot ("Save current findings as report"): a headline, the
 * counts by severity, then one line per finding. Labels come from the caller (the user's language).
 */
export function scanReportMarkdown(
  findings: readonly GuardFinding[],
  labels: { title: string; counts: string; severity: (s: GuardSeverity) => string; rule: (code: string) => string; none: string; amount: (v: number) => string },
): string {
  const counts = countBySeverity(findings);
  const lines = [`# ${labels.title}`, "", `**${labels.counts}:** ${GUARD_SEVERITIES.map((s) => `${labels.severity(s)} ${counts[s]}`).join(", ")}`, ""];
  if (findings.length === 0) {
    lines.push(labels.none);
  } else {
    for (const s of GUARD_SEVERITIES) {
      const group = findings.filter((f) => f.severity === s);
      if (group.length === 0) continue;
      lines.push(`## ${labels.severity(s)} (${group.length})`, "");
      for (const f of group) {
        const bits = [`**${f.rule}**`, labels.rule(f.rule), f.docNo, f.partnerName, f.amount !== null ? labels.amount(f.amount) : null].filter(Boolean);
        lines.push(`- ${bits.join(" · ")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** The facts stored next to a snapshot: counts by severity and the rows (for the Excel export). */
export function scanReportSummary(findings: readonly GuardFinding[]): Record<string, unknown> {
  return {
    total: findings.length,
    counts: countBySeverity(findings),
    findings: findings.slice(0, 2000).map((f) => ({
      id: f.id,
      rule: f.rule,
      severity: f.severity,
      status: f.status,
      doc_no: f.docNo,
      doc_date: f.docDate,
      partner: f.partnerName,
      amount: f.amount,
      first_seen: f.firstSeenAt.slice(0, 10),
    })),
  };
}

// ── Bell and widget ─────────────────────────────────────────────────────────

export interface GuardNotificationState {
  newFindings: number;
  newCritical: number;
  newReports: number;
}

export function notificationStateFromJson(raw: unknown): GuardNotificationState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { newFindings: num(o.new_findings) ?? 0, newCritical: num(o.new_critical) ?? 0, newReports: num(o.new_reports) ?? 0 };
}

/** The reason a person types for "Resolved" or "Not an error": trimmed, collapsed, at least three characters. */
export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 500;
export function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length >= REASON_MIN_LENGTH ? t.slice(0, REASON_MAX_LENGTH) : null;
}
