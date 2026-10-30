// Imports module, IMP-3: exchange differences, prepayments, reports and the cost sheet.
// The database side is checked by supabase/tests/imports_fx.sql in CI.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveGoodsRate, fxPayment } from "../src/lib/imports/fx.ts";
import { payablesReport, productsReport, shipmentsReport, transitReport, vatReport } from "../src/modules/imports/lib/reports.ts";
import {
  IMPORT_REPORTS,
  payablesReportDefinition,
  productsReportDefinition,
  shipmentsReportDefinition,
  transitReportDefinition,
  vatReportDefinition,
} from "../src/modules/imports/views/reports.ts";
import { landedCostOf, emptyShipment } from "../src/modules/imports/lib/shipment.ts";
import { DEFAULT_IMPORTS_CONFIG } from "../src/lib/imports/config.ts";
import { POSTING_ERROR_CODES } from "../src/modules/imports/lib/posting.ts";
import { extraItemsFor, SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── Exchange differences ────────────────────────────────────────────────────

test("partial payments at other rates: a loss, then a gain, the last one clears the booked value", () => {
  // 1,000 USD booked at 1.70 = 1,700 AZN.
  const first = fxPayment({ currencyCode: "USD", openFc: 1000, openAzn: 1700, amountFc: 400, rate: 1.75 });
  assert.deepEqual([first.paidAzn, first.settledAzn, first.differenceAzn, first.remainingFc, first.remainingAzn, first.overpay], [700, 680, 20, 600, 1020, false]);
  const rest = fxPayment({ currencyCode: "USD", openFc: 600, openAzn: 1020, amountFc: 600, rate: 1.65 });
  assert.deepEqual([rest.paidAzn, rest.settledAzn, rest.differenceAzn, rest.remainingFc, rest.remainingAzn], [990, 1020, -30, 0, 0]);
  assert.equal(first.settledAzn + rest.settledAzn, 1700, "2100 ends at zero");
});

test("the last payment takes exactly what is left, whatever the rounding", () => {
  // 3 equal thirds of 100 USD booked at 1.7 = 170 AZN: 56.67 + 56.67, then the rest.
  const a = fxPayment({ currencyCode: "USD", openFc: 100, openAzn: 170, amountFc: 33.33, rate: 1.7 });
  const b = fxPayment({ currencyCode: "USD", openFc: a.remainingFc, openAzn: a.remainingAzn, amountFc: 33.33, rate: 1.7 });
  const c = fxPayment({ currencyCode: "USD", openFc: b.remainingFc, openAzn: b.remainingAzn, amountFc: b.remainingFc, rate: 1.7 });
  assert.equal(Math.round((a.settledAzn + b.settledAzn + c.settledAzn) * 100), 17000);
  assert.equal(c.remainingAzn, 0);
});

test("overpay is checked in the currency; AZN payables have no difference", () => {
  assert.equal(fxPayment({ currencyCode: "USD", openFc: 600, openAzn: 1020, amountFc: 600.01, rate: 1.7 }).overpay, true);
  const azn = fxPayment({ currencyCode: "AZN", openFc: 500, openAzn: 500, amountFc: 200, rate: 0 });
  assert.deepEqual([azn.paidAzn, azn.settledAzn, azn.differenceAzn, azn.remainingAzn], [200, 200, 0, 300]);
  assert.equal(fxPayment({ currencyCode: "AZN", openFc: 500, openAzn: 500, amountFc: 501, rate: 1 }).overpay, true);
});

test("prepayments: the prepaid part at its own rate, the rest at the invoice rate", () => {
  // 300 USD prepaid at 1.60 (480 AZN), 1,000 USD invoiced at 1.70 → 1,670 AZN, rate 1.67.
  assert.equal(effectiveGoodsRate(1000, 1.7, [{ amountFc: 300, amountAzn: 480 }]), 1.67);
  assert.equal(effectiveGoodsRate(1000, 1.7, []), null);
  assert.equal(effectiveGoodsRate(1000, 1.7, [{ amountFc: 1200, amountAzn: 2040 }]), null, "more than the goods is refused");
  // The calculator uses the effective rate once it is set.
  const draft = {
    ...emptyShipment(),
    invoiceRate: 1.7,
    goodsRateAzn: 1.67,
    lines: [{ key: "l", productId: "p", qtyPurchase: 10, purchaseUnit: null, qtyStock: 10, unitPriceFc: 100, weightKg: null, volumeM3: null, hsCode: null, dutyRatePct: 0, warehouseId: null }],
  };
  assert.equal(landedCostOf(draft, DEFAULT_IMPORTS_CONFIG).totals.goodsAzn, 1670);
});

// ── Reports ─────────────────────────────────────────────────────────────────

const S1 = "s1";
const S2 = "s2";
const SRC = {
  shipments: [
    { id: S1, number: "IMP-2026-0001", status: "received", supplier_id: "sup", currency_code: "USD", invoice_rate: 1.7, invoice_date: "2026-10-01", confirm_date: "2026-10-02", customs_declaration_no: "D-1", customs_declaration_date: "2026-10-04" },
    { id: S2, number: "IMP-2026-0002", status: "draft", supplier_id: "sup", currency_code: "USD", invoice_rate: 1.7 },
    { id: "s3", number: "IMP-2026-0003", status: "confirmed", supplier_id: "sup", currency_code: "USD", invoice_rate: 1.7, goods_rate_azn: 1.67, confirm_date: "2026-11-02" },
  ],
  lines: [
    { id: "l1", shipment_id: S1, product_id: "p1", qty_purchase_unit: 100, qty_stock_unit: 400, unit_price_fc: 25 },
    { id: "l2", shipment_id: S2, product_id: "p1", qty_purchase_unit: 1, qty_stock_unit: 4, unit_price_fc: 25 },
    { id: "l3", shipment_id: "s3", product_id: "p1", qty_purchase_unit: 10, qty_stock_unit: 40, unit_price_fc: 100 },
  ],
  costs: [
    { id: "c1", shipment_id: S1, cost_type: "freight_international", amount: 400, currency_code: "USD", rate_to_azn: 1.7, vat_amount_azn: 0 },
    { id: "c2", shipment_id: S1, cost_type: "customs_duty", amount: 246.5, currency_code: "AZN", rate_to_azn: 1, vat_amount_azn: 0 },
    { id: "c3", shipment_id: S1, cost_type: "customs_fee", amount: 30, currency_code: "AZN", rate_to_azn: 1, vat_amount_azn: 0 },
    { id: "c4", shipment_id: S1, cost_type: "freight_local", amount: 200, currency_code: "AZN", rate_to_azn: 1, vat_amount_azn: 36 },
    { id: "c5", shipment_id: S1, cost_type: "labour", amount: 100, currency_code: "AZN", rate_to_azn: 1, vat_amount_azn: 0 },
    { id: "c6", shipment_id: S1, cost_type: "customs_vat", amount: 931.77, currency_code: "AZN", rate_to_azn: 1, vat_amount_azn: 0 },
  ],
  allocations: [
    { cost_line_id: "c1", shipment_line_id: "l1", amount_azn: 680 },
    { cost_line_id: "c2", shipment_line_id: "l1", amount_azn: 246.5 },
    { cost_line_id: "c3", shipment_line_id: "l1", amount_azn: 30 },
    { cost_line_id: "c4", shipment_line_id: "l1", amount_azn: 200 },
    { cost_line_id: "c5", shipment_line_id: "l1", amount_azn: 100 },
  ],
  payables: [
    { id: "pay1", shipment_id: S1, partner_id: "sup", source: "goods", document_date: "2026-10-02", currency_code: "USD", amount_fc: 2500, paid_fc: 1000, amount_azn: 4250, paid_azn: 1700, status: "open" },
    { id: "pay2", shipment_id: S1, partner_id: "cus", source: "cost", cost_line_id: "c3", document_date: "2026-10-02", currency_code: "AZN", amount_fc: 30, paid_fc: 30, amount_azn: 30, paid_azn: 30, status: "paid" },
  ],
  products: [{ id: "p1", code: "PLY-18", name: "Plywood 18" }],
  suppliers: [{ id: "sup", full_name: "Kronospan" }, { id: "cus", full_name: "Gömrük" }],
  transit: [
    { shipment_id: S1, entry_date: "2026-10-02", debit: 5506.5, credit: 0 },
    { shipment_id: S1, entry_date: "2026-11-05", debit: 0, credit: 5506.5 },
    { shipment_id: "s3", entry_date: "2026-11-02", debit: 1670, credit: 0 },
  ],
  customsValueCostTypes: ["freight_international", "insurance"],
};

test("shipments report: the plan example, drafts left out, landed per stock unit", () => {
  const rows = shipmentsReport(SRC);
  assert.deepEqual(rows.map((r) => r.number), ["IMP-2026-0001", "IMP-2026-0003"]);
  const r = rows[0];
  assert.deepEqual([r.goods_azn, r.capitalized_azn, r.vat_azn, r.landed_azn, r.qty_stock], [4250, 1256.5, 967.77, 5506.5, 400]);
  assert.equal(Math.round(r.landed_per_unit * 100) / 100, 13.77);
  assert.equal(rows[1].goods_azn, 1670, "goods at the effective rate after a prepayment");
});

test("landed cost per product: one row per line with the confirmation date", () => {
  const rows = productsReport(SRC);
  assert.deepEqual(rows.map((r) => [r.shipment_number, r.date, r.landed_azn]), [["IMP-2026-0001", "2026-10-02", 5506.5], ["IMP-2026-0003", "2026-11-02", 1670]]);
  assert.equal(rows[0].product_name, "Plywood 18");
  assert.equal(Math.round(rows[0].unit_cost_stock * 100) / 100, 13.77);
  assert.equal(Math.round(rows[0].unit_cost_purchase * 100) / 100, 55.07);
});

test("import VAT register: customs value, duty, customs VAT and local VAT by declaration month", () => {
  const [r] = vatReport(SRC);
  assert.deepEqual([r.month, r.declaration_no, r.customs_value_azn, r.duty_azn, r.customs_vat_azn, r.local_vat_azn, r.total_vat_azn], ["2026-10", "D-1", 4930, 246.5, 931.77, 36, 967.77]);
  assert.equal(vatReport(SRC)[1].month, "2026-11", "no declaration date: the confirmation month");
});

test("open payables: only open ones, both currencies, days open", () => {
  const rows = payablesReport(SRC, new Date(2026, 9, 12));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].partner_name, rows[0].open_fc, rows[0].open_azn, rows[0].age_days, rows[0].currency_code], ["Kronospan", 1500, 2550, 10, "USD"]);
});

test("goods in transit as of a date: entries up to it, zero balances left out", () => {
  assert.deepEqual(transitReport(SRC, "2026-10-31").map((r) => [r.shipment_number, r.balance_azn]), [["IMP-2026-0001", 5506.5]]);
  assert.deepEqual(transitReport(SRC, "2026-11-30").map((r) => [r.shipment_number, r.balance_azn]), [["IMP-2026-0003", 1670]]);
});

test("report definitions: every column is a field; money summed", () => {
  const defs = [shipmentsReportDefinition(), productsReportDefinition(), vatReportDefinition(), payablesReportDefinition(), transitReportDefinition()];
  assert.equal(defs.length, IMPORT_REPORTS.length);
  for (const def of defs) {
    const fields = new Set(def.fields.map((f) => f.name));
    for (const c of [...def.list.columns, ...(def.list.sums ?? []), ...(def.list.optional ?? []), ...def.form.fields]) assert.ok(fields.has(c), `${def.model.key}: ${c}`);
    assert.equal(def.model.readPermission, "can_view_imports");
  }
  assert.ok(vatReportDefinition().list.sums.includes("total_vat_azn"));
});

// ── Wiring and texts ────────────────────────────────────────────────────────

test("reports page, launcher item and cost sheet are wired behind NEW_IMPORTS", () => {
  assert.match(read("src/app/imports/reports/page.tsx"), /isNewImportsEnabled\(\)/);
  assert.ok(extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: false, newImports: true }).some((e) => e.path === "/imports/reports"));
  assert.ok(!extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: false, newImports: false }).some((e) => e.path === "/imports/reports"));
  assert.match(read("src/modules/imports/actions/reports.ts"), /canViewFinancials\(ctx\.profile\)/);
  assert.match(read("src/modules/imports/components/ImportFormScreen.tsx"), /<CostSheet data=\{costSheet\} \/>/);
  const panel = read("src/modules/imports/components/PostingPanel.tsx");
  assert.match(panel, /payPayableAction\(paying\.id, d, note, splits, opKey, amountFc, rate\)/);
  assert.match(panel, /prepayAction\(id, d, note, amountFc, rate, splits, opKey\)/);
});

test("migration: exchange difference accounts, running currency balance, prepayments", () => {
  const sql = read("supabase/migrations/20261030120000_imports_fx.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS paid_fc NUMERIC\(18,2\)/);
  assert.match(sql, /_imports_line\('6260', v_diff/);
  assert.match(sql, /_imports_line\('4960', v_diff/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.pay_import_payable\(UUID, DATE, TEXT, JSONB, TEXT\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.import_prepayments \(/);
  assert.match(sql, /ALTER TABLE public\.import_prepayments ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /COALESCE\(s\.goods_rate_azn, s\.invoice_rate\)/);
  for (const code of [...sql.matchAll(/'imports_([a-z_]+):/g)].map((m) => m[1])) assert.ok(POSTING_ERROR_CODES.includes(code), code);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/imports_fx\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261030120000_imports_fx/);
});

test("every IMP-3 text exists in az, en and ru", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : keys(v, `${p}${k}.`)));
  for (const group of ["importReports", "importPosting"]) {
    const az = keys(azMessages[group]).sort();
    assert.deepEqual(keys(enMessages[group]).sort(), az, group);
    assert.deepEqual(keys(ruMessages[group]).sort(), az, group);
  }
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const r of IMPORT_REPORTS) assert.ok(m.importReports[r].title && m.importReports[r].hint, r);
    for (const code of POSTING_ERROR_CODES) assert.ok(m.importPosting.errors[code], code);
    assert.ok(m.newShell.extra_importsReports);
  }
  const used = new Set();
  for (const f of ["src/modules/imports/components/ImportReportsScreen.tsx", "src/modules/imports/components/CostSheet.tsx", "src/modules/imports/components/PostingPanel.tsx", "src/modules/imports/views/reports.ts"]) {
    // Keys passed to t() and labelKey fields (not query or view keys).
    for (const m of read(f).matchAll(/(?:t\(|labelKey: )["`]((?:importReports|importPosting|imports)\.[A-Za-z_]+(?:\.[A-Za-z_]+)*)["`]/g)) used.add(m[1]);
  }
  const get = (o, k) => k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o);
  for (const k of used) for (const m of [azMessages, enMessages, ruMessages]) assert.equal(typeof get(m, k), "string", k);
});
