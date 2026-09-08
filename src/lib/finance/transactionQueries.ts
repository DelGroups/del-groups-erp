import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  attachAccountNamesToLedgerRows,
  isRetryableLedgerSelectError,
  mapUnifiedLedgerRow,
  UNIFIED_LEDGER_SELECT_ATTEMPTS,
  type UnifiedTransactionType,
} from "@/lib/finance/unifiedLedger";

async function hydrateLedgerAccountNames(
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const accountIds = Array.from(
    new Set(
      rows
        .map((row) => (row.account_id as string) || "")
        .filter((id) => id.length > 0)
    )
  );

  if (accountIds.length === 0) return rows;

  const admin = createSupabaseAdminClient();
  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id,name")
    .in("id", accountIds);

  if (error || !accounts?.length) return rows;

  const accountNamesById = new Map(
    accounts.map((account) => [String(account.id), String(account.name || "")])
  );

  return attachAccountNamesToLedgerRows(rows, accountNamesById);
}

export async function fetchTransactionsRaw(
  filter?: { type?: UnifiedTransactionType; limit?: number }
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const admin = createSupabaseAdminClient();
  const limit = filter?.limit ?? 2000;
  let lastError: string | null = null;

  for (const fields of UNIFIED_LEDGER_SELECT_ATTEMPTS) {
    let query = admin
      .from("transactions")
      .select(fields)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filter?.type && fields.includes("unified_type")) {
      query = query.eq("unified_type", filter.type);
    }

    const { data, error } = await query;
    if (!error) {
      let rows = (data || []) as Record<string, unknown>[];
      if (filter?.type && !fields.includes("unified_type")) {
        rows = rows.filter((row) => mapUnifiedLedgerRow(row).type === filter.type);
      }
      if (!fields.includes("accounts!")) {
        rows = await hydrateLedgerAccountNames(rows);
      }
      return { rows, error: null };
    }

    lastError = error.message || "Failed to load transactions";
    if (!isRetryableLedgerSelectError(lastError)) {
      return { rows: [], error: lastError };
    }
  }

  return { rows: [], error: lastError || "transactions schema mismatch" };
}

export const FINANCIAL_REPORT_SELECT_ATTEMPTS = [
  "id, type, amount, category, notes, created_at, accounts!transactions_account_id_fkey(name)",
  "id, type, amount, category, notes, created_at, accounts!account_id(name)",
  "id, type, amount, category, notes, created_at, accounts!fk_transactions_account(name)",
  "id, type, amount, category, notes, created_at",
] as const;
