import type { OfficialVatBreakdown, VatMode } from "@/lib/finance/vatEngine";

export interface TreasuryPaymentSplit {
  amount: number;
  accountId: string;
  method: string;
  label: string;
  notes?: string;
}

export interface OfficialTransactionState {
  isOfficial: boolean;
  contractId: string | null;
  vatMode: VatMode;
  voenVerification: string;
}

export interface OfficialDocumentFields {
  is_official: boolean;
  contract_id: string | null;
  vat_mode: VatMode;
  subtotal_amount: number;
  vat_rate: number;
  vat_amount: number;
  grand_total: number;
}

export function buildOfficialDocumentFields(
  state: OfficialTransactionState,
  amounts: OfficialVatBreakdown
): OfficialDocumentFields {
  return {
    is_official: state.isOfficial,
    contract_id: state.isOfficial ? state.contractId : null,
    vat_mode: state.isOfficial ? state.vatMode : "none",
    subtotal_amount: amounts.subtotal_amount,
    vat_rate: amounts.vat_rate,
    vat_amount: amounts.vat_amount,
    grand_total: amounts.grand_total,
  };
}

export async function persistSaleOfficialFields(
  saleId: string,
  fields: OfficialDocumentFields
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await import("@/lib/supabase");
  const { error } = await supabase
    .from("sales")
    .update({
      is_official: fields.is_official,
      contract_id: fields.contract_id,
      vat_mode: fields.vat_mode,
      subtotal_amount: fields.subtotal_amount,
      vat_rate: fields.vat_rate,
      vat_amount: fields.vat_amount,
      grand_total: fields.grand_total,
      vat_total: fields.vat_amount,
      total_amount: fields.grand_total,
    })
    .eq("id", saleId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function persistPurchaseOfficialFields(
  purchaseId: string,
  fields: OfficialDocumentFields
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await import("@/lib/supabase");
  const { error } = await supabase
    .from("purchases")
    .update({
      is_official: fields.is_official,
      contract_id: fields.contract_id,
      vat_mode: fields.vat_mode,
      subtotal_amount: fields.subtotal_amount,
      vat_rate: fields.vat_rate,
      vat_amount: fields.vat_amount,
      grand_total: fields.grand_total,
      total_amount: fields.grand_total,
    })
    .eq("id", purchaseId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
