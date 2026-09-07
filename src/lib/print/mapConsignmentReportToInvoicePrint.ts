import type { ConsignmentMonthlyReport } from "@/lib/consignment/types";
import type { InvoicePrintData } from "@/lib/print/types";

export function mapConsignmentReportToInvoicePrint(
  report: ConsignmentMonthlyReport
): InvoicePrintData {
  return {
    docNo: report.report_no,
    docDate: report.report_period,
    customerName: report.partner_name || "-",
    sellerName: "-",
    warehouseName: "-",
    paymentStatus: "debt",
    subtotal: Number(report.total_amount) || 0,
    discountTotal: 0,
    additionalExpenses: 0,
    vatTotal: 0,
    grandTotal: Number(report.total_amount) || 0,
    paidAmount: 0,
    remainingBalance: Number(report.total_amount) || 0,
    currency: "AZN",
    notes: report.notes,
    variant: "consignment",
    lines: (report.sold_items || []).map((item) => ({
      kind: "accessory",
      productCode: item.product_code || "",
      productName: item.product_name,
      packaging: "Ədəd",
      quantity: Number(item.quantity_sold) || 0,
      unit: "Ədəd",
      unitPrice: Number(item.unit_price) || 0,
      lineTotal: Number(item.total_price) || 0,
    })),
  };
}
