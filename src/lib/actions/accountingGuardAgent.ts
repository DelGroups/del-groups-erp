"use server";

import { ActionAuthError } from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { isGuardAgentFlagOn } from "@/lib/guard/agentConfig";
import { guardDb, guardFail, guardRows, requireGuardAdmin, type GuardActionResult } from "@/lib/guard/server";

/**
 * Server actions of the accountant agent's screens (GUARD-5): its memory (read, add, edit, delete) and
 * dismissing one of its suggestions. Admin only, ACCOUNTING_GUARD and ACCOUNTING_GUARD_AI on. They run
 * with the admin's own session; the database functions check the admin again. Confirming a suggestion
 * is the ordinary status change of GUARD-3 (with the agent's reason), so it is logged like any decision.
 */

export interface GuardMemoryNote {
  id: string;
  kind: "fact" | "pattern" | "preference";
  subject: string;
  body: string;
  source: "agent" | "admin";
  updatedAt: string;
}

async function requireAgentAdmin() {
  const ctx = await requireGuardAdmin();
  if (!isGuardAgentFlagOn()) throw new ActionAuthError("guard.errors.agentOff");
  return ctx;
}

export async function listGuardMemoryAction(): Promise<GuardActionResult<GuardMemoryNote[]>> {
  try {
    await requireAgentAdmin();
    const db = await guardDb();
    const { data, error } = await db.from("guard_agent_memory").select("id, kind, subject, body, source, updated_at").order("updated_at", { ascending: false }).limit(500);
    if (error) return { success: false, error: "guard.errors.agentNotReady" };
    const notes: GuardMemoryNote[] = guardRows(data).flatMap((r) =>
      typeof r.id === "string" && typeof r.subject === "string" && typeof r.body === "string"
        ? [{
            id: r.id,
            kind: r.kind === "pattern" || r.kind === "preference" ? r.kind : "fact",
            subject: r.subject,
            body: r.body,
            source: r.source === "admin" ? ("admin" as const) : ("agent" as const),
            updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
          }]
        : [],
    );
    return { success: true, data: notes };
  } catch (err) {
    return guardFail(err);
  }
}

/** An admin adds a note or edits one (the same subject updates it); it is then the admin's note. */
export async function saveGuardMemoryAction(subject: string, body: string, kind: string): Promise<GuardActionResult<string>> {
  try {
    await requireAgentAdmin();
    const k = kind === "pattern" || kind === "preference" ? kind : "fact";
    const db = await guardDb();
    const { data, error } = await db.rpc("guard_memory_save", { p_subject: String(subject ?? ""), p_body: String(body ?? ""), p_kind: k, p_source: "admin" });
    if (error) return guardFail(new Error(error.message));
    return { success: true, data: String(data) };
  } catch (err) {
    return guardFail(err);
  }
}

export async function deleteGuardMemoryAction(id: string): Promise<GuardActionResult<boolean>> {
  try {
    await requireAgentAdmin();
    if (!isValidUuid(id)) return { success: false, error: "guard.errors.notFound" };
    const db = await guardDb();
    const { data, error } = await db.rpc("guard_memory_delete", { p_id: id });
    if (error) return guardFail(new Error(error.message));
    return { success: true, data: data === true };
  } catch (err) {
    return guardFail(err);
  }
}

/** The admin says "no, this is an error": the suggestion goes away, the finding stays as it was. */
export async function dismissAgentSuggestionAction(findingId: string): Promise<GuardActionResult<boolean>> {
  try {
    await requireAgentAdmin();
    if (!isValidUuid(findingId)) return { success: false, error: "guard.errors.notFound" };
    const db = await guardDb();
    const { error } = await db.rpc("guard_set_agent_suggestion", { p_id: findingId, p_suggestion: null });
    if (error) return guardFail(new Error(error.message));
    return { success: true, data: true };
  } catch (err) {
    return guardFail(err);
  }
}
