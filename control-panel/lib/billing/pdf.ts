/**
 * Invoice PDF (prompt 13): A4, in the tenant's language, from the invoice as issued (its
 * seller and buyer snapshots and lines), so the same invoice always prints the same.
 * Noto Sans (assets/fonts, SIL OFL) is embedded and subset, so ə, ğ, ş, ı and Cyrillic print.
 * Server only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { MESSAGES, translate, type Locale } from "../i18n/messages.ts";
import { bankTransferLines } from "./providers/manualBankTransfer.ts";
import { formatDocDate, formatDocMoney } from "./docFormat.ts";

export { formatDocDate, formatDocMoney };

export interface InvoiceParty {
  name?: string | null;
  tax_id?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  [key: string]: unknown;
}

export interface InvoiceDocument {
  id: string;
  number: string;
  status: string;
  currency: string;
  language: Locale;
  issued_at: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  subtotal: number;
  tax: number;
  total: number;
  amount_paid: number;
  notes: string | null;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: { description: string; quantity: number; unit_price: number; amount: number }[];
}

/** Where Noto Sans lives: BILLING_FONT_DIR, else assets/fonts from the panel or the repo root. */
export function fontDir(env: Readonly<Record<string, string | undefined>> = process.env, cwd = process.cwd()): string {
  const candidates = [env.BILLING_FONT_DIR, join(cwd, "assets", "fonts"), join(cwd, "control-panel", "assets", "fonts")];
  const found = candidates.find((dir) => dir && existsSync(join(dir, "NotoSans-Regular.ttf")));
  if (!found) throw new Error("invoice fonts not found: set BILLING_FONT_DIR to control-panel/assets/fonts");
  return found;
}

let fontCache: { dir: string; regular: Uint8Array; bold: Uint8Array } | null = null;
function fonts(dir: string) {
  if (fontCache?.dir !== dir) {
    fontCache = {
      dir,
      regular: readFileSync(join(dir, "NotoSans-Regular.ttf")),
      bold: readFileSync(join(dir, "NotoSans-Bold.ttf")),
    };
  }
  return fontCache;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.11, 0.13, 0.17);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderInvoicePdf(doc: InvoiceDocument, options: { fontDir?: string } = {}): Promise<Uint8Array> {
  const messages = MESSAGES[doc.language] ?? MESSAGES.az;
  const tr = (key: string, vars?: Record<string, string | number>) => translate(messages, `invoiceDoc.${key}`, vars);
  // Azerbaijani capitals: i → İ, not I.
  const upper = (s: string) => s.toLocaleUpperCase(doc.language);
  const f = fonts(options.fontDir ?? fontDir());

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(f.regular, { subset: true });
  const bold = await pdf.embedFont(f.bold, { subset: true });
  pdf.setTitle(`${tr("title")} ${doc.number}`);
  pdf.setAuthor(String(doc.seller.name ?? ""));
  pdf.setCreator("Del Groups ERP control panel");
  pdf.setProducer("pdf-lib");
  // Same bytes for the same invoice: dates come from the invoice, not the clock.
  const stamp = doc.issued_at ? new Date(doc.issued_at) : new Date(0);
  pdf.setCreationDate(stamp);
  pdf.setModificationDate(stamp);

  const [W, H] = A4;
  const right = W - MARGIN;
  let page: PDFPage = pdf.addPage(A4);
  let y = H - MARGIN;

  const text = (s: string, x: number, yy: number, size = 9.5, font = regular, color = INK) =>
    page.drawText(s, { x, y: yy, size, font, color });
  const textRight = (s: string, x: number, yy: number, size = 9.5, font = regular, color = INK) =>
    text(s, x - font.widthOfTextAtSize(s, size), yy, size, font, color);
  const rule = (yy: number) => page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: right, y: yy }, thickness: 0.6, color: RULE });

  // ── Header: seller on the left, invoice facts on the right ──
  const seller = doc.seller;
  text(String(seller.name || ""), MARGIN, y - 14, 15, bold);
  let sy = y - 32;
  for (const line of [
    seller.tax_id ? tr("taxId", { value: String(seller.tax_id) }) : "",
    ...wrap(String(seller.address ?? ""), regular, 9, 260),
    [seller.email, seller.phone].filter(Boolean).join(" · "),
  ].filter(Boolean)) {
    text(line, MARGIN, sy, 9, regular, MUTED);
    sy -= 12;
  }

  textRight(upper(tr("title")), right, y - 14, 18, bold);
  const facts: [string, string][] = [
    [tr("number"), doc.number],
    [tr("issued"), formatDocDate(doc.issued_at)],
    [tr("due"), formatDocDate(doc.due_date)],
  ];
  if (doc.period_start && doc.period_end) {
    facts.push([tr("period"), `${formatDocDate(doc.period_start)} – ${formatDocDate(doc.period_end)}`]);
  }
  let fy = y - 34;
  for (const [label, value] of facts) {
    textRight(value, right, fy, 9.5, bold);
    textRight(label, right - bold.widthOfTextAtSize(value, 9.5) - 10, fy, 9, regular, MUTED);
    fy -= 13;
  }
  y = Math.min(sy, fy) - 14;

  // ── Bill to ──
  text(upper(tr("billTo")), MARGIN, y, 8, bold, MUTED);
  y -= 14;
  const buyer = doc.buyer;
  text(String(buyer.name || ""), MARGIN, y, 11, bold);
  y -= 13;
  for (const line of [
    buyer.tax_id ? tr("taxId", { value: String(buyer.tax_id) }) : "",
    ...wrap(String(buyer.address ?? ""), regular, 9, 300),
    String(buyer.email ?? ""),
  ].filter(Boolean)) {
    text(line, MARGIN, y, 9, regular, MUTED);
    y -= 12;
  }
  y -= 12;

  // ── Lines ──
  const col = { qty: right - 205, unit: right - 95, amount: right };
  const descWidth = col.qty - MARGIN - 50;
  const tableHeader = () => {
    text(tr("description"), MARGIN, y, 8.5, bold, MUTED);
    textRight(tr("quantity"), col.qty, y, 8.5, bold, MUTED);
    textRight(tr("unitPrice"), col.unit, y, 8.5, bold, MUTED);
    textRight(tr("amount"), col.amount, y, 8.5, bold, MUTED);
    y -= 7;
    rule(y);
    y -= 14;
  };
  tableHeader();
  for (const line of doc.lines) {
    const rows = wrap(line.description, regular, 9.5, descWidth);
    if (y - rows.length * 12 < MARGIN + 40) {
      page = pdf.addPage(A4);
      y = H - MARGIN;
      tableHeader();
    }
    textRight(String(Number(line.quantity)), col.qty, y);
    textRight(formatDocMoney(Number(line.unit_price), doc.currency), col.unit, y);
    textRight(formatDocMoney(Number(line.amount), doc.currency), col.amount, y);
    for (const row of rows) {
      text(row, MARGIN, y);
      y -= 12;
    }
    y -= 4;
  }
  rule(y + 6);
  y -= 8;

  // ── Totals ──
  const balance = Math.max(0, Math.round((Number(doc.total) - Number(doc.amount_paid)) * 100) / 100);
  const totals: [string, number, boolean][] = [[tr("subtotal"), Number(doc.subtotal), false]];
  if (Number(doc.tax) > 0 || Number(seller.tax_rate_pct ?? 0) > 0) {
    totals.push([tr("tax", { label: String(seller.tax_label ?? ""), rate: Number(seller.tax_rate_pct ?? 0) }), Number(doc.tax), false]);
  }
  totals.push([tr("total"), Number(doc.total), true]);
  if (Number(doc.amount_paid) > 0) {
    totals.push([tr("paid"), -Number(doc.amount_paid), false], [tr("balance"), balance, true]);
  }
  if (y - totals.length * 15 - 120 < MARGIN) {
    page = pdf.addPage(A4);
    y = H - MARGIN;
  }
  for (const [label, value, strong] of totals) {
    const font = strong ? bold : regular;
    textRight(formatDocMoney(value, doc.currency), col.amount, y, strong ? 11 : 9.5, font);
    textRight(label, col.unit, y, strong ? 11 : 9.5, font, strong ? INK : MUTED);
    y -= strong ? 17 : 14;
  }
  y -= 14;

  // ── Payment details (bank transfer) ──
  const bank = bankTransferLines(seller as Parameters<typeof bankTransferLines>[0], doc.number);
  if (bank.length > 1 && doc.status !== "void") {
    text(upper(tr("payment")), MARGIN, y, 8, bold, MUTED);
    y -= 14;
    for (const { label, value } of bank) {
      text(tr(`bank.${label}`), MARGIN, y, 9, regular, MUTED);
      text(value, MARGIN + 140, y, 9, label === "reference" ? bold : regular);
      y -= 12;
    }
    y -= 4;
    for (const row of wrap(tr("paymentNote"), regular, 8.5, right - MARGIN)) {
      text(row, MARGIN, y, 8.5, regular, MUTED);
      y -= 11;
    }
  }
  if (doc.notes) {
    y -= 8;
    for (const row of wrap(doc.notes, regular, 9, right - MARGIN)) {
      text(row, MARGIN, y, 9, regular, MUTED);
      y -= 12;
    }
  }

  // ── Stamp and page numbers ──
  const pages = pdf.getPages();
  if (doc.status === "paid" || doc.status === "void") {
    const label = upper(tr(doc.status === "paid" ? "paidStamp" : "voidStamp"));
    const color = doc.status === "paid" ? rgb(0.09, 0.55, 0.33) : rgb(0.55, 0.57, 0.6);
    pages[0].drawText(label, { x: W - 255, y: H - 212, size: 30, font: bold, color, opacity: 0.35, rotate: degrees(18) });
  }
  pages.forEach((p, i) => {
    const s = tr("page", { page: i + 1, pages: pages.length });
    p.drawText(s, { x: right - regular.widthOfTextAtSize(s, 8), y: MARGIN - 20, size: 8, font: regular, color: MUTED });
    p.drawText(doc.number, { x: MARGIN, y: MARGIN - 20, size: 8, font: regular, color: MUTED });
  });

  return pdf.save({ useObjectStreams: true });
}
