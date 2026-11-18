// Delivery act (Təhvil-təslim aktı): Azerbaijani dates and suffixes, the company name in quotes, which
// template, the official text with and without a contract, blank lines for missing directors, the simple
// form, the table, the mapping from database rows, the printed page and the Word file (a real zip read
// back), the flag and the entry points, the director fields, and the texts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { actFileName, azDate, BLANK, buildDeliveryAct, chooseTemplate, quoteCompany, yearSuffix } from "../src/lib/deliveryAct/act.ts";
import { contractFromRow, mapActSource } from "../src/lib/deliveryAct/source.ts";
import { barcodeFormat } from "../src/lib/deliveryAct/barcodes.ts";
import { actToHtml } from "../src/components/print/deliveryActHtml.ts";
import { BARCODE_WIDTH_EMU, barcodeMedia, COLS, DOCX_MIME, docxParts, documentXml } from "../src/lib/deliveryAct/docx.ts";
import { isDeliveryActEnabled } from "../src/lib/features/deliveryAct.ts";
import { EMPTY_COMPANY_PROFILE, profileFromRow, profileToRow } from "../src/lib/company/profile.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const LINES = [
  { barcode: "698552626564", name: "Diyircəkli gel qələm dəsti DP105", unit: "ədəd", quantity: 12 },
  { barcode: null, name: "Mexaniki karandaş Panter AMP34971, 0.5 mm", unit: "ədəd", quantity: 30 },
  { barcode: null, name: "Boş sətir", unit: "ədəd", quantity: 0 },
  { barcode: null, name: "Qrafit karandaş 2,5", unit: "kq", quantity: 2.5 },
];
const OFFICIAL = {
  sale: { doc_no: "SS-2026-00123", doc_date: "2026-11-03", is_official: true, customer_name: "Baku Book Center" },
  customer: { full_name: "Günel Rzayeva", company_name: "BAKU BOOK CENTER MMC", entity_type: "legal", director_name: "Rzayeva Günel Anar qızı" },
  contract: { contract_number: "15", contract_date: "2026-05-22" },
  company: { legalName: "ACME MMC", directorName: "Kamran Əliyev" },
  lines: LINES,
  actDate: "2026-11-03",
};

// ─── Dates and names ────────────────────────────────────────────────────────

test("year suffixes follow the last spoken word of the year", () => {
  assert.deepEqual([2026, 2021, 2023, 2024, 2025, 2027, 2028, 2029, 2030, 2040, 2020, 2050, 2060, 2090, 2100, 2000].map(yearSuffix), ["cı", "ci", "cü", "cü", "ci", "ci", "ci", "cu", "cu", "cı", "ci", "ci", "cı", "cı", "cü", "ci"]);
});

test("dates read as in the sample: day, month in words, year with its suffix", () => {
  assert.equal(azDate("2026-11-03"), "03 noyabr 2026-cı il");
  assert.equal(azDate("2026-05-22"), "22 may 2026-cı il");
  assert.equal(azDate("2023-01-09T10:00:00Z"), "09 yanvar 2023-cü il");
  assert.equal(azDate(null), BLANK);
  assert.equal(azDate("2026-13-01"), BLANK);
});

test("company names are quoted with the legal form outside the quotes", () => {
  assert.equal(quoteCompany("BAKU BOOK CENTER MMC"), '"BAKU BOOK CENTER" MMC');
  assert.equal(quoteCompany('"ACME" mmc'), '"ACME" mmc');
  assert.equal(quoteCompany("Tikinti ASC"), '"Tikinti" ASC');
  assert.equal(quoteCompany("Konik"), '"Konik"');
  assert.equal(quoteCompany("  "), BLANK);
});

// ─── Which template ─────────────────────────────────────────────────────────

test("official only for an official invoice of a company customer", () => {
  assert.equal(chooseTemplate(OFFICIAL), "official");
  assert.equal(chooseTemplate({ ...OFFICIAL, sale: { ...OFFICIAL.sale, is_official: false } }), "informal");
  assert.equal(chooseTemplate({ ...OFFICIAL, customer: { ...OFFICIAL.customer, entity_type: "physical" } }), "informal");
  assert.equal(chooseTemplate({ ...OFFICIAL, customer: { ...OFFICIAL.customer, company_name: "" } }), "informal");
  assert.equal(chooseTemplate({ ...OFFICIAL, customer: null }), "informal");
});

// ─── The official act ───────────────────────────────────────────────────────

test("official act: the sample's text with the contract, both companies and directors", () => {
  const act = buildDeliveryAct(OFFICIAL);
  assert.equal(act.template, "official");
  assert.equal(act.number, "SS-2026-00123");
  assert.equal(act.contractHeading, "22 may 2026-cı il tarixli № 15 saylı Müqavilənin");
  assert.equal(act.title, "Təhvil-təslim aktı");
  assert.deepEqual([act.city, act.date], ["Bakı şəhəri", "03 noyabr 2026-cı il"]);
  assert.equal(
    act.clauses[0],
    '"ACME" MMC-nin direktoru Kamran Əliyev şəxsində (satıcı) bir tərəfdən, "BAKU BOOK CENTER" MMC, direktoru Rzayeva Günel Anar qızı şəxsində (alıcı) digər tərəfdən bu aktı tərtib edirik ondan ötrü ki, 22 may 2026-cı il tarixli № 15 saylı Müqaviləyə əsasən "ACME" MMC-nin direktoru Kamran Əliyev tərəfindən "BAKU BOOK CENTER" MMC, direktoru Rzayeva Günel Anar qızı şəxsinə aşağıdakı mallar təhvil verilmişdir:'
  );
  // The sample's typos are fixed: goods, not services; the buyer, not the customer; no "tərəfindən tərəfdən".
  assert.match(act.clauses[1], /^Alıcı .*mallarda heç bir qüsur/);
  assert.doesNotMatch(act.clauses.join(" "), /xidmətlərdə|Sifarişçi|tərəfindən tərəfdən/);
  assert.equal(act.clauses[2], "Tərəflərin bir-birinə qarşı qarşılıqlı tələbləri yoxdur. Aktın doğruluğunu imzalarımızla təsdiq edirik.");
  assert.deepEqual(act.seller, { role: "Satıcı", name: '"ACME" MMC', director: "Direktor: Kamran Əliyev" });
  assert.deepEqual(act.buyer, { role: "Alıcı", name: '"BAKU BOOK CENTER" MMC', director: "Direktor: Rzayeva Günel Anar qızı" });
  assert.deepEqual(act.warnings, []);
});

test("the act date can differ from the invoice date", () => {
  assert.equal(buildDeliveryAct({ ...OFFICIAL, actDate: "2026-11-05" }).date, "05 noyabr 2026-cı il");
  assert.equal(buildDeliveryAct({ ...OFFICIAL, actDate: "" }).date, "03 noyabr 2026-cı il", "empty → the invoice date");
});

test("official without a contract: no contract line, and a warning", () => {
  const act = buildDeliveryAct({ ...OFFICIAL, contract: null });
  assert.equal(act.template, "official");
  assert.equal(act.contractHeading, null);
  assert.doesNotMatch(act.clauses[0], /Müqavilə/);
  assert.match(act.clauses[0], /ondan ötrü ki, "ACME" MMC-nin direktoru/);
  assert.deepEqual(act.warnings, ["no_contract"]);
});

test("a missing director prints a blank line to sign by hand, and says so", () => {
  const act = buildDeliveryAct({ ...OFFICIAL, company: { legalName: "ACME MMC", directorName: "" }, customer: { ...OFFICIAL.customer, director_name: null } });
  assert.match(act.clauses[0], new RegExp(`direktoru ${BLANK} şəxsində \\(satıcı\\)`));
  assert.match(act.clauses[0], new RegExp(`direktoru ${BLANK} şəxsində \\(alıcı\\)`));
  assert.equal(act.seller.director, "");
  assert.deepEqual(act.warnings, ["no_seller_director", "no_buyer_director"]);
  const noNumber = buildDeliveryAct({ ...OFFICIAL, contract: { contract_number: null, contract_date: "2026-05-22" } });
  assert.equal(noNumber.contractHeading, `22 may 2026-cı il tarixli № ${BLANK} saylı Müqavilənin`);
});

// ─── The simple act ─────────────────────────────────────────────────────────

test("informal act: the customer's name only, no contract; (satıcı) / (alıcı) in the opening, the signatures 'Təhvil verən' / 'Təhvil alan'", () => {
  const act = buildDeliveryAct({ ...OFFICIAL, sale: { ...OFFICIAL.sale, is_official: false }, customer: { ...OFFICIAL.customer, entity_type: "physical" } });
  assert.equal(act.template, "informal");
  assert.equal(act.contractHeading, null);
  assert.equal(act.clauses[0], 'Bu akt "ACME" MMC (satıcı) ilə Günel Rzayeva (alıcı) arasında tərtib edilir ondan ötrü ki, aşağıdakı mallar təhvil verilmiş və təhvil alınmışdır:');
  // Del (18.11): only the words in brackets at the top say satıcı / alıcı; the rest stays as it was.
  assert.doesNotMatch(act.clauses[0], /(təhvil verən)|(təhvil alan)/);
  assert.match(act.clauses[1], /^Təhvil alan yuxarıda /);
  assert.deepEqual([act.seller.role, act.buyer.role, act.buyer.name, act.buyer.director], ["Təhvil verən", "Təhvil alan", "Günel Rzayeva", ""]);
  assert.deepEqual(act.warnings, [], "no contract or director warnings on the simple form");
  const walkIn = buildDeliveryAct({ ...OFFICIAL, sale: { ...OFFICIAL.sale, is_official: false, customer_name: "Nağd alıcı" }, customer: null });
  assert.equal(walkIn.buyer.name, "Nağd alıcı");
});

test("the table: lines with a quantity, numbered, decimal comma, no prices", () => {
  const act = buildDeliveryAct(OFFICIAL);
  assert.deepEqual(act.rows, [
    { no: 1, barcode: "698552626564", name: "Diyircəkli gel qələm dəsti DP105", unit: "ədəd", quantity: "12" },
    { no: 2, barcode: "", name: "Mexaniki karandaş Panter AMP34971, 0.5 mm", unit: "ədəd", quantity: "30" },
    { no: 3, barcode: "", name: "Qrafit karandaş 2,5", unit: "kq", quantity: "2,5" },
  ]);
  assert.deepEqual(buildDeliveryAct({ ...OFFICIAL, lines: [] }).warnings, ["no_lines"]);
  assert.equal(actFileName(act), "Tehvil-teslim-akti-SS-2026-00123");
});

// ─── From database rows ─────────────────────────────────────────────────────

test("rows → act input: the invoice number, barcodes from the product card, the contract only when linked", () => {
  const src = {
    sale: { doc_no: null, invoice_number: "INV-7", doc_date: "2026-11-03", is_official: true, contract_id: "k1", customer_id: "c1", customer_name: "X" },
    lines: [
      { product_id: "p1", product_name: "Qələm", barcode: null, unit: null, unit_name: "ədəd", quantity: "4" },
      { product_id: "p2", product_name: "Karandaş", barcode: "111", unit: "ədəd", unit_name: null, quantity: 2 },
    ],
    productBarcodes: [{ id: "p1", barcode: "999" }],
    customer: { full_name: "X", company_name: "X MMC", entity_type: "legal" },
    contract: { contract_number: "15", contract_date: "2026-05-22" },
    company: { legalName: "ACME MMC", directorName: "K" },
  };
  const input = mapActSource(src);
  assert.equal(input.sale.doc_no, "INV-7");
  assert.deepEqual(input.lines, [
    { barcode: "999", name: "Qələm", unit: "ədəd", quantity: 4 },
    { barcode: "111", name: "Karandaş", unit: "ədəd", quantity: 2 },
  ]);
  assert.equal(input.customer.director_name, null, "before the migration the column is simply missing");
  assert.equal(mapActSource({ ...src, sale: { ...src.sale, contract_id: null } }).contract, null);
  assert.deepEqual(mapActSource({ ...src, company: null }).company, { legalName: "", directorName: "" });
});

// ─── Print / PDF and Word ───────────────────────────────────────────────────

test("the printed page: A4, the whole act, every value escaped", () => {
  const html = actToHtml(buildDeliveryAct({ ...OFFICIAL, lines: [{ barcode: "<b>", name: "Qələm & <script>alert(1)</script>", unit: "ədəd", quantity: 1 }] }));
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /<h1>Təhvil-təslim aktı № SS-2026-00123<\/h1>/);
  assert.match(html, /22 may 2026-cı il tarixli № 15 saylı Müqavilənin/);
  assert.match(html, /<th>№<\/th><th>Barkod<\/th><th>Malın adı<\/th><th>Vahid<\/th><th>Miqdarı<\/th>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Qələm &amp; &lt;script&gt;/);
  assert.match(html, /<p>2\. Alıcı /);
  assert.match(html, /"Satıcı"[\s\S]*"Alıcı"/);
});

test("the Word file: valid parts, the same text, a real zip that opens", async () => {
  const act = buildDeliveryAct({ ...OFFICIAL, lines: [{ barcode: "1", name: "A & B <c>", unit: "ədəd", quantity: 3 }] });
  const parts = docxParts(act);
  assert.deepEqual(parts.images, {}, "no barcode pictures without drawn barcodes");
  assert.deepEqual(Object.keys(parts.xml).sort(), ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
  const xml = documentXml(act);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?><w:document /);
  assert.match(xml, /Təhvil-təslim aktı № SS-2026-00123/);
  assert.match(xml, /A &amp; B &lt;c&gt;/);
  assert.match(xml, /<w:tblHeader\/>/);
  assert.match(xml, /w:w="11906" w:h="16838"/, "A4");
  assert.equal(DOCX_MIME, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const zip = new JSZip();
  for (const [p, x] of Object.entries(parts.xml)) zip.file(p, x);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const back = await JSZip.loadAsync(bytes);
  assert.equal(await back.file("word/document.xml").async("string"), xml);
  assert.match(read("src/lib/deliveryAct/docx.ts"), /zip\.generateAsync\(\{ type: "blob", mimeType: DOCX_MIME \}\)/);
});

// ─── Flag, entry points, data ───────────────────────────────────────────────

test("DELIVERY_ACT is off unless it is exactly true", () => {
  assert.equal(isDeliveryActEnabled({}), false);
  assert.equal(isDeliveryActEnabled({ DELIVERY_ACT: "1" }), false);
  assert.equal(isDeliveryActEnabled({ DELIVERY_ACT: " TRUE " }), true);
  assert.match(read("src/app/layout.tsx"), /<DeliveryActProvider enabled=\{isDeliveryActEnabled\(\)\}>/);
});

test("the act is offered in both lists' row menus and inside the invoice, only with the flag, never for a cancelled one", () => {
  const screen = read("src/modules/sales/components/SalesScreen.tsx");
  assert.match(screen, /key: DELIVERY_ACT_ACTION_KEY, label: t\("deliveryAct\.action"\), icon: icon\(FileSignature\), hidden: !deliveryActOn \|\| status === "cancelled"/);
  const form = read("src/modules/sales/components/SaleFormScreen.tsx");
  assert.match(form, /deliveryActOn && record\.doc_status !== "cancelled" \? \[\{ key: DELIVERY_ACT_ACTION_KEY/);
  assert.match(read("src/components/deliveryAct/deliveryActAction.ts"), /DELIVERY_ACT_ACTION_KEY = "delivery_act"/);
  const classic = read("src/modules/sales/components/SalesPage.tsx");
  assert.match(classic, /onDeliveryAct=\{deliveryActOn && sale\.status !== "cancelled" \? \(\) => setActSaleId\(sale\.id\) : undefined\}/);
  assert.match(read("src/components/documents/DocumentListActions.tsx"), /if \(onDeliveryAct\) \{/);
  assert.match(read("src/modules/sales/components/SaleDetailPage.tsx"), /<DeliveryActButton saleId=\{sale\.id\}/);
  assert.match(read("src/modules/sales/components/InvoiceForm.tsx"), /<DeliveryActButton saleId=\{savedSaleId\} size="sm" \/>/);
  const button = read("src/components/deliveryAct/DeliveryActButton.tsx");
  assert.match(button, /if \(!on \|\| !saleId\) return null;/);
  assert.match(button, /variant="secondary"/, "the screen keeps its one primary action");
});

test("the data is read with the user's session, after the flag and the sales permission; nothing is written", () => {
  const action = read("src/lib/actions/deliveryAct.ts");
  assert.match(action, /if \(!isDeliveryActEnabled\(\)\) return/);
  assert.match(action, /requirePermissionAction\("can_view_sales"\)/);
  assert.match(action, /createSupabaseServerClient\(\)/);
  assert.doesNotMatch(action, /createSupabaseAdminClient|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test("the directors: on the company profile and the customer card, saved even before the migration runs", () => {
  const full = { ...EMPTY_COMPANY_PROFILE, legalName: "ACME MMC", directorName: "Kamran Əliyev" };
  assert.equal(profileToRow(full).director_name, "Kamran Əliyev");
  assert.deepEqual(profileFromRow(profileToRow(full)), full);
  assert.equal(profileFromRow({ director_name: "  " + "x".repeat(200) }).directorName.length, 120);
  assert.match(read("src/lib/actions/companyProfile.ts"), /if \(error && \/director_name\/\.test/);
  const customers = read("src/app/customers/page.client.tsx");
  assert.match(customers, /director_name: entityType === "legal" \? formData\.director_name\.trim\(\) \|\| null : null,/);
  assert.match(customers, /if \(error && \/director_name\/\.test\(error\.message\)\)/);
  assert.match(read("src/components/settings/v2/CompanyProfileV2.tsx"), /settings\.directorName/);
  const sql = read("supabase/migrations/20261121150000_delivery_act_directors.sql");
  assert.match(sql, /ALTER TABLE public\.customers ADD COLUMN IF NOT EXISTS director_name TEXT;/);
  assert.match(sql, /ALTER TABLE public\.company_profile ADD COLUMN IF NOT EXISTS director_name TEXT;/);
});

test("texts in az / en / ru", () => {
  const keys = ["action", "title", "templateOfficial", "templateInformal", "actDate", "actDateHint", "warningsLabel", "preview", "print", "word", "close"];
  for (const k of keys) {
    assert.ok(azMessages.deliveryAct[k] && enMessages.deliveryAct[k], k);
    assert.match(ruMessages.deliveryAct[k], /[А-Яа-яЁё]/, k);
  }
  for (const w of ["no_contract", "no_seller_director", "no_buyer_director", "no_lines"]) assert.ok(azMessages.deliveryAct.warnings[w] && enMessages.deliveryAct.warnings[w] && ruMessages.deliveryAct.warnings[w], w);
  for (const e of ["off", "notFound", "forbidden", "loadFailed", "wordFailed"]) assert.ok(azMessages.deliveryAct.errors[e] && enMessages.deliveryAct.errors[e] && ruMessages.deliveryAct.errors[e], e);
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.settings.directorName && m.settings.directorNameHint && m.customers.directorName);
  }
  assert.equal(azMessages.deliveryAct.action, "Təhvil-təslim aktı");
});

// ─── Follow-up (Del, 18.11): the contract's date, and real barcodes ─────────

test("the contract's own date is printed; a contract saved without one uses the day it was entered", () => {
  // A real contracts row as the screen saves it.
  const row = { id: "k1", contract_number: "123", party_name: "BAKU BOOK CENTER MMC", contract_date: "2026-05-22", expiry_date: null, created_at: "2026-05-23T09:12:00+00:00", status: "active" };
  const src = {
    sale: { doc_no: "SS-2026-00123", invoice_number: null, doc_date: "2026-11-03", is_official: true, contract_id: "k1", customer_id: "c1", customer_name: "X" },
    lines: [{ product_id: "p1", product_name: "Qələm", barcode: null, unit: "ədəd", unit_name: null, quantity: 1 }],
    productBarcodes: [],
    customer: { full_name: "X", company_name: "BAKU BOOK CENTER MMC", entity_type: "legal", director_name: "Rzayeva Günel Anar qızı" },
    contract: contractFromRow(row),
    company: { legalName: "ACME MMC", directorName: "Kamran Əliyev" },
  };
  const act = buildDeliveryAct({ ...mapActSource(src), actDate: "2026-11-03" });
  assert.equal(act.contractHeading, "22 may 2026-cı il tarixli № 123 saylı Müqavilənin");
  assert.match(act.clauses[0], /ondan ötrü ki, 22 may 2026-cı il tarixli № 123 saylı Müqaviləyə əsasən "ACME" MMC-nin/);
  // An older contract without its own date.
  const old = buildDeliveryAct({ ...mapActSource({ ...src, contract: contractFromRow({ ...row, contract_date: null }) }), actDate: "2026-11-03" });
  assert.equal(old.contractHeading, "23 may 2026-cı il tarixli № 123 saylı Müqavilənin");
  // Another install's column names.
  assert.deepEqual(contractFromRow({ number: "7", date: "2025-02-01" }), { contract_number: "7", contract_date: "2025-02-01", created_at: null });
  assert.match(read("src/lib/actions/deliveryAct.ts"), /from\("contracts"\)\.select\("\*"\)/);
});

test("barcode type: Code 128 for every barcode, plain black on white, number under the bars", () => {
  for (const v of ["4006381333931", "698552626564", "ABC-123", "1"]) assert.equal(barcodeFormat(v), "CODE128", v);
  const src = read("src/lib/deliveryAct/barcodes.ts");
  assert.doesNotMatch(src, /"EAN13"/, "one type on every row (Del, 18.11)");
  assert.match(src, /import\("jsbarcode"\)/, "the library the product card uses; nothing over the network");
  assert.match(src, /displayValue: true/, "the number under the bars");
  assert.match(src, /background: "#ffffff", lineColor: "#000000"/);
  assert.match(src, /margin: 10,/, "a clean quiet zone around the bars");
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

test("the printed page shows the barcode picture; rows without one stay empty", () => {
  const act = buildDeliveryAct({ ...OFFICIAL, lines: [{ barcode: "4006381333931", name: "A", unit: "ədəd", quantity: 1 }, { barcode: null, name: "B", unit: "ədəd", quantity: 2 }, { barcode: "X-1", name: "C", unit: "ədəd", quantity: 3 }] });
  const html = actToHtml(act, { "4006381333931": { png: PNG, width: 220, height: 90 } });
  assert.match(html, /<td class="b"><img src="data:image\/png;base64,iVBOR[^"]*" alt="4006381333931" \/><\/td>/);
  assert.match(html, /<td class="b"><\/td><td class="name">B<\/td>/, "no barcode: empty cell");
  assert.match(html, /<td class="b">X-1<\/td>/, "not drawn: the number as text");
});

test("the barcode column is narrow (32 mm) and the product name gets the room, on paper and in Word", () => {
  const html = actToHtml(buildDeliveryAct(OFFICIAL), {});
  assert.match(html, /table-layout: fixed/);
  assert.match(html, /col\.c-b \{ width: 32mm; \}/);
  assert.match(html, /td\.b img \{ display: block; margin: 0 auto; width: 28mm; max-width: 100%; height: auto; \}/);
  assert.match(html, /<colgroup><col class="c-n" \/><col class="c-b" \/><col \/><col class="c-u" \/><col class="c-q" \/><\/colgroup>/, "the name column takes the rest");
  // Word: the same widths in the table grid, adding up to the A4 text width; the picture fits its cell.
  assert.deepEqual(COLS, [510, 1814, 5194, 960, 1160]);
  assert.equal(COLS.reduce((a, b) => a + b, 0), 9638);
  assert.equal(BARCODE_WIDTH_EMU, 28 * 36_000);
  assert.ok(BARCODE_WIDTH_EMU / 36_000 < (COLS[1] - 160) / 56.7, "picture narrower than the cell minus its margins");
  assert.ok(COLS[2] > COLS[1] * 2.5, "the name column is the widest by far");
});

test("the Word file carries the same pictures: one per distinct barcode, linked and sized", async () => {
  const act = buildDeliveryAct({ ...OFFICIAL, lines: [{ barcode: "4006381333931", name: "A", unit: "ədəd", quantity: 1 }, { barcode: "4006381333931", name: "A2", unit: "ədəd", quantity: 1 }, { barcode: null, name: "B", unit: "ədəd", quantity: 2 }] });
  const barcodes = { "4006381333931": { png: PNG, width: 220, height: 90 } };
  const media = barcodeMedia(act, barcodes);
  assert.equal(media.length, 1);
  assert.deepEqual([media[0].rId, media[0].path, media[0].cx, media[0].cy], ["rIdBc1", "media/barcode1.png", BARCODE_WIDTH_EMU, Math.round((BARCODE_WIDTH_EMU * 90) / 220)]);
  const parts = docxParts(act, barcodes);
  assert.deepEqual(parts.images, { "word/media/barcode1.png": PNG });
  assert.match(parts.xml["[Content_Types].xml"], /<Default Extension="png" ContentType="image\/png"\/>/);
  assert.match(parts.xml["word/_rels/document.xml.rels"], /Id="rIdBc1" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image" Target="media\/barcode1\.png"/);
  const xml = parts.xml["word/document.xml"];
  assert.equal((xml.match(/<a:blip r:embed="rIdBc1"\/>/g) ?? []).length, 2, "both rows show it");
  assert.deepEqual([...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]), ["1", "2"], "unique drawing ids");
  assert.match(xml, /xmlns:wp="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/wordprocessingDrawing"/);
  // A real zip with the picture, read back.
  const zip = new JSZip();
  for (const [p, x] of Object.entries(parts.xml)) zip.file(p, x);
  for (const [p, b] of Object.entries(parts.images)) zip.file(p, b, { base64: true });
  const back = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
  const png = await back.file("word/media/barcode1.png").async("uint8array");
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG signature");
});

test("the dialog draws the barcodes once and waits for them before Print and Word", () => {
  const dialog = read("src/components/deliveryAct/DeliveryActDialog.tsx");
  assert.match(dialog, /queryFn: \(\) => drawBarcodes\(barcodeValues\)/);
  assert.match(dialog, /actToHtml\(act, barcodes\)/);
  assert.match(dialog, /buildDocx\(act, barcodes\)/);
  assert.match(dialog, /disabled=\{!act \|\| drawn\.isFetching\}/);
});
