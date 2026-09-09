import { supabase } from "@/lib/supabase";
import type { CompanyBranding } from "@/lib/print/types";
import type { SaleRecord } from "@/lib/sales/fetchSales";
import type { PurchaseRecord } from "@/types/database.types";
import {
  TAX_PAYROLL_CONFIG_KEY,
  parseTaxPayrollConfig,
} from "@/lib/tax/payrollConfig";
import {
  buildEQaimeJson,
  buildEQaimeXml,
  classifyVatRate,
  downloadTextFile,
  eQaimeFilename,
  parseInvoiceSerial,
  type EQaimeDocument,
  type EQaimeLine,
} from "@/lib/tax/eQaime";

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function fetchPartyVoen(table: "customers" | "suppliers", id: string | null | undefined): Promise<string> {
  if (!id) return "";
  const { data } = await supabase.from(table).select("voen").eq("id", id).maybeSingle();
  return (data?.voen as string) || "";
}

async function resolveBranding(branding: CompanyBranding): Promise<CompanyBranding> {
  if (branding.voen && branding.companyName) return branding;
  const [{ data: settings }, { data: company }, { data: taxRow }] = await Promise.all([
    supabase.from("settings").select("company_name, voen, address, phone").limit(1).maybeSingle(),
    supabase.from("company_settings").select("company_name, voen, address, phone").limit(1).maybeSingle(),
    supabase.from("system_settings").select("value").eq("key", TAX_PAYROLL_CONFIG_KEY).maybeSingle(),
  ]);
  const taxConfig = parseTaxPayrollConfig(taxRow?.value);
  return {
    ...branding,
    companyName:
      branding.companyName ||
      company?.company_name ||
      settings?.company_name ||
      branding.companyName,
    voen: branding.voen || taxConfig.company_voen || company?.voen || settings?.voen || null,
    address: branding.address || company?.address || settings?.address || null,
    phone: branding.phone || company?.phone || settings?.phone || null,
  };
}

function lineVat(rate: number, net: number, storedVat?: number): { vatRate: number; vatAmount: number } {
  const vatRate = Number(rate) || 0;
  if (storedVat != null && Number.isFinite(storedVat)) {
    return { vatRate, vatAmount: money(storedVat) };
  }
  return { vatRate, vatAmount: money(net * (vatRate / 100)) };
}

export function saleToEQaime(
  sale: SaleRecord,
  branding: CompanyBranding,
  buyerVoen: string
): EQaimeDocument {
  const parsed = parseInvoiceSerial(sale.doc_no);
  const headerRate = Number(sale.vat_rate) || 0;
  const lines: EQaimeLine[] = (sale.items || []).map((item) => {
    const net = money(Number(item.total) || Number(item.quantity) * Number(item.unit_price) || 0);
    const vatRate = Number(item.vat_rate) || headerRate;
    const { vatAmount } = lineVat(vatRate, net);
    return {
      code: item.product_code || "",
      name: item.product_name || "",
      unit: item.unit || "Ədəd",
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unit_price) || 0,
      lineNet: net,
      vatRate,
      vatAmount,
      lineGross: money(net + vatAmount),
      vatCode: classifyVatRate(vatRate, sale.vat_mode),
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.lineNet, 0) || money(Number(sale.subtotal) || 0);
  const vatTotal = lines.reduce((sum, line) => sum + line.vatAmount, 0) || money(Number(sale.vat_total || sale.vat_amount) || 0);

  return {
    documentType: "SALE",
    invoiceSerial: parsed.serial,
    invoiceNumber: parsed.number,
    invoiceDate: (sale.doc_date || sale.created_at || "").slice(0, 10),
    currency: "AZN",
    seller: {
      voen: branding.voen || "",
      name: branding.companyName,
      address: branding.address,
    },
    buyer: {
      voen: buyerVoen,
      name: sale.customer_name || "Anonim müştəri",
    },
    lines,
    subtotal,
    vatTotal,
    grandTotal: money(Number(sale.grand_total || sale.total_amount) || subtotal + vatTotal),
    notes: sale.note,
  };
}

export function purchaseToEQaime(
  purchase: PurchaseRecord,
  branding: CompanyBranding,
  sellerVoen: string
): EQaimeDocument {
  const parsed = parseInvoiceSerial(purchase.invoice_number);
  const headerRate = Number(purchase.vat_rate) || 0;
  const lines: EQaimeLine[] = (purchase.items || []).map((item) => {
    const net = money(Number(item.total) || Number(item.quantity) * Number(item.unit_price) || 0);
    const { vatAmount } = lineVat(headerRate, net);
    return {
      code: item.product_code || "",
      name: item.product_name || "",
      unit: item.unit || "Ədəd",
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unit_price) || 0,
      lineNet: net,
      vatRate: headerRate,
      vatAmount,
      lineGross: money(net + vatAmount),
      vatCode: classifyVatRate(headerRate, purchase.vat_mode),
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.lineNet, 0) || money(Number(purchase.subtotal_amount || purchase.total_amount) || 0);
  const vatTotal = lines.reduce((sum, line) => sum + line.vatAmount, 0) || money(Number(purchase.vat_amount) || 0);

  return {
    documentType: "PURCHASE",
    invoiceSerial: parsed.serial,
    invoiceNumber: parsed.number,
    invoiceDate: (purchase.doc_date || purchase.created_at || "").slice(0, 10),
    currency: "AZN",
    seller: {
      voen: sellerVoen,
      name: purchase.supplier_company || purchase.supplier_name || "Təchizatçı",
    },
    buyer: {
      voen: branding.voen || "",
      name: branding.companyName,
      address: branding.address,
    },
    lines,
    subtotal,
    vatTotal,
    grandTotal: money(Number(purchase.grand_total || purchase.total_amount) || subtotal + vatTotal),
    notes: purchase.notes,
  };
}

export async function exportSaleEQaime(
  sale: SaleRecord,
  branding: CompanyBranding,
  format: "xml" | "json"
): Promise<void> {
  const [voen, resolved] = await Promise.all([
    fetchPartyVoen("customers", sale.customer_id),
    resolveBranding(branding),
  ]);
  const doc = saleToEQaime(sale, resolved, voen);
  const content = format === "xml" ? buildEQaimeXml(doc) : buildEQaimeJson(doc);
  const mime = format === "xml" ? "application/xml" : "application/json";
  downloadTextFile(eQaimeFilename(doc, format), content, mime);
}

export async function exportPurchaseEQaime(
  purchase: PurchaseRecord,
  branding: CompanyBranding,
  format: "xml" | "json"
): Promise<void> {
  const [voen, resolved] = await Promise.all([
    fetchPartyVoen("suppliers", purchase.supplier_id),
    resolveBranding(branding),
  ]);
  const doc = purchaseToEQaime(purchase, resolved, voen);
  const content = format === "xml" ? buildEQaimeXml(doc) : buildEQaimeJson(doc);
  const mime = format === "xml" ? "application/xml" : "application/json";
  downloadTextFile(eQaimeFilename(doc, format), content, mime);
}
