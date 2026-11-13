/**
 * DATE-1: the two RPCs of the date change (admin only; the server checks). Browser side.
 */
import { getSupabaseClient } from "@/lib/supabase";
import type { DateChangeDocumentType, DateChangeOptions, DateChangePreview } from "./dateChange";

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
