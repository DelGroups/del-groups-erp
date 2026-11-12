// INV-2: writes sample invoice files from test data (no database, no app) with the same pure
// functions the browser uses, into docs/screenshots/invoice-export/.
//   node --import ./scripts/node-ts/register.mjs scripts/invoice-export-samples.mjs [az|en|ru]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildInvoicePdfDefinition,
  invoiceExportFileName,
  invoiceExportLabels,
  PDF_FONT,
  PDF_FONT_FILES,
  purchaseToExportDoc,
  saleToExportDoc,
} from "../src/lib/export/invoiceExport.ts";
import { buildInvoiceLayout } from "../src/lib/export/invoiceLayout.ts";
import { writeInvoiceXlsx } from "../src/lib/export/invoiceXlsx.ts";
import { translate } from "../src/i18n/translate.ts";
import { getMessages } from "../src/i18n/messages/index.ts";
import { BRANDING, purchaseFixture, saleFixture } from "../tests/fixtures/invoiceExportFixtures.mjs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const pdfmake = require("pdfmake");

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "docs/screenshots/invoice-export");
const fonts = join(root, "public/fonts");
const locale = process.argv[2] ?? "az";
const intl = { az: "az-AZ", en: "en-GB", ru: "ru-RU" }[locale] ?? "az-AZ";
const messages = getMessages(locale);
const labels = invoiceExportLabels((key, params) => translate(messages, key, params));

pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => path.startsWith(fonts));
pdfmake.setFonts({ [PDF_FONT]: { normal: join(fonts, PDF_FONT_FILES.normal), bold: join(fonts, PDF_FONT_FILES.bold) } });

mkdirSync(out, { recursive: true });
const docs = [
  saleToExportDoc(saleFixture(), { branding: BRANDING, partyVoen: "9876543210" }),
  purchaseToExportDoc(purchaseFixture({ status: "draft" }), { branding: BRANDING, partyVoen: "1122334455" }),
];
for (const doc of docs) {
  const xlsxName = invoiceExportFileName(doc, "xlsx");
  // Excel asks no layout question (a regular sales invoice leaves out the company).
  writeFileSync(join(out, xlsxName), await writeInvoiceXlsx(ExcelJS, buildInvoiceLayout(doc, labels, { mode: "unofficial", locale: intl })));
  const pdfName = invoiceExportFileName(doc, "pdf");
  const pdf = await pdfmake.createPdf(buildInvoicePdfDefinition(doc, labels, { mode: "official", locale: intl })).getBuffer();
  writeFileSync(join(out, pdfName), pdf);
  console.log("wrote", xlsxName, pdfName);
}
