// Module screens on the view engine (phase 18, NEW_UI): shared dashboard helpers, every
// switched route still renders its classic page while NEW_UI is off, every text exists in
// az/en/ru, and each module's own record mapping, definitions and dashboard figures.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { countIf, matchesFilters, monthTotals, sumIf, validateDefinition, weeklySeries } from "../src/views/logic.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import * as hr from "../src/modules/hr/views/hr.ts";
import * as exp from "../src/modules/expenses/views/expenses.ts";
import * as com from "../src/modules/commissions/views/commissions.ts";
import * as cons from "../src/modules/consignment/views/consignment.ts";
import * as con from "../src/modules/contracts/views/contracts.ts";
import * as inv from "../src/modules/inventory/views/inventory.ts";
import { purchaseFilters, purchaseKpis, purchaseRemaining, purchasesDefinition, purchasesModel, purchaseToRecord } from "../src/modules/purchases/views/purchases.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const fmt = { t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: "en" };
const NOW = new Date(2026, 9, 14, 12);

// ── Shared ───────────────────────────────────────────────────────────────────

test("dashboard helpers: sums, counts, weekly series and month totals", () => {
  const recs = [
    { id: "a", d: "2026-10-13", v: 10 },
    { id: "b", d: "2026-10-02", v: 5 },
    { id: "c", d: "2026-09-20", v: 20 },
    { id: "d", d: null, v: 7 },
    { id: "e", d: "2026-06-01", v: 1 },
  ];
  assert.equal(sumIf(recs, (r) => r.v), 43);
  assert.equal(sumIf(recs, (r) => r.v, (r) => r.v > 6), 37);
  assert.equal(countIf(recs, (r) => !!r.d), 4);
  const w = weeklySeries(recs, (r) => r.d, (r) => r.v, NOW, 8);
  assert.equal(w.length, 8);
  assert.equal(w[7], 10);
  assert.equal(w.reduce((s, x) => s + x, 0), 35);
  assert.deepEqual(monthTotals(recs, (r) => r.d, (r) => r.v, NOW), { current: 15, previous: 20, delta: -25 });
  assert.deepEqual(monthTotals([recs[0]], (r) => r.d, (r) => r.v, NOW).delta, null);
});

/**
 * Every route switched in phase 18: [route dir, module, classic export, screen export].
 * Each module branch adds its routes here.
 */
const ROUTES = [
  ["purchases", "purchases", "PurchasesPage", "PurchasesScreen"],
  ["inventory", "inventory", "WarehouseStockPage", "InventoryStockScreen"],
  ["dashboard/warehouse/slips", "inventory", "WarehouseSlipsPage", "WarehouseSlipsScreen"],
  ["inventory/counts", "inventory", "InventoryCountsPage", "InventoryCountsScreen"],
  ["warehouse/initial-balance", "inventory", "InitialBalanceListPage", "InitialBalanceScreen"],
  ["products/damaged-goods", "inventory", "DamagedGoodsPage", "DamagedGoodsScreen"],
  ["contracts", "contracts", "ContractsPage", "ContractsScreen"],
  ["consignments", "consignment", "ConsignmentsPage", "ConsignmentsScreen"],
  ["commissions", "commissions", "CommissionsPage", "CommissionsScreen"],
  ["expenses", "expenses", "ExpensesPage", "ExpensesScreen"],
];
/** New files whose texts must exist in all languages, per module. */
const TEXT_FILES = [
  "src/views/components/EngineScreen.tsx",
  "src/views/components/KpiCards.tsx",
  "src/modules/purchases/views/purchases.ts",
  "src/modules/purchases/components/PurchasesScreen.tsx",
  "src/modules/inventory/views/inventory.ts",
  "src/modules/inventory/components/InventoryScreens.tsx",
  "src/modules/contracts/views/contracts.ts",
  "src/modules/contracts/components/ContractsScreen.tsx",
  "src/modules/consignment/views/consignment.ts",
  "src/modules/consignment/components/ConsignmentsScreen.tsx",
  "src/modules/commissions/views/commissions.ts",
  "src/modules/commissions/components/CommissionsScreen.tsx",
  "src/modules/expenses/views/expenses.ts",
  "src/modules/expenses/components/ExpensesScreen.tsx",
  "src/modules/hr/views/hr.ts",
  "src/modules/hr/components/EmployeesScreen.tsx",
];

test("with NEW_UI off every switched route renders exactly its classic page", () => {
  for (const [route, module, classic, screen] of ROUTES) {
    const page = read(`src/app/${route}/page.tsx`);
    assert.match(page, new RegExp(`if \\(!isNewUiEnabled\\(\\)\\) return <${classic} />;`), route);
    const client = read(`src/app/${route}/page.client.tsx`);
    assert.match(client, new RegExp(`return active \\? <${screen} /> : <${classic} />;`), route);
    assert.match(client, new RegExp(`import\\("@/modules/${module}/pages"\\)\\.then\\(\\(m\\) => m\\.${screen}\\)`), route);
    assert.match(read(`src/modules/${module}/pages.ts`), new RegExp(`export \\{[^}]*\\b${screen}\\b[^}]*\\}`), route);
  }
});

test("every text of the new module screens exists in az, en and ru", () => {
  const keys = new Set();
  for (const f of TEXT_FILES) {
    assert.ok(existsSync(join(root, f)), f);
    for (const m of read(f).matchAll(/["'`]((?:[a-z][A-Za-z0-9]*)\.[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)["'`]/g)) {
      const k = m[1];
      // Only translation keys: the first segment is a messages namespace.
      if (k.split(".")[0] in enMessages) keys.add(k);
    }
  }
  // View keys (`..._VIEW_KEY = "inventory.stock"`) look like texts; they are not.
  for (const f of TEXT_FILES) for (const m of read(f).matchAll(/_VIEW_KEY = "([^"]+)"/g)) keys.delete(m[1]);
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});

// ── Purchases ────────────────────────────────────────────────────────────────

const prow = (id, extra = {}) => ({
  id,
  invoice_number: `P-${id}`,
  doc_date: "2026-10-05",
  supplier_id: "s1",
  supplier_name: "Ali",
  supplier_company: "Taxta MMC",
  total_amount: 100,
  paid_amount: 0,
  debt_amount: 100,
  status: "posted",
  warehouse_sent: false,
  warehouse_slip_status: null,
  created_at: "2026-10-05T10:00:00Z",
  ...extra,
});
const pdef = purchasesDefinition(purchasesModel({ fetchAll: async () => [], fetchOne: async () => null }));

test("purchases: record mapping keeps the classic debt, status and send state", () => {
  const r = purchaseToRecord(prow("a"));
  assert.equal(r.supplier_name, "Ali (Taxta MMC)");
  assert.equal(r.remaining, 100);
  assert.equal(r.payment_state, "unpaid");
  assert.equal(r.doc_status, "posted");
  assert.equal(r.warehouse_state, "not_sent");
  assert.equal(purchaseRemaining({ total_amount: 100, paid_amount: 30, debt_amount: 0 }), 70);
  assert.equal(purchaseRemaining({ total_amount: 100, paid_amount: 30, debt_amount: 50 }), 50);
  // Legacy labels: blank or "debtor" are posted, "Ləğv edildi" cancelled.
  assert.equal(purchaseToRecord(prow("b", { status: null })).doc_status, "posted");
  assert.equal(purchaseToRecord(prow("c", { status: "Borclu" })).doc_status, "posted");
  assert.equal(purchaseToRecord(prow("d", { status: "draft" })).doc_status, "draft");
  assert.equal(purchaseToRecord(prow("e", { supplier_name: null })).supplier_name, "Taxta MMC");
});

test("purchases: definition, filters and dashboard cards", () => {
  assert.deepEqual(validateDefinition(pdef), []);
  assert.equal(pdef.model.module, "purchases");
  assert.equal(pdef.model.readPermission, "can_view_purchases");
  assert.ok(pdef.fields.every((f) => f.readonly));
  const recs = [
    purchaseToRecord(prow("a", { doc_date: "2026-10-02" })),
    purchaseToRecord(prow("b", { doc_date: "2026-10-10", paid_amount: 100, debt_amount: 0, warehouse_sent: true, warehouse_slip_status: "approved" })),
    purchaseToRecord(prow("c", { doc_date: "2026-09-10", total_amount: 200, paid_amount: 50, debt_amount: 150 })),
    purchaseToRecord(prow("d", { status: "draft", total_amount: 999 })),
  ];
  const ctx = { userId: "u", now: NOW };
  const ids = (f) => recs.filter((r) => matchesFilters(r, purchaseFilters(), f, ctx)).map((r) => r.id).join("");
  assert.equal(ids(["this_month"]), "abd");
  assert.equal(ids(["last_month"]), "c");
  assert.equal(ids(["unpaid", "partial"]), "acd");
  assert.equal(ids(["not_sent"]), "ac");
  const k = Object.fromEntries(purchaseKpis(recs, fmt, NOW).map((x) => [x.key, x]));
  assert.equal(k.month.value, "200 common.currency");
  assert.equal(k.month.delta, 0);
  assert.equal(k.payable.value, "250 common.currency");
  assert.deepEqual(k.payable.filters, ["posted", "unpaid", "partial"]);
  assert.equal(k.drafts.value, "1");
  assert.equal(k.not_sent.value, "2");
});

// ── Inventory ────────────────────────────────────────────────────────────────

const noFetch = { fetchAll: async () => [] };

test("inventory: every definition is valid and keeps the classic permissions", () => {
  const defs = {
    stock: [inv.stockDefinition(noFetch), "can_view_products"],
    slips: [inv.slipsDefinition(noFetch), "can_view_warehouse_slips"],
    counts: [inv.countsDefinition(noFetch), "can_writeoff_inventory"],
    intake: [inv.intakeDefinition(noFetch), "can_manage_products"],
    writeoffs: [inv.writeoffsDefinition(noFetch), "can_writeoff_inventory"],
  };
  for (const [name, [def, permission]] of Object.entries(defs)) {
    assert.deepEqual(validateDefinition(def), [], name);
    assert.equal(def.model.module, "inventory", name);
    assert.equal(def.model.readPermission, permission, name);
    assert.ok(def.fields.every((f) => f.readonly), name);
  }
});

test("inventory stock: rows, filters and the classic KPI strip", () => {
  const row = (id, extra) => ({ id, productId: `p${id}`, sku: `S${id}`, name: `Item ${id}`, warehouseId: "w1", warehouseName: "Main", totalPhysical: 10, reserved: 0, available: 10, minLimit: 2, buyPrice: 3, valuation: 30, status: "in_stock", ...extra });
  const recs = [row("1"), row("2", { status: "low", totalPhysical: 2, valuation: 6 }), row("3", { status: "out", totalPhysical: 0, valuation: 0, reserved: 1 }), row("4", { productId: "p1", warehouseName: "Second", valuation: 12.345 })].map(inv.stockToRecord);
  assert.equal(recs[3].valuation, 12.35);
  assert.equal(recs[0].warehouse_id, "w1");
  const def = inv.stockDefinition(noFetch);
  const ids = (f) => recs.filter((r) => matchesFilters(r, def.filters, f, { userId: null, now: NOW })).map((r) => r.id).join("");
  assert.equal(ids(["low", "out"]), "23");
  assert.equal(ids(["reserved"]), "3");
  const k = Object.fromEntries(inv.stockKpis(recs, fmt).map((x) => [x.key, x.value]));
  assert.deepEqual(k, { items: "3", low: "1", out: "1", value: "48 common.currency" });
});

test("inventory slips: states, late deliveries and the dashboard", () => {
  const s = (id, extra) => inv.slipToRecord({ id, slip_number: `W-${id}`, type: "outbound", status: "pending", items: [{}, {}], created_at: "2026-10-14T08:00:00", ...extra });
  const recs = [
    s("1", { delivery_due_at: "2026-10-14T09:00:00" }),
    s("2", { delivery_due_at: "2026-10-14T18:00:00" }),
    s("3", { status: "approved", approved_at: "2026-10-03T10:00:00" }),
    s("4", { status: "rejected" }),
    s("5", { status: "weird" }),
  ];
  assert.equal(recs[0].item_count, 2);
  assert.equal(recs[4].status, "pending");
  const def = inv.slipsDefinition(noFetch);
  const ids = (f) => recs.filter((r) => matchesFilters(r, def.filters, f, { userId: null, now: NOW })).map((r) => r.id).join("");
  assert.equal(ids(["late"]), "1");
  assert.equal(ids(["approved", "rejected"]), "34");
  const k = Object.fromEntries(inv.slipKpis(recs, fmt, NOW).map((x) => [x.key, x.value]));
  assert.deepEqual(k, { pending: "3", late: "1", today: "2", approved: "1" });
});

test("inventory counts and intake documents: mapping and dashboards", () => {
  const c = (id, extra) => inv.countToRecord({ id, document_number: `C-${id}`, status: "in_progress", line_count: 8, counted_count: 2, total_surplus_value: 0, total_shortage_value: 0, total_variance_value: 0, category_name: "Panels", subcategory_name: null, ...extra });
  const counts = [c("1"), c("2", { status: "review", line_count: 0 }), c("3", { status: "posted", total_surplus_value: 10, total_shortage_value: 4.5, total_variance_value: 5.5 }), c("4", { status: "bogus" })];
  assert.equal(counts[0].progress, 25);
  assert.equal(counts[1].progress, 0);
  assert.equal(counts[0].scope, "Panels");
  assert.equal(counts[3].status, "draft");
  const ck = Object.fromEntries(inv.countKpis(counts, fmt).map((x) => [x.key, x.value]));
  assert.deepEqual(ck, { open: "3", review: "1", surplus: "10.00 common.currency", shortage: "4.50 common.currency" });
  const d = (id, extra) => inv.intakeToRecord({ id, document_number: `I-${id}`, doc_date: "2026-10-03", entry_type: "receipt", status: "posted", total_amount: 100, ...extra });
  const docs = [d("1"), d("2", { doc_date: "2026-09-03" }), d("3", { entry_type: "opening_balance", total_amount: 50 }), d("4", { status: "draft" })];
  const ik = Object.fromEntries(inv.intakeKpis(docs, fmt, NOW).map((x) => [x.key, x.value]));
  assert.deepEqual(ik, { drafts: "1", receipts: "100 common.currency", opening: "50 common.currency", posted: "3" });
});

test("inventory write-offs: lines, quantity and the month's figures", () => {
  const w = (id, extra) => inv.writeoffToRecord({ id, document_number: `D-${id}`, writeoff_date: "2026-10-02", warehouse_name: "Main", checker_name: "Kamal", items: [{ quantity: 2 }, { quantity: 1.5 }], ...extra });
  const recs = [w("1"), w("2", { writeoff_date: "2026-09-30", items: [{ quantity: 4 }] })];
  assert.equal(recs[0].item_count, 2);
  assert.equal(recs[0].quantity, 3.5);
  const k = Object.fromEntries(inv.writeoffKpis(recs, fmt, NOW).map((x) => [x.key, x.value]));
  assert.deepEqual(k, { month: "1", qty: "3.50", all: "2" });
});

// ── Contracts ────────────────────────────────────────────────────────────────

test("contracts: mapping, expiry filters and the classic stat cards", () => {
  const c = (id, extra) => con.contractToRecord({ id, contract_number: `M-${id}`, title: `T${id}`, type: "sale", status: "active", total_amount: 1000, advance_percentage: 30, attachment_path: null, ...extra });
  const recs = [
    c("1", { expiry_date: "2026-10-20" }),
    c("2", { expiry_date: "2026-10-01", type: "purchase", attachment_path: "x.pdf" }),
    c("3", { expiry_date: "2026-12-31", type: "service", advance_percentage: null }),
    c("4", { status: "cancelled", expiry_date: "2026-10-20" }),
    c("5", { status: "weird", type: "weird", total_amount: "", advance_percentage: "abc" }),
  ];
  assert.equal(recs[0].advance_amount, 300);
  assert.equal(recs[2].advance_amount, null);
  assert.equal(recs[4].status, "active");
  assert.equal(recs[4].type, "sale");
  assert.equal(recs[4].total_amount, null);
  assert.equal(recs[1].has_attachment, true);
  const def = con.contractsDefinition({ fetchAll: async () => [] });
  assert.deepEqual(validateDefinition(def), []);
  assert.equal(def.model.readPermission, "can_view_sales");
  const ids = (f) => recs.filter((r) => matchesFilters(r, def.filters, f, { userId: null, now: NOW })).map((r) => r.id).join("");
  assert.equal(ids(["expiring"]), "1");
  assert.equal(ids(["expired"]), "2");
  assert.equal(ids(["purchase", "service"]), "23");
  assert.equal(ids(["no_attachment", "active"]), "135");
  const k = Object.fromEntries(con.contractKpis(recs, fmt, NOW).map((x) => [x.key, x.value]));
  // Classic stats: active 4; sale+service vs purchase 4 / 1; expected advance on active contracts 300 + 300.
  assert.deepEqual(k, { active: "4", split: "4 / 1", advance: "600.00 common.currency", expiring: "1" });
});

// ── Consignment ──────────────────────────────────────────────────────────────

test("consignment: stock at partners, the document history and the classic cards", () => {
  const stock = [
    { id: "1", partner_id: "a", partner_name: "Nur", product_name: "Board", delivered_qty: 10, sold_qty: 4, returned_qty: 1, remaining_qty: 5, unit_price: 20, is_aging: false },
    { id: "2", partner_id: "b", partner_name: "Elm", product_name: "Edge", delivered_qty: 3, sold_qty: 0, returned_qty: 0, remaining_qty: 3, unit_price: 10, is_aging: true, aging_days: 120 },
    { id: "3", partner_id: "b", partner_name: "Elm", product_name: "Glue", delivered_qty: 2, sold_qty: 2, returned_qty: 0, remaining_qty: 0, unit_price: 5, is_aging: true },
  ].map(cons.partnerStockToRecord);
  assert.equal(stock[0].value, 100);
  const docs = cons.consignmentDocuments(
    [
      { id: "d1", dispatch_no: "D-1", partner_id: "a", dispatch_date: "2026-10-01", status: "delivered", sales_rep_name: "Rauf", items: [{ quantity: 2, unit_price: 10 }, { quantity: 1, unit_price: 5 }] },
      { id: "d2", dispatch_no: "IB-1", partner_id: "b", dispatch_date: "2026-01-01", status: "initial_balance", items: [{ quantity: 5, unit_price: 10 }] },
    ],
    [{ id: "r1", return_no: "R-1", partner_id: "a", return_date: "2026-10-05", items: [{ quantity: 1, unit_price: 10 }] }],
    [
      { id: "p1", report_no: "S-1", partner_id: "a", report_period: "2026-10", total_amount: 80, sales_rep_name: "Rauf", sold_items: [{}] },
      { id: "p2", report_no: "S-0", partner_id: "a", report_period: "2026-09", total_amount: 30, sold_items: [] },
    ]
  );
  assert.deepEqual(docs.map((d) => [d.doc_no, d.document_type, d.total_value]), [["R-1", "RETURN", 10], ["D-1", "DISPATCH", 25], ["S-1", "ACTUAL_SALE", 80], ["S-0", "ACTUAL_SALE", 30], ["IB-1", "INITIAL_BALANCE", 50]]);
  assert.equal(docs.find((d) => d.doc_no === "S-1").date, "2026-10-01");
  assert.deepEqual(validateDefinition(cons.partnerStockDefinition({ fetchAll: async () => [] })), []);
  const ddef = cons.documentsDefinition({ fetchAll: async () => [] });
  assert.deepEqual(validateDefinition(ddef), []);
  assert.equal(ddef.model.readPermission, "can_view_consignments");
  const sdef = cons.partnerStockDefinition({ fetchAll: async () => [] });
  assert.deepEqual(stock.filter((r) => matchesFilters(r, sdef.filters, ["aging"], { userId: null, now: NOW })).map((r) => r.id), ["2"]);
  const now = new Date(Date.UTC(2026, 9, 14, 12));
  const k = Object.fromEntries(cons.consignmentKpis(stock, docs, fmt, now).map((x) => [x.key, x.value]));
  // Classic: stock value = remaining × price; sold this month = this period's reports; aging = aging lines' value.
  assert.deepEqual(k, { stock: "130.00 common.currency", sold: "80.00 common.currency", aging: "30.00 common.currency", partners: "2" });
  // Rep chart: opening balances and returns left out.
  assert.deepEqual(cons.repPerformance(docs, "—"), [{ repName: "Rauf", dispatched: 25, sold: 80 }, { repName: "—", dispatched: 0, sold: 30 }]);
});

// ── Commissions ──────────────────────────────────────────────────────────────

test("commissions: sellers as the classic list names them, and its cards", () => {
  const employees = new Map([["e1", { full_name: "Leyla", department: "sales" }]]);
  const recs = [
    { id: "1", employee_id: "e1", seller_name: "old name", sale_id: "s1", sale_doc_no: "S-1", sale_amount: 1000, commission_rate: 2, commission_amount: 20, created_at: "2026-10-03T10:00:00Z" },
    { id: "2", employee_id: null, seller_name: "Rauf", sale_amount: 500, commission_rate: 3, commission_amount: 15, created_at: "2026-09-03T10:00:00Z" },
    { id: "3", employee_id: "e1", sale_amount: 200, commission_rate: 2.5, commission_amount: 5, created_at: "2026-10-10T10:00:00Z" },
  ].map((r) => com.commissionToRecord(r, employees));
  assert.deepEqual(recs.map((r) => [r.seller_key, r.seller_name, r.department]), [["e1", "Leyla", "sales"], ["Rauf", "Rauf", "general"], ["e1", "Leyla", "sales"]]);
  const def = com.commissionsDefinition({ fetchAll: async () => [] }, [{ value: "sales", label: "Sales" }]);
  assert.deepEqual(validateDefinition(def), []);
  assert.equal(def.model.readPermission, "can_view_commissions");
  const k = Object.fromEntries(com.commissionKpis(recs, fmt, NOW).map((x) => [x.key, x.value]));
  assert.deepEqual(k, { rows: "3", total: "40.00 common.currency", sellers: "2", month: "25.00 common.currency" });
});

// ── Expenses ─────────────────────────────────────────────────────────────────

test("expenses: approval stages, filters and the classic summary", () => {
  const e = (id, extra) => exp.expenseToRecord({ id, code: `E-${id}`, expense_date: "2026-10-05", status: "posted", payment_mode: "company", category: "Fuel", net_amount: 100, vat_amount: 18, amount: 118, attachment_count: 1, is_production: false, ...extra });
  const recs = [
    e("1"),
    e("2", { status: "draft", amount: 50 }),
    e("3", { status: "submitted", amount: 20 }),
    e("4", { status: "approved", payment_mode: "employee", amount: 30, attachment_count: 0 }),
    e("5", { status: "cancelled", amount: 999 }),
    e("6", { expense_date: "2026-09-20", amount: 10, category: "" }),
  ];
  assert.deepEqual(recs.map((r) => r.stage), ["posted", "draft", "submitted", "owed", "cancelled", "posted"]);
  assert.equal(recs[5].category, "—");
  const def = exp.expensesDefinition({ fetchAll: async () => [] });
  assert.deepEqual(validateDefinition(def), []);
  assert.equal(def.model.readPermission, "can_view_expenses");
  const ids = (f) => recs.filter((r) => matchesFilters(r, def.filters, f, { userId: null, now: NOW })).map((r) => r.id).join("");
  assert.equal(ids(["pending"]), "23");
  assert.equal(ids(["owed"]), "4");
  assert.equal(ids(["booked", "this_month"]), "14");
  assert.equal(ids(["last_month"]), "6");
  assert.equal(ids(["no_receipt", "active"]), "4");
  const k = Object.fromEntries(exp.expenseKpis(recs, fmt, NOW).map((x) => [x.key, x.value]));
  // Classic summary: booked = posted + approved (owed), cancelled out; pending = draft + submitted.
  assert.deepEqual(k, { month: "148 common.currency", total: "158.00 common.currency", pending: "70.00 common.currency", owed: "30.00 common.currency" });
});

// ── HR ───────────────────────────────────────────────────────────────────────

test("hr: the employees route keeps the classic page while NEW_UI is off, payroll tabs included", () => {
  assert.match(read("src/app/employees/page.tsx"), /if \(!isNewUiEnabled\(\)\) return <EmployeesPageClient \/>;/);
  const sw = read("src/app/employees/new-ui-switch.tsx");
  assert.match(sw, /return active \? <EmployeesScreen extraTabs=\{isEnabled\("payroll"\) \? PAYROLL_EMPLOYEE_TABS : \[\]\} \/> : <EmployeesPageClient \/>;/);
  assert.match(read("src/app/employees/page.client.tsx"), /<EmployeesPage extraTabs=\{isEnabled\("payroll"\) \? PAYROLL_EMPLOYEE_TABS : \[\]\} \/>/);
});

test("hr: directory with the classic paid-leave balance, leaves, filters and cards", () => {
  const leaves = [
    { id: "l1", employee_id: "e1", leave_type: "PAID", status: "APPROVED", start_date: "2026-03-01", end_date: "2026-03-05", days_count: 5, employees: { full_name: "Leyla" } },
    { id: "l2", employee_id: "e1", leave_type: "PAID", status: "PENDING", start_date: "2026-11-01", end_date: "2026-11-03", days_count: 3 },
    { id: "l3", employee_id: "e1", leave_type: "PAID", status: "APPROVED", start_date: "2025-12-20", end_date: "2025-12-24", days_count: 4 },
    { id: "l4", employee_id: "e2", leave_type: "SICK", status: "APPROVED", start_date: "2026-10-13", end_date: "2026-10-15", days_count: 3 },
  ];
  const used = hr.paidLeaveUsed(leaves, NOW);
  assert.equal(used.get("e1"), 5);
  const emps = [
    hr.employeeToRecord({ id: "e1", employee_code: "E1", full_name: "Leyla", status: "active", base_salary: 1200, contract_end_date: "2026-11-01" }, used),
    hr.employeeToRecord({ id: "e2", employee_code: "E2", full_name: "Rauf", status: "on_leave", base_salary: 900 }, used),
    hr.employeeToRecord({ id: "e3", employee_code: "E3", full_name: "Old", status: "inactive", base_salary: 500 }, used),
  ];
  assert.equal(emps[0].paid_leave_left, 16);
  assert.equal(emps[1].paid_leave_left, 21);
  const edef = hr.employeesDefinition({ fetchAll: async () => [] }, [{ value: "sales", label: "Sales" }]);
  assert.deepEqual(validateDefinition(edef), []);
  assert.equal(edef.model.readPermission, "can_view_hr");
  assert.deepEqual(emps.filter((r) => matchesFilters(r, edef.filters, ["contract_ending"], { userId: null, now: NOW })).map((r) => r.id), ["e1"]);
  const ek = Object.fromEntries(hr.employeeKpis(emps, fmt, NOW).map((x) => [x.key, x.value]));
  assert.deepEqual(ek, { active: "1", on_leave: "1", payroll: "1,200 common.currency", contracts: "1" });
  const lrecs = leaves.map(hr.leaveToRecord);
  assert.equal(lrecs[0].employee_name, "Leyla");
  const ldef = hr.leavesDefinition({ fetchAll: async () => [] });
  assert.deepEqual(validateDefinition(ldef), []);
  const ids = (f) => lrecs.filter((r) => matchesFilters(r, ldef.filters, f, { userId: null, now: NOW })).map((r) => r.id).join("");
  assert.equal(ids(["current"]), "l4");
  assert.equal(ids(["upcoming"]), "l2");
  const lk = Object.fromEntries(hr.leaveKpis(lrecs, fmt, NOW).map((x) => [x.key, x.value]));
  assert.deepEqual(lk, { pending: "1", today: "1", paid_days: "5", sick: "3" });
});
