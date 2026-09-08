import { isRetryableSelectError } from "@/lib/supabase/schemaFallback";

export type UnifiedTransactionType = "INCOME" | "EXPENSE" | "TRANSFER";

export type FinancialCategoryOption = {
  id: string;
  name: string;
  type: UnifiedTransactionType;
  parent_id?: string | null;
  parent_name?: string | null;
  is_active?: boolean;
};

export type UnifiedLedgerTransaction = {
  id: string;
  transaction_date: string;
  type: UnifiedTransactionType;
  legacy_type: string;
  amount: number;
  account_id: string | null;
  account_name: string | null;
  category: string;
  category_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  description: string;
  notes: string | null;
  created_at: string;
};

export type UnifiedLedgerSummary = {
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
};

export type AccountLedgerBalance = {
  account_id: string;
  code: string;
  name: string;
  type: string;
  stored_balance: number;
  ledger_balance: number;
  income_total: number;
  expense_total: number;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeUnifiedTransactionType(
  unifiedType: unknown,
  legacyType: unknown
): UnifiedTransactionType {
  const unified = String(unifiedType || "").toUpperCase();
  if (unified === "INCOME" || unified === "EXPENSE" || unified === "TRANSFER") {
    return unified as UnifiedTransactionType;
  }

  const legacy = String(legacyType || "").toLowerCase();
  if (legacy.includes("mədaxil") || legacy.includes("medaxil") || legacy === "income") {
    return "INCOME";
  }
  if (legacy.includes("məxaric") || legacy.includes("mexaric") || legacy === "expense") {
    return "EXPENSE";
  }
  if (legacy === "transfer") return "TRANSFER";
  return "EXPENSE";
}

function extractAccountName(accounts: unknown): string | null {
  if (!accounts) return null;
  if (Array.isArray(accounts)) {
    const first = accounts[0] as { name?: string } | undefined;
    return first?.name?.trim() || null;
  }
  const name = (accounts as { name?: string }).name;
  return name?.trim() || null;
}

export function mapUnifiedLedgerRow(row: Record<string, unknown>): UnifiedLedgerTransaction {
  const legacyType = String(row.type || "");
  const unifiedType = normalizeUnifiedTransactionType(row.unified_type, legacyType);
  const dateValue = String(row.transaction_date || row.created_at || "");
  const financialCategory = row.financial_categories as { name?: string } | null | undefined;

  return {
    id: String(row.id || ""),
    transaction_date: dateValue,
    type: unifiedType,
    legacy_type: legacyType,
    amount: num(row.amount),
    account_id: (row.account_id as string) || null,
    account_name: extractAccountName(row.accounts),
    category: String(row.category || financialCategory?.name || "—"),
    category_id: (row.category_id as string) || null,
    reference_type: String(row.reference_type || row.source_type || "") || null,
    reference_id: (row.reference_id as string) || (row.source_id as string) || null,
    description: String(row.description || row.notes || ""),
    notes: (row.notes as string) || null,
    created_at: String(row.created_at || ""),
  };
}

export function summarizeUnifiedLedger(rows: UnifiedLedgerTransaction[]): UnifiedLedgerSummary {
  let totalIncome = 0;
  let totalExpense = 0;

  for (const row of rows) {
    if (row.type === "INCOME") totalIncome += row.amount;
    else if (row.type === "EXPENSE") totalExpense += row.amount;
  }

  return {
    totalIncome,
    totalExpense,
    netBalance: totalIncome - totalExpense,
  };
}

export function computeAccountLedgerBalances(
  accounts: Array<Record<string, unknown>>,
  transactions: UnifiedLedgerTransaction[]
): AccountLedgerBalance[] {
  const byAccount = new Map<
    string,
    { income: number; expense: number }
  >();

  for (const tx of transactions) {
    if (!tx.account_id) continue;
    const bucket = byAccount.get(tx.account_id) || { income: 0, expense: 0 };
    if (tx.type === "INCOME") bucket.income += tx.amount;
    else if (tx.type === "EXPENSE") bucket.expense += tx.amount;
    byAccount.set(tx.account_id, bucket);
  }

  return accounts.map((account) => {
    const id = String(account.id);
    const bucket = byAccount.get(id) || { income: 0, expense: 0 };
    const ledgerBalance = bucket.income - bucket.expense;
    return {
      account_id: id,
      code: String(account.code || ""),
      name: String(account.name || ""),
      type: String(account.type || ""),
      stored_balance: num(account.balance),
      ledger_balance: ledgerBalance,
      income_total: bucket.income,
      expense_total: bucket.expense,
    };
  });
}

const REFERENCE_LABELS_AZ: Record<string, string> = {
  production_expense: "İstehsalat xərci",
  production: "İstehsalat",
  manual_expense: "Əl ilə xərc",
  purchase_invoice: "Satın alma fakturası",
  purchase: "Satın alma",
  customer_advance: "Müştəri avansı",
  sale: "Satış fakturası",
  cash_transaction: "Kassa əməliyyatı",
};

export function formatReferenceTypeLabel(referenceType: string | null | undefined): string {
  if (!referenceType) return "—";
  return REFERENCE_LABELS_AZ[referenceType] || referenceType;
}

export function isRetryableLedgerSelectError(message: string | undefined): boolean {
  return isRetryableSelectError(message);
}

export function attachAccountNamesToLedgerRows(
  rows: Record<string, unknown>[],
  accountNamesById: Map<string, string>
): Record<string, unknown>[] {
  return rows.map((row) => {
    if (extractAccountName(row.accounts)) return row;
    const accountId = (row.account_id as string) || "";
    if (!accountId) return row;
    const name = accountNamesById.get(accountId);
    if (!name) return row;
    return { ...row, accounts: { name } };
  });
}

export const UNIFIED_LEDGER_SELECT_ATTEMPTS = [
  "id, type, unified_type, amount, category, category_id, notes, description, transaction_date, created_at, account_id, reference_type, reference_id, source_type, source_id, accounts!account_id(name), financial_categories!category_id(name)",
  "id, type, unified_type, amount, category, category_id, notes, description, transaction_date, created_at, account_id, reference_type, reference_id, source_type, source_id, accounts!transactions_account_id_fkey(name), financial_categories!category_id(name)",
  "id, type, unified_type, amount, category, category_id, notes, description, transaction_date, created_at, account_id, reference_type, reference_id, source_type, source_id, accounts!fk_transactions_account(name), financial_categories!category_id(name)",
  "id, type, amount, category, notes, created_at, account_id, source_type, source_id, accounts!account_id(name)",
  "id, type, amount, category, notes, created_at, account_id, source_type, source_id, accounts!transactions_account_id_fkey(name)",
  "id, type, unified_type, amount, category, category_id, notes, description, transaction_date, created_at, account_id, reference_type, reference_id, source_type, source_id",
  "id, type, amount, category, notes, created_at, account_id, source_type, source_id",
] as const;
