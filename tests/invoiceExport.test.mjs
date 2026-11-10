import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildInvoicePdfDefinition,
  buildInvoiceSheet,
  invoiceExportFileName,
  invoiceExportLabels,
  invoiceSheetName,
  patchBoldRows,
  pdfShowsCompany,
  PDF_FONT,
  PDF_FONT_FILES,
  purchaseToExportDoc,
  saleToExportDoc,
  writeInvoiceXlsxBytes,
} from "../src/lib/export/invoiceExport.ts";
import { mapSaleToInvoicePrint } from "../src/modules/sales/lib/mapSaleToInvoicePrint.ts";
import { translate } from "../src/i18n/translate.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { BRANDING, plainSaleFixture, purchaseFixture, saleFixture } from "./fixtures/invoiceExportFixtures.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const labelsFor = (messages) => invoiceExportLabels((key, params) => translate(messages, key, params));
const en = labelsFor(enMessages);
const az = labelsFor(azMessages);
const ctx = { branding: BRANDING, partyVoen: "9876543210" };

/** The sheet's cells as { "A1": cell } after writing and reading the real .xlsx bytes. */
const readBack = (doc, labels = en) => {
  const book = XLSX.read(writeInvoiceXlsxBytes(XLSX, buildInvoiceSheet(doc, labels)), { type: "array", cellNF: true, cellStyles: true });
  return { book, sheet: book.Sheets[book.SheetNames[0]] };
};
const findRow = (sheet, column, text) => {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r += 1) if (sheet[`${column}${r + 1}`]?.v === text) return r + 1;
  return -1;
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

// ── Excel file ──────────────────────────────────────────────────────────────

test("xlsx: sheet named by the document, numbers are numeric cells with 2 decimals", () => {
  const { book, sheet } = readBack(saleToExportDoc(saleFixture(), ctx));
  assert.deepEqual(book.SheetNames, ["SAT-2026-0042"]);
  const header = findRow(sheet, "B", en.cols.product);
  assert.ok(header > 0, "lines header");
  for (const col of ["A", "E", "F", "G", "H", "I"]) assert.equal(sheet[`${col}${header + 1}`].t, "n", `${col} is a number`);
  assert.equal(sheet[`I${header + 1}`].v, 807.5);
  assert.equal(sheet[`F${header + 1}`].z, "#,##0.00");
  assert.equal(sheet[`E${header + 2}`].v, 120.5);
  assert.ok(sheet["!cols"]?.length >= 9, "column widths");
});

test("xlsx: totals are values under the Total column and match the invoice", () => {
  const sale = saleFixture();
  const { sheet } = readBack(saleToExportDoc(sale, ctx));
  const value = (label) => {
    const r = findRow(sheet, "H", label);
    assert.ok(r > 0, label);
    assert.equal(sheet[`I${r}`].t, "n", `${label} is a number`);
    assert.equal(sheet[`I${r}`].f, undefined, `${label} is a value, not a formula`);
    return sheet[`I${r}`].v;
  };
  assert.equal(value(en.totals.subtotal), 1250);
  assert.equal(value(en.totals.discount), 75);
  assert.equal(value(en.totals.vat), 211.5);
  assert.equal(value(en.totals.extraCosts), 40);
  assert.equal(value(en.totals.grandTotal), sale.total_amount);
  assert.equal(value(en.totals.paid), 1000);
  assert.equal(value(en.totals.remaining), 426.5);
  const lineSum = [807.5, 208.5, 159].reduce((a, b) => a + b, 0);
  assert.equal(Math.round(lineSum * 100) / 100, value(en.totals.subtotal) - value(en.totals.discount)); // lines are net of discount
});

test("xlsx: the date and the rate are numbers; header fields carry the document data", () => {
  const { sheet } = readBack(saleToExportDoc(saleFixture(), ctx));
  const at = (label) => sheet[`B${findRow(sheet, "A", label)}`];
  assert.equal(at(en.date).t, "n");
  assert.equal(at(en.date).z, "yyyy-mm-dd");
  assert.equal(at(en.rate).v, 1.7);
  assert.equal(at(en.currency).v, "USD");
  assert.equal(at(en.party.sale).v, "Gülşən Əliyeva — Şüşə Dünyası");
  assert.equal(at(en.partyVoen).v, "9876543210");
  assert.equal(at(en.statusLabel).v, "Posted");
  assert.equal(at(en.voen).v, "1234567890");
});

test("xlsx: draft and cancelled files carry the mark under the title; posted has none", () => {
  assert.equal(readBack(saleToExportDoc(saleFixture({ status: "cancelled" }), ctx)).sheet.A2.v, "CANCELLED");
  assert.equal(readBack(purchaseToExportDoc(purchaseFixture({ status: "draft" }), ctx), az).sheet.A2.v, "QARALAMA");
  assert.equal(readBack(saleToExportDoc(saleFixture(), ctx)).sheet.A2, undefined);
});

test("xlsx: purchase file has the supplier, the EUR line and a currency column", () => {
  const { sheet } = readBack(purchaseToExportDoc(purchaseFixture(), ctx));
  const header = findRow(sheet, "B", en.cols.product);
  assert.equal(sheet[`J${header}`].v, en.cols.currency);
  assert.equal(sheet[`J${header + 2}`].v, "EUR");
  assert.equal(sheet[`B${findRow(sheet, "A", en.party.purchase)}`].v, "Şəki Ağac Emalı ASC");
});

test("xlsx: bold rows style text cells and keep the number formats of number cells", () => {
  const xml = '<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" s="2"><v>5</v></c></row><row r="4"><c r="A4" t="s"><v>1</v></c></row>';
  const out = patchBoldRows(xml, 7, [3]);
  assert.match(out, /<c r="A3" s="7" t="s">/);
  assert.match(out, /<c r="B3" s="2">/);
  assert.match(out, /<c r="A4" t="s">/);
});

test("xlsx: quantities keep 3 decimals (cut lengths), amounts are rounded to 2", () => {
  const sale = saleFixture({ items: [{ ...saleFixture().items[1], quantity: 2.375, unit_price: 2.005, total: 4.76 }] });
  const { sheet } = readBack(saleToExportDoc(sale, ctx));
  const row = findRow(sheet, "B", en.cols.product) + 1;
  assert.equal(sheet[`E${row}`].v, 2.375);
  assert.equal(sheet[`E${row}`].z, "#,##0.00#");
  assert.equal(sheet[`F${row}`].v, 2.01);
});

test("xlsx: a regular sales invoice leaves out the company block, as its print does", () => {
  const { sheet } = readBack(saleToExportDoc(plainSaleFixture(), ctx));
  assert.equal(findRow(sheet, "A", en.company), -1);
  assert.equal(findRow(sheet, "A", en.voen), -1);
  assert.ok(findRow(sheet, "A", en.party.sale) > 0, "the document fields stay");
  const official = readBack(saleToExportDoc(saleFixture(), ctx)).sheet;
  assert.ok(findRow(official, "A", en.company) > 0);
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
  for (const s of ["1,426.50 USD", "426.50 USD", "40.00 USD", "-75.00 USD", "600.00 USD", "USD · Exchange rate 1.70", "Payments"]) assert.ok(text.includes(s), s);
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
  assert.match(download, /await import\("xlsx"\)/);
  assert.match(download, /import\("pdfmake\/build\/pdfmake"\)/);
  assert.match(download, /fetch\(`\/fonts\/\$\{file\}`\)/);
  assert.doesNotMatch(download, /https?:\/\//, "no CDN");
  const hook = read("src/components/invoices/useInvoiceExport.tsx");
  assert.match(hook, /import\("@\/lib\/export\/invoiceExportDownload"\)/);
  for (const p of ["src/lib/export/invoiceExport.ts", "src/components/invoices/useInvoiceExport.tsx", "src/components/invoices/invoiceExportActions.tsx"]) {
    assert.doesNotMatch(read(p), /from "(xlsx|pdfmake[^"]*)"/, `${p} has no static library import`);
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
