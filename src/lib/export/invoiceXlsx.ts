/**
 * XLS-1: the invoice as a formatted .xlsx (ExcelJS), drawn from the shared layout
 * (invoiceLayout.ts) so it looks like the PDF: company line and title large and bold across the
 * table, the document fields in a two-column block with grey labels, the lines table with a
 * filled bold header, thin borders and number formats, the totals under it on the right with a
 * bold "Yekun" over a top border, frozen header, A4 portrait fit to width, no gridlines.
 *
 * ExcelJS is passed in (the browser loads it with a dynamic import on click; tests require it),
 * so this module adds nothing to a page bundle. Amounts are the stored values of the invoice,
 * not formulas: the file says what the saved invoice and its PDF say.
 */
import type ExcelJSNamespace from "exceljs";
import type { Borders, Cell, Fill, Font, Worksheet } from "exceljs";
import { invoiceSheetName } from "./invoiceExport";
import type { InvoiceLayout, LayoutAlign, LayoutNumberFormat, LayoutValue } from "./invoiceLayout";

export type ExcelJSModule = typeof ExcelJSNamespace;

/** Number formats of the cells (Excel shows them in the user's own separators). */
export const XLSX_NUMBER_FORMATS: Record<LayoutNumberFormat, string> = {
  money: "#,##0.00",
  // At least 2 decimals, up to 3 (cut lengths in metres): never rounded away.
  quantity: "#,##0.00#",
  percent: "#,##0.00",
  rate: "0.0000",
  integer: "0",
};
export const XLSX_DATE_FORMAT = "dd.mm.yyyy";

const FONT = "Arial";
const INK = "FF0F172A";
const MUTED = "FF64748B";
const LINE = "FFCBD5E1";
const HEAD_BG = "FFF1F5F9";
const MARK: Record<"draft" | "cancelled", string> = { draft: "FFB45309", cancelled: "FFB91C1C" };

const font = (over: Partial<Font> = {}): Partial<Font> => ({ name: FONT, size: 10, color: { argb: INK }, ...over });
const thin = { style: "thin" as const, color: { argb: LINE } };
const box: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const headFill: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };

/** A total in the invoice currency: the number stays a number, the currency is in its format. */
export function currencyFormat(currency: string): string {
  return `${XLSX_NUMBER_FORMATS.money}" ${currency.replace(/"/g, "")}"`;
}

/** Decimals a cell keeps: the value the PDF prints (2.005 → 2.01), not a long float. */
const DECIMALS: Record<LayoutNumberFormat, number> = { money: 2, quantity: 3, percent: 2, rate: 4, integer: 0 };
export function roundFor(format: LayoutNumberFormat, value: number): number {
  const f = 10 ** DECIMALS[format];
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** yyyy-mm-dd → a date cell value (UTC midnight, so no time zone moves the day); null if not ISO. */
function dateValue(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Writes a layout value into a cell: numbers, dates and texts keep their type. */
function put(cell: Cell, value: LayoutValue, align: LayoutAlign, numberFormat?: string) {
  const date = value.type === "date" ? dateValue(value.iso) : null;
  if (value.type === "number") {
    cell.value = roundFor(value.format, value.value);
    // A line in its own currency names it in the format: the cell stays a number.
    cell.numFmt = numberFormat ?? (value.suffix ? `${XLSX_NUMBER_FORMATS[value.format]}" ${value.suffix.replace(/"/g, "")}"` : XLSX_NUMBER_FORMATS[value.format]);
  } else if (date) {
    cell.value = date;
    cell.numFmt = XLSX_DATE_FORMAT;
  } else if (value.type === "text" || value.type === "date") {
    // Text cells stay text (a VÖEN keeps its leading zeros, a code is never a number).
    cell.value = value.text;
    cell.numFmt = "@";
  } else {
    cell.value = null;
  }
  cell.alignment = { horizontal: align, vertical: "middle", wrapText: false };
}

/** Column widths (characters) fitted to the header and the line texts; the product is wide. */
export function invoiceColumnWidths(layout: InvoiceLayout): number[] {
  return layout.columns.map((c) => {
    const texts = [c.header, ...layout.lines.map((l) => l[c.key].text)];
    // The totals and payment amounts stand in the Total column too.
    if (c.key === "total") {
      for (const t of layout.totals) texts.push(t.value.text);
      for (const p of layout.payments?.rows ?? []) texts.push(p.amount.text);
    }
    // Bold 11 pt (the grand total) is about a fifth wider than the 10 pt the width counts in.
    const longest = Math.ceil(Math.max(...texts.map((s) => s.length)) * (c.key === "total" ? 1.2 : 1));
    if (c.key === "product") return Math.min(60, Math.max(28, longest + 2));
    if (c.key === "no") return Math.max(5, longest + 2);
    return Math.min(c.key === "total" ? 24 : 20, Math.max(8, longest + 3));
  });
}

/** The workbook of one invoice (one sheet named by the document number). */
export function buildInvoiceWorkbook(ExcelJS: ExcelJSModule, layout: InvoiceLayout, options: { logoDataUrl?: string | null } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = layout.company?.name ?? "";
  wb.title = layout.documentTitle;
  const ws = wb.addWorksheet(invoiceSheetName(layout.docNo), {
    properties: { defaultRowHeight: 16 },
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: `&R&8${layout.pageLabel.replace("{current}", "&P").replace("{count}", "&N")}` },
  });
  const n = layout.columns.length;
  ws.columns = invoiceColumnWidths(layout).map((width) => ({ width }));

  let row = 0;
  const next = () => (row += 1);
  /** A text across columns from..to (1-based), merged. */
  const banner = (from: number, to: number, text: string, f: Partial<Font>, height?: number) => {
    const r = next();
    if (to > from) ws.mergeCells(r, from, r, to);
    const cell = ws.getCell(r, from);
    cell.value = text;
    cell.font = font(f);
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
    if (height) ws.getRow(r).height = height;
    return r;
  };

  // Company line (with the logo when the file shows the company) and the title.
  const logo = layout.company && options.logoDataUrl ? /^data:image\/(png|jpe?g);base64,/.exec(options.logoDataUrl) : null;
  if (layout.company) {
    const from = logo ? 2 : 1;
    const nameRow = banner(from, n, layout.company.name ?? "", { bold: true, size: 14 }, logo ? 30 : 22);
    if (logo && options.logoDataUrl) {
      const id = wb.addImage({ base64: options.logoDataUrl, extension: logo[1] === "png" ? "png" : "jpeg" });
      ws.addImage(id, { tl: { col: 0.1, row: nameRow - 1 + 0.1 }, ext: { width: 36, height: 36 }, editAs: "oneCell" });
    }
    for (const line of layout.company.lines) banner(from, n, line, { size: 9, color: { argb: MUTED } });
    next();
  }
  banner(1, n, layout.title, { bold: true, size: 16 }, 26);
  if (layout.mark) banner(1, n, layout.mark.text, { bold: true, size: 12, color: { argb: MARK[layout.mark.tone] } });
  next();

  // Document fields: two pairs per row, grey label then its value (as in the PDF).
  const mid = Math.ceil(n / 2) + 1; // first column of the right pair
  const pairs: [number, number, number, number][] = [
    [1, 2, 3, mid - 1],
    [mid, mid + 1, mid + 2, n],
  ];
  const fields = [...layout.docFields, ...layout.infoFields];
  for (let i = 0; i < fields.length; i += 2) {
    const r = next();
    fields.slice(i, i + 2).forEach((f, j) => {
      const [l1, l2, v1, v2] = pairs[j];
      if (l2 > l1) ws.mergeCells(r, l1, r, l2);
      if (v2 > v1) ws.mergeCells(r, v1, r, v2);
      const label = ws.getCell(r, l1);
      label.value = f.label;
      label.font = font({ color: { argb: MUTED } });
      label.alignment = { horizontal: "left", vertical: "middle" };
      const value = ws.getCell(r, v1);
      put(value, f.value, "left");
      value.font = font({ bold: f.key === "docNo" });
    });
  }
  next();

  // The lines table.
  const headerRow = next();
  layout.columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.header;
    cell.font = font({ bold: true });
    cell.fill = headFill;
    cell.border = box;
    cell.alignment = { horizontal: c.align, vertical: "middle", wrapText: false };
  });
  ws.getRow(headerRow).height = 20;
  for (const line of layout.lines) {
    const r = next();
    layout.columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      put(cell, line[c.key], c.align);
      cell.font = font({ bold: c.strong, color: { argb: c.muted ? MUTED : INK } });
      cell.border = box;
    });
  }
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 0, showGridLines: false, activeCell: `A${headerRow + 1}` }];
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

  // Totals: under the table on the right, label over the two columns before the total.
  const totalCol = layout.columns.findIndex((c) => c.key === "total") + 1;
  const labelFrom = Math.max(1, totalCol - 2);
  next();
  const money = currencyFormat(layout.currency);
  for (const t of layout.totals) {
    const r = next();
    if (totalCol - 1 > labelFrom) ws.mergeCells(r, labelFrom, r, totalCol - 1);
    const label = ws.getCell(r, labelFrom);
    label.value = t.label;
    const value = ws.getCell(r, totalCol);
    put(value, { ...t.value, value: t.negative ? -t.value.value : t.value.value }, "right", money);
    const grand = t.emphasis === "grand";
    label.font = font(grand ? { bold: true, size: 11 } : { color: { argb: MUTED } });
    label.alignment = { horizontal: "right", vertical: "middle" };
    value.font = font({ bold: grand || t.emphasis === "strong", size: grand ? 11 : 10 });
    if (grand) {
      const top = { top: { style: "thin" as const, color: { argb: INK } } };
      label.border = top;
      value.border = top;
      ws.getRow(r).height = 20;
    }
  }

  if (layout.payments) {
    const p = layout.payments;
    next();
    banner(1, n, p.title, { bold: true });
    const head = next();
    const cols: [number, number][] = [
      [1, 2],
      [3, totalCol - 1],
      [totalCol, totalCol],
    ];
    [p.headers.date, p.headers.method, p.headers.amount].forEach((h, i) => {
      const [a, b] = cols[i];
      if (b > a) ws.mergeCells(head, a, head, b);
      const cell = ws.getCell(head, a);
      cell.value = h;
      cell.font = font({ bold: true });
      cell.fill = headFill;
      cell.border = box;
      cell.alignment = { horizontal: i === 2 ? "right" : "left", vertical: "middle" };
    });
    for (const pay of p.rows) {
      const r = next();
      [pay.date, pay.method, pay.amount].forEach((v, i) => {
        const [a, b] = cols[i];
        if (b > a) ws.mergeCells(r, a, r, b);
        const cell = ws.getCell(r, a);
        put(cell, v, i === 2 ? "right" : "left", i === 2 ? money : undefined);
        cell.font = font();
        cell.border = box;
      });
    }
  }

  if (layout.notes) {
    next();
    const r = next();
    ws.mergeCells(r, 1, r, 2);
    ws.mergeCells(r, 3, r, n);
    const label = ws.getCell(r, 1);
    label.value = layout.notes.label;
    label.font = font({ color: { argb: MUTED } });
    label.alignment = { horizontal: "right", vertical: "top" };
    const value = ws.getCell(r, 3);
    put(value, layout.notes.value, "left");
    value.font = font();
    value.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  }

  return { workbook: wb, worksheet: ws as Worksheet, headerRow };
}

/** The .xlsx bytes of one invoice. */
export async function writeInvoiceXlsx(ExcelJS: ExcelJSModule, layout: InvoiceLayout, options: { logoDataUrl?: string | null } = {}): Promise<Uint8Array> {
  const { workbook } = buildInvoiceWorkbook(ExcelJS, layout, options);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
