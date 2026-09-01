import { isValidUuid } from "@/lib/auth/validate";
import type { PurchaseLineItem, SaleItem } from "@/types/database.types";
import { resolveSaleItemProductId } from "@/lib/sales/saleItemProductId";

export type PreflightIssue = {
  key: string;
  params?: Record<string, string | number>;
};

type PaymentRow = { account_id?: string | null; amount?: number | null };

/** Cash/bank account required for every payment row with amount > 0. */
export function validatePaymentRowsRequireAccount(
  payments: PaymentRow[]
): PreflightIssue | null {
  for (const pay of payments) {
    const amount = Number(pay.amount) || 0;
    if (amount > 0 && !pay.account_id) {
      return { key: "forms.paymentAccountRequired" };
    }
  }
  return null;
}

export function validatePaymentsNotExceedTotal(
  paidAmount: number,
  grandTotal: number
): PreflightIssue | null {
  if (paidAmount > grandTotal + 0.001) {
    return { key: "forms.paymentsExceedTotal" };
  }
  return null;
}

export function validateSaleInvoiceLines(
  items: SaleItem[],
  resolveAvailableStock?: (item: SaleItem) => number
): PreflightIssue | null {
  const lines = items.filter((item) => item.product_id || item.product_name.trim());
  if (lines.length === 0) {
    return { key: "invoice.addProductAlert" };
  }

  for (const item of lines) {
    const productId = resolveSaleItemProductId(item);
    if (!productId || !isValidUuid(productId)) {
      return { key: "forms.productIdNotFound" };
    }

    const available = resolveAvailableStock
      ? resolveAvailableStock(item)
      : Number(item.available_stock) || 0;

    if (item.quantity > available + 1e-9) {
      return {
        key: "invoice.insufficientStock",
        params: {
          product: item.product_name || item.product_code || "-",
          available: formatQty(available),
          requested: formatQty(item.quantity),
        },
      };
    }
  }

  return null;
}

export function validatePurchaseInvoiceLines(
  items: PurchaseLineItem[]
): PreflightIssue | null {
  for (const row of items) {
    const touched =
      Boolean(row.product_id) ||
      Boolean(row.product_name?.trim()) ||
      Number(row.quantity) > 0 ||
      Number(row.unit_price) > 0;

    const complete =
      Boolean(row.product_id) &&
      Number(row.unit_price) > 0 &&
      Number(row.quantity) > 0;

    if (touched && !complete) {
      if (!row.product_id) {
        return { key: "forms.emptyPurchaseLine" };
      }
      if (Number(row.unit_price) <= 0) {
        return { key: "forms.zeroPurchasePrice" };
      }
      return { key: "forms.incompletePurchaseLine" };
    }
  }

  const validLines = items.filter(
    (row) => row.product_id && Number(row.unit_price) > 0 && Number(row.quantity) > 0
  );
  if (validLines.length === 0) {
    return { key: "forms.noPurchaseLines" };
  }

  return null;
}

function formatQty(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function preflightMessage(
  t: (key: string, params?: Record<string, string | number>) => string,
  issue: PreflightIssue
): string {
  return t(issue.key, issue.params);
}

export function validateDocumentPaymentPreflight(input: {
  amount: number;
  remainingAmount: number;
  accountId: string;
}): PreflightIssue | null {
  if (input.amount <= 0) {
    return { key: "modals.payment.invalidAmount" };
  }
  if (input.amount > input.remainingAmount + 0.001) {
    return {
      key: "modals.payment.maxAmount",
      params: { amount: input.remainingAmount.toFixed(2) },
    };
  }
  if (input.amount > 0 && !input.accountId?.trim()) {
    return { key: "forms.paymentAccountRequiredSelect" };
  }
  return null;
}

export function collectPurchaseSubmitPreflightIssues(input: {
  canSave: boolean;
  supplierId: string;
  warehouseId: string;
  items: PurchaseLineItem[];
  payments: PaymentRow[];
  totalPaid: number;
  grandTotal: number;
}): PreflightIssue | null {
  if (!input.canSave) return { key: "forms.noPurchasePermission" };
  if (!input.supplierId) return { key: "forms.selectSupplier" };
  if (!input.warehouseId) return { key: "forms.selectWarehouse" };
  return (
    validatePurchaseInvoiceLines(input.items) ||
    validatePaymentRowsRequireAccount(input.payments) ||
    validatePaymentsNotExceedTotal(input.totalPaid, input.grandTotal)
  );
}

export function collectSaleSubmitPreflightIssues(input: {
  canSave: boolean;
  customerId: string;
  items: SaleItem[];
  payments: PaymentRow[];
  paidAmount: number;
  grandTotal: number;
  resolveAvailableStock?: (item: SaleItem) => number;
}): PreflightIssue | null {
  if (!input.canSave) return { key: "invoice.noPermission" };
  if (!input.customerId) return { key: "invoice.selectCustomerAlert" };
  const saleItems = input.items.filter((i) => i.product_id || i.product_name.trim());
  return (
    validateSaleInvoiceLines(saleItems, input.resolveAvailableStock) ||
    validatePaymentRowsRequireAccount(input.payments) ||
    validatePaymentsNotExceedTotal(input.paidAmount, input.grandTotal)
  );
}
