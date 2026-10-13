/**
 * Bank transfer with a manual invoice (plan §4.5, available from day one): the invoice PDF and
 * the checkout show the seller's bank details and the invoice number as the payment
 * reference; when the money arrives an admin records the payment in the panel
 * (record_payment), which marks the invoice paid and reactivates the tenant.
 */
import { PaymentProviderError, type Checkout, type CheckoutInvoice, type PaymentProvider } from "./types.ts";

export interface BankDetails {
  seller_name?: string | null;
  seller_tax_id?: string | null;
  bank_name?: string | null;
  bank_code?: string | null;
  bank_tax_id?: string | null;
  bank_swift?: string | null;
  bank_correspondent_account?: string | null;
  bank_account?: string | null;
}

/** Labels are i18n keys under invoiceDoc.bank (the caller translates them). */
export function bankTransferLines(bank: BankDetails, invoiceNumber: string): { label: string; value: string }[] {
  const rows: [string, string | null | undefined][] = [
    ["beneficiary", bank.seller_name],
    ["beneficiaryTaxId", bank.seller_tax_id],
    ["bankName", bank.bank_name],
    ["bankCode", bank.bank_code],
    ["bankTaxId", bank.bank_tax_id],
    ["swift", bank.bank_swift],
    ["correspondentAccount", bank.bank_correspondent_account],
    ["account", bank.bank_account],
    ["reference", invoiceNumber],
  ];
  return rows.filter(([, v]) => v && String(v).trim()).map(([label, value]) => ({ label, value: String(value).trim() }));
}

export function manualBankTransfer(bank: () => Promise<BankDetails>): PaymentProvider {
  return {
    id: "manual_bank_transfer",
    supportsSavedCards: false,
    missing: [],
    async createCheckout(invoice: CheckoutInvoice): Promise<Checkout> {
      return { kind: "instructions", reference: invoice.number, lines: bankTransferLines(await bank(), invoice.number) };
    },
    async chargeSavedCard() {
      throw new PaymentProviderError("not_supported", "bank transfer cannot charge a card");
    },
    async refund() {
      // The money goes back by a transfer made outside the system; the admin records it.
      return { status: "pending", reference: null };
    },
    async verifyWebhook() {
      return null; // no webhooks: payments are recorded by an admin
    },
  };
}
