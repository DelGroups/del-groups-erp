export type PartnerRecord = {
  id: string;
  name: string;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  voen: string | null;
  bank_name: string | null;
  iban: string | null;
  credit_limit: number;
  entity_type: string;
  code: string | null;
  is_customer: boolean;
  is_supplier: boolean;
  customer_id: string | null;
  supplier_id: string | null;
  is_deleted: boolean;
  created_at: string | null;
};

export type PartnerFormInput = {
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  voen?: string;
  bank_name?: string;
  iban?: string;
  credit_limit?: number;
  is_customer: boolean;
  is_supplier: boolean;
  address?: string;
};

export type PartnerNetBalance = {
  receivables: number;
  payables: number;
  netBalance: number;
};

export type PartnerSaleRow = {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_balance: number;
  status: string | null;
};

export type PartnerPurchaseRow = {
  id: string;
  invoice_number: string | null;
  doc_date: string | null;
  total_amount: number;
  paid_amount: number;
  debt_amount: number;
  status: string | null;
};

export type PartnerLedgerEntry = {
  id: string;
  date: string;
  type: "sale" | "purchase";
  documentNo: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type PartnerDashboardData = {
  partner: PartnerRecord;
  balance: PartnerNetBalance;
  sales: PartnerSaleRow[];
  purchases: PartnerPurchaseRow[];
  ledger: PartnerLedgerEntry[];
};

export function isCreditLimitExceeded(partner: Pick<PartnerRecord, "credit_limit">, balance: PartnerNetBalance): boolean {
  const limit = Number(partner.credit_limit) || 0;
  if (limit <= 0) return false;
  return Math.abs(balance.netBalance) > limit;
}
