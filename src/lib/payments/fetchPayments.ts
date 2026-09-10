import { supabase } from "@/lib/supabase";
import { partnerDisplayName } from "@/lib/partners/fetchPartners";
import type { PartnerRecord } from "@/lib/partners/types";
import type { CashAccountOption, PartnerPaymentRecord } from "@/lib/payments/types";

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchPartnerPayments(): Promise<PartnerPaymentRecord[]> {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, journal_entry_id, created_at, partners(name, full_name, company_name), accounts(name)"
    )
    .order("payment_date", { ascending: false });

  if (error) {
    console.error("[payments] list", error.message);
    return [];
  }

  return (data || []).map((row) => {
    const partnerRaw = row.partners as Record<string, unknown> | null;
    const partner = partnerRaw
      ? ({
          name: String(partnerRaw.name || ""),
          full_name: typeof partnerRaw.full_name === "string" ? partnerRaw.full_name : null,
          company_name: typeof partnerRaw.company_name === "string" ? partnerRaw.company_name : null,
        } as PartnerRecord)
      : null;
    const account = row.accounts as { name?: string } | null;
    return {
      id: String(row.id),
      payment_date: String(row.payment_date || ""),
      partner_id: String(row.partner_id),
      partner_name: partner ? partnerDisplayName(partner) : "—",
      amount: toAmount(row.amount),
      payment_type: row.payment_type === "out" ? "out" : "in",
      payment_method: row.payment_method === "bank" ? "bank" : "cash",
      reference_note: typeof row.reference_note === "string" ? row.reference_note : null,
      cash_account_id: String(row.cash_account_id),
      cash_account_name: account?.name || null,
      journal_entry_id: typeof row.journal_entry_id === "string" ? row.journal_entry_id : null,
      created_at: typeof row.created_at === "string" ? row.created_at : null,
    };
  });
}

export async function fetchCashAccountOptions(): Promise<CashAccountOption[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, code, name, type")
    .order("name", { ascending: true });

  if (error) {
    console.error("[payments] cash accounts", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    type: typeof row.type === "string" ? row.type : null,
  }));
}
