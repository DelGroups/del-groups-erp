"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerAuthContext } from "@/lib/supabaseServer";
import { ActionAuthError, mapRpcError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { userHasPermission } from "@/lib/auth/routePermissions";
import { clampString, isValidUuid } from "@/lib/auth/validate";
import { isNewCrmEnabled } from "@/lib/features/newCrm";
import { checkDeal, clampPriority, clampProbability, parseTags, stageCode, targetMonth, type DealType } from "../lib/pipeline";

/**
 * Server actions of the new CRM pipeline (prompt 21, NEW_CRM). Deals are written with the
 * user's session, so the deals policies (can_manage_crm) and the database trigger decide; the
 * settings tables need can_manage_settings. Every action refuses while NEW_CRM is off.
 */

type ActionResult<T = void> = { success: boolean; error?: string; data?: T };
type Client = SupabaseClient;

// The crm_* tables and the new deals columns are not in the generated types yet.
const db = async (): Promise<Client> => (await createSupabaseServerClient()) as unknown as Client;

const fail = (err: unknown, fallback: string): ActionResult<never> => {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? mapRpcError(err.message) : fallback };
};

function requireFlag() {
  if (!isNewCrmEnabled()) throw new ActionAuthError("crm.pipeline.errors.off");
}

async function crmWriter() {
  requireFlag();
  return requirePermissionAction("can_manage_crm", { module: "crm" });
}

async function settingsWriter() {
  requireFlag();
  return requirePermissionAction("can_manage_settings", { module: "crm" });
}

const text = (value: unknown, max: number) => {
  const v = clampString(String(value ?? ""), max).trim();
  return v || null;
};
const uuidOrNull = (value: unknown) => (typeof value === "string" && isValidUuid(value) ? value : null);
const dateOrNull = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

export interface PipelineDealInput {
  title?: string;
  type?: DealType;
  clientId?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  expectedValue?: number | null;
  probability?: number | null;
  expectedClose?: string | null;
  priority?: number;
  tags?: string[] | string;
  teamId?: string | null;
  stageId?: string | null;
  assignedTo?: string | null;
  source?: string | null;
  medium?: string | null;
  notes?: string | null;
}

/** The deals columns for the fields given (undefined = unchanged). */
function dealPatch(input: PipelineDealInput): { patch: Record<string, unknown>; error?: string } {
  const invalid = checkDeal({ title: input.title, email: input.email, expectedValue: input.expectedValue, probability: input.probability, expectedClose: input.expectedClose });
  if (invalid) return { patch: {}, error: `crm.pipeline.errors.${invalid}` };
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = clampString(input.title.trim(), 240);
  if (input.type !== undefined) patch.type = input.type === "lead" ? "lead" : "opportunity";
  if (input.clientId !== undefined) {
    if (input.clientId && !isValidUuid(input.clientId)) return { patch: {}, error: "crm.pipeline.errors.customer" };
    patch.client_id = input.clientId || null;
  }
  if (input.contactName !== undefined) patch.contact_name = text(input.contactName, 200);
  if (input.email !== undefined) patch.email = text(input.email, 200);
  if (input.phone !== undefined) patch.phone = text(input.phone, 60);
  if (input.companyName !== undefined) patch.company_name = text(input.companyName, 200);
  if (input.expectedValue !== undefined) patch.expected_value = Math.max(0, Number(input.expectedValue) || 0);
  if (input.probability !== undefined && input.probability !== null) patch.probability = clampProbability(input.probability);
  if (input.expectedClose !== undefined) patch.expected_close = dateOrNull(input.expectedClose);
  if (input.priority !== undefined) patch.priority = clampPriority(input.priority);
  if (input.tags !== undefined) patch.tags = parseTags(input.tags);
  if (input.teamId !== undefined) patch.team_id = uuidOrNull(input.teamId);
  if (input.stageId !== undefined) {
    if (input.stageId && !isValidUuid(input.stageId)) return { patch: {}, error: "crm.pipeline.errors.stage" };
    patch.stage_id = input.stageId || null;
  }
  if (input.assignedTo !== undefined) patch.assigned_to = uuidOrNull(input.assignedTo);
  if (input.source !== undefined) patch.source = text(input.source, 80);
  if (input.medium !== undefined) patch.medium = text(input.medium, 80);
  if (input.notes !== undefined) patch.notes = text(input.notes, 2000);
  return { patch };
}

/** Quick create (kanban column, leads list) and the full create form. */
export async function createPipelineDealAction(input: PipelineDealInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { user } = await crmWriter();
    if (!input.title?.trim()) return { success: false, error: "crm.pipeline.errors.title" };
    const { patch, error } = dealPatch(input);
    if (error) return { success: false, error };
    const client = await db();
    const row: Record<string, unknown> = { assigned_to: user.id, ...patch };
    // The trigger sets the stage code and the team; a stage_id given wins over the default code.
    if (row.stage_id) delete row.stage;
    const { data, error: dbError } = await client.from("deals").insert([row]).select("id").single();
    if (dbError) return { success: false, error: mapRpcError(dbError.message) };
    return { success: true, data: { id: String(data.id) } };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

export async function updatePipelineDealAction(dealId: string, input: PipelineDealInput): Promise<ActionResult> {
  try {
    await crmWriter();
    if (!isValidUuid(dealId)) return { success: false, error: "crm.pipeline.errors.deal" };
    const { patch, error } = dealPatch(input);
    if (error) return { success: false, error };
    if (!Object.keys(patch).length) return { success: true };
    const client = await db();
    const { data, error: dbError } = await client.from("deals").update(patch).eq("id", dealId).select("id");
    if (dbError) return { success: false, error: mapRpcError(dbError.message) };
    if (!data?.length) return { success: false, error: "crm.pipeline.errors.deal" };
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

/** Kanban drag and the status bar. Moving into a lost stage goes through markLostAction. */
export async function movePipelineDealAction(dealId: string, stageId: string): Promise<ActionResult> {
  return updatePipelineDealAction(dealId, { stageId });
}

async function outcomeStageId(client: Client, dealId: string, won: boolean): Promise<string | null> {
  const { data: deal } = await client.from("deals").select("team_id").eq("id", dealId).maybeSingle();
  if (!deal) return null;
  const { data } = await client.rpc("crm_outcome_stage", { p_team: deal.team_id ?? null, p_won: won });
  return typeof data === "string" ? data : null;
}

export async function markWonAction(dealId: string): Promise<ActionResult> {
  try {
    await crmWriter();
    if (!isValidUuid(dealId)) return { success: false, error: "crm.pipeline.errors.deal" };
    const client = await db();
    const stageId = await outcomeStageId(client, dealId, true);
    if (!stageId) return { success: false, error: "crm.pipeline.errors.noWonStage" };
    return updatePipelineDealAction(dealId, { stageId });
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

export async function markLostAction(dealId: string, payload: { reasonId?: string | null; note?: string | null; stageId?: string | null }): Promise<ActionResult> {
  try {
    await crmWriter();
    if (!isValidUuid(dealId)) return { success: false, error: "crm.pipeline.errors.deal" };
    const client = await db();
    const stageId = uuidOrNull(payload.stageId) ?? (await outcomeStageId(client, dealId, false));
    if (!stageId) return { success: false, error: "crm.pipeline.errors.noLostStage" };
    const { data, error } = await client
      .from("deals")
      .update({ stage_id: stageId, lost_reason_id: uuidOrNull(payload.reasonId), lost_note: text(payload.note, 2000) })
      .eq("id", dealId)
      .select("id");
    if (error) return { success: false, error: mapRpcError(error.message) };
    if (!data?.length) return { success: false, error: "crm.pipeline.errors.deal" };
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

/** Back from won or lost to the team's first open stage. */
export async function reopenDealAction(dealId: string): Promise<ActionResult> {
  try {
    await crmWriter();
    if (!isValidUuid(dealId)) return { success: false, error: "crm.pipeline.errors.deal" };
    const client = await db();
    const { data: deal } = await client.from("deals").select("team_id").eq("id", dealId).maybeSingle();
    if (!deal) return { success: false, error: "crm.pipeline.errors.deal" };
    const { data } = await client.rpc("crm_first_stage", { p_team: deal.team_id ?? null });
    if (typeof data !== "string") return { success: false, error: "crm.pipeline.errors.stage" };
    return updatePipelineDealAction(dealId, { stageId: data });
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

/**
 * Lead → opportunity. With `createCustomer`, a customer is made from the lead's contact (needs
 * can_manage_customers) unless the lead already has one; `clientId` links an existing customer.
 */
export async function convertLeadAction(dealId: string, payload: { createCustomer?: boolean; clientId?: string | null }): Promise<ActionResult<{ customerId: string | null }>> {
  try {
    await crmWriter();
    if (!isValidUuid(dealId)) return { success: false, error: "crm.pipeline.errors.deal" };
    const client = await db();
    const { data: deal, error } = await client.from("deals").select("id, title, client_id, contact_name, company_name, phone").eq("id", dealId).maybeSingle();
    if (error) return { success: false, error: mapRpcError(error.message) };
    if (!deal) return { success: false, error: "crm.pipeline.errors.deal" };

    let customerId: string | null = uuidOrNull(payload.clientId) ?? ((deal.client_id as string) || null);
    if (!customerId && payload.createCustomer) {
      const { profile } = await getServerAuthContext();
      if (!userHasPermission(profile, "can_manage_customers")) return { success: false, error: "crm.pipeline.errors.customerRight" };
      const fullName = clampString(String(deal.contact_name || deal.company_name || deal.title || ""), 200).trim();
      const { data: created, error: customerError } = await client
        .from("customers")
        .insert([
          {
            code: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
            full_name: fullName,
            name: fullName,
            company_name: (deal.company_name as string) || null,
            phone: (deal.phone as string) || null,
            balance: 0,
          },
        ])
        .select("id")
        .single();
      if (customerError) return { success: false, error: mapRpcError(customerError.message) };
      customerId = String(created.id);
    }
    const { error: updateError } = await client.from("deals").update({ type: "opportunity", client_id: customerId }).eq("id", dealId);
    if (updateError) return { success: false, error: mapRpcError(updateError.message) };
    return { success: true, data: { customerId } };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

/** Remembers the draft sales invoice made from a quotation (the invoice itself is saved by the sales module). */
export async function linkQuotationSaleAction(quotationId: string, saleId: string): Promise<ActionResult> {
  try {
    await crmWriter();
    if (!isValidUuid(quotationId) || !isValidUuid(saleId)) return { success: false, error: "crm.pipeline.errors.quote" };
    const client = await db();
    const { data: quote, error } = await client
      .from("quotations")
      .update({ sale_id: saleId, status: "CONVERTED", updated_at: new Date().toISOString() })
      .eq("id", quotationId)
      .select("deal_id")
      .single();
    if (error) return { success: false, error: mapRpcError(error.message) };
    const stageId = await outcomeStageId(client, String(quote.deal_id), true);
    if (stageId) await client.from("deals").update({ stage_id: stageId }).eq("id", quote.deal_id);
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

// ── Settings: teams, stages, lost reasons, targets ──────────────────────────

export async function saveTeamAction(input: { id?: string | null; name: string; leaderId?: string | null; memberIds?: string[]; active?: boolean; sequence?: number }): Promise<ActionResult<{ id: string }>> {
  try {
    await settingsWriter();
    const client = await db();
    const row: Record<string, unknown> = {
      leader_id: uuidOrNull(input.leaderId),
      active: input.active !== false,
    };
    const name = text(input.name, 80);
    // Built-in teams keep their translated name unless one is typed.
    if (name || !input.id) {
      if (!name) return { success: false, error: "crm.pipeline.errors.name" };
      row.name = name;
    }
    if (input.sequence !== undefined) row.sequence = Math.round(Number(input.sequence) || 0);
    let id = input.id && isValidUuid(input.id) ? input.id : null;
    if (id) {
      const { error } = await client.from("crm_teams").update(row).eq("id", id);
      if (error) return { success: false, error: mapRpcError(error.message) };
    } else {
      const { data, error } = await client.from("crm_teams").insert([row]).select("id").single();
      if (error) return { success: false, error: mapRpcError(error.message) };
      id = String(data.id);
    }
    if (input.memberIds) {
      const members = [...new Set(input.memberIds.filter((m) => isValidUuid(m)))];
      const { error: delError } = await client.from("crm_team_members").delete().eq("team_id", id);
      if (delError) return { success: false, error: mapRpcError(delError.message) };
      if (members.length) {
        const { error } = await client.from("crm_team_members").insert(members.map((user_id) => ({ team_id: id, user_id })));
        if (error) return { success: false, error: mapRpcError(error.message) };
      }
    }
    return { success: true, data: { id } };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

export async function deleteTeamAction(id: string): Promise<ActionResult> {
  try {
    await settingsWriter();
    if (!isValidUuid(id)) return { success: false, error: "crm.pipeline.errors.team" };
    const client = await db();
    const { count } = await client.from("crm_teams").select("id", { count: "exact", head: true }).eq("active", true).neq("id", id);
    if (!count) return { success: false, error: "crm.pipeline.errors.lastTeam" };
    const { error } = await client.from("crm_teams").delete().eq("id", id);
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

export async function saveStageAction(input: { id?: string | null; teamId?: string | null; name: string; color?: string; probability?: number; kind?: "open" | "won" | "lost"; folded?: boolean; sequence?: number }): Promise<ActionResult<{ id: string }>> {
  try {
    await settingsWriter();
    const name = text(input.name, 60);
    if (!name) return { success: false, error: "crm.pipeline.errors.name" };
    const client = await db();
    const kind = input.kind ?? "open";
    const row: Record<string, unknown> = {
      name,
      color: /^#[0-9a-fA-F]{6}$/.test(input.color ?? "") ? input.color!.toLowerCase() : "#94a3b8",
      probability: kind === "won" ? 100 : kind === "lost" ? 0 : clampProbability(input.probability ?? 10),
      is_won: kind === "won",
      is_lost: kind === "lost",
      folded: input.folded ?? kind === "lost",
    };
    if (input.sequence !== undefined) row.sequence = Math.round(Number(input.sequence) || 0);
    if (input.id && isValidUuid(input.id)) {
      const { error } = await client.from("crm_stages").update(row).eq("id", input.id);
      if (error) return { success: false, error: mapRpcError(error.message) };
      return { success: true, data: { id: input.id } };
    }
    const { data: codes } = await client.from("crm_stages").select("code");
    row.code = stageCode(name, (codes ?? []).map((c) => String(c.code)));
    row.team_id = uuidOrNull(input.teamId);
    if (row.sequence === undefined) {
      const { data: last } = await client.from("crm_stages").select("sequence").order("sequence", { ascending: false }).limit(1).maybeSingle();
      row.sequence = (Number(last?.sequence) || 0) + 10;
    }
    const { data, error } = await client.from("crm_stages").insert([row]).select("id").single();
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true, data: { id: String(data.id) } };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

/** New order of stages (ids in order); sequence 10, 20, … */
export async function reorderStagesAction(ids: string[]): Promise<ActionResult> {
  try {
    await settingsWriter();
    const valid = ids.filter((id) => isValidUuid(id));
    const client = await db();
    for (const [i, id] of valid.entries()) {
      const { error } = await client.from("crm_stages").update({ sequence: (i + 1) * 10 }).eq("id", id);
      if (error) return { success: false, error: mapRpcError(error.message) };
    }
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

export async function deleteStageAction(id: string): Promise<ActionResult> {
  try {
    await settingsWriter();
    if (!isValidUuid(id)) return { success: false, error: "crm.pipeline.errors.stage" };
    const client = await db();
    const { error } = await client.from("crm_stages").delete().eq("id", id);
    if (error) return { success: false, error: /open, a won and a lost/.test(error.message) ? "crm.pipeline.errors.lastStage" : mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

export async function saveLostReasonAction(input: { id?: string | null; name: string; active?: boolean }): Promise<ActionResult<{ id: string }>> {
  try {
    await settingsWriter();
    const client = await db();
    const name = text(input.name, 80);
    const row: Record<string, unknown> = { active: input.active !== false };
    if (name) row.name = name;
    if (input.id && isValidUuid(input.id)) {
      const { error } = await client.from("crm_lost_reasons").update(row).eq("id", input.id);
      if (error) return { success: false, error: mapRpcError(error.message) };
      return { success: true, data: { id: input.id } };
    }
    if (!name) return { success: false, error: "crm.pipeline.errors.name" };
    const { data, error } = await client.from("crm_lost_reasons").insert([row]).select("id").single();
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true, data: { id: String(data.id) } };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

/** Sets (or with amount 0 and an id, keeps at 0) a monthly target of a team or a salesperson. */
export async function saveTargetAction(input: { teamId: string; userId?: string | null; month: string; amount: number }): Promise<ActionResult> {
  try {
    await settingsWriter();
    const month = targetMonth(input.month);
    if (!isValidUuid(input.teamId) || !month) return { success: false, error: "crm.pipeline.errors.target" };
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0) return { success: false, error: "crm.pipeline.errors.value" };
    const client = await db();
    const userId = uuidOrNull(input.userId);
    let query = client.from("crm_targets").select("id").eq("team_id", input.teamId).eq("month", month);
    query = userId ? query.eq("user_id", userId) : query.is("user_id", null);
    const { data: existing } = await query.maybeSingle();
    const { error } = existing
      ? await client.from("crm_targets").update({ amount: Math.round(amount * 100) / 100 }).eq("id", existing.id)
      : await client.from("crm_targets").insert([{ team_id: input.teamId, user_id: userId, month, amount: Math.round(amount * 100) / 100 }]);
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}

export async function deleteTargetAction(id: string): Promise<ActionResult> {
  try {
    await settingsWriter();
    if (!isValidUuid(id)) return { success: false, error: "crm.pipeline.errors.target" };
    const client = await db();
    const { error } = await client.from("crm_targets").delete().eq("id", id);
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    return fail(err, "crm.pipeline.errors.save");
  }
}
