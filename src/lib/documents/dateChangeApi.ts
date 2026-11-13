/**
 * DATE-1/2: the RPCs of the date change (admin only; the server checks). Browser side.
 */
import { getSupabaseClient } from "@/lib/supabase";
import { parseResolvedDocument, type DateChangeDocumentType, type DateChangeOptions, type DateChangePreview, type ResolvedDateChangeDocument } from "./dateChange";

export async function previewDocumentDateChange(type: DateChangeDocumentType, id: string, newDate: string, options: DateChangeOptions): Promise<DateChangePreview> {
  const { data, error } = await getSupabaseClient().rpc("preview_document_date_change" as never, {
    p_document_type: type,
    p_document_id: id,
    p_new_date: newDate,
    p_options: options,
  } as never);
  if (error) throw new Error(error.message);
  const p = (data ?? {}) as Partial<DateChangePreview>;
  return { ok: p.ok === true, old_date: p.old_date, new_date: p.new_date, label: p.label, blockers: p.blockers ?? [], warnings: p.warnings ?? [], affected: p.affected ?? {} };
}

export async function applyDocumentDateChange(
  type: DateChangeDocumentType,
  id: string,
  newDate: string,
  reason: string,
  options: DateChangeOptions,
  acknowledged: string[]
): Promise<{ changeId: string; moved: number }> {
  const { data, error } = await getSupabaseClient().rpc("apply_document_date_change" as never, {
    p_document_type: type,
    p_document_id: id,
    p_new_date: newDate,
    p_reason: reason,
    p_options: options,
    p_acknowledged_warnings: acknowledged,
  } as never);
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { change_id?: string; moved?: number };
  return { changeId: String(r.change_id ?? ""), moved: Number(r.moved ?? 0) };
}

/** DATE-2: the document a cash row belongs to (an invoice payment, a partner payment, a manual row, an expense, an invoice), or null. */
export async function resolveDateChangeDocument(transactionId: string): Promise<ResolvedDateChangeDocument | null> {
  const { data, error } = await getSupabaseClient().rpc("resolve_date_change_document" as never, { p_transaction_id: transactionId } as never);
  if (error) throw new Error(error.message);
  return parseResolvedDocument(data);
}
