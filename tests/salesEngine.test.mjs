// Sales on the view engine (NEW_UI): the invoice record mapping (same remaining debt, status
// and warehouse state as the classic list), the view definitions, filters, the dashboard
// figures, the report rows, and that the classic pages stay while NEW_UI is off.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySearch, matchesFilters, validateDefinition } from "../src/views/logic.ts";
import {
  paymentState,
  reportRecords,
  saleRemaining,
  salesDashboard,
  salesDefinition,
  salesFilters,
  salesModel,
  salesReportDefinition,
  saleToRecord,
  SALES_VIEW_KEY,
  warehouseState,
} from "../src/modules/sales/views/sales.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const fmt = { t: (k) => k, locale: "en" };

const row = (id, extra = {}) => ({
  id,
  doc_no: `S-${id}`,
  doc_date: "2026-10-05",
  customer_id: "c1",
  customer_name: "Nur MMC",
  seller_id: "u1",
  seller_name: "Leyla",
  warehouse_name: "Əsas Anbar",
  total_amount: 100,
  paid_amount: 0,
  remaining_balance: 100,
  status: "posted",
  warehouse_sent: false,
  warehouse_slip_status: null,
  created_at: "2026-10-05T10:00:00Z",
  ...extra,
});
const fetchers = { fetchAll: async () => [], fetchOne: async () => null };
const def = salesDefinition(salesModel(fetchers));

// ── Records ──────────────────────────────────────────────────────────────────

test("an invoice row becomes a record with the classic remaining debt, status and send state", () => {
  const r = saleToRecord(row("a", { issued_by_name: "Kamran", vat_total: 18 }));
  assert.equal(r.remaining, 100);
  assert.equal(r.payment_state, "unpaid");
  assert.equal(r.doc_status, "posted");
  assert.equal(r.warehouse_state, "not_sent");
  assert.equal(r.seller_name, "Kamran");
  assert.equal(r.vat_total, 18);
  // Stored balance wins; without one, total − paid (never negative), grand total first.
  assert.equal(saleRemaining({ total_amount: 100, paid_amount: 30, remaining_balance: 0 }), 70);
  assert.equal(saleRemaining({ total_amount: 100, grand_total: 118, paid_amount: 18, remaining_balance: null }), 100);
  assert.equal(saleRemaining({ total_amount: 100, paid_amount: 150, remaining_balance: 0 }), 0);
  assert.equal(saleRemaining({ total_amount: 100, paid_amount: 0, remaining_balance: 40 }), 40);
  // Status as the classic badge: blank = posted (legacy), "Ləğv edildi" = cancelled.
  assert.equal(saleToRecord(row("b", { status: null })).doc_status, "posted");
  assert.equal(saleToRecord(row("c", { status: "Draft" })).doc_status, "draft");
  assert.equal(saleToRecord(row("d", { status: "Ləğv edildi" })).doc_status, "cancelled");
  // Fallback to seller_name when no issuer name is known.
  assert.equal(saleToRecord(row("e")).seller_name, "Leyla");
});

test("payment and warehouse states follow the classic list", () => {
  assert.equal(paymentState(100, 0, 100), "unpaid");
  assert.equal(paymentState(100, 40, 60), "partial");
  assert.equal(paymentState(100, 100, 0), "paid");
  assert.equal(paymentState(0, 0, 0), "paid");
  assert.equal(paymentState(100, 0, 60), "partial");
  assert.equal(warehouseState(false, "approved"), "not_sent");
  assert.equal(warehouseState(true, "pending"), "pending");
  assert.equal(warehouseState(true, "approved"), "approved");
  assert.equal(warehouseState(true, "rejected"), "rejected");
  // The classic badge shows "rejected" for a sent invoice without a slip status.
  assert.equal(warehouseState(true, null), "rejected");
});

// ── Definitions ──────────────────────────────────────────────────────────────

test("the sales and report definitions are valid and keep the classic permissions", () => {
  assert.deepEqual(validateDefinition(def), []);
  assert.deepEqual(validateDefinition(salesReportDefinition()), []);
  assert.equal(def.model.key, SALES_VIEW_KEY);
  assert.equal(def.model.module, "sales");
  assert.equal(def.model.readPermission, "can_view_sales");
  assert.equal(def.model.fetchAll, fetchers.fetchAll);
  assert.equal(def.model.fetchOne, fetchers.fetchOne);
  assert.equal(salesReportDefinition().model.readPermission, "can_view_reports");
  // List first (as the classic page), kanban by payment state, reports as pivot and graph.
  assert.deepEqual(def.views, ["list", "kanban", "pivot", "graph", "calendar"]);
  assert.equal(def.kanban.groupBy, "payment_state");
  // The classic list columns are all there.
  for (const c of ["doc_no", "doc_date", "customer_id", "warehouse_name", "total_amount", "paid_amount", "remaining", "doc_status", "warehouse_state"]) assert.ok(def.list.columns.includes(c), c);
  // Nothing is editable in the form: invoices change only through the invoice form and actions.
  assert.ok(def.fields.every((f) => f.readonly));
});

test("sales filters: status, payment, overdue, warehouse, period and my invoices", () => {
  const filters = salesFilters();
  const now = new Date(2026, 9, 14, 12);
  const ctx = { userId: "u1", now };
  const recs = [
    saleToRecord(row("a")),
    saleToRecord(row("b", { status: "draft", seller_id: "u2" })),
    saleToRecord(row("c", { paid_amount: 40, remaining_balance: 60, due_date: "2026-10-01", warehouse_sent: true, warehouse_slip_status: "approved" })),
    saleToRecord(row("d", { paid_amount: 100, remaining_balance: 0, due_date: "2026-10-01", doc_date: "2026-09-20" })),
    saleToRecord(row("e", { due_date: "2026-10-20", is_official: true, doc_date: "2026-08-30" })),
  ];
  const ids = (active) => recs.filter((r) => matchesFilters(r, filters, active, ctx)).map((r) => r.id).join("");
  assert.equal(ids(["draft"]), "b");
  assert.equal(ids(["posted"]), "acde");
  assert.equal(ids(["unpaid"]), "abe");
  assert.equal(ids(["unpaid", "partial"]), "abce");
  assert.equal(ids(["overdue"]), "c");
  assert.equal(ids(["not_sent"]), "ade");
  assert.equal(ids(["official"]), "e");
  assert.equal(ids(["this_month"]), "abc");
  assert.equal(ids(["last_month"]), "d");
  assert.equal(ids(["mine"]), "acde");
  assert.equal(ids(["mine", "draft"]), "");
  // Search through number, customer and warehouse (as the classic search box).
  const search = (q) => applySearch(recs, def, { search: q, filters: [] }, ctx, fmt).map((r) => r.id).join("");
  assert.equal(search("s-c"), "c");
  assert.equal(search("nur"), "abcde");
  assert.equal(search("esas anbar"), "abcde");
});

// ── Dashboard ────────────────────────────────────────────────────────────────

test("dashboard figures: month and trend, receivables, overdue, drafts, payment share, months, customers", () => {
  const now = new Date(2026, 9, 14, 12);
  const recs = [
    saleToRecord(row("a", { total_amount: 300, remaining_balance: 300, doc_date: "2026-10-02" })),
    saleToRecord(row("b", { total_amount: 200, paid_amount: 200, remaining_balance: 0, doc_date: "2026-10-12", warehouse_sent: true, warehouse_slip_status: "approved", customer_id: "c2", customer_name: "Boris" })),
    saleToRecord(row("c", { total_amount: 400, paid_amount: 100, remaining_balance: 300, doc_date: "2026-09-10", due_date: "2026-10-01" })),
    saleToRecord(row("d", { total_amount: 999, status: "draft", doc_date: "2026-10-10" })),
    saleToRecord(row("e", { total_amount: 50, remaining_balance: 50, doc_date: "2025-06-01", customer_id: "c3", customer_name: "Old" })),
  ];
  const d = salesDashboard(recs, now);
  assert.equal(d.month.total, 500);
  assert.equal(d.month.count, 2);
  assert.equal(d.month.previous, 400);
  assert.equal(d.month.delta, 25);
  assert.equal(d.month.weekly.length, 8);
  assert.equal(d.month.weekly.at(-1), 200);
  assert.equal(d.month.weekly.reduce((s, v) => s + v, 0), 900);
  assert.equal(d.receivables.total, 650);
  assert.equal(d.receivables.count, 3);
  assert.equal(d.receivables.overdue, 1);
  assert.equal(d.drafts, 1);
  assert.equal(d.notSent, 3);
  assert.deepEqual(d.payment, { paid: 1, partial: 1, unpaid: 2, paidPercent: 25 });
  assert.deepEqual(d.monthly.map((m) => m.key), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(d.monthly.at(-1), { key: "2026-10", paid: 200, remaining: 300 });
  assert.deepEqual(d.monthly.at(-2), { key: "2026-09", paid: 100, remaining: 300 });
  // Last 12 months only, drafts never count as sales.
  assert.deepEqual(d.topCustomers.map((c) => [c.name, c.total, c.count]), [["Nur MMC", 700, 2], ["Boris", 200, 1]]);
  // No previous month: no trend.
  assert.equal(salesDashboard([recs[0]], now).month.delta, null);
  assert.equal(salesDashboard([], now).payment.paidPercent, 0);
  assert.equal(salesDashboard(recs, now, 8, 12).monthly.length, 12);
});

test("report rows keep the classic figures, rounded for display", () => {
  const rows = reportRecords([
    { product_id: "p1", product_name: "Board", product_code: "B1", category: "Panels", quantity: 2.345, revenue: 100.005, cost: 60.004, profit: 40.001, marginPercent: 40.0004 },
    { product_id: "", product_name: "Service", product_code: "-", category: "Digər", quantity: 1, revenue: 10, cost: 0, profit: 10, marginPercent: 100 },
  ]);
  assert.deepEqual(rows[0], { id: "p1", product_name: "Board", product_code: "B1", category: "Panels", quantity: 2.35, revenue: 100.01, cost: 60, profit: 40, margin: 40 });
  assert.equal(rows[1].id, "row-1");
});

// ── NEW_UI off: nothing changes ──────────────────────────────────────────────

test("with NEW_UI off every sales route renders exactly its classic page", () => {
  assert.match(read("src/app/sales/page.tsx"), /if \(!isNewUiEnabled\(\)\) return <SalesPage \/>;/);
  assert.match(read("src/app/sales/[id]/page.tsx"), /if \(!isNewUiEnabled\(\)\) return <SaleDetailPage saleId=\{id\} \/>;/);
  assert.match(read("src/app/reports/sales/page.tsx"), /if \(!isNewUiEnabled\(\)\) return <SalesReportPage \/>;/);
  assert.match(read("src/app/sales/page.client.tsx"), /return active \? <SalesScreen \/> : <SalesPage \/>;/);
  assert.match(read("src/app/sales/[id]/page.client.tsx"), /return active \? <SaleFormScreen id=\{id\} \/> : <SaleDetailPage saleId=\{id\} \/>;/);
  assert.match(read("src/app/reports/sales/page.client.tsx"), /return active \? <SalesReportScreen \/> : <SalesReportPage \/>;/);
  // The invoice form itself is untouched; the classic screens do not import the engine.
  for (const f of ["SalesPage", "SaleDetailPage", "SalesReportPage", "SaleNewPage", "InvoiceForm"]) {
    assert.doesNotMatch(read(`src/modules/sales/components/${f}.tsx`), /@\/views|SalesScreen|SaleFormScreen/, f);
  }
});

test("the new screens reuse the module's own reads and server actions", () => {
  const def = read("src/modules/sales/hooks/useSalesDefinition.ts");
  assert.match(def, /fetchSalesListWithMeta\(\)/);
  assert.match(def, /fetchSaleById\(id\)/);
  const form = read("src/modules/sales/components/SaleFormScreen.tsx");
  for (const action of ["recordSalePaymentAction", "voidSaleAction", "sendSaleToWarehouseAction", "exportSaleEQaime", "mapSaleToInvoicePrint"]) assert.match(form, new RegExp(action), action);
  assert.match(form, /can\("can_delete_sales"\)/);
  assert.match(form, /isDraft && can\("can_edit_sales"\)/);
  assert.match(form, /canDelegateInvoiceIssuer\(profile\?\.role\)/);
  assert.match(read("src/modules/sales/components/SalesReportScreen.tsx"), /fetchSalesReport\(filters\)/);
});

// ── Texts ────────────────────────────────────────────────────────────────────

test("every text of the sales screens exists in az, en and ru", () => {
  const files = ["views/sales.ts", "components/SalesScreen.tsx", "components/SaleFormScreen.tsx", "components/SalesReportScreen.tsx", "components/SalesDashboard.tsx"];
  const keys = new Set();
  for (const f of files) {
    for (const m of read(`src/modules/sales/${f}`).matchAll(/["'`]((?:sales|views|common|invoice|warehouseSend|tax|taxPayrollSettings|modals|dashboard|official|reports|crm)\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) keys.add(m[1]);
  }
  keys.delete(SALES_VIEW_KEY);
  keys.delete("sales.report");
  for (const p of ["today", "week", "month", "custom"]) keys.add(`sales.engine.report.presets.${p}`);
  for (const r of ["3m", "6m", "12m"]) keys.add(`sales.engine.dashboard.range.${r}`);
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  assert.ok(keys.size > 80);
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});
