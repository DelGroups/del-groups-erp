import type { PurchaseItemInsert, PurchaseLineItem, PurchasePaymentRow } from "@/types/database.types";

export type { PurchasePaymentRow };

export function createEmptyPurchasePayment(): PurchasePaymentRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    account_id: "",
    amount: 0,
    payment_date: new Date().toISOString().slice(0, 10),
    note: "",
  };
}

export function calcPurchasePaymentsTotal(payments: PurchasePaymentRow[]): number {
  return payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

/** Generates a unique purchase invoice number, e.g. PUR-2026-48291 */
export function generatePurchaseInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(10000 + Math.random() * 90000);
  return `PUR-${year}-${seq}`;
}

export function createEmptyPurchaseLineItem(): PurchaseLineItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: "",
    product_code: "",
    product_name: "",
    quantity: 1,
    unit: "Ədəd",
    unit_price: 0,
    total: 0,
  };
}

export function calcPurchaseLineTotal(quantity: number, unitPrice: number): number {
  return (Number(quantity) || 0) * (Number(unitPrice) || 0);
}

export function calcPurchaseGrandTotal(items: PurchaseLineItem[]): number {
  return items.reduce((sum, item) => sum + item.total, 0);
}

export function purchaseLineItemsToRows(
  purchaseId: string,
  items: PurchaseLineItem[]
): PurchaseItemInsert[] {
  return items.map((item) => ({
    purchase_id: purchaseId,
    product_id: item.product_id || null,
    product_code: item.product_code || null,
    product_name: item.product_name || null,
    quantity: item.quantity,
    unit: item.unit || "Ədəd",
    unit_price: item.unit_price,
    total_price: item.total,
  }));
}
