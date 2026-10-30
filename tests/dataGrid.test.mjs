import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GRID_ROW_HEIGHT,
  TYPE_MIN_WIDTH,
  TYPE_WIDTH,
  CELL_PADDING,
  DIGIT_WIDTH,
  clampWidth,
  distributeSurplus,
  edgeShadows,
  estimateTextWidth,
  fitWidth,
  floatingScrollbar,
  horizontalWheelDelta,
  initialColumnWidth,
  nextRowIndex,
  resizeWidth,
  resolveWidths,
  stickyStartOffsets,
  tableWidth,
} from "../src/design-system/grid.ts";
import { clearColumnWidths, defaultColumnPrefs, mergeColumnPrefs, serializeColumnPrefs, setColumnOrder, setColumnWidth, toggleColumn } from "../src/lib/lists/columns.ts";
import { flattenGroups, gridColumnType } from "../src/views/logic.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Widths ─────────────────────────────────────────────────────────────────────

test("rows have one fixed height per density; dates have fixed widths", () => {
  assert.deepEqual(GRID_ROW_HEIGHT, { compact: 32, comfortable: 40 });
  assert.equal(TYPE_WIDTH.date, 96);
  assert.equal(TYPE_WIDTH.datetime, 132);
  assert.equal(initialColumnWidth({ key: "d", type: "date", header: "Tarix" }), 96);
  assert.equal(initialColumnWidth({ key: "d", type: "datetime", header: "Yaradılma vaxtı" }), 132);
  // A date column can never be dragged narrower than its full text.
  assert.equal(resizeWidth("date", 96, -60), TYPE_MIN_WIDTH.date);
  assert.equal(resizeWidth("datetime", 132, -200), 132);
});

test("money and status columns are sized to their content", () => {
  const money = initialColumnWidth({ key: "m", type: "money", samples: ["1.234.567,89 AZN"], header: "Məbləğ" });
  assert.equal(money, estimateTextWidth("1.234.567,89 AZN", DIGIT_WIDTH) + CELL_PADDING);
  const small = initialColumnWidth({ key: "m", type: "money", samples: ["5,00 AZN"], header: "Məbləğ" });
  assert.ok(small >= TYPE_MIN_WIDTH.money && small < money);
  // A status chip as wide as its longest label (plus chip padding).
  const status = initialColumnWidth({ key: "s", type: "status", samples: ["Qaralama", "Anbara göndərilib"], header: "Status" });
  assert.ok(status > estimateTextWidth("Anbara göndərilib") + CELL_PADDING);
  assert.ok(status < estimateTextWidth("Anbara göndərilib") + CELL_PADDING + 30);
  // Text columns start at the default; a page's own width wins, clamped.
  assert.equal(initialColumnWidth({ key: "t", type: "text" }), TYPE_WIDTH.text);
  assert.equal(initialColumnWidth({ key: "t", type: "text", width: 10 }), TYPE_MIN_WIDTH.text);
  assert.equal(clampWidth("text", 5000), 640);
  assert.equal(clampWidth("number", Number.NaN), TYPE_WIDTH.number);
});

test("stored widths win over the defaults and are clamped", () => {
  const cols = [
    { key: "a", type: "text" },
    { key: "b", type: "date" },
  ];
  assert.deepEqual(resolveWidths(cols, { a: 300, b: 20 }), { a: 300, b: 96 });
  assert.deepEqual(resolveWidths(cols, undefined), { a: 180, b: 96 });
  assert.deepEqual(resolveWidths(cols, { a: -1 }), { a: 180, b: 96 });
});

test("free space goes to text columns only, to the last pixel", () => {
  const cols = [
    { key: "no", type: "code" },
    { key: "name", type: "text" },
    { key: "date", type: "date" },
    { key: "note", type: "text" },
    { key: "sum", type: "money" },
  ];
  const widths = { no: 112, name: 200, date: 96, note: 100, sum: 120 };
  const out = distributeSurplus(cols, widths, 1000, 40);
  assert.equal(out.no, 112);
  assert.equal(out.date, 96);
  assert.equal(out.sum, 120);
  assert.equal(Object.values(out).reduce((a, b) => a + b, 0) + 40, 1000);
  assert.ok(out.name > out.note, "in proportion to their width");
  // No surplus: unchanged. No text column: the last column takes it.
  assert.deepEqual(distributeSurplus(cols, widths, 500), widths);
  const numbersOnly = distributeSurplus([{ key: "a", type: "date" }, { key: "b", type: "money" }], { a: 96, b: 120 }, 300);
  assert.deepEqual(numbersOnly, { a: 96, b: 204 });
});

test("double-click fits the widest cell or the header", () => {
  assert.equal(fitWidth("text", [80, 210, 150], 60), 210 + CELL_PADDING);
  assert.equal(fitWidth("text", [20], 120), 120 + 16 + CELL_PADDING);
  assert.equal(fitWidth("date", [10], 10), 96);
});

// ── Sticky columns, shadows, scrollbar, wheel ─────────────────────────────────

test("sticky offsets and the table width", () => {
  assert.deepEqual(stickyStartOffsets([40, 112]), [0, 40]);
  assert.deepEqual(stickyStartOffsets([]), []);
  assert.equal(tableWidth([100, 200], true, true), 100 + 200 + 40 + 48);
  assert.equal(tableWidth([100], false, false), 100);
});

test("edge shadows show the side that hides columns, LTR and RTL", () => {
  assert.deepEqual(edgeShadows({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 1000 }), { start: false, end: false });
  assert.deepEqual(edgeShadows({ scrollLeft: 0, scrollWidth: 2000, clientWidth: 1000 }), { start: false, end: true });
  assert.deepEqual(edgeShadows({ scrollLeft: 500, scrollWidth: 2000, clientWidth: 1000 }), { start: true, end: true });
  assert.deepEqual(edgeShadows({ scrollLeft: 1000, scrollWidth: 2000, clientWidth: 1000 }), { start: true, end: false });
  // RTL: browsers count scrollLeft from 0 towards negative.
  assert.deepEqual(edgeShadows({ scrollLeft: -1000, scrollWidth: 2000, clientWidth: 1000 }), { start: true, end: false });
  assert.deepEqual(edgeShadows({ scrollLeft: -0, scrollWidth: 2000, clientWidth: 1000 }), { start: false, end: true });
});

test("floating scrollbar only while the grid's own one is below the window", () => {
  const wide = { scrollWidth: 2000, clientWidth: 1000 };
  assert.equal(floatingScrollbar({ top: 200, bottom: 1500 }, 900, wide), true);
  assert.equal(floatingScrollbar({ top: 200, bottom: 800 }, 900, wide), false);
  assert.equal(floatingScrollbar({ top: 880, bottom: 1500 }, 900, wide), false, "grid barely visible");
  assert.equal(floatingScrollbar({ top: 200, bottom: 1500 }, 900, { scrollWidth: 1000, clientWidth: 1000 }), false, "nothing to scroll");
});

test("shift + wheel and trackpads scroll sideways", () => {
  assert.equal(horizontalWheelDelta({ deltaX: 0, deltaY: 120, shiftKey: true }), 120);
  assert.equal(horizontalWheelDelta({ deltaX: 0, deltaY: 120, shiftKey: false }), 0);
  assert.equal(horizontalWheelDelta({ deltaX: 40, deltaY: 5, shiftKey: false }), 40);
});

test("keyboard: arrows, Home/End and pages move the focused row", () => {
  assert.equal(nextRowIndex(-1, "ArrowDown", 5), 0);
  assert.equal(nextRowIndex(0, "ArrowDown", 5), 1);
  assert.equal(nextRowIndex(4, "ArrowDown", 5), 4);
  assert.equal(nextRowIndex(0, "ArrowUp", 5), 0);
  assert.equal(nextRowIndex(3, "Home", 5), 0);
  assert.equal(nextRowIndex(1, "End", 5), 4);
  assert.equal(nextRowIndex(1, "PageDown", 30), 11);
  assert.equal(nextRowIndex(5, "PageUp", 30), 0);
  assert.equal(nextRowIndex(1, "Enter", 5), null);
  assert.equal(nextRowIndex(0, "ArrowDown", 0), null);
});

// ── Prefs: widths and density with order and visibility ───────────────────────

test("column prefs keep widths and density, and drop unknown or bad widths", () => {
  const defs = [
    { key: "no", defaultVisible: true, required: true },
    { key: "date", defaultVisible: true },
    { key: "note", defaultVisible: false },
  ];
  const stored = { visible: ["no", "date"], order: ["no", "date", "note"], widths: { no: 140, date: 5, ghost: 300, note: "x" }, density: "compact" };
  const merged = mergeColumnPrefs(defs, stored);
  assert.deepEqual(merged.widths, { no: 140 });
  assert.equal(merged.density, "compact");
  assert.equal(mergeColumnPrefs(defs, { ...stored, density: "huge" }).density, undefined);
  // Width-only prefs (no order stored yet) keep the defaults with the widths.
  const widthsOnly = mergeColumnPrefs(defs, { widths: { date: 120 } });
  assert.deepEqual(widthsOnly.visible, ["no", "date"]);
  assert.deepEqual(widthsOnly.widths, { date: 120 });

  // Changing order or visibility keeps widths and density.
  const base = { ...defaultColumnPrefs(defs), widths: { date: 120 }, density: "compact" };
  assert.deepEqual(toggleColumn(defs, base, "note").widths, { date: 120 });
  assert.equal(setColumnOrder(base, ["date", "no", "note"]).density, "compact");
  assert.deepEqual(setColumnWidth(base, "no", 150.6).widths, { date: 120, no: 151 });
  assert.equal(clearColumnWidths(base).widths, undefined);
  assert.equal(clearColumnWidths(base).density, "compact");

  // Storage: only what is set.
  assert.deepEqual(JSON.parse(serializeColumnPrefs(defaultColumnPrefs(defs))), { visible: ["no", "date"], order: ["no", "date", "note"] });
  assert.deepEqual(JSON.parse(serializeColumnPrefs(base)).widths, { date: 120 });
});

// ── View engine and classic adapters ──────────────────────────────────────────

test("view-engine field types map to grid widths", () => {
  assert.equal(gridColumnType({ name: "a", type: "monetary" }), "money");
  assert.equal(gridColumnType({ name: "a", type: "integer" }), "number");
  assert.equal(gridColumnType({ name: "a", type: "float" }), "number");
  assert.equal(gridColumnType({ name: "a", type: "date" }), "date");
  assert.equal(gridColumnType({ name: "a", type: "datetime" }), "datetime");
  assert.equal(gridColumnType({ name: "a", type: "selection" }), "status");
  assert.equal(gridColumnType({ name: "a", type: "char" }), "text");
});

test("group rows flatten in screen order; closed groups hide their rows", () => {
  const r1 = { id: "1" };
  const r2 = { id: "2" };
  const groups = [
    { path: "a", records: [r1], children: [], label: "A", count: 1, sums: {} },
    { path: "b", records: [r2], children: [{ path: "b/x", records: [r2], children: [], label: "X", count: 1, sums: {} }], label: "B", count: 1, sums: {} },
  ];
  const kinds = (items) => items.map((it) => (it.kind === "group" ? `g:${it.group.path}@${it.depth}` : `r:${it.record.id}@${it.depth}`));
  assert.deepEqual(kinds(flattenGroups(groups, new Set())), ["g:a@0", "g:b@0"]);
  assert.deepEqual(kinds(flattenGroups(groups, new Set(["a"]))), ["g:a@0", "r:1@1", "g:b@0"]);
  assert.deepEqual(kinds(flattenGroups(groups, new Set(["b", "b/x"]))), ["g:a@0", "g:b@0", "g:b/x@1", "r:2@2"]);
});

test("classic columns get a grid type from their Excel type, numeric flag or key", async () => {
  const { classicGridType } = await import("../src/components/lists/listTable.tsx").catch(() => ({}));
  if (!classicGridType) {
    // listTable.tsx imports React components; check the rule in its source instead.
    const src = read("src/components/lists/listTable.tsx");
    for (const needle of ['exportType === "date"', 'exportType === "datetime"', '"money"', '"status"', "doc_no|number|code|slip_no"]) assert.ok(src.includes(needle), needle);
    return;
  }
  assert.equal(classicGridType({ key: "doc_date", exportType: "date" }), "date");
  assert.equal(classicGridType({ key: "total", numeric: true }), "money");
  assert.equal(classicGridType({ key: "doc_status" }), "status");
  assert.equal(classicGridType({ key: "doc_no" }), "code");
  assert.equal(classicGridType({ key: "customer" }), "text");
});

// ── Wiring: flag, picker placement, global resizer, pages ─────────────────────

test("the view engine renders DataGrid only with UI_STANDARD, and never puts the picker in a header cell", () => {
  const list = read("src/views/components/ListView.tsx");
  assert.match(list, /return useUiStandard\(\) \? <GridListView \{\.\.\.props\} \/> : <ClassicListView \{\.\.\.props\} \/>;/);
  const grid = list.slice(list.indexOf("function GridListView"));
  assert.doesNotMatch(grid.slice(0, grid.indexOf("/** One cell")), /picker/);
  const engine = read("src/views/components/ViewEngine.tsx");
  assert.match(engine, /pickerProps && !standard \? <ColumnPicker/);
  assert.match(engine, /columnsMenu: pickerProps \? <ColumnPickerPanel/);
});

test("the global resizer skips DataGrid; the grid marks itself", async () => {
  const resizer = read("src/components/ui/TableColumnResizer.tsx");
  assert.match(resizer, /if \(isSelfResizingTable\(table\)\) return null;/);
  const grid = read("src/design-system/components/DataGrid.tsx");
  assert.match(grid, /className="ds-grid"\s+data-col-resize="manual"/);
  const { isSelfResizingTable } = await import("../src/components/ui/TableColumnResizer.tsx").catch(() => ({}));
  if (isSelfResizingTable) {
    const el = (attrs, cls = []) => ({ dataset: attrs, classList: { contains: (c) => cls.includes(c) } });
    assert.equal(isSelfResizingTable(el({}, ["ds-grid"])), true);
    assert.equal(isSelfResizingTable(el({ colResize: "manual" })), true);
    assert.equal(isSelfResizingTable(el({})), false);
  }
});

test("grid CSS: one line, sentence-case header, hover-only handle, logical properties", () => {
  const css = read("src/design-system/components.css");
  const grid = css.slice(css.indexOf("DataGrid (UI-2"));
  assert.match(grid, /\.ds-grid th,\s*\n\[data-ds\] \.ds-grid td \{[^}]*white-space: nowrap;[^}]*height: var\(--ds-grid-row-h\)|height: var\(--ds-grid-row-h\);[\s\S]*white-space: nowrap;/);
  assert.match(grid, /text-transform: none;/);
  assert.match(grid, /\.ds-grid-resize \{[^}]*opacity: 0;/);
  assert.match(grid, /thead th:hover \.ds-grid-resize/);
  assert.doesNotMatch(grid, /\b(left|right|margin-left|margin-right|padding-left|padding-right):/, "logical properties only");
  assert.doesNotMatch(grid, /dashed/);
});

test("classic list pages switch to ListGrid only with the flag", () => {
  const pages = [
    "src/modules/sales/components/SalesPage.tsx",
    "src/modules/purchases/components/PurchasesPage.tsx",
    "src/modules/expenses/components/ExpensesPage.tsx",
    "src/modules/accounting/components/PaymentsPage.tsx",
    "src/modules/accounting/components/FinancePage.tsx",
    "src/modules/inventory/components/WarehouseSlipsPage.tsx",
    "src/modules/inventory/components/InventoryCountsPage.tsx",
    "src/modules/inventory/components/InitialBalanceListPage.tsx",
    "src/modules/inventory/components/DamagedGoodsPage.tsx",
    "src/modules/contracts/components/ContractsPage.tsx",
    "src/modules/consignment/components/ConsignmentsPage.tsx",
    "src/app/customers/page.client.tsx",
    "src/app/suppliers/page.client.tsx",
    "src/app/dashboard/partners/page.client.tsx",
    "src/modules/hr/components/EmployeesPage.tsx",
    "src/components/products/ProductTable.tsx",
  ];
  for (const p of pages) {
    const src = read(p);
    assert.match(src, /<ListGrid\b/, p);
    // Both paths stay: the old table is still there for UI_STANDARD off.
    assert.match(src, /<table\b|<Table\b/, p);
    assert.match(src, /(\.grid|standard) \?|\.grid &&|!columns\.grid|if \(standard\)/, p);
  }
  // useTableColumns tells pages whether the grid is on, and hides the old picker then.
  const lt = read("src/components/lists/listTable.tsx");
  assert.match(lt, /const grid = useUiStandard\(\);/);
  assert.match(lt, /enabled && !grid \? <ColumnPicker/);
});

test("grid texts exist in az, en and ru", async () => {
  const { azMessages } = await import("../src/i18n/messages/az.ts");
  const { enMessages } = await import("../src/i18n/messages/en.ts");
  const { ruMessages } = await import("../src/i18n/messages/ru.ts");
  const keys = Object.keys(azMessages.uiStandard.grid).sort();
  assert.deepEqual(Object.keys(enMessages.uiStandard.grid).sort(), keys);
  assert.deepEqual(Object.keys(ruMessages.uiStandard.grid).sort(), keys);
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.match(m.uiStandard.grid.resize, /\{column\}/);
    assert.match(m.uiStandard.grid.count, /\{count\}/);
  }
  const lab = read("src/app/dev/ui-lab/GridLab.tsx");
  for (const k of new Set([...lab.matchAll(/l\("([a-zA-Z]+)"\)/g)].map((m) => m[1]))) assert.ok(azMessages.uiStandard.lab[k], `uiStandard.lab.${k}`);
  assert.equal((lab.match(/\{ key: "[a-zA-Z]+", header:/g) ?? []).length, 20, "20 columns in the lab grid");
  assert.match(read("docs/ui-standard.md"), /## Lists/);
});
