// LED-4: debtor / creditor reports and turnover per partner, behind PARTNER_LEDGERS.
// The SQL side (open items, filters, paging, turnover = statement) is tested in
// supabase/tests/partner_debtor_reports.sql.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  barWidths,
  buildReportSheet,
  debtorFileName,
  debtorQueryString,
  defaultDebtorQuery,
  dpo,
  dso,
  filtersJson,
  mapBalanceReport,
  mapTurnoverReport,
  nextSort,
  overCreditLimit,
  overduePct,
  pageCount,
  parseDebtorQuery,
  patchQuery,
} from "../src/lib/reports/debtorReport.ts";
import { extraItemsFor, SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { writeSheetBytes } from "../src/lib/export/exportXlsx.ts";
import { patchBoldRows } from "../src/lib/export/invoiceExport.ts";
import { translate } from "../src/i18n/translate.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r/g, "");
const TODAY = "2026-11-11";

const balancePayload = {
  as_of: "2026-11-10",
  tab: "debtors",
  total_count: 2,
  rows: [
    { partner_id: "p1", partner_name: "LED4 L1", phone: "+994 50 444 00 01", voen: null, is_customer: true, is_supplier: false, is_deleted: false, balance: 40, receivable: 40, payable: 0, overdue: 10, oldest_overdue_days: 29, open_count: 2, advance: 0, credit_limit: 30, credit_used_pct: 133.3, last_payment_date: "2026-10-22", last_payment_amount: 120, payment_terms_days: 10 },
    { partner_id: "p2", partner_name: "B", phone: null, voen: "1", is_customer: true, is_supplier: true, is_deleted: true, balance: "80.10", receivable: 80.1, payable: 40, overdue: 0, oldest_overdue_days: null, open_count: 1, advance: 0, credit_limit: 0, credit_used_pct: null, last_payment_date: null, last_payment_amount: null, payment_terms_days: null },
  ],
  totals: { balance: 120.1, overdue: 10, open_count: 3 },
  kpi: { total_receivable: 200, total_payable: 50, net: 150, overdue_receivable: 30, top_debtors: [{ partner_id: "p2", partner_name: "B", balance: 80.1 }, { partner_id: "p1", partner_name: "LED4 L1", balance: 40 }] },
};

test("mappers: balance report and turnover", () => {
  const r = mapBalanceReport(balancePayload);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(
    { ...r.rows[0] },
    { partnerId: "p1", name: "LED4 L1", phone: "+994 50 444 00 01", voen: "", isCustomer: true, isSupplier: false, isDeleted: false, balance: 40, receivable: 40, payable: 0, overdue: 10, oldestOverdueDays: 29, openCount: 2, advance: 0, creditLimit: 30, creditUsedPct: 133.3, lastPaymentDate: "2026-10-22", lastPaymentAmount: 120, paymentTermsDays: 10 }
  );
  assert.equal(r.rows[1].balance, 80.1);
  assert.equal(r.rows[1].oldestOverdueDays, null);
  assert.equal(r.rows[1].creditUsedPct, null);
  assert.equal(r.rows[1].isDeleted, true);
  assert.deepEqual(r.totals, { balance: 120.1, overdue: 10, openCount: 3 });
  assert.equal(r.kpi.topDebtors[0].name, "B");
  const empty = mapBalanceReport(null);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.tab, "debtors");
  const t = mapTurnoverReport({ from: "2026-09-27", to: "2026-11-10", days: 45, total_count: 1, rows: [{ partner_id: "p1", partner_name: "L1", opening: 100, debit: 80, credit: 140, closing: 40, sales: 80, purchases: 0, dso: 39.4, dpo: null }], totals: { opening: 100, debit: 80, credit: 140, closing: 40, sales: 80, purchases: 0, dso: 39.4, dpo: null } });
  assert.equal(t.rows[0].closing, 40);
  assert.equal(t.rows[0].dpo, null);
  assert.equal(t.totals.dso, 39.4);
});

test("KPI formulas: % overdue, DSO, DPO, credit limit, bar widths", () => {
  assert.equal(overduePct({ overdueReceivable: 30, totalReceivable: 200 }), 15);
  assert.equal(overduePct({ overdueReceivable: 1, totalReceivable: 3 }), 33.3);
  assert.equal(overduePct({ overdueReceivable: 0, totalReceivable: 0 }), null);
  // The SQL fixture: receivable 100 → 40, sales 80, 45 days.
  assert.equal(dso(100, 40, 80, 45), 39.4);
  assert.equal(dso(100, 40, 0, 45), null);
  assert.equal(dpo(60, 20, 120, 30), 10);
  assert.equal(overCreditLimit({ creditUsedPct: 100 }), false);
  assert.equal(overCreditLimit({ creditUsedPct: 100.1 }), true);
  assert.equal(overCreditLimit({ creditUsedPct: null }), false);
  assert.deepEqual(barWidths([80, 40, 0]), [100, 50, 0]);
  assert.deepEqual(barWidths([]), []);
  assert.deepEqual(barWidths([0, 0]), [0, 0]);
});

test("URL filter state: defaults, parse, round trip, junk", () => {
  const get = (o) => ({ get: (k) => (k in o ? o[k] : null) });
  const d = defaultDebtorQuery(TODAY);
  assert.deepEqual(parseDebtorQuery(get({}), TODAY), d);
  assert.equal(debtorQueryString(d, TODAY), "");
  const q = parseDebtorQuery(
    get({ tab: "creditors", asOf: "2026-10-31", type: "supplier", min: "250.5", ccy: "usd", user: "00000000-0000-0000-0ed1-00000000000a", overdue: "1", overLimit: "1", q: "abşeron", sort: "overdue", dir: "asc", page: "3", size: "100" }),
    TODAY
  );
  assert.deepEqual(q, { ...d, tab: "creditors", asOf: "2026-10-31", type: "supplier", minAmount: 250.5, currency: "USD", userId: "00000000-0000-0000-0ed1-00000000000a", overdueOnly: true, overLimitOnly: true, search: "abşeron", sort: "overdue", dir: "asc", page: 3, pageSize: 100 });
  assert.deepEqual(parseDebtorQuery(new URLSearchParams(debtorQueryString(q, TODAY)), TODAY), q);
  const junk = parseDebtorQuery(get({ tab: "aging", asOf: "yesterday", type: "vip", min: "-5", ccy: "dollars", user: "x';--", sort: "drop table", dir: "up", page: "-2", size: "7" }), TODAY);
  assert.deepEqual(junk, d);
  // Turnover: its own default sort, and a start after the end is reset.
  const t = parseDebtorQuery(get({ tab: "turnover", from: "2026-11-20", to: "2026-10-15" }), TODAY);
  assert.deepEqual([t.sort, t.dir, t.from, t.to], ["name", "asc", "2026-10-01", "2026-10-15"]);
  // A turnover sort key is not a balance sort key.
  assert.equal(parseDebtorQuery(get({ sort: "dso" }), TODAY).sort, "balance");
});

test("changing the query: back to page 1; switching tab family resets the sort", () => {
  const q = { ...defaultDebtorQuery(TODAY), page: 4, sort: "overdue", dir: "asc" };
  assert.equal(patchQuery(q, { search: "x" }).page, 1);
  assert.equal(patchQuery(q, { page: 5 }).page, 5);
  const t = patchQuery(q, { tab: "turnover" });
  assert.deepEqual([t.sort, t.dir, t.page], ["name", "asc", 1]);
  const c = patchQuery(q, { tab: "creditors" });
  assert.deepEqual([c.sort, c.dir], ["overdue", "asc"]);
  assert.deepEqual(nextSort({ sort: "balance", dir: "desc" }, "balance"), { sort: "balance", dir: "asc" });
  assert.deepEqual(nextSort({ sort: "balance", dir: "desc" }, "overdue"), { sort: "overdue", dir: "desc" });
  assert.deepEqual(nextSort({ sort: "balance", dir: "desc" }, "name"), { sort: "name", dir: "asc" });
});

test("filters JSON for the RPC, page count, file names", () => {
  assert.deepEqual(filtersJson(defaultDebtorQuery(TODAY)), {});
  assert.deepEqual(
    filtersJson({ type: "partner", minAmount: 10, currency: "EUR", userId: "u", overdueOnly: true, overLimitOnly: false, search: "  acme " }),
    { type: "partner", min_amount: 10, currency: "EUR", user_id: "u", overdue_only: true, search: "acme" }
  );
  assert.equal(pageCount(0, 50), 1);
  assert.equal(pageCount(101, 50), 3);
  assert.equal(debtorFileName({ tab: "debtors", asOf: "2026-11-10", from: "", to: "" }, "xlsx"), "debtors-2026-11-10.xlsx");
  assert.equal(debtorFileName({ tab: "turnover", asOf: "", from: "2026-10-01", to: "2026-10-31" }, "pdf"), "partner-turnover-2026-10-01-2026-10-31.pdf");
});

test("Excel: filters in the header, numbers as numbers, totals, a real file", () => {
  const r = mapBalanceReport(balancePayload);
  const sheet = buildReportSheet({
    name: "Debitorlar",
    title: "Debitor və kreditor borcları",
    filterLines: [["Tarixə", "10.11.2026"], ["Yalnız gecikmiş", "Bəli"]],
    columns: [
      { header: "Tərəfdaş", kind: "text", value: (x) => x.name },
      { header: "Borc", kind: "money", value: (x) => x.balance },
      { header: "Gecikmə", kind: "number", value: (x) => x.oldestOverdueDays },
      { header: "Limit %", kind: "percent", value: (x) => x.creditUsedPct },
      { header: "Son ödəniş", kind: "date", value: (x) => x.lastPaymentDate },
    ],
    rows: r.rows,
    totals: { 1: r.totals.balance },
    totalsLabel: "Cəmi",
  });
  const v = sheet.rows.map((row) => row.map((c) => (c.t === "z" ? null : c.v)));
  assert.equal(v[0][0], "Debitor və kreditor borcları");
  assert.deepEqual(v[1], ["Tarixə", "10.11.2026"]);
  assert.deepEqual(v[2], ["Yalnız gecikmiş", "Bəli"]);
  assert.deepEqual(v[4], ["Tərəfdaş", "Borc", "Gecikmə", "Limit %", "Son ödəniş"]);
  assert.equal(sheet.rows[5][1].t, "n");
  assert.equal(sheet.rows[5][4].t, "n", "dates are Excel dates");
  assert.deepEqual(v[6].slice(0, 4), ["B", 80.1, null, null]);
  assert.deepEqual(v[7].slice(0, 2), ["Cəmi", 120.1]);
  assert.deepEqual(sheet.boldRows, [0, 4, 7]);
  const XLSX = require("xlsx");
  const bytes = writeSheetBytes(XLSX, { name: sheet.name, rows: sheet.rows, widths: sheet.widths }, (xml, style) => patchBoldRows(xml, style, sheet.boldRows.map((x) => x + 1)));
  const back = XLSX.utils.sheet_to_json(XLSX.read(bytes, { type: "array" }).Sheets.Debitorlar, { header: 1, raw: true });
  assert.equal(back.find((row) => row[0] === "Cəmi")[1], 120.1);
});

test("flag: menu items, route permission, guarded page, actions, links", () => {
  const paths = (partnerLedgers) => extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: false, partnerLedgers }).map((e) => e.path);
  assert.ok(paths(true).includes("/dashboard/reports/debtors"));
  assert.ok(!paths(false).includes("/dashboard/reports/debtors"));
  assert.match(read("src/modules/accounting/manifest.ts"), /prefix: "\/dashboard\/reports\/debtors", permission: "can_view_financial_reports"/);
  assert.match(read("src/lib/navigation/breadcrumbs.ts"), /"\/dashboard\/reports\/debtors": "nav.items.debtorReports"/);
  assert.match(read("src/app/dashboard/reports/debtors/page.tsx"), /if \(!\(await partnerLedgersActiveForRequest\(\)\)\) notFound\(\);/);
  const actions = read("src/modules/accounting/actions/debtorReports.ts");
  assert.equal((actions.match(/await requirePartnerLedgers\(\);/g) ?? []).length, 3, "every action checks the flag");
  assert.match(read("src/components/Sidebar.tsx"), /"\/dashboard\/reports\/debtors"/);
  const hub = read("src/app/reports/page.client.tsx");
  assert.match(hub, /\.\.\.\(partnerLedgers\s*\?[\s\S]*"\/dashboard\/reports\/debtors"/);
  const home = read("src/components/home/widgets/ManagementWidgets.tsx");
  assert.equal((home.match(/action=\{partnerLedgers \? <DebtorReportLink tab="(debtors|creditors)" \/> : undefined\}/g) ?? []).length, 2);
});

test("one RPC call per view; the server pages and sorts", () => {
  const page = read("src/modules/accounting/components/debtorReports/DebtorCreditorPage.tsx");
  assert.match(page, /sort=\{\{ key: q\.sort, dir: q\.dir \}\}/);
  assert.match(page, /onSort=\{onSort\}/);
  const actions = read("src/modules/accounting/actions/debtorReports.ts");
  assert.equal((actions.match(/db\.rpc\(/g) ?? []).length, 2);
  assert.doesNotMatch(page, /<select\b|type="date"|<h1\b|btn-primary|<table\b/);
});

test("every string in az, en and ru", () => {
  const keys = (o, prefix = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
  const az = keys(azMessages.debtorReports).sort();
  assert.deepEqual(keys(enMessages.debtorReports).sort(), az);
  assert.deepEqual(keys(ruMessages.debtorReports).sort(), az);
  for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.nav.items.debtorReports);
  const code = ["DebtorCreditorPage.tsx", "DebtorReportPrintLayout.tsx", "debtorExport.ts"].map((f) => read(`src/modules/accounting/components/debtorReports/${f}`)).join("\n") + read("src/modules/accounting/actions/debtorReports.ts") + read("src/components/home/widgets/ManagementWidgets.tsx");
  for (const [, key] of code.matchAll(/"debtorReports\.([a-zA-Z_.]+)"/g)) assert.ok(az.includes(key), `missing debtorReports.${key}`);
  for (const [, key] of code.matchAll(/\bk\("([a-zA-Z_.]+)"/g)) assert.ok(az.includes(key), `missing debtorReports.${key}`);
  for (const tab of ["debtors", "creditors", "net", "turnover"]) assert.ok(az.includes(`tabs.${tab}`));
  for (const tab of ["debtors", "creditors", "net"]) assert.ok(az.includes(`cols.balance_${tab}`));
  assert.equal(translate(azMessages, "debtorReports.days", { n: "39,4" }), "39,4 gün");
  // The DSO help text states the formula in every language.
  for (const m of [azMessages, enMessages, ruMessages]) assert.match(m.debtorReports.dsoHelp, /DSO = .*÷.*×/);
});
