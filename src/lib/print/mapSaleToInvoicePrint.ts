import type { SaleRecord } from "@/lib/sales/fetchSales";
import { getSaleRemaining } from "@/lib/sales/fetchSales";
import type { InvoiceLineKind, InvoicePrintData, InvoicePrintLine, SaleItemWithMeta } from "@/lib/print/types";

function inferLineKind(item: SaleItemWithMeta): InvoiceLineKind {
  if (item.sale_item_type === "service") return "service";
  if (item.sale_item_type === "dimensional") return "dimensional";
  if (item.sale_item_type === "accessory") return "accessory";
  if (item.polywood_sale_mode === "full_sheet" || item.polywood_sale_mode === "meter" || item.polywood_sale_mode === "linear_m") {
    return "dimensional";
  }
  return "standard";
}

function mapDimensionalLine(item: SaleItemWithMeta): Partial<InvoicePrintLine> {
  const mode = item.polywood_sale_mode;
  const isFullSheet = mode === "full_sheet";
  const lengthM = item.polywood_length_m ?? (isFullSheet ? null : item.quantity);
  const pieceCount = item.piece_count ?? 1;

  return {
    saleTypeLabel: isFullSheet ? "Tam" : "Kəsim",
    lengthM: isFullSheet ? null : lengthM,
    pieceCount: isFullSheet ? item.quantity : pieceCount,
    totalMeterage: isFullSheet ? null : Number(item.quantity) || 0,
  };
}

function mapLine(item: SaleItemWithMeta, index: number): InvoicePrintLine {
  const kind = inferLineKind(item);
  const base: InvoicePrintLine = {
    kind,
    productCode: item.product_code || "",
    productName: item.product_name || "-",
    quantity: Number(item.quantity) || 0,
    unit: item.unit || "Ədəd",
    unitPrice: Number(item.unit_price) || 0,
    lineTotal: Number(item.total) || 0,
  };

  if (kind === "dimensional") {
    return { ...base, ...mapDimensionalLine(item) };
  }

  if (kind === "service") {
    return {
      ...base,
      description: item.extra_info || item.product_name || null,
    };
  }

  return {
    ...base,
    packaging: item.unit || "Ədəd",
  };
}

function resolvePaymentStatus(
  sale: Pick<SaleRecord, "total_amount" | "paid_amount" | "remaining_balance">
): InvoicePrintData["paymentStatus"] {
  const remaining = getSaleRemaining(sale);
  const paid = Number(sale.paid_amount) || 0;
  if (remaining <= 0.009) return "paid";
  if (paid > 0) return "partial";
  return "debt";
}

function detectVariant(items: SaleItemWithMeta[]): InvoicePrintData["variant"] {
  if (items.some((item) => inferLineKind(item) === "dimensional")) return "polywood";
  return "standard";
}

export function mapSaleToInvoicePrint(
  sale: SaleRecord,
  options?: { variant?: InvoicePrintData["variant"]; additionalExpenses?: number }
): InvoicePrintData {
  const items = (sale.items ?? []) as SaleItemWithMeta[];
  const remaining = getSaleRemaining(sale);

  return {
    docNo: sale.doc_no || "-",
    docDate: sale.doc_date || "-",
    customerName: sale.customer_name || "Anonim müştəri",
    sellerName: sale.seller_name || "-",
    warehouseName: sale.warehouse_name || "-",
    paymentStatus: resolvePaymentStatus(sale),
    subtotal: Number(sale.subtotal) || 0,
    discountTotal: Number(sale.discount_total) || 0,
    additionalExpenses: options?.additionalExpenses ?? 0,
    vatTotal: Number(sale.vat_total) || 0,
    grandTotal: Number(sale.total_amount) || 0,
    paidAmount: Number(sale.paid_amount) || 0,
    remainingBalance: remaining,
    currency: "AZN",
    lines: items.map(mapLine),
    notes: sale.note,
    variant: options?.variant ?? detectVariant(items),
    isOfficial: sale.is_official === true,
  };
}
