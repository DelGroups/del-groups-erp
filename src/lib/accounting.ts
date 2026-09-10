import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

/** GL account types (maps to chart_of_accounts.account_type). */
export type GlAccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "income"
  | "expense"
  | "contra";

/** Chart of Accounts row (Hesablar Planı). Stored in chart_of_accounts. */
export type GlAccount = {
  id: string;
  code: string;
  name: string;
  type: GlAccountType;
  is_active: boolean;
};

/** One Debet/Kredit line for a journal entry. */
export type JournalLineInput = {
  /** GL account UUID (chart_of_accounts.id). */
  accountId?: string | null;
  /** GL account code, e.g. '1200'. Resolved server-side when accountId is omitted. */
  accountCode?: string | null;
  /** Business partner for AR/AP sub-ledgers. */
  partnerId?: string | null;
  partnerType?: string | null;
  /** Optional cash/bank account (public.accounts) when line ties to Kassa/Bank. */
  cashAccountId?: string | null;
  debit?: number;
  credit?: number;
  memo?: string | null;
};

/** 1C-style journal entry payload (Müxabirləşmə). */
export type CreateJournalEntryInput = {
  date?: string | Date | null;
  documentType: string;
  documentId?: string | null;
  description?: string | null;
  entryNo?: string | null;
  idempotencyKey?: string | null;
  lines: JournalLineInput[];
};

export type CreateJournalEntryResult =
  | { success: true; entryId: string }
  | { success: false; error: string };

const BALANCE_TOLERANCE = 0.0001;

function toIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toAmount(value: number | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapAccountType(value: unknown): GlAccountType {
  const raw = String(value || "asset").toLowerCase();
  if (
    raw === "asset" ||
    raw === "liability" ||
    raw === "equity" ||
    raw === "revenue" ||
    raw === "income" ||
    raw === "expense" ||
    raw === "contra"
  ) {
    return raw;
  }
  return "asset";
}

/** Validate debet/kredit balance before hitting the database. */
export function validateJournalLines(lines: JournalLineInput[]): string | null {
  if (!lines.length) return "Journal sətirləri tələb olunur";

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    const debit = toAmount(line.debit);
    const credit = toAmount(line.credit);

    if (debit < 0 || credit < 0) return "Debet və kredit mənfi ola bilməz";
    if (debit > 0 && credit > 0) return "Eyni sətirdə debet və kredit eyni vaxtda ola bilməz";
    if (!line.accountId && !line.accountCode) {
      return "Hər sətir üçün accountId və ya accountCode tələb olunur";
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    return `Journal balanssızdir (debet=${totalDebit.toFixed(2)}, kredit=${totalCredit.toFixed(2)})`;
  }

  return null;
}

function buildRpcPayload(input: CreateJournalEntryInput) {
  const isoDate = toIsoDate(input.date);
  const entryDate = isoDate ? isoDate.slice(0, 10) : null;

  return {
    date: isoDate,
    entry_date: entryDate,
    document_type: input.documentType,
    source_type: input.documentType,
    document_id: input.documentId || null,
    source_id: input.documentId || null,
    description: input.description || null,
    memo: input.description || null,
    entry_no: input.entryNo || null,
    idempotency_key: input.idempotencyKey || null,
    lines: input.lines.map((line) => ({
      account_id: line.accountId || null,
      account_code: line.accountCode || null,
      coa_id: line.accountId || null,
      coa_code: line.accountCode || null,
      partner_id: line.partnerId || null,
      partner_type: line.partnerType || null,
      cash_account_id: line.cashAccountId || null,
      debit: toAmount(line.debit),
      credit: toAmount(line.credit),
      line_memo: line.memo || null,
      memo: line.memo || null,
    })),
  };
}

/**
 * Post a balanced double-entry journal entry via PostgreSQL RPC.
 * Uses create_journal_entry (deferred DB trigger enforces debit = credit).
 */
export async function createJournalEntry(
  input: CreateJournalEntryInput,
  options?: { useAdmin?: boolean }
): Promise<CreateJournalEntryResult> {
  const validationError = validateJournalLines(input.lines);
  if (validationError) {
    return { success: false, error: validationError };
  }

  if (!input.documentType?.trim()) {
    return { success: false, error: "documentType tələb olunur" };
  }

  const client = options?.useAdmin
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  const { data, error } = await client.rpc("create_journal_entry", {
    p_payload: buildRpcPayload(input),
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data) {
    return { success: false, error: "create_journal_entry cavab vermədi" };
  }

  return { success: true, entryId: String(data) };
}

/** Load active GL accounts (chart_of_accounts). */
export async function fetchGlAccounts(options?: {
  useAdmin?: boolean;
}): Promise<GlAccount[]> {
  const client = options?.useAdmin
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  const { data, error } = await client
    .from("chart_of_accounts")
    .select("id, code, name, account_type, is_active")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) {
    console.error("[accounting] fetchGlAccounts", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    type: mapAccountType(row.account_type),
    is_active: row.is_active !== false,
  }));
}

/** Resolve a GL account id by code (client-side helper; RPC also resolves codes). */
export type CreatePartnerPaymentInput = {
  partnerId: string;
  amount: number;
  paymentType: "in" | "out";
  paymentMethod: "cash" | "bank";
  paymentDate?: string | Date | null;
  referenceNote?: string | null;
  cashAccountId?: string | null;
  idempotencyKey?: string | null;
};

export type CreatePartnerPaymentResult =
  | { success: true; paymentId: string; journalEntryId?: string; transactionId?: string }
  | { success: false; error: string };

/** Atomic partner payment: inserts payment row + cash movement + balanced journal entry. */
export async function createPartnerPayment(
  input: CreatePartnerPaymentInput,
  options?: { useAdmin?: boolean }
): Promise<CreatePartnerPaymentResult> {
  if (!input.partnerId) return { success: false, error: "Tərəfdaş seçilməlidir" };
  if (!input.amount || input.amount <= 0) {
    return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
  }

  const client = options?.useAdmin
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  const paymentDate = toIsoDate(input.paymentDate);

  const { data, error } = await client.rpc("create_partner_payment", {
    p_payload: {
      partner_id: input.partnerId,
      amount: input.amount,
      payment_type: input.paymentType,
      payment_method: input.paymentMethod,
      payment_date: paymentDate,
      reference_note: input.referenceNote || null,
      cash_account_id: input.cashAccountId || null,
      idempotency_key: input.idempotencyKey || null,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const payload = (data || {}) as {
    success?: boolean;
    payment_id?: string;
    journal_entry_id?: string;
    transaction_id?: string;
    error?: string;
  };

  if (!payload.success || !payload.payment_id) {
    return { success: false, error: payload.error || "Ödəniş qeydə alınmadı" };
  }

  return {
    success: true,
    paymentId: String(payload.payment_id),
    journalEntryId: payload.journal_entry_id ? String(payload.journal_entry_id) : undefined,
    transactionId: payload.transaction_id ? String(payload.transaction_id) : undefined,
  };
}

export async function resolveGlAccountIdByCode(
  code: string,
  options?: { useAdmin?: boolean }
): Promise<string | null> {
  const normalized = code.trim();
  if (!normalized) return null;

  const client = options?.useAdmin
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  const { data, error } = await client
    .from("chart_of_accounts")
    .select("id")
    .eq("code", normalized)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  return String(data.id);
}
