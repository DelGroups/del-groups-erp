/**
 * XLS-1: one layout of an invoice, shared by every renderer (the PDF definition and the Excel
 * workbook; later the invoice designer and the print). It decides what is shown, in which order,
 * with which label, alignment and number format; a renderer only draws it. Pure: no libraries.
 */
import type { PrintMode } from "@/lib/print/types";
import type { InvoiceExportDoc, InvoiceExportKind, InvoiceExportLabels } from "./invoiceExport";

/** Does a file (PDF or Excel) show the company block and the VAT line (the official print does)? */
export function showsCompany(doc: Pick<InvoiceExportDoc, "kind" | "isOfficial">, mode: PrintMode): boolean {
  return doc.kind === "purchase" || doc.isOfficial || mode === "official";
}
/** The INV-2 name of showsCompany. */
export const pdfShowsCompany = showsCompany;

export type LayoutAlign = "left" | "center" | "right";
/** money and percent: 2 decimals; quantity: 2–3 (cut lengths); rate: 4; integer: 0. */
export type LayoutNumberFormat = "money" | "quantity" | "percent" | "rate" | "integer";

export type LayoutValue =
  | { type: "text"; text: string }
  /** iso is yyyy-mm-dd; text is how a person reads it (dd.mm.yyyy). */
  | { type: "date"; iso: string; text: string }
  /** text is the formatted number (with the suffix, e.g. a line's own currency). */
  | { type: "number"; value: number; format: LayoutNumberFormat; text: string; suffix?: string }
  | { type: "empty"; text: string };

export interface LayoutField {
  key: string;
  label: string;
  value: LayoutValue;
}

export type LayoutColumnKey = "no" | "product" | "code" | "unit" | "quantity" | "price" | "discount" | "vat" | "total" | "currency";

export interface LayoutColumn {
  key: LayoutColumnKey;
  /** The header as shown: amount columns name the invoice currency ("Qiymət, AZN"). */
  header: string;
  align: LayoutAlign;
  /** Muted text (the product code). */
  muted?: boolean;
  /** Bold values (the line total). */
  strong?: boolean;
  /** PDF column width (pt, or "*" for the free space). */
  pdfWidth: number | "*";
  /** Excel only: the PDF names a line's own currency on its amounts instead of a column. */
  excelOnly?: boolean;
}

export interface LayoutTotal {
  key: "subtotal" | "discount" | "vat" | "extraCosts" | "grandTotal" | "paid" | "remaining";
  label: string;
  value: Extract<LayoutValue, { type: "number" }>;
  /** grand: the "Yekun" line (bold, top border); strong: bold amount only. */
  emphasis: "grand" | "strong" | "normal";
  /** Shown as "-75.00" (the discount is subtracted). */
  negative?: boolean;
}

export interface InvoiceLayout {
  kind: InvoiceExportKind;
  docNo: string;
  /** The document title ("Satış fakturası"). */
  title: string;
  /** Draft / cancelled mark (watermark in the PDF, a coloured line in Excel). */
  mark: { text: string; tone: "draft" | "cancelled" } | null;
  /** The company block; null when the file leaves it out (a regular sales invoice). */
  company: { name: string | null; lines: string[]; logoUrl: string | null } | null;
  /** Document number and date (top right in the PDF). */
  docFields: LayoutField[];
  /** Party, warehouse, people, currency, status: the two-column block. */
  infoFields: LayoutField[];
  columns: LayoutColumn[];
  lines: Record<LayoutColumnKey, LayoutValue>[];
  totals: LayoutTotal[];
  /** The invoice currency (totals and amount headers). */
  currency: string;
  payments: { title: string; headers: { date: string; method: string; amount: string }; rows: { date: LayoutValue; method: LayoutValue; amount: Extract<LayoutValue, { type: "number" }> }[] } | null;
  notes: LayoutField | null;
  /** "Page {current} of {count}". */
  pageLabel: string;
  /** For a file's metadata ("Satış fakturası SAT-0042"). */
  documentTitle: string;
}

export interface InvoiceLayoutOptions {
  /** Regular sales invoices: the layout picked for the print (Excel asks nothing: "unofficial"). */
  mode: PrintMode;
  /** BCP 47 tag for numbers, e.g. "az-AZ". */
  locale: string;
}

/** yyyy-mm-dd → dd.mm.yyyy (the date as Azerbaijani documents write it). */
export function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/**
 * A person's name for a document: the first candidate that is a name, not an e-mail address
 * (a profile without a display name falls back to its e-mail); an e-mail only when no name is
 * known, else "-".
 */
export function personName(...candidates: readonly (string | null | undefined)[]): string {
  const given = candidates.map((c) => (typeof c === "string" ? c.trim() : "")).filter((c) => c && c !== "-");
  return given.find((c) => !isEmailLike(c)) ?? given[0] ?? "-";
}

export function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** The layout of one invoice: the same for the PDF and the Excel file. */
export function buildInvoiceLayout(doc: InvoiceExportDoc, labels: InvoiceExportLabels, options: InvoiceLayoutOptions): InvoiceLayout {
  const f2 = new Intl.NumberFormat(options.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f3 = new Intl.NumberFormat(options.locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const f4 = new Intl.NumberFormat(options.locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const pct = new Intl.NumberFormat(options.locale, { maximumFractionDigits: 2 });
  const formatters: Record<LayoutNumberFormat, (n: number) => string> = {
    money: (n) => f2.format(n),
    quantity: (n) => f3.format(n),
    percent: (n) => `${pct.format(n)}%`,
    rate: (n) => f4.format(n),
    integer: (n) => String(Math.trunc(n)),
  };
  const number = (value: number, format: LayoutNumberFormat, suffix?: string | null): Extract<LayoutValue, { type: "number" }> => ({
    type: "number",
    value,
    format,
    text: suffix ? `${formatters[format](value)} ${suffix}` : formatters[format](value),
    ...(suffix ? { suffix } : {}),
  });
  const text = (value: string | null | undefined): LayoutValue => ({ type: "text", text: value && value.trim() ? value : "-" });
  const date = (iso: string | null): LayoutValue => (iso ? { type: "date", iso, text: displayDate(iso) } : text(null));
  const empty: LayoutValue = { type: "empty", text: "—" };

  const showCompany = showsCompany(doc, options.mode);
  const company = showCompany
    ? {
        name: doc.company.companyName || null,
        lines: [doc.company.voen ? `${labels.voen}: ${doc.company.voen}` : "", doc.company.address ?? "", doc.company.phone ?? ""].filter(Boolean),
        logoUrl: doc.company.logoUrl ?? null,
      }
    : null;

  const mark =
    doc.status === "draft" ? { text: labels.mark.draft, tone: "draft" as const } : doc.status === "cancelled" ? { text: labels.mark.cancelled, tone: "cancelled" as const } : null;

  const docFields: LayoutField[] = [
    { key: "docNo", label: labels.docNo, value: text(doc.docNo) },
    { key: "date", label: labels.date, value: date(doc.docDate) },
  ];
  // Left column then right column, row by row (the PDF's two-column block).
  const infoFields: LayoutField[] = [
    { key: "party", label: labels.party[doc.kind], value: text(doc.partyName) },
    { key: "warehouse", label: labels.warehouse, value: text(doc.warehouse) },
    // VÖEN stays text: leading zeros are part of it.
    { key: "partyVoen", label: labels.partyVoen, value: text(doc.partyVoen) },
    { key: "responsible", label: labels.responsible[doc.kind], value: text(doc.responsible) },
    { key: "currency", label: labels.currency, value: text(doc.currency) },
    { key: "createdBy", label: labels.createdBy, value: text(doc.createdBy) },
    ...(doc.exchangeRate !== 1 ? [{ key: "rate", label: labels.rate, value: number(doc.exchangeRate, "rate") }] : []),
    { key: "status", label: labels.statusLabel, value: text(labels.status[doc.status]) },
  ];

  const withLineCurrency = doc.lines.some((l) => l.currency);
  const c = labels.cols;
  // Amount headers name the currency only when every line is in it; else each line names its own.
  const inCurrency = (name: string) => (withLineCurrency ? name : labels.withCurrency.replace("{name}", name).replace("{currency}", doc.currency));
  const columns: LayoutColumn[] = [
    { key: "no", header: c.no, align: "center", pdfWidth: 18 },
    { key: "product", header: c.product, align: "left", pdfWidth: "*" },
    { key: "code", header: c.code, align: "left", muted: true, pdfWidth: 52 },
    { key: "unit", header: c.unit, align: "left", pdfWidth: 34 },
    { key: "quantity", header: c.quantity, align: "right", pdfWidth: 44 },
    { key: "price", header: inCurrency(c.price), align: "right", pdfWidth: 48 },
    { key: "discount", header: c.discount, align: "right", pdfWidth: 42 },
    { key: "vat", header: c.vat, align: "right", pdfWidth: 30 },
    { key: "total", header: inCurrency(c.total), align: "right", strong: true, pdfWidth: 56 },
    ...(withLineCurrency ? [{ key: "currency" as const, header: c.currency, align: "center" as const, pdfWidth: 34, excelOnly: true }] : []),
  ];
  // A line without its own currency is in the invoice's (named in the currency column).
  const lines = doc.lines.map((l) => ({
    no: number(l.no, "integer"),
    product: text(l.name),
    code: l.code ? text(l.code) : empty,
    unit: l.unit ? text(l.unit) : empty,
    quantity: number(l.quantity, "quantity"),
    price: number(l.price, "money", l.currency),
    discount: l.discount ? number(l.discount, "money", l.currency) : empty,
    vat: l.vatRate === null ? empty : number(l.vatRate, "percent"),
    total: number(l.total, "money", l.currency),
    currency: text(l.currency ?? doc.currency),
  }));

  // The same lines as the printed invoice: discount, VAT and extra costs only when they apply.
  const tl = labels.totals;
  const sum = (n: number) => number(n, "money", doc.currency);
  const totals: LayoutTotal[] = [{ key: "subtotal", label: tl.subtotal, value: sum(doc.totals.subtotal), emphasis: "normal" }];
  if (doc.totals.discount > 0) totals.push({ key: "discount", label: tl.discount, value: { ...sum(doc.totals.discount), text: `-${sum(doc.totals.discount).text}` }, emphasis: "normal", negative: true });
  if (showCompany) totals.push({ key: "vat", label: tl.vat, value: sum(doc.totals.vat), emphasis: "normal" });
  if (doc.totals.extraCosts > 0) totals.push({ key: "extraCosts", label: tl.extraCosts, value: sum(doc.totals.extraCosts), emphasis: "normal" });
  totals.push({ key: "grandTotal", label: tl.grandTotal, value: sum(doc.totals.grandTotal), emphasis: "grand" });
  totals.push({ key: "paid", label: tl.paid, value: sum(doc.totals.paid), emphasis: "normal" });
  totals.push({ key: "remaining", label: tl.remaining, value: sum(doc.totals.remaining), emphasis: "strong" });

  const payments = doc.payments.length
    ? {
        title: labels.payments.title,
        headers: { date: labels.payments.date, method: labels.payments.method, amount: labels.payments.amount },
        rows: doc.payments.map((p) => ({ date: date(p.date), method: text(p.method), amount: sum(p.amount) })),
      }
    : null;

  return {
    kind: doc.kind,
    docNo: doc.docNo,
    title: labels.title[doc.kind],
    mark,
    company,
    docFields,
    infoFields,
    columns,
    lines,
    totals,
    currency: doc.currency,
    payments,
    notes: doc.notes ? { key: "notes", label: labels.notes, value: text(doc.notes) } : null,
    pageLabel: labels.page,
    documentTitle: `${labels.title[doc.kind]} ${doc.docNo}`,
  };
}
