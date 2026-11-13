// LOT-4: the lot screens. List rows and filters, the card's figures and links, the financial
// figures gate, the lot search of the barcode lookup and the palette, and that nothing shows
// while LOT_TRACKING is off. The reads are tested in supabase/tests/lot_ui.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  counterpartyHref,
  daysUntil,
  exactLotMatch,
  expiryWindowConditions,
  gateLotCard,
  groupTrace,
  lotCardHref,
  lotDocHref,
  lotEditChanges,
  lotKpis,
  lotRowRefs,
  lotSearchTerm,
  lotStatusActions,
  lotToListRecord,
  lotsOfProductHref,
  materialLotsOf,
  movementFromRpc,
  nextMovementsOffset,
  statusOfAction,
  traceRowFromRpc,
} from "../src/modules/inventory/lib/lotScreens.ts";
import { lotFilters, lotKpiCards, lotsDefinition } from "../src/modules/inventory/views/lots.ts";
import { matchesFilters, matchesSearch, validateDefinition } from "../src/views/logic.ts";
import { extraItemsFor, SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { CHATTER_MODELS, recordHref } from "../src/views/chatter/logic.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const TODAY = "2026-11-14";
const WH = new Map([
  ["w1", "Əsas anbar"],
  ["w2", "Mağaza"],
]);
const CTX = { userId: null, now: new Date("2026-11-14T10:00:00Z") };
const fmt = { t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: "en" };

const row = (over = {}) => ({
  id: "lot-1",
  lot_no: "LOT-2026-00001",
  supplier_batch_no: "B-77",
  product_id: "p1",
  status: "active",
  origin_type: "import",
  origin_doc_no: "IMP-0003",
  supplier_id: "s1",
  supplier_name: "Kronospan",
  import_shipment_id: "i1",
  import_shipment_no: "IMP-0003",
  customs_declaration_no: "GD-1",
  mfg_date: "2026-01-01",
  exp_date: "2026-12-01",
  received_date: "2026-02-01",
  qty_received: 100,
  created_at: "2026-02-01T08:00:00Z",
  products: { name: "Laminat", code: "LM-1", barcode: "4760001", unit: "m2" },
  stock_lot_balances: [
    { warehouse_id: "w1", qty: 30 },
    { warehouse_id: "w2", qty: 12.5 },
  ],
  ...over,
});

// ── List rows ─────────────────────────────────────────────────────────────────

test("a lot row becomes a list record with totals, warehouses and expiry state", () => {
  const r = lotToListRecord(row(), { today: TODAY, warehouseNames: WH });
  assert.equal(r.on_hand, 42.5);
  assert.equal(r.warehouses, ["Əsas anbar", "Mağaza"].sort((a, b) => a.localeCompare(b)).join(", "));
  assert.equal(r["wh:w1"], 30);
  assert.equal(r["wh:w2"], 12.5);
  assert.equal(r.days_left, 17);
  assert.equal(r.expiry_state, "near");
  assert.equal(r.has_stock, "yes");
  assert.equal(r.supplier_name, "Kronospan");
  assert.equal(r.import_shipment_no, "IMP-0003");
  assert.equal(r.product_code, "LM-1");
});

test("a lot without stock, expired, with names from the balances", () => {
  const r = lotToListRecord(row({ exp_date: "2026-11-01", stock_lot_balances: [{ warehouse_id: "w9", qty: 0, warehouse_name: "Köhnə" }] }), { today: TODAY, warehouseNames: WH });
  assert.equal(r.on_hand, 0);
  assert.equal(r.has_stock, null);
  assert.equal(r.warehouses, "");
  assert.equal(r.expiry_state, "expired");
  assert.equal(r.days_left, -13);
  const named = lotToListRecord(row({ stock_lot_balances: [{ warehouse_id: "w9", qty: 3, warehouse_name: "Köhnə" }] }), { today: TODAY, warehouseNames: WH });
  assert.equal(named.warehouses, "Köhnə");
});

test("unknown status and origin fall back safely; refs are deduplicated", () => {
  const r = lotToListRecord(row({ status: "weird", origin_type: "x" }), { today: TODAY, warehouseNames: WH });
  assert.equal(r.status, "active");
  assert.equal(r.origin_type, "manual");
  assert.deepEqual(lotRowRefs([row(), row(), row({ supplier_id: null, import_shipment_id: "i2" })]), { supplierIds: ["s1"], shipmentIds: ["i1", "i2"] });
  assert.equal(daysUntil(null, TODAY), null);
  assert.equal(daysUntil("bad", TODAY), null);
});

// ── List filters and search ──────────────────────────────────────────────────

const def = lotsDefinition({ fetchAll: async () => [] }, { today: () => TODAY, warehouses: [...WH].map(([id, name]) => ({ id, name })), warehouseNames: WH });
const records = [
  lotToListRecord(row(), { today: TODAY, warehouseNames: WH }),
  lotToListRecord(row({ id: "lot-2", lot_no: "LOT-2026-00002", supplier_batch_no: null, exp_date: "2026-10-01", status: "quarantine", stock_lot_balances: [{ warehouse_id: "w1", qty: 5 }] }), { today: TODAY, warehouseNames: WH }),
  lotToListRecord(row({ id: "lot-3", lot_no: "LOT-2026-00003", exp_date: "2027-06-01", stock_lot_balances: [] }), { today: TODAY, warehouseNames: WH }),
  lotToListRecord(row({ id: "lot-4", lot_no: "LOT-2026-00004", exp_date: "2027-01-20", stock_lot_balances: [{ warehouse_id: "w2", qty: 1 }] }), { today: TODAY, warehouseNames: WH }),
];
const ids = (active) => records.filter((r) => matchesFilters(r, def.filters, active, CTX)).map((r) => r.id);

test("the lot list definition is valid and lists the asked columns", () => {
  assert.deepEqual(validateDefinition(def), []);
  assert.equal(def.model.readPermission, "can_view_lots");
  for (const f of ["lot_no", "product_id", "supplier_batch_no", "status", "exp_date", "on_hand", "warehouses"]) assert.ok(def.list.columns.includes(f), f);
  assert.deepEqual(def.valueFilters.map((v) => v.field), ["product_id", "supplier_id", "import_shipment_id"]);
});

test("filters: status, expiry windows, stock and warehouse", () => {
  assert.deepEqual(ids(["quarantine"]), ["lot-2"]);
  assert.deepEqual(ids(["expired"]), ["lot-2"]);
  assert.deepEqual(ids(["exp30"]), ["lot-1"]);
  assert.deepEqual(ids(["exp90"]), ["lot-1", "lot-4"]);
  assert.deepEqual(ids(["has_stock"]), ["lot-1", "lot-2", "lot-4"]);
  assert.deepEqual(ids(["no_stock"]), ["lot-3"]);
  assert.deepEqual(ids(["wh:w2"]), ["lot-1", "lot-4"]);
  // OR inside a group, AND between groups.
  assert.deepEqual(ids(["wh:w1", "wh:w2", "exp90"]), ["lot-1", "lot-4"]);
  assert.deepEqual(expiryWindowConditions("expired"), [{ field: "days_left", op: "lt", value: 0 }]);
  assert.equal(lotFilters([]).some((f) => f.group === "warehouse"), false);
});

test("search finds a lot by lot no, supplier batch, product name, code and barcode", () => {
  const find = (q) => records.filter((r) => matchesSearch(r, def, q, fmt)).map((r) => r.id);
  assert.deepEqual(find("00002"), ["lot-2"]);
  assert.deepEqual(find("B-77"), ["lot-1", "lot-3", "lot-4"]);
  assert.equal(find("laminat").length, 4);
  assert.equal(find("LM-1").length, 4);
  assert.equal(find("4760001").length, 4);
});

test("list cards: with stock, expired with stock, expiring within 30 days, quarantine", () => {
  const cards = lotKpiCards(records, { t: (k) => k, locale: "en" });
  assert.deepEqual(cards.map((c) => [c.key, c.value]), [["stock", "3"], ["expired", "1"], ["soon", "1"], ["quarantine", "1"]]);
  assert.deepEqual(cards[1].filters, ["expired", "has_stock"]);
});

// ── Card ─────────────────────────────────────────────────────────────────────

test("card figures: rounded, never negative except on hand", () => {
  assert.deepEqual(lotKpis({ received: "100", on_hand: -0.0001, sold: 40.12345, written_off: -2, at_partners: 3, in_production: null, movement_count: 7 }), {
    received: 100,
    onHand: -0,
    sold: 40.123,
    writtenOff: 0,
    atPartners: 3,
    inProduction: 0,
    movementCount: 7,
  });
  assert.equal(lotKpis(null).received, 0);
});

test("unit cost is removed without the financial figures permission", () => {
  const card = { id: "x", lotNo: "L", kpis: lotKpis({}), unitCost: 12.5 };
  assert.equal(gateLotCard(card, true).unitCost, 12.5);
  assert.equal("unitCost" in gateLotCard(card, false), false);
  // The server action decides it from the profile, never from the browser.
  const src = read("src/modules/inventory/actions/lotScreens.ts");
  assert.match(src, /const financials = isAdminRole\(ctx\.profile\?\.role\) \|\| canViewFinancials\(ctx\.profile\)/);
  assert.match(src, /gateLotCard\(card, financials\)/);
  assert.match(src, /if \(financials && typeof lot\.inventory_batch_id === "string"\)/);
});

test("document, counterparty and product links", () => {
  assert.equal(lotDocHref("sale", "s 1"), "/sales/s%201");
  assert.equal(lotDocHref("purchase", "p1"), "/purchases?record=p1");
  assert.equal(lotDocHref("import_receipt", "r1", { importShipmentId: "i1" }), "/imports/i1");
  assert.equal(lotDocHref("production_delivery", "o1"), "/production/o1");
  assert.equal(lotDocHref("inventory_count", "c1"), "/inventory/counts/c1");
  assert.equal(lotDocHref("stock_transfer", "t1"), null);
  assert.equal(lotDocHref(null, "x"), null);
  assert.equal(counterpartyHref("customer", "c1"), "/customers?record=c1");
  assert.equal(counterpartyHref("partner", "p1"), "/consignments");
  assert.equal(counterpartyHref("customer", null), null);
  assert.equal(lotCardHref("a/b"), "/inventory/lots/a%2Fb");
  assert.equal(lotsOfProductHref("p1"), "/inventory/lots?product=p1");
});

test("forward trace grouped by customer, largest first; movements and pages", () => {
  const rows = [
    { counterparty_type: "customer", counterparty_id: "c1", doc_type: "sale", doc_id: "s1", doc_no: "S-1", qty: "3", first_date: "2026-03-02" },
    { counterparty_type: "customer", counterparty_id: "c2", doc_type: "sale", doc_id: "s2", doc_no: "S-2", qty: 10, first_date: "2026-03-01" },
    { counterparty_type: "customer", counterparty_id: "c1", doc_type: "sale", doc_id: "s3", doc_no: "S-3", qty: 9, first_date: "2026-02-01" },
    { counterparty_type: "partner", counterparty_id: "pa", doc_type: "consignment", doc_id: null, doc_no: "K-1, K-2", qty: 4, first_date: "2026-04-01" },
  ].map(traceRowFromRpc);
  const groups = groupTrace(rows, new Map([["c1", "Aysel"], ["c2", "Bakı Mebel"], ["pa", "Partner MMC"]]));
  assert.deepEqual(groups.map((g) => [g.name, g.qty]), [["Aysel", 12], ["Bakı Mebel", 10], ["Partner MMC", 4]]);
  assert.deepEqual(groups[0].rows.map((r) => r.docNo), ["S-3", "S-1"]);
  const m = movementFromRpc({ id: "m1", movement_date: "2026-03-01T10:00:00Z", warehouse_id: "w1", qty_delta: "-2.5", running_balance: 97.5, kind: "out", doc_type: "sale", doc_id: "s1", doc_no: "S-1", counterparty_type: "customer", counterparty_id: "c1", pick_mode: "fefo", created_by: "u1" }, WH);
  assert.deepEqual([m.qty, m.balance, m.warehouseName, m.pickMode], [-2.5, 97.5, "Əsas anbar", "fefo"]);
  assert.equal(nextMovementsOffset(50, 120), 50);
  assert.equal(nextMovementsOffset(120, 120), null);
  assert.deepEqual(materialLotsOf({ material_lots: [{ lot_id: "a", lot_no: "L-A", qty: 2 }, { lot_no: "no id" }] }), [{ lotId: "a", lotNo: "L-A", qty: 2 }]);
});

test("status actions and edit changes", () => {
  assert.deepEqual(lotStatusActions("active", 5), ["quarantine"]);
  assert.deepEqual(lotStatusActions("active", 0), ["quarantine", "close"]);
  assert.deepEqual(lotStatusActions("quarantine", 3), ["release"]);
  assert.deepEqual(lotStatusActions("closed", 0), ["release"]);
  assert.equal(statusOfAction("release"), "active");
  assert.equal(statusOfAction("close"), "closed");
  const before = { lotNo: "L-1", supplierBatchNo: "B", mfgDate: "2026-01-01", expDate: null, notes: null };
  assert.deepEqual(lotEditChanges(before, { lotNo: " L-1 ", supplierBatchNo: "B", mfgDate: "2026-01-01", expDate: null, notes: "  " }), {});
  assert.deepEqual(lotEditChanges(before, { lotNo: "L-2", supplierBatchNo: "", mfgDate: "2026-01-01", expDate: "2027-01-01", notes: "ok" }), {
    lotNo: "L-2",
    supplierBatchNo: null,
    expDate: "2027-01-01",
    notes: "ok",
  });
});

// ── Barcode lookup and palette ───────────────────────────────────────────────

test("a scanned code opens the lot: exact lot no first, else a unique supplier batch", () => {
  const lots = [
    { id: "1", lot_no: "LOT-2026-00010", supplier_batch_no: "B-1" },
    { id: "2", lot_no: "LOT-2026-00011", supplier_batch_no: "B-1" },
    { id: "3", lot_no: "LOT-2026-00012", supplier_batch_no: "B-9" },
  ];
  assert.equal(exactLotMatch("lot-2026-00011", lots)?.id, "2");
  assert.equal(exactLotMatch(" B-9 ", lots)?.id, "3");
  assert.equal(exactLotMatch("B-1", lots), null, "a batch shared by two lots is ambiguous");
  assert.equal(exactLotMatch("LOT-2026", lots), null);
  assert.equal(lotSearchTerm("ab"), null);
  assert.equal(lotSearchTerm("  LOT-1%,(x)  "), "LOT-1x");
  assert.equal(lotSearchTerm("x".repeat(81)), null);
});

test("the barcode route answers a lot before the product lookup; the scan modal opens it", () => {
  const route = read("src/app/api/lookup-barcode/route.ts");
  const lotAt = route.indexOf("exactLotMatch(barcode, await findLotsAction(barcode))");
  assert.ok(lotAt > 0);
  assert.ok(lotAt < route.indexOf("lookupBarcodeWithConfig("), "lots are checked before the external lookup");
  assert.match(route, /kind: "lot"/);
  assert.match(route, /href: lotCardHref\(lot\.id\)/);
  const modal = read("src/components/products/QuickScanModal.tsx");
  assert.match(modal, /payload\.kind === "lot" && payload\.href/);
  // The search refuses without the flag or lots.view (an empty list).
  const actions = read("src/modules/inventory/actions/lotScreens.ts");
  assert.match(actions, /try \{\s+await requireLots\(\);\s+\} catch \{\s+return \[\];/);
  assert.match(read("src/modules/inventory/components/LotPaletteSearch.ts"), /useLotTracking\(\) && can\("can_view_lots"\)/);
});

// ── Flag off ─────────────────────────────────────────────────────────────────

test("flag off: the routes 404 and no menu item shows", () => {
  for (const p of ["src/app/inventory/lots/page.tsx", "src/app/inventory/lots/[id]/page.tsx"]) {
    const src = read(p);
    assert.match(src, /lotScreensVisible\(\)\)\)? notFound\(\)/, p);
    assert.match(src, /notFound\(\)/, p);
  }
  const gate = read("src/lib/features/lotTrackingServer.ts");
  assert.match(gate, /if \(!isLotTrackingEnabled\(\)\) return false;/);
  const lots = (flags) => extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: false, ...flags }).filter((e) => e.path === "/inventory/lots");
  assert.equal(lots({}).length, 0);
  assert.equal(lots({ lotTracking: false }).length, 0);
  assert.equal(lots({ lotTracking: true }).length, 1);
  // Products row menu and stock screen only with the flag (and lots.view).
  assert.match(read("src/components/products/ProductTable.tsx"), /const lotsMenu = useLotTracking\(\) && can\("can_view_lots"\);/);
  assert.match(read("src/modules/inventory/components/InventoryScreens.tsx"), /const lots = useLotTracking\(\) && can\("can_view_lots"\);/);
  // The route needs lots.view.
  assert.match(read("src/modules/inventory/manifest.ts"), /\{ prefix: "\/inventory\/lots", permission: "can_view_lots" \}/);
  const manifest = read("src/modules/inventory/manifest.ts");
  assert.ok(manifest.indexOf('"/inventory/lots"') < manifest.indexOf('{ prefix: "/inventory", permission'), "the lots rule comes before /inventory");
});

test("every action checks the flag and lots.view / lots.manage on the server", () => {
  const src = read("src/modules/inventory/actions/lotScreens.ts");
  assert.match(src, /if \(!isLotTrackingEnabled\(\)\) throw new ActionAuthError\("lots\.screens\.errors\.disabled"\);/);
  const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  for (const name of exported) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    const next = body.indexOf("\nexport ", 10);
    assert.match(next > 0 ? body.slice(0, next) : body, /requireLots\(/, name);
  }
  assert.match(src, /export async function updateLotAction[\s\S]*?requireLots\("manage"\)/);
  assert.match(src, /export async function setLotStatusAction[\s\S]*?requireLots\("manage"\)/);
});

// ── Chatter, migration, i18n ─────────────────────────────────────────────────

test("lots carry chatter and the read functions check lots.view", () => {
  assert.ok(CHATTER_MODELS.includes("stock_lots"));
  assert.equal(recordHref("stock_lots", "x"), "/inventory/lots/x");
  const sql = read("supabase/migrations/20261115130000_lot_ui.sql");
  for (const fn of ["lot_card_summary", "lot_movements_page", "lot_trace_forward"]) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
    assert.match(body.slice(0, 1200), /SECURITY INVOKER[\s\S]*IF NOT public\.lots_can\('view'\)/, fn);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`), fn);
  }
  assert.match(sql, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 500\)/, "a page has at most 500 movements");
});

const get = (obj, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
const leaves = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

test("every lot screen text exists in az, en and ru", () => {
  const keys = leaves(enMessages.lots.screens, "lots.screens.");
  assert.ok(keys.length > 100);
  for (const [lang, m] of Object.entries({ az: azMessages, ru: ruMessages })) {
    for (const k of keys) assert.equal(typeof get(m, k), "string", `${lang}: ${k}`);
    assert.deepEqual(leaves(m.lots.screens, "lots.screens.").sort(), [...keys].sort(), lang);
  }
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.equal(typeof get(m, "nav.items.lots"), "string");
    assert.equal(typeof get(m, "views.chatter.models.stock_lots"), "string");
  }
  // Every literal key the screens use exists.
  const used = ["LotsScreen.tsx", "LotCardScreen.tsx", "LotPaletteSearch.ts", "InventoryScreens.tsx"]
    .map((f) => read(`src/modules/inventory/components/${f}`))
    .concat(read("src/modules/inventory/views/lots.ts"), read("src/components/products/ProductTable.tsx"))
    .flatMap((src) => [...src.matchAll(/"(lots\.screens\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]));
  for (const k of new Set(used)) assert.equal(typeof get(enMessages, k), "string", k);
});
