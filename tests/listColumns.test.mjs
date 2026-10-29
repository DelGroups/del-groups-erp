// List columns and Excel export (prompt 24c): the column model (defaults, merge with new
// definitions, required columns, order, corrupted storage), the flag, the view engine's columns,
// favourites with columns, user names, the .xlsx writer (types, bold frozen header, names), the
// migrations, and that no list export writes CSV any more.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  columnLabelKey,
  columnPrefsKey,
  columnsForFlag,
  defaultColumnPrefs,
  loadColumnPrefs,
  mergeColumnPrefs,
  moveColumn,
  resetColumnPrefs,
  saveColumnPrefs,
  setColumnOrder,
  toggleColumn,
  visibleColumns,
} from "../src/lib/lists/columns.ts";
import {
  buildXlsxSheet,
  excelSerial,
  patchSheetXml,
  patchStylesXml,
  toXlsxCell,
  writeXlsxBytes,
  xlsxFileName,
  xlsxSheetName,
} from "../src/lib/export/exportXlsx.ts";
import { attachProfileNames, collectProfileIds, fetchProfileDisplayNames, profileName, withProfileNames } from "../src/lib/profiles/displayNames.ts";
import { isListColumnsEnabled } from "../src/lib/features/listColumns.ts";
import { exportColumns, groupRecords, listColumnDefs, listFieldLabel, sanitizeSearchState, shownListColumns, sumBy } from "../src/views/logic.ts";
import { salesDefinition, salesModel, saleToRecord } from "../src/modules/sales/views/sales.ts";
import { purchasesDefinition, purchasesModel } from "../src/modules/purchases/views/purchases.ts";
import { PRODUCT_COLUMNS, getDefaultColumnVisibility } from "../src/lib/products/columns.ts";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const root = join(fileURLToPath(import.meta.url), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fmt = { t: (k) => k, locale: "en" };

const DEFS = [
  { key: "no", labelKey: "n", defaultVisible: true, required: true },
  { key: "date", labelKey: "d", defaultVisible: true, offLabelKey: "common.date" },
  { key: "amount", labelKey: "a", defaultVisible: true, numeric: true },
  { key: "issued_at", labelKey: "i", defaultVisible: true, standard: true },
  { key: "note", labelKey: "x", defaultVisible: false },
];

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

// ── Column model ─────────────────────────────────────────────────────────────

test("defaults: visible keys and the full order", () => {
  assert.deepEqual(defaultColumnPrefs(DEFS), { visible: ["no", "date", "amount", "issued_at"], order: ["no", "date", "amount", "issued_at", "note"] });
  assert.equal(columnPrefsKey("sales.invoices", "u1"), "del-groups-erp-cols-sales.invoices-u1");
});

test("merge: unknown keys dropped, new columns get their default at their place, order kept", () => {
  const stored = { visible: ["amount", "gone", "no"], order: ["amount", "no", "gone", "date", "note"] };
  const prefs = mergeColumnPrefs(DEFS, stored);
  // issued_at is new since the choice was stored: it goes right after "amount", its nearest
  // predecessor in the definition, and is shown (its default).
  assert.deepEqual(prefs.order, ["amount", "issued_at", "no", "date", "note"]);
  assert.deepEqual(prefs.visible, ["amount", "issued_at", "no"]);
});

test("merge: required columns are always visible, at least one column stays", () => {
  assert.ok(mergeColumnPrefs(DEFS, { visible: ["note"], order: DEFS.map((d) => d.key) }).visible.includes("no"));
  const none = mergeColumnPrefs([{ key: "a", defaultVisible: true }, { key: "b", defaultVisible: false }], { visible: [], order: ["b", "a"] });
  assert.deepEqual(none, { visible: ["a"], order: ["a", "b"] });
});

test("merge: corrupted or foreign values give the defaults", () => {
  for (const bad of [null, "x", 42, [], { visible: "no", order: 5 }, { visible: [1, 2], order: [null] }]) {
    assert.deepEqual(mergeColumnPrefs(DEFS, bad), defaultColumnPrefs(DEFS), JSON.stringify(bad));
  }
});

test("toggle, move and reorder", () => {
  let prefs = defaultColumnPrefs(DEFS);
  prefs = toggleColumn(DEFS, prefs, "note");
  assert.ok(prefs.visible.includes("note"));
  prefs = toggleColumn(DEFS, prefs, "no");
  assert.ok(prefs.visible.includes("no"), "required stays");
  prefs = moveColumn(prefs, "amount", -1);
  assert.deepEqual(visibleColumns(DEFS, prefs).map((d) => d.key), ["no", "amount", "date", "issued_at", "note"]);
  assert.deepEqual(moveColumn(prefs, "no", -1), prefs, "first cannot move up");
  prefs = setColumnOrder(prefs, ["note", "no"]);
  assert.deepEqual(prefs.order.slice(0, 2), ["note", "no"]);
  assert.equal(prefs.order.length, DEFS.length);
  const single = { visible: ["date"], order: ["no", "date"] };
  assert.deepEqual(toggleColumn([{ key: "no", defaultVisible: false }, { key: "date", defaultVisible: true }], single, "date"), single, "last visible stays");
});

test("storage: per list and user, survives a reload, reset, and never throws", () => {
  const storage = memoryStorage();
  const prefs = toggleColumn(DEFS, defaultColumnPrefs(DEFS), "note");
  saveColumnPrefs("sales.invoices", "u1", prefs, storage);
  assert.deepEqual(loadColumnPrefs("sales.invoices", "u1", DEFS, storage), prefs);
  assert.deepEqual(loadColumnPrefs("sales.invoices", "u2", DEFS, storage), defaultColumnPrefs(DEFS), "other user");
  storage.setItem(columnPrefsKey("sales.invoices", "u1"), "{not json");
  assert.deepEqual(loadColumnPrefs("sales.invoices", "u1", DEFS, storage), defaultColumnPrefs(DEFS));
  resetColumnPrefs("sales.invoices", "u1", storage);
  assert.equal(storage.data.size, 0);
  const throwing = { getItem: () => { throw new Error("private"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("x"); } };
  assert.deepEqual(loadColumnPrefs("l", "u", DEFS, throwing), defaultColumnPrefs(DEFS));
  saveColumnPrefs("l", "u", prefs, throwing);
  resetColumnPrefs("l", "u", throwing);
});

test("flag off: exactly today's columns and labels; on: the user's choice", () => {
  const prefs = toggleColumn(DEFS, defaultColumnPrefs(DEFS), "note");
  assert.deepEqual(columnsForFlag(DEFS, false, prefs).map((d) => d.key), ["no", "date", "amount"]);
  assert.deepEqual(columnsForFlag(DEFS, true, prefs).map((d) => d.key), ["no", "date", "amount", "issued_at", "note"]);
  assert.equal(columnLabelKey(DEFS[1], false), "common.date");
  assert.equal(columnLabelKey(DEFS[1], true), "d");
  assert.equal(isListColumnsEnabled({}), false);
  assert.equal(isListColumnsEnabled({ LIST_COLUMNS: " TRUE " }), true);
  assert.equal(isListColumnsEnabled({ LIST_COLUMNS: "1" }), false);
});

test("products page keeps its columns on the shared model", () => {
  assert.deepEqual(
    getDefaultColumnVisibility(),
    Object.fromEntries(PRODUCT_COLUMNS.map((c) => [c.key, c.defaultVisible]))
  );
  const src = read("src/lib/products/columns.ts");
  assert.match(src, /mergeColumnPrefs/);
  assert.match(src, /COLUMN_VISIBILITY_STORAGE_KEY = `\$\{PRODUCT_SLUG\}-products-columns`/, "same storage key: saved choices stay");
});

// ── View engine ──────────────────────────────────────────────────────────────

const salesDef = salesDefinition(salesModel({}));
const sale = (over) =>
  saleToRecord({ id: "s1", doc_no: "S-1", doc_date: "2026-10-01", total_amount: 100, paid_amount: 40, status: "posted", created_at: "2026-10-03T09:30:00Z", created_by_name: "Leyla", issued_by_name: "Kamran", seller_name: "Old", ...over });

test("view columns: today's set while off, standard ones on, every field offered", () => {
  assert.deepEqual(shownListColumns(salesDef, false, undefined), salesDef.list.columns);
  const defs = listColumnDefs(salesDef);
  assert.equal(defs[0].key, "doc_no");
  assert.equal(defs[0].required, true);
  assert.deepEqual(defs.filter((d) => d.standard).map((d) => d.key), ["created_at", "seller_name", "created_by_name"]);
  for (const f of salesDef.fields) assert.ok(defs.some((d) => d.key === f.name), `${f.name} offered`);
  const on = shownListColumns(salesDef, true, defaultColumnPrefs(defs));
  assert.deepEqual(on, [...salesDef.list.columns, "created_at", "seller_name", "created_by_name"]);
  assert.equal(listFieldLabel(salesDef.fields.find((f) => f.name === "doc_date"), salesDef, true, fmt), "listColumns.invoiceDate");
  assert.equal(listFieldLabel(salesDef.fields.find((f) => f.name === "doc_date"), salesDef, false, fmt), "common.date");
  const purchaseDef = purchasesDefinition(purchasesModel({}));
  assert.ok(purchaseDef.list.standard.includes("responsible_name"), "purchases: Responsible instead of Salesperson");
  assert.ok(!purchaseDef.list.standard.includes("seller_name"));
});

test("view columns: group sums do not depend on the column set", () => {
  const records = [sale({ id: "a" }), sale({ id: "b", total_amount: 50, customer_id: "c2" })];
  const before = groupRecords(records, salesDef, ["doc_status"], salesDef.list.sums, fmt);
  const defs = listColumnDefs(salesDef);
  const hidden = toggleColumn(defs, defaultColumnPrefs(defs), "total_amount");
  assert.ok(!shownListColumns(salesDef, true, hidden).includes("total_amount"));
  const after = groupRecords(records, salesDef, ["doc_status"], salesDef.list.sums, fmt);
  assert.equal(after[0].sums.total_amount, before[0].sums.total_amount);
  assert.equal(sumBy(records, "total_amount"), 150);
});

test("salesperson: issuer name, else the stored seller name; creator name kept", () => {
  assert.equal(sale({}).seller_name, "Kamran");
  assert.equal(sale({ issued_by_name: null }).seller_name, "Old");
  assert.equal(sale({}).created_by_name, "Leyla");
  assert.equal(sale({ created_by_name: null }).created_by_name, null);
});

test("favourites keep their columns; old favourites use the user's", () => {
  const defs = listColumnDefs(salesDef);
  const columns = toggleColumn(defs, defaultColumnPrefs(defs), "note");
  const state = sanitizeSearchState({ search: "", filters: [], groupBy: [], sort: null, view: "list", columns }, salesDef);
  assert.deepEqual(state.columns.visible, columns.visible);
  const old = sanitizeSearchState({ search: "", filters: [], groupBy: [], sort: null, view: "list" }, salesDef);
  assert.equal("columns" in old, false);
  const broken = sanitizeSearchState({ view: "list", columns: { visible: ["nope"], order: [] } }, salesDef);
  assert.deepEqual(broken.columns, defaultColumnPrefs(defs));
});

test("view export: the user's columns in their order, numbers and dates typed", () => {
  const defs = listColumnDefs(salesDef);
  const prefs = setColumnOrder(defaultColumnPrefs(defs), ["total_amount", "doc_no"]);
  const cols = exportColumns(salesDef, shownListColumns(salesDef, true, prefs), fmt, true);
  assert.deepEqual(cols.slice(0, 2).map((c) => c.header), ["sales.totalAmount", "sales.docNo"]);
  assert.equal(cols[0].type, "money");
  const date = cols.find((c) => c.header === "listColumns.invoiceDate");
  assert.equal(date.type, "date");
  assert.equal(date.value(sale({})), "2026-10-01");
  assert.equal(cols.find((c) => c.header === "listColumns.issuedAt").type, "datetime");
  assert.equal(cols.find((c) => c.header === "listColumns.createdBy").value(sale({})), "Leyla");
});

// ── User names ───────────────────────────────────────────────────────────────

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

function fakeClient({ rpcError = null, names = { [U1]: "Leyla" } } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push(["rpc", fn, args.p_ids]);
      if (rpcError) return { data: null, error: rpcError };
      return { data: args.p_ids.filter((id) => names[id]).map((id) => ({ id, full_name: names[id] })), error: null };
    },
    from: () => ({
      select: () => ({
        in: async (_c, ids) => {
          calls.push(["profiles", ids]);
          return { data: ids.filter((id) => names[id]).map((id) => ({ id, full_name: names[id] })), error: null };
        },
      }),
    }),
  };
}

test("names: one batched lookup, never a raw uuid, stored names win", async () => {
  const rows = [{ created_by: U1 }, { created_by: U1, issued_by: U2 }, { created_by: "not-a-uuid" }, { created_by: null, created_by_name: "Stored" }];
  assert.deepEqual(collectProfileIds(rows, ["created_by", "issued_by"]).sort(), [U1, U2]);
  const client = fakeClient();
  const out = await withProfileNames(client, rows, [["created_by", "created_by_name"], ["issued_by", "issued_by_name"]]);
  assert.equal(client.calls.length, 1, "one call for the page");
  assert.deepEqual(out.map((r) => r.created_by_name), ["Leyla", "Leyla", null, "Stored"]);
  assert.equal(out[1].issued_by_name, null, "unknown id -> null, shown as —");
  assert.equal(profileName(new Map(), U1), null);
  assert.deepEqual(attachProfileNames([{ created_by: U1 }], [["created_by", "n"]], new Map([[U1, "X"]])), [{ created_by: U1, n: "X" }]);
});

test("names: before the migration, the profiles read is the fallback", async () => {
  const client = fakeClient({ rpcError: { code: "PGRST202", message: "missing" } });
  const names = await fetchProfileDisplayNames(client, [U1]);
  assert.equal(names.get(U1), "Leyla");
  assert.deepEqual(client.calls.map((c) => c[0]), ["rpc", "profiles"]);
  const denied = fakeClient({ rpcError: { code: "42501", message: "denied" } });
  assert.equal((await fetchProfileDisplayNames(denied, [U1])).size, 0);
  assert.equal(denied.calls.length, 1, "other errors do not fall back");
});

// ── Excel ────────────────────────────────────────────────────────────────────

test("cells keep their types: money with 2 decimals, dates as Excel dates", () => {
  assert.deepEqual(toXlsxCell("money", "12.345"), { t: "n", v: 12.35, z: "#,##0.00" });
  assert.deepEqual(toXlsxCell("integer", 3.6), { t: "n", v: 4, z: "#,##0" });
  assert.deepEqual(toXlsxCell("date", "2026-10-29"), { t: "n", v: 46324, z: "yyyy-mm-dd" });
  assert.equal(excelSerial("1900-03-01"), 61);
  assert.deepEqual(toXlsxCell("text", null), { t: "z" });
  assert.deepEqual(toXlsxCell("money", "abc"), { t: "z" });
  const dt = toXlsxCell("datetime", new Date(2026, 9, 29, 12, 0));
  assert.equal(dt.v, 46324.5);
  assert.deepEqual(toXlsxCell("date", "soon"), { t: "s", v: "soon" });
});

test("sheet data: header, widths from content, sheet and file names", () => {
  const data = buildXlsxSheet(
    [{ header: "No", value: (r) => r.no }, { header: "Amount", type: "money", value: (r) => r.amount }],
    [{ no: "S-0000001", amount: 1234567.5 }]
  );
  assert.deepEqual(data.header, ["No", "Amount"]);
  assert.equal(data.widths[0], 11);
  assert.ok(data.widths[1] >= 14);
  assert.equal(xlsxSheetName("Satış: fakturalar [2026] və digər sənədlər uzun ad"), "Satış fakturalar 2026 və digər");
  assert.equal(xlsxSheetName("   "), "Sheet1");
  assert.equal(xlsxFileName('Sales: "invoices"', new Date(2026, 9, 29)), "Sales_invoices-2026-10-29.xlsx");
});

test("written file: numbers and dates typed, bold and frozen header", () => {
  const bytes = writeXlsxBytes(XLSX, {
    sheetName: "Sales",
    columns: [
      { header: "No", value: (r) => r.no },
      { header: "Total", type: "money", value: (r) => r.total },
      { header: "Date", type: "date", value: (r) => r.date },
    ],
    rows: [{ no: "S-1", total: 10.5, date: "2026-10-29" }],
  });
  const wb = XLSX.read(bytes, { type: "array", cellNF: true });
  const ws = wb.Sheets.Sales;
  assert.equal(ws.B2.t, "n");
  assert.equal(ws.B2.v, 10.5);
  assert.equal(ws.B2.z, "#,##0.00");
  assert.equal(ws.C2.t, "n");
  assert.equal(ws.C2.w, "2026-10-29");
  const zip = XLSX.CFB.read(bytes, { type: "array" });
  const file = (suffix) => new TextDecoder().decode(zip.FileIndex[zip.FullPaths.findIndex((p) => p.endsWith(suffix))].content);
  const sheet = file("xl/worksheets/sheet1.xml");
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  const style = /<c r="A1" s="(\d+)"/.exec(sheet)[1];
  const xfs = /<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/.exec(file("xl/styles.xml"))[1].match(/<xf [^>]*\/>/g);
  const fontId = /fontId="(\d+)"/.exec(xfs[Number(style)])[1];
  const fonts = /<fonts count="\d+">([\s\S]*?)<\/fonts>/.exec(file("xl/styles.xml"))[1].match(/<font>[\s\S]*?<\/font>/g);
  assert.match(fonts[Number(fontId)], /<b\/>/, "header font is bold");
});

test("xml patches are safe on unusual input", () => {
  assert.equal(patchStylesXml("<styleSheet/>").headerStyle, -1);
  assert.equal(patchSheetXml("<sheetViews><sheetView workbookViewId=\"0\"/></sheetViews>", -1).includes("frozen"), true);
});

// ── Pages, migrations, no CSV ────────────────────────────────────────────────

const CLASSIC_LISTS = [
  "src/modules/sales/components/SalesPage.tsx",
  "src/modules/purchases/components/PurchasesPage.tsx",
  "src/modules/accounting/components/PaymentsPage.tsx",
  "src/modules/accounting/components/FinancePage.tsx",
  "src/modules/expenses/components/ExpensesPage.tsx",
  "src/modules/inventory/components/WarehouseSlipsPage.tsx",
  "src/modules/inventory/components/InventoryCountsPage.tsx",
  "src/modules/inventory/components/InitialBalanceListPage.tsx",
  "src/modules/inventory/components/DamagedGoodsPage.tsx",
  "src/modules/consignment/components/ConsignmentsPage.tsx",
  "src/modules/contracts/components/ContractsPage.tsx",
];

test("classic lists: header, body, skeleton and export follow one column set", () => {
  for (const file of CLASSIC_LISTS) {
    const src = read(file);
    assert.match(src, /useTableColumns\(/, file);
    assert.match(src, /\.visible\.map\(|<ListHeadCells columns=\{columns\.visible\}/, `${file}: header from the visible columns`);
    assert.match(src, /exportColumns/, `${file}: Excel from the same columns`);
  }
  const sales = read("src/modules/sales/components/SalesPage.tsx");
  assert.match(sales, /<ListHeadCells columns=\{columns\.visible\} \/>/);
  assert.match(sales, /<ListBodyCells columns=\{columns\.visible\} row=\{sale\} \/>/);
  assert.match(sales, /TableSkeletonRows columns=\{columns\.visible\.length\}/);
  assert.doesNotMatch(sales, /<Th className="min-w-\[7rem\]">\{t\("sales\.docNo"\)\}<\/Th>/, "no fixed header left");
});

test("new UI: ListView renders the chosen columns, export uses them", () => {
  const list = read("src/views/components/ListView.tsx");
  assert.match(list, /\(shown \?\? def\.list\.columns\)/);
  const engine = read("src/views/components/ViewEngine.tsx");
  assert.match(engine, /exportColumns\(def, shown, fmt, listColumns\)/);
  assert.doesNotMatch(engine, /exportRows\(sorted, def, def\.list\.columns/);
});

test("migrations: created_by columns, trigger and backfill, names RPC", () => {
  const dir = "supabase/migrations";
  const rpc = read(`${dir}/20261028140000_profile_display_names.sql`);
  assert.match(rpc, /SECURITY DEFINER\s+SET search_path = public/);
  assert.match(rpc, /RETURNS TABLE \(id uuid, full_name text\)/);
  assert.match(rpc, /REVOKE ALL ON FUNCTION public\.profile_display_names\(uuid\[\]\) FROM anon/);
  assert.match(rpc, /NEW\.created_by := auth\.uid\(\)/);
  for (const [ts, table] of [["20261028141000", "purchases"], ["20261028142000", "inventory_writeoffs"], ["20261028143000", "contracts"]]) {
    const sql = read(`${dir}/${ts}_${table}_created_by.sql`);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth\\.users`));
    assert.match(sql, /DEFAULT auth\.uid\(\)/);
    assert.match(sql, /BEFORE INSERT ON/);
    assert.match(sql, /FROM public\.audit_logs/);
  }
  const names = readdirSync(join(root, dir)).filter((f) => f.startsWith("2026102814"));
  assert.equal(names.length, 4, "one file per change");
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("no CSV export left: only import templates may still write .csv", () => {
  // Files that write a .csv TEMPLATE for an import (allowed by the prompt) or the CSV helpers.
  const ALLOWED = [
    "src/lib/csv/csvUtils.ts",
    "src/lib/products/bulkImport.ts",
    "src/lib/initial-setup/productImport.ts",
    "src/app/settings/initial-setup/page.client.tsx",
    "src/modules/polywood/components/PolywoodImportPanel.tsx",
    "src/modules/polywood/lib/import.ts",
    "src/components/products/BulkImportModal.tsx",
  ].map((p) => join(root, p));
  const offenders = walk(join(root, "src"))
    .filter((f) => !f.includes(`${join("src", "i18n")}`) && !ALLOWED.includes(f))
    .filter((f) => /text\/csv|rowsToCsv\(|\.csv[`"']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => f.slice(root.length + 1)), []);
});
