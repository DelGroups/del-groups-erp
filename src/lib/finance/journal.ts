import { supabase } from "@/lib/supabase";
import type {
  ChartOfAccount,
  JournalEntry,
  JournalEntryLine,
} from "@/types/database.types";

export type JournalEntryLinePayload = {
  coa_id?: string | null;
  coa_code?: string | null;
  debit?: number;
  credit?: number;
  partner_type?: string | null;
  partner_id?: string | null;
  account_id?: string | null;
  line_memo?: string | null;
};

export type JournalEntryPayload = {
  entry_no?: string | null;
  entry_date?: string | null;
  source_type: string;
  source_id?: string | null;
  idempotency_key?: string | null;
  memo?: string | null;
  lines: JournalEntryLinePayload[];
};

export type JournalEntryWithLines = JournalEntry & {
  lines: JournalEntryLine[];
};

export type PostJournalEntryResult = {
  success: boolean;
  error?: string;
  journalEntryId?: string;
};

export type GetJournalBySourceResult = {
  success: boolean;
  error?: string;
  entries: JournalEntryWithLines[];
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapChartOfAccount(row: Record<string, unknown>): ChartOfAccount {
  return {
    id: String(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    account_type: String(row.account_type || "asset") as ChartOfAccount["account_type"],
    parent_id: (row.parent_id as string) || null,
    is_active: row.is_active !== false,
    created_at: (row.created_at as string) || null,
  };
}

function mapJournalEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: String(row.id),
    entry_no: String(row.entry_no || ""),
    entry_date: String(row.entry_date || ""),
    source_type: String(row.source_type || ""),
    source_id: (row.source_id as string) || null,
    idempotency_key: (row.idempotency_key as string) || null,
    memo: (row.memo as string) || null,
    posted_at: (row.posted_at as string) || null,
    created_by: (row.created_by as string) || null,
  };
}

function mapJournalLine(
  row: Record<string, unknown>,
  coa?: ChartOfAccount | null
): JournalEntryLine {
  return {
    id: String(row.id),
    journal_entry_id: String(row.journal_entry_id),
    coa_id: String(row.coa_id),
    debit: num(row.debit),
    credit: num(row.credit),
    partner_type: (row.partner_type as string) || null,
    partner_id: (row.partner_id as string) || null,
    account_id: (row.account_id as string) || null,
    line_memo: (row.line_memo as string) || null,
    chart_of_accounts: coa || null,
  };
}

/** Post a balanced double-entry journal via PostgreSQL RPC. */
export async function postJournalEntry(
  payload: JournalEntryPayload
): Promise<PostJournalEntryResult> {
  const { data, error } = await supabase.rpc("post_journal_entry", {
    p_payload: payload,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data) {
    return { success: false, error: "Journal entry RPC cavab vermədi" };
  }

  return { success: true, journalEntryId: String(data) };
}

/** Load journal headers and lines for a business document / cash transaction source. */
export async function getJournalBySource(
  sourceType: string,
  sourceId: string
): Promise<GetJournalBySourceResult> {
  const { data: entries, error: entriesError } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("posted_at", { ascending: false });

  if (entriesError) {
    return { success: false, error: entriesError.message, entries: [] };
  }

  const entryRows = (entries || []) as Record<string, unknown>[];
  if (!entryRows.length) {
    return { success: true, entries: [] };
  }

  const entryIds = entryRows.map((row) => String(row.id));
  const { data: lines, error: linesError } = await supabase
    .from("journal_entry_lines")
    .select("*, chart_of_accounts(*)")
    .in("journal_entry_id", entryIds)
    .order("debit", { ascending: false });

  if (linesError) {
    return { success: false, error: linesError.message, entries: [] };
  }

  const linesByEntry = new Map<string, JournalEntryLine[]>();
  for (const rawLine of (lines || []) as Record<string, unknown>[]) {
    const coaRaw = rawLine.chart_of_accounts as Record<string, unknown> | null;
    const coa = coaRaw ? mapChartOfAccount(coaRaw) : null;
    const line = mapJournalLine(rawLine, coa);
    const bucket = linesByEntry.get(line.journal_entry_id) || [];
    bucket.push(line);
    linesByEntry.set(line.journal_entry_id, bucket);
  }

  return {
    success: true,
    entries: entryRows.map((row) => ({
      ...mapJournalEntry(row),
      lines: linesByEntry.get(String(row.id)) || [],
    })),
  };
}

/** Convenience helper for cash transaction journal lookup. */
export async function getCashTransactionJournal(transactionId: string) {
  return getJournalBySource("cash_transaction", transactionId);
}
