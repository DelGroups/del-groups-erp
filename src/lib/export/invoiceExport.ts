/**
 * INV-2: one sales or purchase invoice as an .xlsx or .pdf file. Pure: no React, no Supabase,
 * no browser. The client runner (invoiceExportDownload.ts) loads the libraries and the font when
 * the user clicks; the tests and the sample script call these functions in Node.
 *
 * The data comes from the print mapping (mapSaleToInvoicePrint for sales, the purchase print's
 * fields for purchases), so the file says what the printed invoice says.
 */
import { mapSaleToInvoicePrint } from "@/modules/sales/lib/mapSaleToInvoicePrint";
import type { SaleRecord } from "@/modules/sales/lib/fetchSales";
import { normalizePurchaseDocumentStatus, normalizeSalesDocumentStatus } from "@/lib/invoices/invoiceStatus";
import { parseDocumentAdditionalExpenses, sumDocumentAdditionalExpenses } from "@/lib/forms/documentExpenses";
import { calcLineDiscountAmount, type PurchaseRecord } from "@/types/database.types";
import type { CompanyBranding, PrintMode } from "@/lib/print/types";
import { toXlsxCell, writeSheetBytes, xlsxSheetName, XLSX_FORMATS, type XlsxCell, type XlsxModule } from "./exportXlsx";

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
    responsible: print.sellerName,
    createdBy: text(sale.created_by_name) || "-",
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
    responsible: text(purchase.responsible_name) || "-",
    createdBy: text(purchase.created_by_name) || "-",
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

const markOf = (doc: InvoiceExportDoc, labels: InvoiceExportLabels): string | null =>
  doc.status === "draft" ? labels.mark.draft : doc.status === "cancelled" ? labels.mark.cancelled : null;

const hasLineCurrency = (doc: InvoiceExportDoc) => doc.lines.some((l) => l.currency);

// ── Excel ───────────────────────────────────────────────────────────────────

export const RATE_FORMAT = "0.0000";

export interface InvoiceSheet {
  name: string;
  rows: XlsxCell[][];
  /** Column widths in characters. */
  widths: number[];
  /** 0-based rows whose text cells are bold. */
  boldRows: number[];
}

const s = (value: string | null | undefined): XlsxCell => (value ? { t: "s", v: value } : { t: "z" });
const money = (value: number): XlsxCell => toXlsxCell("money", value);
/** Quantities: at least 2 decimals, up to 3 (cut lengths in metres) — never rounded away. */
export const QUANTITY_FORMAT = "#,##0.00#";
const qty = (value: number): XlsxCell => ({ t: "n", v: value, z: QUANTITY_FORMAT });

/**
 * The invoice as one sheet: title and mark, company, document fields, the lines table, the
 * totals under the Total column, the payments and the notes. Amounts are numbers with two
 * decimals; totals are the stored values, as on the printed invoice.
 */
export function buildInvoiceSheet(doc: InvoiceExportDoc, labels: InvoiceExportLabels): InvoiceSheet {
  const rows: XlsxCell[][] = [];
  const bold: number[] = [];
  const push = (cells: XlsxCell[], isBold = false) => {
    if (isBold) bold.push(rows.length);
    rows.push(cells);
  };
  const field = (label: string, value: XlsxCell) => push([s(label), value]);
  const mark = markOf(doc, labels);

  push([s(labels.title[doc.kind])], true);
  if (mark) push([s(mark)], true);
  push([]);
  // The company block where the print shows it: official sales and purchases. A regular
  // (unofficial) sales invoice leaves it out, as its print does (Excel asks no question).
  if (pdfShowsCompany(doc, "unofficial")) {
    if (doc.company.companyName) field(labels.company, s(doc.company.companyName));
    if (doc.company.voen) field(labels.voen, s(doc.company.voen));
    if (doc.company.address) field(labels.address, s(doc.company.address));
    if (doc.company.companyName || doc.company.voen || doc.company.address) push([]);
  }

  field(labels.docNo, s(doc.docNo));
  field(labels.date, doc.docDate ? toXlsxCell("date", doc.docDate) : s("-"));
  field(labels.party[doc.kind], s(doc.partyName));
  field(labels.partyVoen, s(doc.partyVoen || "-"));
  field(labels.warehouse, s(doc.warehouse));
  field(labels.responsible[doc.kind], s(doc.responsible));
  field(labels.createdBy, s(doc.createdBy));
  field(labels.currency, s(doc.currency));
  field(labels.rate, { t: "n", v: doc.exchangeRate, z: RATE_FORMAT });
  field(labels.statusLabel, s(labels.status[doc.status]));
  push([]);

  const withCurrency = hasLineCurrency(doc);
  const c = labels.cols;
  const header = [c.no, c.product, c.code, c.unit, c.quantity, c.price, c.discount, c.vat, c.total, ...(withCurrency ? [c.currency] : [])];
  push(header.map((h) => s(h)), true);
  for (const line of doc.lines) {
    push([
      { t: "n", v: line.no, z: XLSX_FORMATS.integer },
      s(line.name),
      s(line.code),
      s(line.unit),
      qty(line.quantity),
      money(line.price),
      money(line.discount),
      line.vatRate === null ? { t: "z" } : { t: "n", v: line.vatRate, z: XLSX_FORMATS.money },
      money(line.total),
      ...(withCurrency ? [s(line.currency)] : []),
    ]);
  }
  push([]);

  // Totals: label in the VAT column, amount in the Total column.
  const total = (label: string, value: number, isBold = false) => push([{ t: "z" }, { t: "z" }, { t: "z" }, { t: "z" }, { t: "z" }, { t: "z" }, { t: "z" }, s(label), money(value)], isBold);
  const tl = labels.totals;
  total(tl.subtotal, doc.totals.subtotal);
  total(tl.discount, doc.totals.discount);
  total(tl.vat, doc.totals.vat);
  total(tl.extraCosts, doc.totals.extraCosts);
  total(tl.grandTotal, doc.totals.grandTotal, true);
  total(tl.paid, doc.totals.paid);
  total(tl.remaining, doc.totals.remaining);

  if (doc.payments.length) {
    push([]);
    push([s(labels.payments.title)], true);
    push([s(labels.payments.date), s(labels.payments.method), s(labels.payments.amount)], true);
    for (const p of doc.payments) push([p.date ? toXlsxCell("date", p.date) : s("-"), s(p.method), money(p.amount)]);
  }
  if (doc.notes) {
    push([]);
    field(labels.notes, s(doc.notes));
  }

  // Widths: the field labels share column A with the line numbers; the product column is wide.
  const width = (i: number) =>
    rows.reduce((m, r) => {
      const cell = r[i];
      if (!cell || cell.t === "z") return m;
      const len = cell.t === "n" ? String(Math.trunc(Math.abs(Number(cell.v)))).length + 4 : String(cell.v).length;
      return Math.max(m, len);
    }, 0);
  const widths = header.map((_, i) => Math.min(i === 1 ? 50 : 30, Math.max(8, width(i) + 2)));
  return { name: invoiceSheetName(doc.docNo), rows, widths, boldRows: bold };
}

/** The document number as a sheet name: Excel forbids : \ / ? * [ ], so they become "-". */
export function invoiceSheetName(docNo: string): string {
  return xlsxSheetName(docNo.replace(/[:\\/?*[\]]+/g, "-"));
}

/** Gives the text cells of the listed rows (1-based) the bold style. Number cells keep theirs. */
export function patchBoldRows(xml: string, style: number, rows: readonly number[]): string {
  if (style < 0 || !rows.length) return xml;
  const wanted = new Set(rows);
  return xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (whole, r: string, attrs: string, body: string) => {
    if (!wanted.has(Number(r))) return whole;
    const styled = body.replace(/<c r="([A-Z]+\d+)"(?: s="0")?(?! s=")/g, `<c r="$1" s="${style}"`);
    return `<row r="${r}"${attrs}>${styled}</row>`;
  });
}

/** The .xlsx bytes of one invoice sheet (the shared writer; bold rows patched in). */
export function writeInvoiceXlsxBytes(XLSX: XlsxModule, sheet: InvoiceSheet): Uint8Array {
  const boldRows = sheet.boldRows.map((r) => r + 1);
  return writeSheetBytes(XLSX, { name: sheet.name, rows: sheet.rows, widths: sheet.widths }, (xml, style) => patchBoldRows(xml, style, boldRows));
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

/** Does this file show the company block and the VAT line (the official print does)? */
export function pdfShowsCompany(doc: Pick<InvoiceExportDoc, "kind" | "isOfficial">, mode: PrintMode): boolean {
  return doc.kind === "purchase" || doc.isOfficial || mode === "official";
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
  const f2 = new Intl.NumberFormat(options.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f3 = new Intl.NumberFormat(options.locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const f4 = new Intl.NumberFormat(options.locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const pct = new Intl.NumberFormat(options.locale, { maximumFractionDigits: 2 });
  const amount = (n: number) => f2.format(n);
  const withCurrency = (n: number) => `${amount(n)} ${doc.currency}`;
  const showCompany = pdfShowsCompany(doc, options.mode);
  const mark = markOf(doc, labels);
  const markColor = doc.status === "cancelled" ? MARK_COLOR.cancelled : MARK_COLOR.draft;

  const companyBlock: PdfNode[] = [];
  if (showCompany) {
    if (doc.company.companyName) companyBlock.push({ text: doc.company.companyName, bold: true, fontSize: 12 });
    if (doc.company.voen) companyBlock.push({ text: `${labels.voen}: ${doc.company.voen}`, color: MUTED });
    if (doc.company.address) companyBlock.push({ text: doc.company.address, color: MUTED });
    if (doc.company.phone) companyBlock.push({ text: doc.company.phone, color: MUTED });
  }
  const left: PdfBlock =
    showCompany && options.logoDataUrl
      ? { columns: [{ image: options.logoDataUrl, fit: [48, 48], width: 56 }, { stack: companyBlock, width: "*" }], columnGap: 8 }
      : { stack: companyBlock };

  const right: PdfNode[] = [
    { text: labels.title[doc.kind].toUpperCase(), bold: true, fontSize: 15, alignment: "right" },
    { text: `${labels.docNo}: ${doc.docNo}`, alignment: "right", bold: true },
    { text: `${labels.date}: ${doc.docDate ?? "-"}`, alignment: "right", color: MUTED },
  ];
  if (mark) right.push({ text: mark, alignment: "right", bold: true, color: markColor, fontSize: 12, margin: [0, 4, 0, 0] });

  const info = (label: string, value: string): PdfNode[] => [{ text: label, color: MUTED }, { text: value || "-", bold: true }];
  const infoRows: PdfNode[][] = [
    [...info(labels.party[doc.kind], doc.partyName), ...info(labels.warehouse, doc.warehouse)],
    [...info(labels.partyVoen, doc.partyVoen || "-"), ...info(labels.responsible[doc.kind], doc.responsible)],
    [...info(labels.currency, doc.exchangeRate !== 1 ? `${doc.currency} · ${labels.rate} ${f4.format(doc.exchangeRate)}` : doc.currency), ...info(labels.createdBy, doc.createdBy)],
    [...info(labels.statusLabel, labels.status[doc.status]), { text: "" }, { text: "" }],
  ];

  // A line in another currency names it on its amounts (the totals are in the invoice currency).
  const inLineCurrency = (l: InvoiceExportLine, n: number) => (l.currency ? `${amount(n)} ${l.currency}` : amount(n));
  const c = labels.cols;
  const head = [c.no, c.product, c.code, c.unit, c.quantity, c.price, c.discount, c.vat, c.total].map((h, i) => ({
    text: h,
    bold: true,
    fillColor: HEAD_BG,
    alignment: i >= 4 ? "right" : "left",
  }));
  const body: PdfNode[][] = [
    head,
    ...doc.lines.map((l) => [
      String(l.no),
      { text: l.name },
      { text: l.code, color: MUTED },
      l.unit,
      { text: f3.format(l.quantity), alignment: "right" },
      { text: inLineCurrency(l, l.price), alignment: "right" },
      { text: l.discount ? inLineCurrency(l, l.discount) : "—", alignment: "right" },
      { text: l.vatRate === null ? "—" : `${pct.format(l.vatRate)}%`, alignment: "right" },
      { text: inLineCurrency(l, l.total), alignment: "right", bold: true },
    ]),
  ];

  const tl = labels.totals;
  const totalsRows: PdfNode[][] = [[{ text: tl.subtotal, color: MUTED }, { text: withCurrency(doc.totals.subtotal), alignment: "right" }]];
  if (doc.totals.discount > 0) totalsRows.push([{ text: tl.discount, color: MUTED }, { text: `-${withCurrency(doc.totals.discount)}`, alignment: "right" }]);
  if (showCompany) totalsRows.push([{ text: tl.vat, color: MUTED }, { text: withCurrency(doc.totals.vat), alignment: "right" }]);
  if (doc.totals.extraCosts > 0) totalsRows.push([{ text: tl.extraCosts, color: MUTED }, { text: withCurrency(doc.totals.extraCosts), alignment: "right" }]);
  totalsRows.push([{ text: tl.grandTotal, bold: true, fontSize: 11 }, { text: withCurrency(doc.totals.grandTotal), bold: true, fontSize: 11, alignment: "right" }]);
  totalsRows.push([{ text: tl.paid, color: MUTED }, { text: withCurrency(doc.totals.paid), alignment: "right" }]);
  totalsRows.push([{ text: tl.remaining, color: MUTED }, { text: withCurrency(doc.totals.remaining), alignment: "right", bold: true }]);

  const content: PdfNode[] = [
    { columns: [{ ...left, width: "*" }, { stack: right, width: "auto" }], columnGap: 16 },
    { canvas: [{ type: "line", x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1, lineColor: LINE }], margin: [0, 0, 0, 10] },
    { table: { widths: ["auto", "*", "auto", "*"], body: infoRows }, layout: "noBorders", margin: [0, 0, 0, 12] },
    {
      table: { headerRows: 1, widths: [18, "*", 52, 34, 44, 48, 42, 30, 56], body },
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
  if (doc.payments.length) {
    content.push({ text: labels.payments.title, bold: true, margin: [0, 14, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        widths: [70, "*", 90],
        body: [
          [labels.payments.date, labels.payments.method, labels.payments.amount].map((h, i) => ({ text: h, bold: true, fillColor: HEAD_BG, alignment: i === 2 ? "right" : "left" })),
          ...doc.payments.map((p) => [p.date ?? "-", p.method, { text: withCurrency(p.amount), alignment: "right" }]),
        ],
      },
      layout: "lightHorizontalLines",
      fontSize: 8,
    });
  }
  if (doc.notes) content.push({ text: [{ text: `${labels.notes}: `, bold: true }, doc.notes], margin: [0, 14, 0, 0] });

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 48],
    info: { title: `${labels.title[doc.kind]} ${doc.docNo}` },
    defaultStyle: { font: PDF_FONT, fontSize: 9, color: INK, lineHeight: 1.2 },
    ...(mark ? { watermark: { text: mark, color: markColor, opacity: 0.12, bold: true } } : {}),
    footer: (current: number, count: number) => ({
      text: labels.page.replace("{current}", String(current)).replace("{count}", String(count)),
      alignment: "right",
      fontSize: 7,
      color: MUTED,
      margin: [40, 16, 40, 0],
    }),
    content,
  };
}
