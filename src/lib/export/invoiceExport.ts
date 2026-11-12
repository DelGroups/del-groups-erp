/**
 * INV-2: one sales or purchase invoice as an .xlsx or .pdf file. Pure: no React, no Supabase,
 * no browser. The client runner (invoiceExportDownload.ts) loads the libraries and the font when
 * the user clicks; the tests and the sample script call these functions in Node.
 *
 * The data comes from the print mapping (mapSaleToInvoicePrint for sales, the purchase print's
 * fields for purchases), so the file says what the printed invoice says. XLS-1: both files render
 * from one layout (invoiceLayout.ts); the Excel workbook is written by invoiceXlsx.ts (ExcelJS).
 * One difference from the print: people are named by their display name, never an e-mail
 * (personName), where the print still shows the e-mail of a profile without a name.
 */
import { mapSaleToInvoicePrint } from "@/modules/sales/lib/mapSaleToInvoicePrint";
import type { SaleRecord } from "@/modules/sales/lib/fetchSales";
import { normalizePurchaseDocumentStatus, normalizeSalesDocumentStatus } from "@/lib/invoices/invoiceStatus";
import { parseDocumentAdditionalExpenses, sumDocumentAdditionalExpenses } from "@/lib/forms/documentExpenses";
import { calcLineDiscountAmount, type PurchaseRecord } from "@/types/database.types";
import type { CompanyBranding, PrintMode } from "@/lib/print/types";
import { xlsxSheetName } from "./exportXlsx";
import { buildInvoiceLayout, personName, type InvoiceLayout, type LayoutValue } from "./invoiceLayout";

export { pdfShowsCompany, showsCompany } from "./invoiceLayout";

// ── The document ────────────────────────────────────────────────────────────

export type InvoiceExportKind = "sale" | "purchase";
export type InvoiceExportStatus = "draft" | "posted" | "cancelled";
export type InvoiceExportFormat = "xlsx" | "pdf";

export interface InvoiceExportLine {
  no: number;
  name: string;
  code: string;
  unit: string;
  quantity: number;
  price: number;
  /** Discount amount of the line, in the line's currency. */
  discount: number;
  /** VAT rate in percent (18 = 18 %); null when the line has none. */
  vatRate: number | null;
  total: number;
  /** The line's own currency, when it is not the invoice's. */
  currency: string | null;
}

export interface InvoiceExportPayment {
  date: string | null;
  method: string;
  amount: number;
}

export interface InvoiceExportDoc {
  kind: InvoiceExportKind;
  status: InvoiceExportStatus;
  docNo: string;
  /** yyyy-mm-dd, or null when the invoice has no date. */
  docDate: string | null;
  isOfficial: boolean;
  company: Pick<CompanyBranding, "companyName" | "voen" | "address" | "phone" | "logoUrl">;
  partyName: string;
  partyVoen: string | null;
  warehouse: string;
  responsible: string;
  createdBy: string;
  currency: string;
  exchangeRate: number;
  lines: InvoiceExportLine[];
  totals: {
    subtotal: number;
    discount: number;
    vat: number;
    extraCosts: number;
    grandTotal: number;
    paid: number;
    remaining: number;
  };
  payments: InvoiceExportPayment[];
  notes: string | null;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const day = (value: unknown): string | null => {
  const s = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const company = (b: CompanyBranding): InvoiceExportDoc["company"] => ({
  companyName: b.companyName,
  voen: b.voen,
  address: b.address,
  phone: b.phone,
  logoUrl: b.logoUrl,
});
const lineCurrency = (currency: unknown, invoiceCurrency: string): string | null => {
  const c = text(currency).toUpperCase();
  return c && c !== invoiceCurrency ? c : null;
};

export interface InvoiceExportContext {
  branding: CompanyBranding;
  /** The customer's or supplier's VÖEN (looked up by the caller). */
  partyVoen?: string | null;
  /**
   * Display names of the users behind the document (profile_display_names: names only, never
   * an e-mail), looked up by the caller. They win over stored labels that may be an e-mail.
   */
  people?: { createdBy?: string | null; issuedBy?: string | null };
}

/** A sales invoice, on the print mapping plus the fields the print leaves out. */
export function saleToExportDoc(sale: SaleRecord, ctx: InvoiceExportContext): InvoiceExportDoc {
  const extraCosts = num(sale.additional_expenses_total);
  const print = mapSaleToInvoicePrint(sale, { additionalExpenses: extraCosts });
  const items = sale.items ?? [];
  const currency = text(sale.currency).toUpperCase() || "AZN";
  return {
    kind: "sale",
    status: normalizeSalesDocumentStatus(sale.status),
    docNo: print.docNo,
    docDate: day(sale.doc_date),
    isOfficial: print.isOfficial === true,
    company: company(ctx.branding),
    partyName: print.customerName,
    partyVoen: ctx.partyVoen || null,
    warehouse: print.warehouseName,
    // The issuing user's display name, else the stored seller (an employee); an e-mail only last.
    responsible: personName(ctx.people?.issuedBy, sale.issued_by_name, sale.seller_name, print.sellerName),
    createdBy: personName(ctx.people?.createdBy, sale.created_by_name),
    currency,
    exchangeRate: currency === "AZN" ? 1 : num(sale.exchange_rate) || 1,
    lines: print.lines.map((line, i) => {
      const item = items[i];
      return {
        no: i + 1,
        name: line.productName,
        code: line.productCode,
        unit: line.unit,
        quantity: line.quantity,
        price: line.unitPrice,
        discount: item ? calcLineDiscountAmount(item) : 0,
        vatRate: item && num(item.vat_rate) > 0 ? num(item.vat_rate) : null,
        total: line.lineTotal,
        currency: item ? lineCurrency(item.currency, currency) : null,
      };
    }),
    totals: {
      subtotal: print.subtotal,
      discount: print.discountTotal,
      vat: print.vatTotal,
      extraCosts: print.additionalExpenses,
      grandTotal: print.grandTotal,
      paid: print.paidAmount,
      remaining: print.remainingBalance,
    },
    payments: (sale.payments ?? [])
      .filter((p) => num(p.amount) !== 0)
      .map((p) => ({ date: day(p.date) ?? day(sale.doc_date), method: text(p.method) || "-", amount: num(p.amount) })),
    notes: text(sale.note) || null,
  };
}

/** A purchase invoice, on the purchase print's fields plus VAT, extra costs and the people. */
export function purchaseToExportDoc(purchase: PurchaseRecord, ctx: InvoiceExportContext): InvoiceExportDoc {
  const lines = purchase.items ?? [];
  // In AZN: a foreign line counts at its rate (as the purchase form adds it up).
  const lineSum = lines.reduce((s, l) => s + num(l.total) * (lineCurrency(l.currency, "AZN") ? num(l.exchange_rate) || 1 : 1), 0);
  const vat = num(purchase.vat_amount);
  return {
    kind: "purchase",
    status: normalizePurchaseDocumentStatus(purchase.status),
    docNo: text(purchase.invoice_number) || "-",
    docDate: day(purchase.doc_date) ?? day(purchase.created_at),
    isOfficial: purchase.is_official === true,
    company: company(ctx.branding),
    partyName: text(purchase.supplier_name) || text(purchase.supplier_company) || "-",
    partyVoen: ctx.partyVoen || null,
    warehouse: text(purchase.warehouse_name) || "-",
    responsible: personName(purchase.responsible_name),
    createdBy: personName(ctx.people?.createdBy, purchase.created_by_name),
    currency: "AZN",
    exchangeRate: 1,
    lines: lines.map((line, i) => ({
      no: i + 1,
      name: text(line.product_name) || "-",
      code: text(line.product_code),
      unit: text(line.unit),
      quantity: num(line.quantity),
      price: num(line.unit_price),
      discount: 0,
      vatRate: vat > 0 && num(purchase.vat_rate) > 0 ? num(purchase.vat_rate) : null,
      total: num(line.total),
      currency: lineCurrency(line.currency, "AZN"),
    })),
    totals: {
      subtotal: purchase.subtotal_amount != null ? num(purchase.subtotal_amount) : lineSum,
      discount: 0,
      vat,
      extraCosts: sumDocumentAdditionalExpenses(parseDocumentAdditionalExpenses(purchase.additional_expenses)),
      // The purchase print's "Total".
      grandTotal: num(purchase.total_amount),
      paid: num(purchase.paid_amount),
      remaining: num(purchase.debt_amount),
    },
    payments: [],
    notes: text(purchase.notes) || null,
  };
}

/** "<doc number>_<date>.<ext>" with only letters, digits, dot, dash and underscore. */
export function invoiceExportFileName(doc: Pick<InvoiceExportDoc, "docNo" | "docDate">, format: InvoiceExportFormat): string {
  const safe = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ə/gi, "e")
      .replace(/ı/g, "i")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
  const no = safe(doc.docNo === "-" ? "" : doc.docNo) || "invoice";
  return doc.docDate ? `${no}_${doc.docDate}.${format}` : `${no}.${format}`;
}

// ── Texts ───────────────────────────────────────────────────────────────────

/** Every text the files use, in the user's language (see invoiceExportLabels). */
export interface InvoiceExportLabels {
  title: Record<InvoiceExportKind, string>;
  status: Record<InvoiceExportStatus, string>;
  /** Big mark on draft and cancelled files. */
  mark: Record<"draft" | "cancelled", string>;
  company: string;
  voen: string;
  address: string;
  docNo: string;
  date: string;
  party: Record<InvoiceExportKind, string>;
  partyVoen: string;
  warehouse: string;
  responsible: Record<InvoiceExportKind, string>;
  createdBy: string;
  currency: string;
  rate: string;
  statusLabel: string;
  cols: { no: string; product: string; code: string; unit: string; quantity: string; price: string; discount: string; vat: string; total: string; currency: string };
  /** An amount column's header with the invoice currency: "{name}, {currency}" ("Qiymət, AZN"). */
  withCurrency: string;
  totals: { subtotal: string; discount: string; vat: string; extraCosts: string; grandTotal: string; paid: string; remaining: string };
  payments: { title: string; date: string; method: string; amount: string };
  notes: string;
  page: string;
}

/** The labels from the "invoiceTools.export" texts. */
export function invoiceExportLabels(t: (key: string, params?: Record<string, string | number>) => string): InvoiceExportLabels {
  const k = (key: string) => t(`invoiceTools.export.${key}`);
  return {
    title: { sale: k("title.sale"), purchase: k("title.purchase") },
    status: { draft: k("status.draft"), posted: k("status.posted"), cancelled: k("status.cancelled") },
    mark: { draft: k("mark.draft"), cancelled: k("mark.cancelled") },
    company: k("fields.company"),
    voen: k("fields.voen"),
    address: k("fields.address"),
    docNo: k("fields.docNo"),
    date: k("fields.date"),
    party: { sale: k("fields.customer"), purchase: k("fields.supplier") },
    partyVoen: k("fields.partyVoen"),
    warehouse: k("fields.warehouse"),
    responsible: { sale: k("fields.salesperson"), purchase: k("fields.responsible") },
    createdBy: k("fields.createdBy"),
    currency: k("fields.currency"),
    rate: k("fields.rate"),
    statusLabel: k("fields.status"),
    cols: {
      no: k("cols.no"),
      product: k("cols.product"),
      code: k("cols.code"),
      unit: k("cols.unit"),
      quantity: k("cols.quantity"),
      price: k("cols.price"),
      discount: k("cols.discount"),
      vat: k("cols.vat"),
      total: k("cols.total"),
      currency: k("cols.currency"),
    },
    withCurrency: k("cols.withCurrency"),
    totals: {
      subtotal: k("totals.subtotal"),
      discount: k("totals.discount"),
      vat: k("totals.vat"),
      extraCosts: k("totals.extraCosts"),
      grandTotal: k("totals.grandTotal"),
      paid: k("totals.paid"),
      remaining: k("totals.remaining"),
    },
    payments: { title: k("payments.title"), date: k("payments.date"), method: k("payments.method"), amount: k("payments.amount") },
    notes: k("fields.notes"),
    page: k("page"),
  };
}

/** The document number as a sheet name: Excel forbids : \ / ? * [ ], so they become "-". */
export function invoiceSheetName(docNo: string): string {
  return xlsxSheetName(docNo.replace(/[:\\/?*[\]]+/g, "-"));
}

/**
 * Gives the text cells of the listed rows (1-based) the bold style. Number cells keep theirs.
 * No longer used by the invoice (XLS-1: ExcelJS); kept for the SheetJS exports of the debtor
 * reports and the partner statement until they move too.
 */
export function patchBoldRows(xml: string, style: number, rows: readonly number[]): string {
  if (style < 0 || !rows.length) return xml;
  const wanted = new Set(rows);
  return xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (whole, r: string, attrs: string, body: string) => {
    if (!wanted.has(Number(r))) return whole;
    const styled = body.replace(/<c r="([A-Z]+\d+)"(?: s="0")?(?! s=")/g, `<c r="$1" s="${style}"`);
    return `<row r="${r}"${attrs}>${styled}</row>`;
  });
}

// ── PDF (pdfmake document definition) ───────────────────────────────────────

export const PDF_FONT = "NotoSans";
/** Font files in public/fonts (Noto Sans, SIL OFL 1.1): Latin incl. Azerbaijani, and Cyrillic. */
export const PDF_FONT_FILES = { normal: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" } as const;

export interface InvoicePdfOptions {
  /** Sales: the print layout picked in PrintInvoiceModal; official invoices are always official. */
  mode: PrintMode;
  /** BCP 47 tag for numbers and dates, e.g. "az-AZ". */
  locale: string;
  /** The company logo as a data URL; leave out when it could not be loaded. */
  logoDataUrl?: string | null;
}

const INK = "#0f172a";
const MUTED = "#475569";
const LINE = "#cbd5e1";
const HEAD_BG = "#f1f5f9";
const MARK_COLOR: Record<"draft" | "cancelled", string> = { draft: "#b45309", cancelled: "#b91c1c" };

type PdfNode = Record<string, unknown> | string;
type PdfBlock = Record<string, unknown>;

/** The pdfmake document of one invoice: plain data, so tests can check it. */
export function buildInvoicePdfDefinition(doc: InvoiceExportDoc, labels: InvoiceExportLabels, options: InvoicePdfOptions): Record<string, unknown> {
  return renderInvoicePdf(buildInvoiceLayout(doc, labels, options), options.logoDataUrl ?? null);
}

/** pdfmake nodes of a layout (the one renderer of the PDF). */
export function renderInvoicePdf(layout: InvoiceLayout, logoDataUrl: string | null): Record<string, unknown> {
  const markColor = layout.mark ? MARK_COLOR[layout.mark.tone] : MARK_COLOR.draft;
  const value = (v: LayoutValue) => v.text;

  const companyBlock: PdfNode[] = [];
  if (layout.company) {
    if (layout.company.name) companyBlock.push({ text: layout.company.name, bold: true, fontSize: 12 });
    for (const line of layout.company.lines) companyBlock.push({ text: line, color: MUTED });
  }
  const left: PdfBlock =
    layout.company && logoDataUrl
      ? { columns: [{ image: logoDataUrl, fit: [48, 48], width: 56 }, { stack: companyBlock, width: "*" }], columnGap: 8 }
      : { stack: companyBlock };

  const [docNo, docDate] = layout.docFields;
  const right: PdfNode[] = [
    { text: layout.title, bold: true, fontSize: 15, alignment: "right" },
    { text: `${docNo.label}: ${value(docNo.value)}`, alignment: "right", bold: true },
    { text: `${docDate.label}: ${value(docDate.value)}`, alignment: "right", color: MUTED },
  ];
  if (layout.mark) right.push({ text: layout.mark.text, alignment: "right", bold: true, color: markColor, fontSize: 12, margin: [0, 4, 0, 0] });

  // Two fields per row: label (muted) and value (bold), left then right.
  const infoRows: PdfNode[][] = [];
  for (let i = 0; i < layout.infoFields.length; i += 2) {
    const pair = layout.infoFields.slice(i, i + 2);
    infoRows.push(pair.flatMap((f) => [{ text: f.label, color: MUTED }, { text: value(f.value), bold: true }]));
    if (pair.length === 1) infoRows[infoRows.length - 1].push({ text: "" }, { text: "" });
  }

  const columns = layout.columns.filter((c) => !c.excelOnly);
  const head = columns.map((c) => ({ text: c.header, bold: true, fillColor: HEAD_BG, alignment: c.align }));
  const body: PdfNode[][] = [
    head,
    ...layout.lines.map((line) =>
      columns.map((c) => ({
        text: value(line[c.key]),
        alignment: c.align,
        ...(c.muted ? { color: MUTED } : {}),
        ...(c.strong ? { bold: true } : {}),
      }))
    ),
  ];

  const totalsRows: PdfNode[][] = layout.totals.map((t) =>
    t.emphasis === "grand"
      ? [{ text: t.label, bold: true, fontSize: 11 }, { text: t.value.text, bold: true, fontSize: 11, alignment: "right" }]
      : [{ text: t.label, color: MUTED }, { text: t.value.text, alignment: "right", ...(t.emphasis === "strong" ? { bold: true } : {}) }]
  );

  const content: PdfNode[] = [
    { columns: [{ ...left, width: "*" }, { stack: right, width: "auto" }], columnGap: 16 },
    { canvas: [{ type: "line", x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1, lineColor: LINE }], margin: [0, 0, 0, 10] },
    { table: { widths: ["auto", "*", "auto", "*"], body: infoRows }, layout: "noBorders", margin: [0, 0, 0, 12] },
    {
      table: { headerRows: 1, widths: columns.map((c) => c.pdfWidth), body },
      layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3 },
      fontSize: 8,
    },
    {
      columns: [
        { text: "", width: "*" },
        {
          width: 230,
          table: { widths: ["*", "auto"], body: totalsRows },
          // Thin lines between the rows only (no header row here).
          layout: { hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => LINE },
          margin: [0, 12, 0, 0],
        },
      ],
    },
  ];
  if (layout.payments) {
    const p = layout.payments;
    content.push({ text: p.title, bold: true, margin: [0, 14, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        widths: [70, "*", 90],
        body: [
          [p.headers.date, p.headers.method, p.headers.amount].map((h, i) => ({ text: h, bold: true, fillColor: HEAD_BG, alignment: i === 2 ? "right" : "left" })),
          ...p.rows.map((r) => [value(r.date), value(r.method), { text: r.amount.text, alignment: "right" }]),
        ],
      },
      layout: "lightHorizontalLines",
      fontSize: 8,
    });
  }
  if (layout.notes) content.push({ text: [{ text: `${layout.notes.label}: `, bold: true }, value(layout.notes.value)], margin: [0, 14, 0, 0] });

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 48],
    info: { title: layout.documentTitle },
    defaultStyle: { font: PDF_FONT, fontSize: 9, color: INK, lineHeight: 1.2 },
    ...(layout.mark ? { watermark: { text: layout.mark.text, color: markColor, opacity: 0.12, bold: true } } : {}),
    footer: (current: number, count: number) => ({
      text: layout.pageLabel.replace("{current}", String(current)).replace("{count}", String(count)),
      alignment: "right",
      fontSize: 7,
      color: MUTED,
      margin: [40, 16, 40, 0],
    }),
    content,
  };
}
