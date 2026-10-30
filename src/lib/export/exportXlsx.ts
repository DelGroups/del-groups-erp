/**
 * The one list export of the app (prompt 24c, step 7b): an .xlsx file, never .csv. Cells keep
 * their types (amounts are numbers with two decimals, dates are Excel dates), the header row is
 * bold and frozen, column widths follow the content and the file is "<list>-<yyyy-mm-dd>.xlsx".
 *
 * Built on the "xlsx" package (SheetJS 0.18.5). Its community build cannot write a bold font or
 * a frozen row, so the writer patches those two parts of the generated file (styles.xml and the
 * sheet's sheetView). Only writing is used here; reading files stays in the import code.
 *
 * Everything but `exportXlsx` is pure and takes the xlsx module as a parameter, so tests run it
 * in Node with `require("xlsx")`.
 */

export type XlsxCellType = "text" | "number" | "integer" | "money" | "date" | "datetime" | "boolean";

export interface XlsxColumn<Row> {
  /** Header in the user's language. */
  header: string;
  type?: XlsxCellType;
  value: (row: Row) => unknown;
}

/** A SheetJS cell object: string, number (dates are numbers with a date format) or empty. */
export interface XlsxCell {
  t: "s" | "n" | "b" | "z";
  v?: string | number | boolean;
  /** Number format. */
  z?: string;
}

export const XLSX_FORMATS = {
  money: "#,##0.00",
  integer: "#,##0",
  number: "#,##0.##",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm",
} as const;

const DAY_MS = 86_400_000;
// Day 0 of Excel's 1900 date system, as used by every modern Excel (the 1900 leap-year bug
// is behind this date, so serials from 1900-03-01 on are right).
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Excel date serial. A plain "yyyy-mm-dd" is a calendar day (no time zone); a timestamp is
 * shown at the wall-clock time of the user's time zone, like the list shows it.
 */
export function excelSerial(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const day = DATE_ONLY.exec(value.trim());
    if (day) return (Date.UTC(+day[1], +day[2] - 1, +day[3]) - EXCEL_EPOCH_UTC) / DAY_MS;
  }
  const d = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (local - EXCEL_EPOCH_UTC) / DAY_MS;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toXlsxCell(type: XlsxCellType, value: unknown): XlsxCell {
  if (value === null || value === undefined || value === "") return { t: "z" };
  switch (type) {
    case "money": {
      const n = toNumber(value);
      return n === null ? { t: "z" } : { t: "n", v: Math.round(n * 100) / 100, z: XLSX_FORMATS.money };
    }
    case "integer": {
      const n = toNumber(value);
      return n === null ? { t: "z" } : { t: "n", v: Math.round(n), z: XLSX_FORMATS.integer };
    }
    case "number": {
      const n = toNumber(value);
      return n === null ? { t: "z" } : { t: "n", v: n, z: XLSX_FORMATS.number };
    }
    case "date":
    case "datetime": {
      const serial = excelSerial(value);
      if (serial === null) return { t: "s", v: String(value) };
      return type === "date" ? { t: "n", v: Math.floor(serial), z: XLSX_FORMATS.date } : { t: "n", v: serial, z: XLSX_FORMATS.datetime };
    }
    case "boolean":
      return typeof value === "boolean" ? { t: "b", v: value } : { t: "s", v: String(value) };
    default:
      return { t: "s", v: String(value) };
  }
}

/** Shown width of a cell in characters, for the column widths. */
function cellWidth(cell: XlsxCell): number {
  if (cell.t === "z") return 0;
  if (cell.t === "n") {
    if (cell.z === XLSX_FORMATS.date) return 10;
    if (cell.z === XLSX_FORMATS.datetime) return 16;
    const n = Number(cell.v);
    const digits = Math.trunc(Math.abs(n)).toString().length;
    return digits + Math.floor((digits - 1) / 3) + (cell.z === XLSX_FORMATS.integer ? 0 : 3) + (n < 0 ? 1 : 0);
  }
  return String(cell.v).split("\n").reduce((m, line) => Math.max(m, line.length), 0);
}

export interface XlsxSheetData {
  header: string[];
  cells: XlsxCell[][];
  /** Column widths in characters (header and content, 8 to 60). */
  widths: number[];
}

export function buildXlsxSheet<Row>(columns: readonly XlsxColumn<Row>[], rows: readonly Row[]): XlsxSheetData {
  const header = columns.map((c) => c.header);
  const cells = rows.map((row) => columns.map((c) => toXlsxCell(c.type ?? "text", c.value(row))));
  const widths = columns.map((c, i) => {
    const widest = cells.reduce((m, r) => Math.max(m, cellWidth(r[i])), c.header.length);
    return Math.min(60, Math.max(8, widest + 2));
  });
  return { header, cells, widths };
}

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ]. */
export function xlsxSheetName(name: string): string {
  const clean = name.replace(/[:\\/?*[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim();
  return clean || "Sheet1";
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "<list>-<yyyy-mm-dd>.xlsx", without characters that break file names. */
export function xlsxFileName(listName: string, now: Date): string {
  const safe = listName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().replace(/ /g, "_") || "export";
  return `${safe}-${dayKey(now)}.xlsx`;
}

const BOLD_FONT = '<font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>';

/** Adds a bold font and a cell style that uses it; returns the new style's index. */
export function patchStylesXml(xml: string): { xml: string; headerStyle: number } {
  let headerStyle = -1;
  const withFont = xml.replace(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/, (_m, count: string, body: string) => `<fonts count="${Number(count) + 1}">${body}${BOLD_FONT}</fonts>`);
  const fontId = Number(/<fonts count="(\d+)">/.exec(withFont)?.[1] ?? "1") - 1;
  const out = withFont.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_m, count: string, body: string) => {
    headerStyle = Number(count);
    return `<cellXfs count="${headerStyle + 1}">${body}<xf numFmtId="0" fontId="${fontId}" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>`;
  });
  return { xml: out, headerStyle };
}

/** Freezes the first row and gives its cells the header style. */
export function patchSheetXml(xml: string, headerStyle: number): string {
  const frozen = xml.replace(/<sheetView([^>]*?)\/>/, '<sheetView$1><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>');
  if (headerStyle < 0) return frozen;
  return frozen.replace(/<row r="1"([^>]*)>([\s\S]*?)<\/row>/, (_m, attrs: string, body: string) => {
    const styled = body.replace(/<c r="([A-Z]+1)"(?: s="\d+")?/g, `<c r="$1" s="${headerStyle}"`);
    return `<row r="1"${attrs}>${styled}</row>`;
  });
}

/** The parts of the "xlsx" module the writer uses. */
export interface XlsxModule {
  utils: {
    aoa_to_sheet: (data: unknown[][]) => Record<string, unknown>;
    book_new: () => { Workbook?: { Views?: { RTL?: boolean }[] } } & Record<string, unknown>;
    book_append_sheet: (book: never, sheet: never, name: string) => void;
  };
  write: (book: never, opts: { type: "array"; bookType: "xlsx" }) => ArrayBuffer;
  CFB: {
    read: (data: Uint8Array, opts: { type: "array" }) => CfbContainer;
    write: (cfb: CfbContainer, opts: { fileType: "zip"; type: "array" }) => ArrayBuffer | number[];
  };
}
interface CfbContainer {
  FullPaths: string[];
  FileIndex: { content: Uint8Array | number[] }[];
}

export interface XlsxBook<Row> {
  sheetName: string;
  columns: readonly XlsxColumn<Row>[];
  rows: readonly Row[];
  /** Right-to-left sheet, for a right-to-left interface language. */
  rtl?: boolean;
}

const utf8 = { decode: (b: Uint8Array | number[]) => new TextDecoder().decode(b instanceof Uint8Array ? b : Uint8Array.from(b)), encode: (s: string) => new TextEncoder().encode(s) };

/** The .xlsx file's bytes. */
export function writeXlsxBytes<Row>(XLSX: XlsxModule, book: XlsxBook<Row>): Uint8Array {
  const data = buildXlsxSheet(book.columns, book.rows);
  const sheet = XLSX.utils.aoa_to_sheet([data.header, ...data.cells]);
  sheet["!cols"] = data.widths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  if (book.rtl) wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb as never, sheet as never, xlsxSheetName(book.sheetName));
  const raw = new Uint8Array(XLSX.write(wb as never, { type: "array", bookType: "xlsx" }));

  const zip = XLSX.CFB.read(raw, { type: "array" });
  const entry = (suffix: string) => {
    const i = zip.FullPaths.findIndex((p) => p.endsWith(suffix));
    return i >= 0 ? zip.FileIndex[i] : null;
  };
  const styles = entry("xl/styles.xml");
  const sheetXml = entry("xl/worksheets/sheet1.xml");
  if (!styles || !sheetXml) return raw;
  const patched = patchStylesXml(utf8.decode(styles.content));
  styles.content = utf8.encode(patched.xml);
  sheetXml.content = utf8.encode(patchSheetXml(utf8.decode(sheetXml.content), patched.headerStyle));
  const out = XLSX.CFB.write(zip, { fileType: "zip", type: "array" });
  return out instanceof ArrayBuffer ? new Uint8Array(out) : Uint8Array.from(out);
}

/** Builds the file in the browser and downloads it. */
export async function exportXlsx<Row>(fileName: string, book: XlsxBook<Row>): Promise<void> {
  const XLSX = (await import("xlsx")) as unknown as XlsxModule;
  const bytes = writeXlsxBytes(XLSX, book);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
