import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import type { CrmLostReason, CrmStage, CrmTarget, CrmTeam } from "./pipeline";

/** Reads of the new CRM (prompt 21), in the browser with the user's session (RLS). */

// The crm_* tables and the new deals columns are not in the generated types yet.
const supabase = typedClient as unknown as SupabaseClient;

export interface PipelineSettings {
  teams: CrmTeam[];
  stages: CrmStage[];
  lostReasons: CrmLostReason[];
  targets: CrmTarget[];
}

export const PIPELINE_SETTINGS_KEY = ["crm", "pipeline-settings"] as const;

export function teamFromRow(row: Record<string, unknown>): CrmTeam {
  const members = Array.isArray(row.crm_team_members) ? (row.crm_team_members as Record<string, unknown>[]) : [];
  return {
    id: String(row.id),
    code: (row.code as string) || null,
    name: (row.name as string) || null,
    leader_id: (row.leader_id as string) || null,
    sequence: Number(row.sequence) || 0,
    active: row.active !== false,
    member_ids: members.map((m) => String(m.user_id)),
  };
}

export function stageFromRow(row: Record<string, unknown>): CrmStage {
  return {
    id: String(row.id),
    team_id: (row.team_id as string) || null,
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    color: String(row.color || "#94a3b8"),
    sequence: Number(row.sequence) || 0,
    probability: Number(row.probability) || 0,
    is_won: Boolean(row.is_won),
    is_lost: Boolean(row.is_lost),
    folded: Boolean(row.folded),
  };
}

export function lostReasonFromRow(row: Record<string, unknown>): CrmLostReason {
  return {
    id: String(row.id),
    code: (row.code as string) || null,
    name: (row.name as string) || null,
    sequence: Number(row.sequence) || 0,
    active: row.active !== false,
  };
}

export function targetFromRow(row: Record<string, unknown>): CrmTarget {
  return {
    id: String(row.id),
    team_id: String(row.team_id),
    user_id: (row.user_id as string) || null,
    month: String(row.month ?? "").slice(0, 10),
    amount: Number(row.amount) || 0,
  };
}

export async function fetchPipelineSettings(): Promise<PipelineSettings> {
  const [teams, stages, reasons, targets] = await Promise.all([
    supabase.from("crm_teams").select("*, crm_team_members(user_id)").order("sequence").order("created_at"),
    supabase.from("crm_stages").select("*").order("sequence").order("created_at"),
    supabase.from("crm_lost_reasons").select("*").order("sequence").order("created_at"),
    supabase.from("crm_targets").select("*").order("month", { ascending: false }),
  ]);
  const failed = teams.error || stages.error || reasons.error || targets.error;
  if (failed) throw new Error(failed.message);
  return {
    teams: (teams.data ?? []).map((r) => teamFromRow(r as Record<string, unknown>)),
    stages: (stages.data ?? []).map((r) => stageFromRow(r as Record<string, unknown>)),
    lostReasons: (reasons.data ?? []).map((r) => lostReasonFromRow(r as Record<string, unknown>)),
    targets: (targets.data ?? []).map((r) => targetFromRow(r as Record<string, unknown>)),
  };
}

const DEAL_SELECT = "*, customers(full_name, company_name), profiles!deals_assigned_to_fkey(full_name), quotations(*)";

/** Leads or opportunities, newest first (up to 2000; the CRM of one company stays far below). */
export async function fetchPipelineDeals(type: "lead" | "opportunity"): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.from("deals").select(DEAL_SELECT).eq("type", type).order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export async function fetchPipelineDeal(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("deals").select(DEAL_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Record<string, unknown> | null;
}

/** Every deal with the fields the reports need. */
export async function fetchReportDeals(): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from("deals")
    .select("id, title, type, team_id, stage_id, expected_value, probability, expected_close, assigned_to, lost_reason_id, won_at, lost_at, created_at")
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export interface Salesperson {
  id: string;
  full_name: string;
}

export async function fetchSalespeople(): Promise<Salesperson[]> {
  const { data, error } = await supabase.from("profiles").select("id, full_name, is_active").order("full_name").limit(500);
  if (error) return [];
  return (data ?? [])
    .filter((r) => (r as Record<string, unknown>).is_active !== false)
    .map((r) => ({ id: String(r.id), full_name: String((r as Record<string, unknown>).full_name || "—") }));
}
