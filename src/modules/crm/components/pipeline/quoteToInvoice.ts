"use client";

import { submitSale } from "@/modules/sales";
import { calcSaleTotals, type CrmQuotation, type SaleInsert, type SaleItem } from "@/types/database.types";
import { quotationToInvoiceLines } from "../../lib/pipeline";
import { linkQuotationSaleAction } from "../../actions/pipeline";

export type QuoteToInvoiceResult =
  | { ok: true; saleId: string; docNo: string }
  | { ok: false; error: "noCustomer" | "noLines" | "missingProducts" | "save" | "link"; detail?: string; missing?: string[] };

/**
 * Quotation → sales invoice (prompt 21) through the sales module's own save (submitSale), as a
 * DRAFT: no stock, payment or ledger effect until someone checks the warehouse and posts it in
 * Sales. The quotation then points at the invoice and the deal is won.
 */
export async function quotationToDraftInvoice(input: {
  quotation: CrmQuotation;
  customerId: string | null;
  customerName: string;
  seller: { id: string | null; name: string | null };
  note: string;
}): Promise<QuoteToInvoiceResult> {
  if (!input.customerId) return { ok: false, error: "noCustomer" };
  const { lines, missing } = quotationToInvoiceLines({ items: input.quotation.items_json, discount: input.quotation.discount, tax: input.quotation.tax });
  if (missing.length) return { ok: false, error: "missingProducts", missing };
  if (!lines.length) return { ok: false, error: "noLines" };

  const items: SaleItem[] = lines.map((l, i) => ({
    id: `crm-${input.quotation.id}-${i}`,
    product_id: l.product_id,
    product_code: l.product_code,
    product_name: l.product_name,
    warehouse_id: "",
    warehouse_name: "",
    quantity: l.quantity,
    unit: l.unit,
    unit_price: l.unit_price,
    discount_percent: l.discount_percent,
    discount_type: "percentage",
    vat_rate: l.vat_rate,
    total: l.total,
    extra_info: "",
  }));
  const totals = calcSaleTotals(items, [], "free", 0);
  const header = {
    doc_no: "",
    doc_date: new Date().toISOString().slice(0, 10),
    customer_id: input.customerId,
    customer_name: input.customerName,
    seller_id: input.seller.id,
    seller_name: input.seller.name,
    warehouse_name: "",
    subtotal: totals.subtotal,
    discount_total: totals.discount_total,
    vat_total: totals.vat_total,
    total_amount: totals.grand_total,
    paid_amount: 0,
    remaining_balance: totals.grand_total,
    delivery_address: "",
    delivery_type: "free",
    delivery_fee: 0,
    note: input.note,
    created_at: new Date().toISOString(),
  } as unknown as SaleInsert;

  const saved = await submitSale({ header, items, payments: [], docNo: "", mode: "draft", decrementStock: true });
  if (!saved.success || !saved.saleId) return { ok: false, error: "save", detail: saved.error };
  const linked = await linkQuotationSaleAction(input.quotation.id, saved.saleId);
  if (!linked.success) return { ok: false, error: "link", detail: linked.error };
  return { ok: true, saleId: saved.saleId, docNo: saved.docNo ?? "" };
}
