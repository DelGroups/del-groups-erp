import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildInvoicePdfDefinition,
  invoiceExportFileName,
  invoiceExportLabels,
  invoiceSheetName,
  patchBoldRows,
  pdfShowsCompany,
  PDF_FONT,
  PDF_FONT_FILES,
  purchaseToExportDoc,
  saleToExportDoc,
} from "../src/lib/export/invoiceExport.ts";
import { buildInvoiceLayout, displayDate, isEmailLike, personName } from "../src/lib/export/invoiceLayout.ts";
import { currencyFormat, writeInvoiceXlsx, XLSX_DATE_FORMAT, XLSX_NUMBER_FORMATS } from "../src/lib/export/invoiceXlsx.ts";
import { mapSaleToInvoicePrint } from "../src/modules/sales/lib/mapSaleToInvoicePrint.ts";
import { translate } from "../src/i18n/translate.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { BRANDING, plainSaleFixture, purchaseFixture, saleFixture } from "./fixtures/invoiceExportFixtures.mjs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const labelsFor = (messages) => invoiceExportLabels((key, params) => translate(messages, key, params));
const en = labelsFor(enMessages);
const az = labelsFor(azMessages);
const ctx = { branding: BRANDING, partyVoen: "9876543210" };

/** The workbook after writing the real .xlsx bytes and reading them back with ExcelJS. */
const readBack = async (doc, labels = en, options = { mode: "unofficial", locale: "en-GB" }) => {
  const bytes = await writeInvoiceXlsx(ExcelJS, buildInvoiceLayout(doc, labels, options));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes));
  return { book, sheet: book.worksheets[0], bytes };
};
/** The first row (1-based) whose cell in `column` has the text, or -1. */
const findRow = (sheet, column, text, from = 1) => {
  for (let r = from; r <= sheet.rowCount; r += 1) if (sheet.getCell(`${column}${r}`).value === text) return r;
  return -1;
};
/** The cell to the right of a label in the document-field block. */
const fieldValue = (sheet, label) => {
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    for (const [l, v] of [["A", "C"], ["F", "H"]]) if (sheet.getCell(`${l}${r}`).value === label) return sheet.getCell(`${v}${r}`);
  }
  return null;
};

// ── Sales mapping ───────────────────────────────────────────────────────────

test("a sale uses the print mapping: header, lines and totals match the printed invoice", () => {
  const sale = saleFixture();
  const doc = saleToExportDoc(sale, ctx);
  const print = mapSaleToInvoicePrint(sale, { additionalExpenses: 40 });
  assert.equal(doc.kind, "sale");
  assert.equal(doc.docNo, print.docNo);
  assert.equal(doc.partyName, print.customerName);
  assert.equal(doc.responsible, print.sellerName);
  assert.equal(doc.warehouse, print.warehouseName);
  assert.equal(doc.createdBy, "Səbinə Qasımova");
  assert.equal(doc.partyVoen, "9876543210");
  assert.deepEqual(doc.lines.map((l) => [l.name, l.code, l.unit, l.quantity, l.price, l.total]), print.lines.map((l) => [l.productName, l.productCode, l.unit, l.quantity, l.unitPrice, l.lineTotal]));
  assert.deepEqual(doc.totals, {
    subtotal: print.subtotal,
    discount: print.discountTotal,
    vat: print.vatTotal,
    extraCosts: 40,
    grandTotal: print.grandTotal,
    paid: print.paidAmount,
    remaining: print.remainingBalance,
  });
});

test("line discounts: percent of qty × price, or the fixed amount", () => {
  const [percent, fixed, none] = saleToExportDoc(saleFixture(), ctx).lines;
  assert.equal(percent.discount, 42.5); // 10 × 85 × 5 %
  assert.equal(fixed.discount, 32.5); // fixed 32.50
  assert.equal(none.discount, 0);
});

test("VAT: line rates when the invoice has VAT, none on a regular invoice", () => {
  assert.deepEqual(saleToExportDoc(saleFixture(), ctx).lines.map((l) => l.vatRate), [18, 18, 18]);
  const plain = saleToExportDoc(plainSaleFixture(), ctx);
  assert.deepEqual(plain.lines.map((l) => l.vatRate), [null]);
  assert.equal(plain.totals.vat, 0);
  assert.equal(plain.isOfficial, false);
});

test("foreign currency: invoice currency and rate; AZN has rate 1", () => {
  const usd = saleToExportDoc(saleFixture(), ctx);
  assert.equal(usd.currency, "USD");
  assert.equal(usd.exchangeRate, 1.7);
  const azn = saleToExportDoc(plainSaleFixture({ exchange_rate: 3 }), ctx);
  assert.equal(azn.currency, "AZN");
  assert.equal(azn.exchangeRate, 1);
});

test("payments are listed with their date (the invoice date when missing)", () => {
  const doc = saleToExportDoc(saleFixture({ payments: [{ id: "x", account_id: "a", method: "Nağd", amount: 50 }, { id: "y", account_id: "a", method: "", amount: 0 }] }), ctx);
  assert.deepEqual(doc.payments, [{ date: "2026-11-09", method: "Nağd", amount: 50 }]);
});

test("status: draft, posted, cancelled (also the old Azerbaijani cancelled label)", () => {
  assert.equal(saleToExportDoc(saleFixture({ status: "draft" }), ctx).status, "draft");
  assert.equal(saleToExportDoc(saleFixture({ status: "" }), ctx).status, "posted");
  assert.equal(saleToExportDoc(saleFixture({ status: "ləğv edildi" }), ctx).status, "cancelled");
  assert.equal(purchaseToExportDoc(purchaseFixture({ status: "cancelled" }), ctx).status, "cancelled");
});

// ── Purchase mapping ────────────────────────────────────────────────────────

test("a purchase: supplier, responsible, VAT, extra costs and the print's total", () => {
  const doc = purchaseToExportDoc(purchaseFixture(), { branding: BRANDING, partyVoen: "1122334455" });
  assert.equal(doc.kind, "purchase");
  assert.equal(doc.docNo, "AL-2026/0108");
  assert.equal(doc.partyName, "Şəki Ağac Emalı ASC");
  assert.equal(doc.responsible, "Rəşad Hüseynov");
  assert.equal(doc.totals.subtotal, 1922.88);
  assert.equal(doc.totals.vat, 346.12);
  assert.equal(doc.totals.extraCosts, 150); // 120 + 30
  assert.equal(doc.totals.grandTotal, 2419); // total_amount, as the purchase print
  assert.equal(doc.totals.remaining, 919);
  assert.deepEqual(doc.lines.map((l) => [l.no, l.vatRate, l.currency]), [[1, 18, null], [2, 18, "EUR"]]);
});

test("a purchase without stored subtotal sums its lines; no VAT means no line rate", () => {
  const doc = purchaseToExportDoc(purchaseFixture({ subtotal_amount: null, vat_amount: 0, additional_expenses: null }), ctx);
  assert.equal(doc.totals.subtotal, 1100 + 822.88 * 1.85); // the EUR line at its rate, in AZN
  assert.equal(doc.totals.extraCosts, 0);
  assert.deepEqual(doc.lines.map((l) => l.vatRate), [null, null]);
});

// ── File and sheet names ────────────────────────────────────────────────────

test("file name: <doc number>_<date>.<ext> with safe characters only", () => {
  assert.equal(invoiceExportFileName({ docNo: "SAT-2026/0042", docDate: "2026-11-09" }, "xlsx"), "SAT-2026-0042_2026-11-09.xlsx");
  assert.equal(invoiceExportFileName({ docNo: "Şəki: №5 *ö*", docDate: "2026-01-02" }, "pdf"), "Seki-No5-o_2026-01-02.pdf");
  assert.equal(invoiceExportFileName({ docNo: "AL 7", docDate: null }, "pdf"), "AL-7.pdf");
  assert.equal(invoiceExportFileName({ docNo: "-", docDate: "2026-01-02" }, "xlsx"), "invoice_2026-01-02.xlsx");
  assert.match(invoiceExportFileName({ docNo: '../a\\b"c<d>|e', docDate: null }, "xlsx"), /^[A-Za-z0-9._-]+$/);
});

test("sheet name is the document number (forbidden characters become -)", () => {
  assert.equal(invoiceSheetName("SAT-2026/0042"), "SAT-2026-0042");
  assert.equal(invoiceSheetName("A:B?C*[D]"), "A-B-C-D-");
  assert.ok(invoiceSheetName("X".repeat(40)).length <= 31);
});

// ── Layout model (shared by PDF and Excel) ──────────────────────────────────

test("layout: the fields, the line order and the totals of the invoice", () => {
  const layout = buildInvoiceLayout(saleToExportDoc(saleFixture(), ctx), en, { mode: "official", locale: "en-GB" });
  assert.equal(layout.title, en.title.sale);
  assert.deepEqual(layout.docFields.map((f) => [f.key, f.value.text]), [["docNo", "SAT-2026/0042"], ["date", "09.11.2026"]]);
  assert.deepEqual(layout.infoFields.map((f) => f.key), ["party", "warehouse", "partyVoen", "responsible", "currency", "createdBy", "rate", "status"]);
  assert.equal(layout.infoFields.find((f) => f.key === "partyVoen").value.type, "text", "VÖEN is text (leading zeros)");
  assert.deepEqual(layout.columns.map((c) => c.key), ["no", "product", "code", "unit", "quantity", "price", "discount", "vat", "total"]);
  assert.deepEqual(layout.columns.map((c) => c.align), ["center", "left", "left", "left", "right", "right", "right", "right", "right"]);
  assert.equal(layout.columns.find((c) => c.key === "price").header, "Price, USD");
  assert.deepEqual(layout.lines.map((l) => l.no.value), [1, 2, 3], "line order kept");
  assert.deepEqual(layout.lines.map((l) => l.total.value), [807.5, 208.5, 159]);
  assert.deepEqual(layout.totals.map((t) => [t.key, t.value.value, t.emphasis]), [
    ["subtotal", 1250, "normal"],
    ["discount", 75, "normal"],
    ["vat", 211.5, "normal"],
    ["extraCosts", 40, "normal"],
    ["grandTotal", saleFixture().total_amount, "grand"],
    ["paid", 1000, "normal"],
    ["remaining", 426.5, "strong"],
  ]);
  assert.equal(layout.totals[1].value.text, "-75.00 USD");
  assert.ok(layout.company?.name === BRANDING.companyName);
});

test("layout: a regular sales invoice in the unofficial mode has no company and no VAT line", () => {
  const layout = buildInvoiceLayout(saleToExportDoc(plainSaleFixture(), ctx), en, { mode: "unofficial", locale: "en-GB" });
  assert.equal(layout.company, null);
  assert.ok(!layout.totals.some((t) => t.key === "vat"));
  assert.ok(buildInvoiceLayout(saleToExportDoc(plainSaleFixture(), ctx), en, { mode: "official", locale: "en-GB" }).company);
});

test("layout: a purchase with a line in another currency gets a currency column", () => {
  const layout = buildInvoiceLayout(purchaseToExportDoc(purchaseFixture(), ctx), en, { mode: "unofficial", locale: "en-GB" });
  assert.equal(layout.columns.at(-1).key, "currency");
  assert.equal(layout.lines[1].currency.text, "EUR");
  assert.equal(layout.lines[1].price.text, "2.74 EUR");
  assert.equal(layout.title, en.title.purchase);
});

test("dates read dd.mm.yyyy", () => {
  assert.equal(displayDate("2026-11-09"), "09.11.2026");
  assert.equal(displayDate("2026-01-02T10:00:00Z"), "02.01.2026");
});

// ── Names, not e-mails ─────────────────────────────────────────────────────

test("people: the display name wins over an e-mail; an e-mail only when no name is known", () => {
  assert.equal(personName("omer@del-groups.test", "Ömər Çələbiyev"), "Ömər Çələbiyev");
  assert.equal(personName(null, "", "sebine@del-groups.test"), "sebine@del-groups.test");
  assert.equal(personName(null, undefined, " "), "-");
  assert.equal(isEmailLike("a.b@c.az"), true);
  assert.equal(isEmailLike("Ömər Çələbiyev"), false);

  // The screenshot's case: the stored seller and creator are e-mails, the profiles have names.
  const sale = saleFixture({ issued_by_name: "omer@del-groups.test", created_by_name: "sebine@del-groups.test", seller_name: "Ömər Çələbiyev" });
  const doc = saleToExportDoc(sale, { ...ctx, people: { createdBy: "Səbinə Qasımova", issuedBy: null } });
  assert.equal(doc.responsible, "Ömər Çələbiyev", "the seller's name, not the issuer's e-mail");
  assert.equal(doc.createdBy, "Səbinə Qasımova");
  const issuer = saleToExportDoc(sale, { ...ctx, people: { issuedBy: "Ömər Ç." } });
  assert.equal(issuer.responsible, "Ömər Ç.", "the issuing user's display name first");
  const purchase = purchaseToExportDoc(purchaseFixture({ created_by_name: "sebine@del-groups.test" }), { ...ctx, people: { createdBy: "Səbinə Qasımova" } });
  assert.equal(purchase.createdBy, "Səbinə Qasımova");
  // The PDF prints the same names.
  const pdf = JSON.stringify(buildInvoicePdfDefinition(doc, en, { mode: "official", locale: "en-GB" }));
  assert.ok(!pdf.includes("@del-groups.test"), "no e-mail in the PDF");
  assert.ok(pdf.includes("Səbinə Qasımova"));
});

test("people: the export looks up display names (names only) and passes them to the mapping", () => {
  const hook = read("src/components/invoices/useInvoiceExport.tsx");
  assert.match(hook, /fetchDocumentPeople\(\{ createdBy: sale\.created_by, issuedBy: sale\.issued_by \}\)/);
  assert.match(hook, /m\.saleToExportDoc\(sale, \{ branding: full, partyVoen: voen, people \}\)/);
  assert.match(hook, /m\.purchaseToExportDoc\(purchase, \{ branding: full, partyVoen: voen, people \}\)/);
  const lookup = read("src/lib/tax/eQaimeDocuments.ts");
  assert.match(lookup, /fetchProfileDisplayNames\(supabase as unknown as ProfileNamesClient, wanted\)/);
});

// ── Excel file (ExcelJS) ────────────────────────────────────────────────────

test("xlsx: sheet named by the document; title large and bold across the table", async () => {
  const { book, sheet } = await readBack(saleToExportDoc(saleFixture(), ctx));
  assert.deepEqual(book.worksheets.map((w) => w.name), ["SAT-2026-0042"]);
  const company = sheet.getCell("A1");
  assert.equal(company.value, BRANDING.companyName);
  assert.equal(company.font.bold, true);
  assert.equal(company.font.size, 14);
  const titleRow = findRow(sheet, "A", en.title.sale);
  assert.ok(titleRow > 1);
  assert.equal(sheet.getCell(`A${titleRow}`).font.size, 16);
  assert.equal(sheet.getCell(`A${titleRow}`).font.bold, true);
  assert.ok(sheet.model.merges.includes(`A${titleRow}:I${titleRow}`), "title merged across the table");
  assert.equal(sheet.getCell(`A${titleRow}`).font.name, "Arial");
});

test("xlsx: document fields with grey labels; date is a real date dd.mm.yyyy; VÖEN is text", async () => {
  const { sheet } = await readBack(saleToExportDoc(saleFixture(), { ...ctx, partyVoen: "0012345678" }));
  const date = fieldValue(sheet, en.date);
  assert.ok(date.value instanceof Date);
  assert.equal(date.value.toISOString().slice(0, 10), "2026-11-09");
  assert.equal(date.numFmt, XLSX_DATE_FORMAT);
  assert.equal(date.alignment.horizontal, "left");
  const voen = fieldValue(sheet, en.partyVoen);
  assert.equal(voen.value, "0012345678", "leading zeros kept");
  assert.equal(voen.numFmt, "@");
  assert.equal(fieldValue(sheet, en.party.sale).value, "Gülşən Əliyeva — Şüşə Dünyası");
  assert.equal(fieldValue(sheet, en.rate).value, 1.7);
  assert.equal(fieldValue(sheet, en.rate).numFmt, XLSX_NUMBER_FORMATS.rate);
  const labelRow = findRow(sheet, "A", en.party.sale);
  assert.equal(sheet.getCell(`A${labelRow}`).font.color.argb, "FF64748B", "grey label");
});

test("xlsx: lines table: bold filled header, thin borders, alignment and number formats", async () => {
  const { sheet } = await readBack(saleToExportDoc(saleFixture(), ctx));
  const header = findRow(sheet, "B", en.cols.product);
  assert.ok(header > 0);
  const h = sheet.getCell(`F${header}`);
  assert.equal(h.value, "Price, USD", "currency code in the header");
  assert.equal(h.font.bold, true);
  assert.equal(h.fill.fgColor.argb, "FFF1F5F9");
  assert.equal(h.border.top.style, "thin");
  const line = header + 1;
  assert.equal(sheet.getCell(`A${line}`).value, 1);
  assert.equal(sheet.getCell(`A${line}`).alignment.horizontal, "center");
  assert.equal(sheet.getCell(`B${line}`).alignment.horizontal, "left");
  for (const col of ["E", "F", "G", "H", "I"]) {
    const cell = sheet.getCell(`${col}${line}`);
    assert.equal(typeof cell.value, "number", `${col} is a number`);
    assert.equal(cell.alignment.horizontal, "right", `${col} right aligned`);
    assert.equal(cell.border.bottom.style, "thin");
  }
  assert.equal(sheet.getCell(`I${line}`).value, 807.5);
  assert.equal(sheet.getCell(`F${line}`).numFmt, "#,##0.00");
  assert.equal(sheet.getCell(`H${line}`).numFmt, "#,##0.00");
  assert.equal(sheet.getCell(`E${line}`).numFmt, "#,##0.00#", "quantities keep cut lengths (3 decimals)");
  assert.notEqual(sheet.getCell(`B${line}`).alignment.wrapText, true, "wrap off");
});

test("xlsx: totals under the table on the right, values not formulas, bold Yekun with a top border", async () => {
  const sale = saleFixture();
  const { sheet } = await readBack(saleToExportDoc(sale, ctx), en, { mode: "official", locale: "en-GB" });
  // Totals start under the table (the "Discount" column header is in G too).
  const below = findRow(sheet, "B", en.cols.product) + saleFixture().items.length + 1;
  const value = (label) => {
    const r = findRow(sheet, "G", label, below);
    assert.ok(r > 0, label);
    const cell = sheet.getCell(`I${r}`);
    assert.equal(typeof cell.value, "number", `${label} is a number, not a formula`);
    assert.equal(cell.numFmt, currencyFormat("USD"));
    return cell.value;
  };
  assert.equal(value(en.totals.subtotal), 1250);
  assert.equal(value(en.totals.discount), -75);
  assert.equal(value(en.totals.vat), 211.5);
  assert.equal(value(en.totals.extraCosts), 40);
  assert.equal(value(en.totals.grandTotal), sale.total_amount);
  assert.equal(value(en.totals.paid), 1000);
  assert.equal(value(en.totals.remaining), 426.5);
  const grand = findRow(sheet, "G", en.totals.grandTotal, below);
  assert.equal(sheet.getCell(`G${grand}`).font.bold, true);
  assert.equal(sheet.getCell(`I${grand}`).font.bold, true);
  assert.equal(sheet.getCell(`I${grand}`).border.top.style, "thin");
  assert.equal(sheet.getCell(`I${grand}`).alignment.horizontal, "right");
});

test("xlsx: widths fitted to content, frozen under the header, A4 portrait fit to width, no gridlines", async () => {
  const { sheet } = await readBack(saleToExportDoc(saleFixture(), ctx));
  const header = findRow(sheet, "B", en.cols.product);
  // ExcelJS reads Excel's default width (9) back as empty.
  const widths = sheet.columns.map((c) => c.width ?? 9);
  assert.equal(widths.length, 9);
  assert.ok(widths[1] >= 28 && widths[1] === Math.max(...widths), "the product column is the widest");
  assert.ok(widths[0] <= 6, "№ is narrow");
  const view = sheet.views[0];
  assert.equal(view.state, "frozen");
  assert.equal(view.ySplit, header);
  assert.equal(view.showGridLines, false);
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.equal(sheet.pageSetup.orientation, "portrait");
  assert.equal(sheet.pageSetup.fitToPage, true);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.match(sheet.headerFooter.oddFooter, /&P.*&N/);
});

test("xlsx: draft and cancelled files carry the mark under the title; posted has none", async () => {
  const marked = async (doc, labels) => {
    const { sheet } = await readBack(doc, labels);
    const title = findRow(sheet, "A", labels.title[doc.kind]);
    return sheet.getCell(`A${title + 1}`).value;
  };
  assert.equal(await marked(saleToExportDoc(saleFixture({ status: "cancelled" }), ctx), en), "CANCELLED");
  assert.equal(await marked(purchaseToExportDoc(purchaseFixture({ status: "draft" }), ctx), az), "QARALAMA");
  assert.equal(await marked(saleToExportDoc(saleFixture(), ctx), en), null);
});

test("xlsx: purchase file has the supplier, the EUR line and a currency column", async () => {
  const { sheet } = await readBack(purchaseToExportDoc(purchaseFixture(), ctx));
  const header = findRow(sheet, "B", en.cols.product);
  assert.equal(sheet.getCell(`J${header}`).value, en.cols.currency);
  assert.equal(sheet.getCell(`J${header + 2}`).value, "EUR");
  assert.equal(fieldValue(sheet, en.party.purchase).value, "Şəki Ağac Emalı ASC");
  assert.ok(findRow(sheet, "A", en.title.purchase) > 0);
});

test("xlsx: quantities keep 3 decimals (cut lengths), amounts are the stored 2-decimal values", async () => {
  const sale = saleFixture({ items: [{ ...saleFixture().items[1], quantity: 2.375, unit_price: 2.005, total: 4.76 }] });
  const { sheet } = await readBack(saleToExportDoc(sale, ctx));
  const row = findRow(sheet, "B", en.cols.product) + 1;
  assert.equal(sheet.getCell(`E${row}`).value, 2.375);
  assert.equal(sheet.getCell(`F${row}`).value, 2.01, "the price the PDF prints");
  assert.equal(sheet.getCell(`I${row}`).value, 4.76);
});

test("xlsx: a regular sales invoice leaves out the company block, as its print does", async () => {
  const { sheet } = await readBack(saleToExportDoc(plainSaleFixture(), ctx));
  assert.equal(findRow(sheet, "A", BRANDING.companyName), -1);
  assert.equal(sheet.getCell("A1").value, en.title.sale, "the title comes first");
  assert.ok(fieldValue(sheet, en.party.sale), "the document fields stay");
  assert.equal(findRow(sheet, "G", en.totals.vat), -1, "no VAT line, like the print");
  const official = (await readBack(saleToExportDoc(saleFixture(), ctx))).sheet;
  assert.equal(official.getCell("A1").value, BRANDING.companyName);
});

test("xlsx: Azerbaijani labels and letters survive the round trip", async () => {
  const { sheet } = await readBack(saleToExportDoc(saleFixture(), ctx), az);
  assert.ok(findRow(sheet, "A", "Satış fakturası") > 0);
  assert.ok(findRow(sheet, "G", "Yekun məbləğ") > 0);
  assert.equal(sheet.getCell(`F${findRow(sheet, "B", "Məhsul")}`).value, "Qiymət, USD");
});

// ── PDF ─────────────────────────────────────────────────────────────────────

const flat = (node) => JSON.stringify(node);

test("pdf: Noto Sans font, A4, footer with page numbers", () => {
  const def = buildInvoicePdfDefinition(saleToExportDoc(saleFixture(), ctx), en, { mode: "official", locale: "en-GB" });
  assert.equal(def.pageSize, "A4");
  assert.equal(def.defaultStyle.font, PDF_FONT);
  assert.equal(def.footer(2, 3).text, "Page 2 of 3");
});

test("pdf: regular layout hides the company and the VAT line, like the print", () => {
  const doc = saleToExportDoc(plainSaleFixture(), ctx);
  assert.equal(pdfShowsCompany(doc, "unofficial"), false);
  const regular = flat(buildInvoicePdfDefinition(doc, en, { mode: "unofficial", locale: "en-GB" }));
  assert.ok(!regular.includes(BRANDING.companyName));
  assert.ok(!regular.includes(`"${en.totals.vat}"`));
  const official = flat(buildInvoicePdfDefinition(doc, en, { mode: "official", locale: "en-GB" }));
  assert.ok(official.includes(BRANDING.companyName));
  assert.ok(official.includes(`"${en.totals.vat}"`));
});

test("pdf: official invoices and purchases always show the company (no layout question)", () => {
  assert.equal(pdfShowsCompany(saleToExportDoc(saleFixture(), ctx), "unofficial"), true);
  assert.equal(pdfShowsCompany(purchaseToExportDoc(purchaseFixture(), ctx), "unofficial"), true);
});

test("pdf: draft and cancelled get a watermark and a mark; posted has none", () => {
  const def = (status) => buildInvoicePdfDefinition(saleToExportDoc(saleFixture({ status }), ctx), en, { mode: "official", locale: "en-GB" });
  assert.equal(def("cancelled").watermark.text, "CANCELLED");
  assert.equal(def("draft").watermark.text, "DRAFT");
  assert.equal(def("posted").watermark, undefined);
});

test("pdf: totals, payments and foreign currency appear with 2 decimals", () => {
  const text = flat(buildInvoicePdfDefinition(saleToExportDoc(saleFixture(), ctx), en, { mode: "official", locale: "en-GB" }));
  for (const s of ["1,426.50 USD", "426.50 USD", "40.00 USD", "-75.00 USD", "600.00 USD", "Exchange rate", "1.70", "09.11.2026", "Price, USD", "Payments"]) assert.ok(text.includes(s), s);
});

test("pdf: quantities show 3 decimals; a foreign line names its currency on price and total", () => {
  const doc = purchaseToExportDoc(purchaseFixture({ items: [{ ...purchaseFixture().items[1], quantity: 2.375 }] }), ctx);
  const text = flat(buildInvoicePdfDefinition(doc, en, { mode: "official", locale: "en-GB" }));
  assert.ok(text.includes('"2.375"'), "quantity");
  assert.ok(text.includes("2.74 EUR"), "price");
  assert.ok(text.includes("822.88 EUR"), "line total");
});

test("pdf: a real file is made in Node with the embedded Noto Sans (Azerbaijani letters)", async () => {
  const pdfmake = require("pdfmake");
  const fonts = join(root, "public/fonts");
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((p) => p.startsWith(fonts));
  pdfmake.setFonts({ [PDF_FONT]: { normal: join(fonts, PDF_FONT_FILES.normal), bold: join(fonts, PDF_FONT_FILES.bold) } });
  const def = buildInvoicePdfDefinition(saleToExportDoc(saleFixture(), ctx), az, { mode: "official", locale: "az-AZ" });
  const bytes = Buffer.from(await pdfmake.createPdf(def).getBuffer());
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.match(bytes.toString("latin1"), /NotoSans/);
  assert.ok(bytes.length > 5000);
});

// ── Font, texts, wiring ─────────────────────────────────────────────────────

test("the font files and their OFL licence are bundled locally", () => {
  for (const file of Object.values(PDF_FONT_FILES)) assert.ok(existsSync(join(root, "public/fonts", file)), file);
  assert.match(read("public/fonts/NotoSans-OFL.txt"), /SIL Open Font License/);
});

test("the export texts exist in az, en and ru with the same keys", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : keys(v, `${p}${k}.`))).sort();
  const base = keys(enMessages.invoiceTools.export);
  for (const messages of [azMessages, ruMessages]) assert.deepEqual(keys(messages.invoiceTools.export), base);
  for (const messages of [azMessages, enMessages, ruMessages]) {
    const labels = labelsFor(messages);
    assert.ok(!flat(labels).includes("invoiceTools."), "every label resolves");
    assert.ok(!messages.invoiceTools.export.downloadExcel.startsWith("+"));
  }
  assert.match(azMessages.invoiceTools.export.mark.cancelled, /LƏĞV/);
});

test("libraries load only on click (dynamic imports), never in the page bundle", () => {
  const download = read("src/lib/export/invoiceExportDownload.ts");
  assert.match(download, /import\("exceljs"\)/);
  assert.doesNotMatch(download, /import\("xlsx"\)/, "the invoice no longer uses SheetJS");
  assert.match(download, /import\("pdfmake\/build\/pdfmake"\)/);
  assert.match(download, /fetch\(`\/fonts\/\$\{file\}`\)/);
  assert.doesNotMatch(download, /https?:\/\//, "no CDN");
  const hook = read("src/components/invoices/useInvoiceExport.tsx");
  assert.match(hook, /import\("@\/lib\/export\/invoiceExportDownload"\)/);
  for (const p of ["src/lib/export/invoiceExport.ts", "src/lib/export/invoiceLayout.ts", "src/lib/export/invoiceXlsx.ts", "src/components/invoices/useInvoiceExport.tsx", "src/components/invoices/invoiceExportActions.tsx"]) {
    assert.doesNotMatch(read(p), /^import (?!type )[^\n]*from "(xlsx|exceljs|pdfmake[^"]*)"/m, `${p} has no static library import`);
  }
  // The mapping comes with the click too: the screens only import its types.
  for (const p of ["src/components/invoices/useInvoiceExport.tsx", "src/components/invoices/invoiceExportActions.tsx", "src/components/documents/DocumentListActions.tsx"]) {
    assert.doesNotMatch(read(p), /^import \{[^}]*\} from "@\/lib\/export\/invoiceExport(Download)?";$/m, `${p} imports the mapping only as types`);
  }
});

test("every menu offers the entries only with INVOICE_TOOLS, next to Print, on one code path", () => {
  const actions = read("src/components/invoices/invoiceExportActions.tsx");
  assert.match(actions, /key: "export_xlsx"/);
  assert.match(actions, /key: "export_pdf"/);
  assert.match(actions, /if \(!enabled\) return \[\];[\s\S]*if \(!enabled\) return \[\];/);

  const salesList = read("src/modules/sales/components/SalesScreen.tsx");
  assert.match(salesList, /key: "print"[^\n]*\n\s*\.\.\.invoiceExportRowActions\(t, exportOn\),/);
  const purchasesScreen = read("src/modules/purchases/components/PurchasesScreen.tsx");
  assert.match(purchasesScreen, /key: "print"[^\n]*\n\s*\.\.\.invoiceExportRowActions\(t, exportOn\),/);
  assert.match(purchasesScreen, /invoiceExportFormActions\(t, invoiceExport\.enabled, \(format\) => void invoiceExport\.exportPurchase\(purchase, format\)\)/);
  const saleForm = read("src/modules/sales/components/SaleFormScreen.tsx");
  assert.match(saleForm, /invoiceExportFormActions\(t, invoiceExport\.enabled, \(format\) => void invoiceExport\.exportSale\(sale, format\)\)/);
  assert.match(saleForm, /\{invoiceExport\.dialog\}/);

  for (const p of ["src/modules/sales/components/SalesPage.tsx", "src/modules/purchases/components/PurchasesPage.tsx"]) {
    assert.match(read(p), /onInvoiceExport=\{invoiceExport\.enabled \? \(format\) => void invoiceExport\.export(Sale|Purchase)\(\(\) => fetch(Sale|Purchase)ById\(/, p);
  }
  for (const p of ["src/modules/sales/components/SaleDetailPage.tsx", "src/modules/purchases/components/PurchaseViewModal.tsx"]) {
    assert.match(read(p), /\{invoiceExport\.enabled \? \(\s*(<div[^>]*>\s*)?<InvoiceExportButtons/, p);
  }
  const listMenu = read("src/components/documents/DocumentListActions.tsx");
  assert.match(listMenu, /onClick: onPrint,\s*\}\);\s*\}\s*if \(onInvoiceExport\)/);
});

test("the PDF asks for the layout only for a regular sales invoice, in the print's modal", () => {
  const hook = read("src/components/invoices/useInvoiceExport.tsx");
  assert.match(hook, /format === "pdf" && doc\.kind === "sale" && !doc\.isOfficial/);
  assert.match(hook, /<PrintInvoiceModal/);
  assert.match(hook, /const enabled = useInvoiceTools\(\);/);
  // A failed or empty load (classic lists fetch on click) ends in the error toast.
  assert.match(hook, /if \(!record\) throw new Error/);
  assert.match(hook, /toast\.error\(t\("invoiceTools\.export\.error"\), \{ id: waiting \}\)/);
});

test("patchBoldRows stays for the other SheetJS exports (debtor reports, partner statement)", () => {
  const xml = '<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" s="2"><v>5</v></c></row><row r="4"><c r="A4" t="s"><v>1</v></c></row>';
  const out = patchBoldRows(xml, 7, [3]);
  assert.match(out, /<c r="A3" s="7" t="s">/);
  assert.match(out, /<c r="B3" s="2">/);
  assert.match(out, /<c r="A4" t="s">/);
});

test("mixed currencies: plain amount headers, each line's currency in its number format; the PDF has no currency column", async () => {
  const doc = purchaseToExportDoc(purchaseFixture(), ctx);
  const layout = buildInvoiceLayout(doc, en, { mode: "unofficial", locale: "en-GB" });
  assert.equal(layout.columns.find((c) => c.key === "price").header, en.cols.price, "no single currency claimed");
  assert.equal(layout.lines[0].currency.text, "AZN", "a line in the invoice currency names it");
  const { sheet } = await readBack(doc);
  const header = findRow(sheet, "B", en.cols.product);
  assert.equal(sheet.getCell(`F${header + 2}`).numFmt, '#,##0.00" EUR"');
  assert.equal(typeof sheet.getCell(`F${header + 2}`).value, "number");
  assert.equal(sheet.getCell(`F${header + 1}`).numFmt, "#,##0.00");
  const pdf = buildInvoicePdfDefinition(doc, en, { mode: "official", locale: "en-GB" });
  const table = pdf.content.find((n) => n.table?.headerRows === 1);
  assert.equal(table.table.widths.length, 9, "the PDF keeps its 9 columns");
  assert.deepEqual(table.table.widths, [18, "*", 52, 34, 44, 48, 42, 30, 56]);
});

test("a date that is not yyyy-mm-dd is written as text, never a broken date cell", async () => {
  const doc = saleToExportDoc(saleFixture(), ctx);
  const layout = buildInvoiceLayout(doc, en, { mode: "unofficial", locale: "en-GB" });
  layout.docFields[1].value = { type: "date", iso: "09.11.2026", text: "09.11.2026" };
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await writeInvoiceXlsx(ExcelJS, layout)));
  assert.equal(fieldValue(book.worksheets[0], en.date).value, "09.11.2026");
});
