/**
 * The new CRM pipeline (prompt 21): teams, stages, lost reasons and targets as the app reads
 * them, a deal's place in the pipeline, the reports (funnel, forecast, win rate, lost reasons,
 * target progress) and the quotation → sales invoice lines. Pure: no React or Supabase, so
 * `node --test` loads it directly. The database keeps deals.stage and deals.stage_id in sync
 * (supabase/migrations/20261025100000_crm_pipeline.sql).
 */
import type { QuotationItem } from "@/types/database.types";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface CrmTeam {
  id: string;
  code: string | null;
  name: string | null;
  leader_id: string | null;
  sequence: number;
  active: boolean;
  member_ids: string[];
}

export interface CrmStage {
  id: string;
  team_id: string | null;
  code: string;
  name: string;
  color: string;
  sequence: number;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
  folded: boolean;
}

export interface CrmLostReason {
  id: string;
  code: string | null;
  name: string | null;
  sequence: number;
  active: boolean;
}

export interface CrmTarget {
  id: string;
  team_id: string;
  user_id: string | null;
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  amount: number;
}

export type DealType = "lead" | "opportunity";
export const DEAL_TYPES: readonly DealType[] = ["lead", "opportunity"];

/** Built-in team and lost reason codes (seeded by the migration, translated in the UI). */
export const TEAM_CODES = ["default"] as const;
export const LOST_REASON_CODES = ["too_expensive", "competitor", "no_budget", "no_response", "not_interested"] as const;

/** The fields of a deal the pipeline and the reports need. */
export interface PipelineDeal {
  id: string;
  title: string;
  type: DealType;
  team_id: string | null;
  stage_id: string | null;
  expected_value: number;
  probability: number;
  expected_close: string | null;
  assigned_to: string | null;
  lost_reason_id: string | null;
  won_at: string | null;
  lost_at: string | null;
  created_at: string | null;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export function teamLabel(team: Pick<CrmTeam, "code" | "name"> | null | undefined, t: Translate): string {
  if (!team) return t("crm.pipeline.noTeam");
  return team.name || (team.code ? t(`crm.pipeline.teamCodes.${team.code}`) : "—");
}

export function lostReasonLabel(reason: Pick<CrmLostReason, "code" | "name"> | null | undefined, t: Translate): string {
  if (!reason) return t("crm.pipeline.noReason");
  return reason.name || (reason.code ? t(`crm.pipeline.lostReasonCodes.${reason.code}`) : "—");
}

// ── Stages ───────────────────────────────────────────────────────────────────

const bySequence = <T extends { sequence: number }>(a: T, b: T) => a.sequence - b.sequence;

/** The pipeline columns of a team: shared stages and the team's own, by order. */
export function stagesForTeam(stages: readonly CrmStage[], teamId: string | null): CrmStage[] {
  return stages.filter((s) => s.team_id === null || (teamId !== null && s.team_id === teamId)).sort(bySequence);
}

export function stageKind(stage: Pick<CrmStage, "is_won" | "is_lost"> | null | undefined): "open" | "won" | "lost" {
  if (!stage) return "open";
  return stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
}

/** The won or lost stage a team's deal goes to (the team's own first, as the database does). */
export function outcomeStage(stages: readonly CrmStage[], teamId: string | null, won: boolean): CrmStage | null {
  const fits = stages.filter((s) => (won ? s.is_won : s.is_lost) && (s.team_id === null || s.team_id === teamId));
  return fits.sort((a, b) => Number(a.team_id === null) - Number(b.team_id === null) || a.sequence - b.sequence)[0] ?? null;
}

/** A new stage code from its name: upper-case letters, digits and _, unique, ≤ 40 characters. */
export function stageCode(name: string, existing: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ə/gi, "E")
      .replace(/ı/g, "I")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "S_$1")
      .slice(0, 36) || "STAGE";
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const code = `${base.slice(0, 36)}_${n}`;
    if (!taken.has(code)) return code;
  }
}

// ── Values ───────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Expected value × probability. */
export function weightedValue(deal: Pick<PipelineDeal, "expected_value" | "probability">): number {
  return round2(((Number(deal.expected_value) || 0) * (Number(deal.probability) || 0)) / 100);
}

export function clampProbability(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

export function clampPriority(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0;
}

/** Tags from free text: split on commas, trimmed, unique (case-insensitive), at most 20 of ≤ 40 chars. */
export function parseTags(value: string | readonly string[]): string[] {
  const parts = typeof value === "string" ? value.split(",") : [...value];
  const out: string[] = [];
  for (const raw of parts) {
    const tag = String(raw).trim().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length === 20) break;
  }
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LeadError = "title" | "email" | "value" | "probability" | "date";

/** Checks of the lead/opportunity form and quick create; the database checks the same limits. */
export function checkDeal(input: { title?: string; email?: string | null; expectedValue?: unknown; probability?: unknown; expectedClose?: string | null }): LeadError | null {
  if (input.title !== undefined && !input.title.trim()) return "title";
  if (input.email && !EMAIL.test(input.email.trim())) return "email";
  if (input.expectedValue !== undefined && input.expectedValue !== null && input.expectedValue !== "") {
    const v = Number(input.expectedValue);
    if (!Number.isFinite(v) || v < 0) return "value";
  }
  if (input.probability !== undefined && input.probability !== null && input.probability !== "") {
    const p = Number(input.probability);
    if (!Number.isFinite(p) || p < 0 || p > 100) return "probability";
  }
  if (input.expectedClose && !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedClose)) return "date";
  return null;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface FunnelStep {
  stage: CrmStage;
  /** Deals that reached this step (now in it or in a later open stage, or won). */
  count: number;
  value: number;
  /** Share of the first step, 0–100. */
  rate: number;
}

/**
 * Conversion funnel (reference stats/stats-conversion-funnel-steps): the open stages in order and
 * the won stage. A deal counts for every step up to the one it is in; won deals count for all.
 * Lost deals are left out: where they stopped is not recorded.
 */
export function funnel(deals: readonly PipelineDeal[], stages: readonly CrmStage[]): FunnelStep[] {
  const ordered = [...stages].filter((s) => !s.is_lost).sort((a, b) => Number(a.is_won) - Number(b.is_won) || a.sequence - b.sequence);
  const steps = ordered.filter((s, i) => !s.is_won || ordered.findIndex((x) => x.is_won) === i);
  const rank = new Map(steps.map((s, i) => [s.id, i] as const));
  const won = new Set(stages.filter((s) => s.is_won).map((s) => s.id));
  const wonRank = steps.length - 1;
  const out = steps.map((stage) => ({ stage, count: 0, value: 0, rate: 0 }));
  for (const d of deals) {
    if (!d.stage_id) continue;
    const r = won.has(d.stage_id) ? wonRank : rank.get(d.stage_id);
    if (r === undefined) continue;
    for (let i = 0; i <= r; i++) {
      out[i].count += 1;
      out[i].value = round2(out[i].value + (Number(d.expected_value) || 0));
    }
  }
  const first = out[0]?.count || 0;
  for (const step of out) step.rate = first ? Math.round((step.count / first) * 1000) / 10 : 0;
  return out;
}

const monthKey = (iso: string) => iso.slice(0, 7);
const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthOf(d);
}

export interface ForecastMonth {
  /** YYYY-MM. */
  month: string;
  /** Open opportunities expected to close this month. */
  expected: number;
  weighted: number;
  count: number;
  /** Won in this month. */
  won: number;
}

/**
 * Forecast by month: open opportunities by expected close month (overdue ones count in the
 * current month, deals without a date are left out) with their weighted value, next to the
 * revenue won in each month. `months` months from the current one.
 */
export function forecastByMonth(deals: readonly PipelineDeal[], stages: readonly CrmStage[], now: Date, months = 6): ForecastMonth[] {
  const current = monthOf(now);
  const list = Array.from({ length: months }, (_, i) => addMonths(current, i));
  const rows = new Map(list.map((m) => [m, { month: m, expected: 0, weighted: 0, count: 0, won: 0 }]));
  const kind = new Map(stages.map((s) => [s.id, stageKind(s)] as const));
  for (const d of deals) {
    const k = d.stage_id ? kind.get(d.stage_id) ?? "open" : "open";
    if (k === "won" && d.won_at) {
      const row = rows.get(monthKey(d.won_at));
      if (row) row.won = round2(row.won + (Number(d.expected_value) || 0));
      continue;
    }
    if (k !== "open" || d.type !== "opportunity" || !d.expected_close) continue;
    const m = monthKey(d.expected_close) < current ? current : monthKey(d.expected_close);
    const row = rows.get(m);
    if (!row) continue;
    row.expected = round2(row.expected + (Number(d.expected_value) || 0));
    row.weighted = round2(row.weighted + weightedValue(d));
    row.count += 1;
  }
  return list.map((m) => rows.get(m)!);
}

export interface WinRateRow {
  userId: string | null;
  won: number;
  lost: number;
  open: number;
  wonValue: number;
  /** won / (won + lost), 0–100; null with no closed deals. */
  rate: number | null;
}

/** Win rate per salesperson (assigned_to), most won value first. */
export function winRateByUser(deals: readonly PipelineDeal[], stages: readonly CrmStage[]): WinRateRow[] {
  const kind = new Map(stages.map((s) => [s.id, stageKind(s)] as const));
  const rows = new Map<string | null, WinRateRow>();
  for (const d of deals) {
    if (d.type !== "opportunity") continue;
    const row = rows.get(d.assigned_to) ?? { userId: d.assigned_to, won: 0, lost: 0, open: 0, wonValue: 0, rate: null };
    const k = d.stage_id ? kind.get(d.stage_id) ?? "open" : "open";
    if (k === "won") {
      row.won += 1;
      row.wonValue = round2(row.wonValue + (Number(d.expected_value) || 0));
    } else if (k === "lost") row.lost += 1;
    else row.open += 1;
    rows.set(d.assigned_to, row);
  }
  const out = [...rows.values()];
  for (const r of out) r.rate = r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 1000) / 10 : null;
  return out.sort((a, b) => b.wonValue - a.wonValue || b.won - a.won);
}

export interface LostReasonRow {
  reasonId: string | null;
  count: number;
  value: number;
}

/** Lost deals by reason (no reason given = null), most frequent first. */
export function lostReasons(deals: readonly PipelineDeal[], stages: readonly CrmStage[]): LostReasonRow[] {
  const lost = new Set(stages.filter((s) => s.is_lost).map((s) => s.id));
  const rows = new Map<string | null, LostReasonRow>();
  for (const d of deals) {
    if (!d.stage_id || !lost.has(d.stage_id)) continue;
    const row = rows.get(d.lost_reason_id) ?? { reasonId: d.lost_reason_id, count: 0, value: 0 };
    row.count += 1;
    row.value = round2(row.value + (Number(d.expected_value) || 0));
    rows.set(d.lost_reason_id, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.value - a.value);
}

export interface TargetProgress {
  target: CrmTarget;
  won: number;
  /** won / amount, 0–∞ (over 100 when beaten); null for a zero target. */
  rate: number | null;
}

/**
 * Targets of a month against the revenue won in it: a team target counts the team's won deals,
 * a salesperson's target their own won deals in that team.
 */
export function targetProgress(targets: readonly CrmTarget[], deals: readonly PipelineDeal[], stages: readonly CrmStage[], month: string): TargetProgress[] {
  const won = new Set(stages.filter((s) => s.is_won).map((s) => s.id));
  const inMonth = deals.filter((d) => d.stage_id && won.has(d.stage_id) && d.won_at && monthKey(d.won_at) === month);
  return targets
    .filter((t) => monthKey(t.month) === month)
    .map((target) => {
      const total = inMonth
        .filter((d) => d.team_id === target.team_id && (target.user_id === null || d.assigned_to === target.user_id))
        .reduce((sum, d) => sum + (Number(d.expected_value) || 0), 0);
      const amount = Number(target.amount) || 0;
      return { target, won: round2(total), rate: amount > 0 ? Math.round((total / amount) * 1000) / 10 : null };
    })
    .sort((a, b) => Number(a.target.user_id !== null) - Number(b.target.user_id !== null));
}

/** First day of the month of a YYYY-MM or a date, as the database stores it. */
export function targetMonth(value: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

// ── Quotation → sales invoice ────────────────────────────────────────────────

export interface InvoiceLine {
  product_id: string;
  product_code: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  /** The quotation's discount spread over the lines as one percentage. */
  discount_percent: number;
  /** The quotation's tax rate. */
  vat_rate: number;
  total: number;
}

export interface QuotationForInvoice {
  items: readonly QuotationItem[];
  discount: number;
  tax: number;
}

/**
 * Lines of the draft sales invoice made from a quotation. Every line needs a product of the
 * catalogue (the sales invoice does); lines typed by hand come back in `missing`. The quotation's
 * discount (an amount) becomes one percentage on every line and its tax a VAT rate, so the
 * invoice totals match the quotation.
 */
export function quotationToInvoiceLines(q: QuotationForInvoice): { lines: InvoiceLine[]; missing: string[] } {
  const items = q.items.filter((i) => (Number(i.quantity) || 0) > 0);
  const missing = items.filter((i) => !i.product_id).map((i) => i.product_name || "—");
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const discount = Math.min(Math.max(0, Number(q.discount) || 0), subtotal);
  const discountPercent = subtotal > 0 ? Math.round((discount / subtotal) * 1e6) / 1e4 : 0;
  const taxable = subtotal - discount;
  const vatRate = taxable > 0 ? Math.round(((Number(q.tax) || 0) / taxable) * 1e6) / 1e4 : 0;
  const lines = items
    .filter((i) => i.product_id)
    .map((i) => {
      const quantity = Number(i.quantity) || 0;
      const unitPrice = Number(i.unit_price) || 0;
      const gross = quantity * unitPrice;
      return {
        product_id: i.product_id as string,
        product_code: i.product_code || "",
        product_name: i.product_name,
        unit: i.unit || "Ədəd",
        quantity,
        unit_price: unitPrice,
        discount_percent: discountPercent,
        vat_rate: vatRate,
        total: round2(gross - (gross * discountPercent) / 100),
      };
    });
  return { lines, missing };
}
