import type { SaleItem } from "@/types/database.types";

export type PrintMode = "official" | "unofficial";

export type InvoiceLineKind = "dimensional" | "accessory" | "service" | "standard";

export interface InvoicePrintLine {
  kind: InvoiceLineKind;
  productCode: string;
  productName: string;
  saleTypeLabel?: string | null;
  lengthM?: number | null;
  pieceCount?: number | null;
  totalMeterage?: number | null;
  packaging?: string | null;
  description?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoicePrintData {
  docNo: string;
  docDate: string;
  customerName: string;
  sellerName: string;
  warehouseName: string;
  paymentStatus: "paid" | "partial" | "debt";
  subtotal: number;
  discountTotal: number;
  additionalExpenses: number;
  vatTotal: number;
  grandTotal: number;
  paidAmount: number;
  remainingBalance: number;
  currency: string;
  lines: InvoicePrintLine[];
  notes?: string | null;
  variant?: "standard" | "polywood" | "consignment";
}

export interface CompanyBranding {
  companyName: string;
  logoUrl: string | null;
  voen: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  iban: string | null;
}

export const DEFAULT_COMPANY_BRANDING: CompanyBranding = {
  companyName: "DEL GROUPS MMC",
  logoUrl: null,
  voen: null,
  address: null,
  phone: null,
  email: null,
  bankName: null,
  iban: null,
};

export type SaleItemWithMeta = SaleItem & {
  sale_item_type?: SaleItem["sale_item_type"];
  piece_count?: number | null;
  polywood_sale_mode?: string | null;
  polywood_length_m?: number | null;
};
