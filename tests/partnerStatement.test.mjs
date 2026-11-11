// LED-3: partner statement ("Hesab çıxarışı") on the LED-1 ledger, behind PARTNER_LEDGERS.
// The SQL side is tested in supabase/tests/partner_statement_details.sql.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildStatementSheet,
  currencySubtotals,
  hasForeignCurrency,
  lastTwelveMonths,
  mapPartnerStatement,
  parseStatementQuery,
  partnerStatementHref,
  partnerTypeWhere,
  presetOf,
  presetRange,
  runningBalances,
  showSideSwitch,
  sourceGroup,
  statementDocHref,
  statementFileName,
  statementQueryString,
  statementStatus,
  statementToReconciliation,
  visibleSubtotals,
} from "../src/lib/reports/partnerStatement.ts";
import { isPartnerLedgersEnabled, partnerLedgersActive, partnerLedgersAudience } from "../src/lib/features/partnerLedgers.ts";
import { extraItemsFor, SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { writeSheetBytes } from "../src/lib/export/exportXlsx.ts";
import { patchBoldRows } from "../src/lib/export/invoiceExport.ts";
import { translate } from "../src/i18n/translate.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r/g, "");

/** What get_partner_statement returns (LED-1 + 20261113100000), for a customer and supplier. */
const payload = {
  partner: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "ACME",
    full_name: "Acme MMC",
    company_name: null,
    voen: "1234567891",
    is_customer: true,
    is_supplier: true,
    is_deleted: false,
    payment_terms_days: 30,
    phone: "+994 50 000 00 00",
    email: null,
    address: "Bakı",
    credit_limit: "500",
  },
  from: "2026-10-01",
  to: "2026-10-31",
  side: "net",
  opening_balance: 100.1,
  lines: [
    { entry_date: "2026-10-02", source_type: "sale", source_id: "s1", doc_no: "SS-1", description: "Satış", debit: 50.2, credit: 0, currency_code: "AZN", amount_fc: 50.2, rate: 1, side: "receivable", balance: 150.3, doc_kind: "sale", doc_id: "aaaaaaaa-0000-4000-8000-000000000001", created_by_name: "Lalə" },
    { entry_date: "2026-10-03", source_type: "sale_payment", source_id: "t1", doc_no: "SS-1", description: "Ödəniş", debit: 0, credit: 30.1, currency_code: "AZN", amount_fc: 30.1, rate: 1, side: "receivable", balance: 120.2, doc_kind: "sale", doc_id: "aaaaaaaa-0000-4000-8000-000000000001", created_by_name: null },
    { entry_date: "2026-10-04", source_type: "import_payable", source_id: "j1", doc_no: "IMP-1", description: "İdxal", debit: 0, credit: 170, currency_code: "USD", amount_fc: 100, rate: 1.7, side: "payable", balance: -49.8, doc_kind: "import", doc_id: "bbbbbbbb-0000-4000-8000-000000000002", created_by_name: "Nərmin" },
    { entry_date: "2026-10-05", source_type: "partner_payment", source_id: "p1", doc_no: null, description: "Ödəniş edildi", debit: 20, credit: 0, currency_code: "AZN", amount_fc: 20, rate: 1, side: "payable", balance: -29.8, doc_kind: null, doc_id: null, created_by_name: "Lalə" },
  ],
  period_debit: 70.2,
  period_credit: 200.1,
  closing_balance: -29.8,
  currencies: [
    { currency_code: "AZN", debit: 70.2, credit: 30.1, net_fc: 40.1 },
    { currency_code: "USD", debit: 0, credit: 170, net_fc: -100 },
  ],
};

test("the mapper reads the RPC and recomputes the running balance in cents", () => {
  const s = mapPartnerStatement(payload);
  assert.equal(s.partner.name, "Acme MMC");
  assert.equal(s.partner.creditLimit, 500);
  assert.equal(s.partner.paymentTermsDays, 30);
  assert.equal(s.partner.phone, "+994 50 000 00 00");
  assert.equal(s.openingBalance, 100.1);
  assert.deepEqual(s.lines.map((l) => l.balance), [150.3, 120.2, -49.8, -29.8]);
  assert.equal(s.lines[1].createdByName, "");
  assert.equal(s.lines[0].docKind, "sale");
  assert.equal(s.lines[3].docKind, null);
  assert.equal(s.closingBalance, -29.8);
  // The last running balance is the closing balance.
  assert.equal(s.lines.at(-1).balance, s.closingBalance);
  // An empty payload does not throw.
  const empty = mapPartnerStatement(null);
  assert.equal(empty.lines.length, 0);
  assert.equal(empty.closingBalance, 0);
  assert.equal(empty.side, "net");
});

test("running balance: no float noise, starts from the opening balance", () => {
  assert.deepEqual(runningBalances(0.1, [{ debit: 0.2, credit: 0 }, { debit: 0, credit: 0.3 }]), [0.3, 0]);
  assert.deepEqual(runningBalances(0, []), []);
  assert.deepEqual(runningBalances(-10, [{ debit: 2.5, credit: 0 }, { debit: 0, credit: 0.01 }]), [-7.5, -7.51]);
});

test("status badge: debtor, creditor, settled (half-cent tolerance)", () => {
  assert.equal(statementStatus(0.01), "debtor");
  assert.equal(statementStatus(-0.01), "creditor");
  assert.equal(statementStatus(0.004), "settled");
  assert.equal(statementStatus(-0.004), "settled");
});

test("per-currency subtotals: only with more than one currency, same rule as the RPC", () => {
  const s = mapPartnerStatement(payload);
  assert.equal(hasForeignCurrency(s.lines), true);
  assert.equal(visibleSubtotals(s).length, 2);
  assert.deepEqual(currencySubtotals(s.lines), [
    { currencyCode: "AZN", debit: 70.2, credit: 30.1, netFc: 40.1 },
    { currencyCode: "USD", debit: 0, credit: 170, netFc: -100 },
  ]);
  const azn = mapPartnerStatement({ ...payload, lines: payload.lines.slice(0, 2), currencies: [payload.currencies[0]] });
  assert.equal(hasForeignCurrency(azn.lines), false);
  assert.deepEqual(visibleSubtotals(azn), []);
});

test("the side switch shows only for a partner who is both customer and supplier", () => {
  assert.equal(showSideSwitch({ isCustomer: true, isSupplier: true }), true);
  assert.equal(showSideSwitch({ isCustomer: true, isSupplier: false }), false);
  assert.equal(showSideSwitch({ isCustomer: false, isSupplier: true }), false);
});

test("date presets and the last twelve months", () => {
  assert.deepEqual(presetRange("thisMonth", "2026-11-11"), { from: "2026-11-01", to: "2026-11-11" });
  assert.deepEqual(presetRange("lastMonth", "2026-11-11"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(presetRange("lastMonth", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(presetRange("lastMonth", "2024-03-31"), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(presetRange("thisYear", "2026-11-11"), { from: "2026-01-01", to: "2026-11-11" });
  assert.deepEqual(presetRange("allTime", "2026-11-11"), { from: null, to: "2026-11-11" });
  assert.equal(presetOf("2026-10-01", "2026-10-31", "2026-11-11"), "lastMonth");
  assert.equal(presetOf(null, "2026-11-11", "2026-11-11"), "allTime");
  assert.equal(presetOf("2026-10-02", "2026-10-31", "2026-11-11"), null);
  assert.deepEqual(lastTwelveMonths("2026-11-11"), { from: "2025-11-12", to: "2026-11-11" });
});

test("URL state: parse, defaults, bad values, round trip", () => {
  const get = (o) => ({ get: (k) => (k in o ? o[k] : null) });
  const today = "2026-11-11";
  assert.deepEqual(parseStatementQuery(get({}), today), { partnerId: "", from: "2026-11-01", to: "2026-11-11", side: "net", type: "all" });
  const id = "11111111-1111-4111-8111-111111111111";
  const q = parseStatementQuery(get({ partnerId: id, from: "all", to: "2026-10-31", side: "payable", type: "supplier" }), today);
  assert.deepEqual(q, { partnerId: id, from: null, to: "2026-10-31", side: "payable", type: "supplier" });
  assert.deepEqual(parseStatementQuery(new URLSearchParams(statementQueryString(q)), today), q);
  // Junk falls back.
  const junk = parseStatementQuery(get({ partnerId: "x'; drop", from: "yesterday", to: "soon", side: "both", type: "vip" }), today);
  assert.deepEqual(junk, { partnerId: "", from: "2026-11-01", to: "2026-11-11", side: "net", type: "all" });
  // A start after the end is reset to the default start.
  assert.equal(parseStatementQuery(get({ from: "2026-12-01", to: "2026-11-01" }), today).from, "2026-11-01");
  assert.equal(partnerStatementHref(id), `/dashboard/reports/partner-statement?partnerId=${id}`);
});

test("partner type filter of the lookup", () => {
  assert.equal(partnerTypeWhere("all"), undefined);
  assert.deepEqual(partnerTypeWhere("customer"), { is_customer: true });
  assert.deepEqual(partnerTypeWhere("supplier"), { is_supplier: true });
  assert.deepEqual(partnerTypeWhere("partner"), { is_customer: true, is_supplier: true });
});

test("document links and document types", () => {
  assert.equal(statementDocHref({ docKind: "sale", docId: "a" }), "/sales/a");
  assert.equal(statementDocHref({ docKind: "purchase", docId: "b" }), "/purchases?record=b");
  assert.equal(statementDocHref({ docKind: "production", docId: "c" }), "/production/c");
  assert.equal(statementDocHref({ docKind: "import", docId: "d" }), "/imports/d");
  assert.equal(statementDocHref({ docKind: null, docId: null }), null);
  assert.equal(statementDocHref({ docKind: "sale", docId: null }), null);
  const groups = Object.fromEntries(
    ["sale", "purchase", "sale_payment", "purchase_payment", "production_payment", "partner_payment", "sale_payment_reversal", "opening_customer", "opening_supplier", "import_payable", "import_payment", "import_prepayment", "import_cost_advance", "import_payment_reversal", "something"].map((s) => [s, sourceGroup(s)])
  );
  assert.deepEqual(groups, {
    sale: "sale",
    purchase: "purchase",
    sale_payment: "payment",
    purchase_payment: "payment",
    production_payment: "payment",
    partner_payment: "payment",
    sale_payment_reversal: "reversal",
    opening_customer: "opening",
    opening_supplier: "opening",
    import_payable: "import",
    import_payment: "importPayment",
    import_prepayment: "importPayment",
    import_cost_advance: "importPayment",
    import_payment_reversal: "reversal",
    something: "other",
  });
});

test("file name: statement-<partner>-<from>-<to>", () => {
  assert.equal(statementFileName("Əli Şirkəti MMC", "2026-10-01", "2026-10-31", "xlsx"), "statement-eli-sirketi-mmc-2026-10-01-2026-10-31.xlsx");
  assert.equal(statementFileName("", null, "2026-10-31", "pdf"), "statement-partner-all-2026-10-31.pdf");
  assert.equal(statementFileName("Ozon / ООО «Тест»", "2026-01-01", "2026-01-31", "xlsx"), "statement-ozon-2026-01-01-2026-01-31.xlsx");
});

test("reconciliation act from the ledger: same layout, ledger numbers", () => {
  const s = mapPartnerStatement(payload);
  const act = statementToReconciliation(s, "2026-10-01", "2026-10-31");
  assert.equal(act.initialBalance, 100.1);
  assert.equal(act.closingBalance, -29.8);
  assert.deepEqual(
    act.lines.map((l) => [l.documentType, l.ourDebit, l.ourCredit, l.runningBalance]),
    [
      ["invoice", 50.2, 0, 150.3],
      ["payment_receipt", 0, 30.1, 120.2],
      ["statement:import", 0, 170, -49.8],
      ["payment_disbursement", 20, 0, -29.8],
    ]
  );
  assert.equal(act.lines[3].documentNo, "—");
});

const labels = {
  title: "Hesab çıxarışı", partner: "Tərəfdaş", voen: "VÖEN", phone: "Telefon", creditLimit: "Kredit limiti", paymentTerms: "Ödəniş müddəti (gün)",
  period: "Dövr", allTime: "Əvvəldən", side: "Hesab", sideName: "Hamısı", company: "Şirkət", companyName: "Del Groups", opening: "Açılış qalığı",
  closing: "Bağlanış qalığı", status: "Vəziyyət", statusName: "Kreditor", totals: "Cəmi", subtotals: "Valyutalar üzrə",
  cols: { date: "Tarix", type: "Növ", docNo: "Sənəd №", description: "Təsvir", debit: "Debet", credit: "Kredit", balance: "Qalıq", currency: "Valyuta", amountFc: "Valyuta ilə", createdBy: "Yaradan" },
  typeName: (s) => s,
};

test("Excel sheet: header block, numbers as numbers, opening first, totals last, subtotals", () => {
  const s = mapPartnerStatement(payload);
  const sheet = buildStatementSheet(s, labels);
  const texts = sheet.rows.map((r) => r.map((c) => (c.t === "z" ? "" : c.v)));
  assert.equal(texts[0][0], "Hesab çıxarışı");
  assert.ok(texts.some((r) => r[0] === "Tərəfdaş" && r[1] === "Acme MMC"));
  assert.ok(texts.some((r) => r[0] === "Dövr" && r[1] === "2026-10-01 — 2026-10-31"));
  const head = texts.findIndex((r) => r[0] === "Tarix");
  assert.deepEqual(texts[head], ["Tarix", "Növ", "Sənəd №", "Təsvir", "Debet", "Kredit", "Qalıq", "Valyuta", "Valyuta ilə", "Yaradan"]);
  assert.equal(texts[head + 1][1], "Açılış qalığı");
  assert.equal(texts[head + 1][6], 100.1);
  const first = sheet.rows[head + 2];
  assert.equal(first[4].t, "n");
  assert.equal(first[4].v, 50.2);
  assert.equal(first[0].t, "n", "dates are Excel dates");
  const totals = texts[head + 2 + s.lines.length];
  assert.deepEqual([totals[1], totals[4], totals[5], totals[6]], ["Cəmi", 70.2, 200.1, -29.8]);
  assert.ok(texts.some((r) => r[0] === "USD" && r[6] === -100));
  assert.ok(sheet.boldRows.includes(0) && sheet.boldRows.includes(head));
  // AZN only: no currency columns.
  const azn = buildStatementSheet(mapPartnerStatement({ ...payload, lines: payload.lines.slice(0, 2), currencies: [] }), labels);
  assert.ok(azn.rows.some((r) => r.map((c) => c.v).join("|") === "Tarix|Növ|Sənəd №|Təsvir|Debet|Kredit|Qalıq|Yaradan"));
});

test("Excel file: a real .xlsx that reads back with the same numbers", () => {
  const XLSX = require("xlsx");
  const s = mapPartnerStatement(payload);
  const sheet = buildStatementSheet(s, labels);
  const bold = sheet.boldRows.map((r) => r + 1);
  const bytes = writeSheetBytes(XLSX, { name: sheet.name, rows: sheet.rows, widths: sheet.widths }, (xml, style) => patchBoldRows(xml, style, bold));
  const book = XLSX.read(bytes, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });
  const totals = rows.find((r) => r[1] === "Cəmi");
  assert.deepEqual([totals[4], totals[5], totals[6]], [70.2, 200.1, -29.8]);
});

test("flag: off unless \"true\"; audience admins by default; financial reports always required", () => {
  assert.equal(isPartnerLedgersEnabled({}), false);
  assert.equal(isPartnerLedgersEnabled({ PARTNER_LEDGERS: "TRUE " }), true);
  assert.equal(isPartnerLedgersEnabled({ PARTNER_LEDGERS: "1" }), false);
  assert.equal(partnerLedgersAudience({}), "admins");
  assert.equal(partnerLedgersAudience({ PARTNER_LEDGERS_AUDIENCE: "All" }), "all");
  assert.equal(partnerLedgersAudience({ PARTNER_LEDGERS_AUDIENCE: "everyone" }), "admins");
  const on = (o) => partnerLedgersActive({ enabled: true, audience: "admins", isAdmin: false, canViewFinancialReports: true, ...o });
  assert.equal(on({ isAdmin: true }), true);
  assert.equal(on({}), false);
  assert.equal(on({ audience: "all" }), true);
  assert.equal(on({ audience: "all", canViewFinancialReports: false }), false);
  assert.equal(on({ isAdmin: true, canViewFinancialReports: false }), false);
  assert.equal(on({ enabled: false, isAdmin: true, audience: "all" }), false);
});

test("menu item only with the flag, under the financial reports", () => {
  const paths = (partnerLedgers) => extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: false, partnerLedgers }).map((e) => e.path);
  assert.ok(paths(true).includes("/dashboard/reports/partner-statement"));
  assert.ok(!paths(false).includes("/dashboard/reports/partner-statement"));
  assert.match(read("src/lib/shell/appMenu.ts"), /"\/dashboard\/reports\/reconciliation", "\/dashboard\/reports\/partner-statement"/);
  assert.match(read("src/modules/accounting/manifest.ts"), /prefix: "\/dashboard\/reports\/partner-statement", permission: "can_view_financial_reports"/);
  assert.match(read("src/lib/navigation/breadcrumbs.ts"), /"\/dashboard\/reports\/partner-statement": "nav.items.partnerStatement"/);
});

test("flag off changes nothing: guarded page, action, act source, partner tab, lists", () => {
  const page = read("src/app/dashboard/reports/partner-statement/page.tsx");
  assert.match(page, /if \(!\(await partnerLedgersActiveForRequest\(\)\)\) notFound\(\);/);
  const access = read("src/lib/features/partnerLedgersServer.ts");
  assert.match(access, /if \(!isPartnerLedgersEnabled\(\)\) throw new ActionAuthError/);
  assert.match(access, /requirePermissionAction\("can_view_financial_reports"\)/);
  const actions = read("src/modules/accounting/actions/partnerStatement.ts");
  assert.equal((actions.match(/await requirePartnerLedgers\(\);/g) ?? []).length, 2, "every action checks the flag");
  const act = read("src/lib/actions/accountingReports.ts");
  assert.match(act, /if \(await partnerLedgersActiveForRequest\(\)\) \{[\s\S]*get_partner_statement[\s\S]*\}\s*\n\s*const admin = await createSupabaseAdminClient\(\);\s*\n\s*const \{ data, error \} = await admin\.rpc\("get_partner_reconciliation_act"/);
  const partner = read("src/app/dashboard/partners/[id]/page.client.tsx");
  assert.match(partner, /partnerLedgers && tab === "ledger" \? \(\s*<PartnerStatementPanel/);
  for (const p of ["src/app/customers/page.client.tsx", "src/app/suppliers/page.client.tsx"]) {
    const src = read(p);
    assert.match(src, /\.\.\.\(partnerLedgers\s*\?/);
    assert.match(src, /const showRowActions = canManage\w+ \|\| partnerLedgers;/);
  }
});

test("every string in az, en and ru", () => {
  const keys = (o, prefix = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
  const az = keys(azMessages.partnerStatement).sort();
  assert.deepEqual(keys(enMessages.partnerStatement).sort(), az);
  assert.deepEqual(keys(ruMessages.partnerStatement).sort(), az);
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.nav.items.partnerStatement);
    for (const k of az) assert.notEqual(translate(m, `partnerStatement.${k}`), `partnerStatement.${k}`, k);
  }
  // Every key the code uses exists.
  const code = ["src/modules/accounting/components/partnerStatement/PartnerStatementView.tsx", "src/modules/accounting/components/partnerStatement/PartnerStatementPage.tsx", "src/modules/accounting/components/partnerStatement/PartnerStatementPanel.tsx", "src/modules/accounting/components/partnerStatement/StatementPrintLayout.tsx", "src/modules/accounting/components/partnerStatement/statementExport.ts", "src/modules/accounting/actions/partnerStatement.ts", "src/lib/features/partnerLedgersServer.ts"]
    .map(read)
    .join("\n");
  for (const [, k] of code.matchAll(/"partnerStatement\.([a-zA-Z.]+)"/g)) assert.ok(az.includes(k), `missing key partnerStatement.${k}`);
  for (const group of ["source", "status", "sides", "types", "presets"]) {
    assert.ok(az.some((k) => k.startsWith(`${group}.`)), group);
  }
  assert.equal(translate(azMessages, "partnerStatement.paymentTermsDays", { days: 30 }), "30 gün");
});

test("print layout and statement files follow the UI rulebook guards", () => {
  const view = read("src/modules/accounting/components/partnerStatement/PartnerStatementView.tsx");
  assert.doesNotMatch(view, /<table\b|<h1\b|uppercase|text-\[(9|10|11)px\]/);
  const pageSrc = read("src/modules/accounting/components/partnerStatement/PartnerStatementPage.tsx");
  assert.doesNotMatch(pageSrc, /<select\b|type="date"|<h1\b|btn-primary/);
  // Only the print area prints.
  assert.match(read("src/modules/accounting/components/partnerStatement/StatementPrintLayout.tsx"), /className="print-area hidden/);
});
