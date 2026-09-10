export type PaymentType = "in" | "out";
export type PaymentMethod = "cash" | "bank";

export type PartnerPaymentRecord = {
  id: string;
  payment_date: string;
  partner_id: string;
  partner_name: string;
  amount: number;
  payment_type: PaymentType;
  payment_method: PaymentMethod;
  reference_note: string | null;
  cash_account_id: string;
  cash_account_name: string | null;
  journal_entry_id: string | null;
  created_at: string | null;
};

export type CreatePartnerPaymentInput = {
  partnerId: string;
  amount: number;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  paymentDate?: string | Date | null;
  referenceNote?: string | null;
  cashAccountId?: string | null;
  idempotencyKey?: string | null;
};

export type CashAccountOption = {
  id: string;
  name: string;
  code: string;
  type: string | null;
};
