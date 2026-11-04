import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DRAG_COLUMN_WIDTH,
  LINE_GRID_ROOM_AT_1280,
  defaultLineGridWidth,
  duplicateLineAt,
  focusAfterRemove,
  isBarcodeLike,
  lineGridStorageKey,
  lineKeyAction,
  moveLine,
  numberInputText,
  parseDecimalInput,
  parseShown,
  removeLineAt,
  reorderByKeys,
  sumLines,
  toggleShown,
  visibleLineColumns,
} from "../src/components/line-grid/logic.ts";
import { changeLineProduct, duplicateLine, newLine, setLineQtyPurchase } from "../src/modules/imports/lib/shipment.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Keyboard ───────────────────────────────────────────────────────────────────────────────

test("Enter moves down the same column; at the last row it adds a line", () => {
  assert.deepEqual(lineKeyAction({ key: "Enter" }, { row: 0, col: 2 }, 3), { type: "focus", row: 1, col: 2 });
  assert.deepEqual(lineKeyAction({ key: "Enter" }, { row: 2, col: 2 }, 3), { type: "add" });
  assert.deepEqual(lineKeyAction({ key: "Enter", shiftKey: true }, { row: 2, col: 1 }, 3), { type: "focus", row: 1, col: 1 });
  assert.equal(lineKeyAction({ key: "Enter", shiftKey: true }, { row: 0, col: 1 }, 3), null);
  assert.equal(lineKeyAction({ key: "Enter", altKey: true }, { row: 0, col: 1 }, 3), null);
});

test("Ctrl/⌘+Enter adds a line, Ctrl/⌘+Delete removes one; other keys are not ours", () => {
  assert.deepEqual(lineKeyAction({ key: "Enter", ctrlKey: true }, { row: 0, col: 0 }, 3), { type: "add" });
  assert.deepEqual(lineKeyAction({ key: "Enter", metaKey: true }, { row: 1, col: 0 }, 3), { type: "add" });
  assert.deepEqual(lineKeyAction({ key: "Delete", ctrlKey: true }, { row: 1, col: 3 }, 3), { type: "remove", row: 1 });
  assert.equal(lineKeyAction({ key: "Delete" }, { row: 1, col: 3 }, 3), null);
  assert.equal(lineKeyAction({ key: "Delete", ctrlKey: true, shiftKey: true }, { row: 1, col: 3 }, 3), null);
  // Tab is left to the browser: the cells are in reading order.
  assert.equal(lineKeyAction({ key: "Tab" }, { row: 1, col: 3 }, 3), null);
  assert.equal(lineKeyAction({ key: "a" }, { row: 1, col: 3 }, 3), null);
});

test("after a removal the focus goes to the line that took its place, else the one above", () => {
  assert.equal(focusAfterRemove(1, 3), 1);
  assert.equal(focusAfterRemove(3, 3), 2);
  assert.equal(focusAfterRemove(0, 0), null);
});

// ── Lines ──────────────────────────────────────────────────────────────────────────────────

test("lines move, reorder by keys, are removed and duplicated without touching the others", () => {
  const lines = ["a", "b", "c", "d"];
  assert.deepEqual(moveLine(lines, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveLine(lines, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveLine(lines, 1, 99), ["a", "c", "d", "b"]);
  assert.deepEqual(moveLine(lines, 2, 2), lines);
  assert.deepEqual(moveLine([], 0, 1), []);
  assert.deepEqual(lines, ["a", "b", "c", "d"], "the input is never changed");

  const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];
  assert.deepEqual(reorderByKeys(rows, ["3", "1", "2"], (r) => r.id).map((r) => r.id), ["3", "1", "2"]);
  // A key the drag result does not know keeps its line at the end; unknown keys are ignored.
  assert.deepEqual(reorderByKeys(rows, ["2", "x"], (r) => r.id).map((r) => r.id), ["2", "1", "3"]);

  assert.deepEqual(removeLineAt(lines, 1), ["a", "c", "d"]);
  assert.deepEqual(removeLineAt(lines, 9), lines);
  assert.deepEqual(duplicateLineAt(lines, 1, (l) => `${l}'`), ["a", "b", "b'", "c", "d"]);
});

test("totals add numbers only and round like money", () => {
  const lines = [{ v: 0.1 }, { v: 0.2 }, { v: null }, { v: Number.NaN }, { v: 10.005 }];
  assert.equal(sumLines(lines, (l) => l.v), 10.31);
  assert.equal(sumLines(lines, (l) => l.v, 3), 10.305);
  assert.equal(sumLines([], (l) => l.v), 0);
});

// ── Number cells ───────────────────────────────────────────────────────────────────────────

test("number cells accept a comma or a point and keep half-typed numbers valid", () => {
  assert.deepEqual(parseDecimalInput(""), { value: null, valid: true });
  assert.deepEqual(parseDecimalInput("12,5"), { value: 12.5, valid: true });
  assert.deepEqual(parseDecimalInput("1 250.75"), { value: 1250.75, valid: true });
  assert.deepEqual(parseDecimalInput("12,"), { value: 12, valid: true });
  assert.deepEqual(parseDecimalInput("0."), { value: 0, valid: true });
  assert.equal(parseDecimalInput("1,2,3").valid, false);
  assert.equal(parseDecimalInput("abc").valid, false);
  assert.equal(parseDecimalInput("-").valid, false);
  // Bounds make the cell invalid (red outline), the value stays visible.
  assert.deepEqual(parseDecimalInput("-3", { min: 0 }), { value: -3, valid: false });
  assert.deepEqual(parseDecimalInput("101", { min: 0, max: 100 }), { value: 101, valid: false });
  assert.equal(numberInputText(null), "");
  assert.equal(numberInputText(12.5), "12.5");
  assert.equal(numberInputText(Number.NaN), "");
});

// ── Columns ────────────────────────────────────────────────────────────────────────────────

test("optional columns stay hidden until the user shows them; the choice is stored per grid", () => {
  const cols = [{ key: "product" }, { key: "qty", type: "number" }, { key: "hs", optional: true }, { key: "weight", optional: true }];
  assert.deepEqual(visibleLineColumns(cols, new Set()).map((c) => c.key), ["product", "qty"]);
  const shown = toggleShown(new Set(), "weight");
  assert.deepEqual(visibleLineColumns(cols, shown).map((c) => c.key), ["product", "qty", "weight"]);
  assert.deepEqual([...toggleShown(shown, "weight")], []);
  assert.deepEqual([...parseShown('["hs",1,"weight"]')], ["hs", "weight"]);
  assert.deepEqual([...parseShown("{bad")], []);
  assert.deepEqual([...parseShown(null)], []);
  assert.equal(lineGridStorageKey("imports-lines"), "line-grid:imports-lines:shown");
});

test("the default columns of the migrated grids fit a 1280 px window", () => {
  // Same widths as ImportLinesGrid and PurchaseLinesGrid (the required columns only). IMP-4 added
  // the warehouse and the landed unit cost to the import lines, so the others got narrower.
  const imports = [
    { key: "product", type: "text", width: 176 },
    { key: "qtyPurchase", type: "number", width: 96 },
    { key: "qtyStock", type: "number", width: 100 },
    { key: "unitPriceFc", type: "money", width: 104 },
    { key: "lineTotalFc", type: "money", width: 104 },
    { key: "dutyRatePct", type: "number", width: 80 },
    { key: "warehouse", type: "text", width: 116 },
    { key: "landedUnit", type: "money", width: 92 },
  ];
  const purchase = [
    { key: "product", type: "text", width: 280 },
    { key: "quantity", type: "number", width: 120 },
    { key: "unit_price", type: "money", width: 120 },
    { key: "currency", type: "code", width: 88 },
    { key: "total", type: "money", width: 128 },
  ];
  assert.ok(defaultLineGridWidth(imports, { reorder: true }) <= LINE_GRID_ROOM_AT_1280, `imports: ${defaultLineGridWidth(imports, { reorder: true })}`);
  assert.ok(defaultLineGridWidth(purchase, { reorder: true }) <= LINE_GRID_ROOM_AT_1280, `purchase: ${defaultLineGridWidth(purchase, { reorder: true })}`);
  assert.equal(DRAG_COLUMN_WIDTH, 28);
  for (const [file, cols] of [
    ["src/modules/imports/components/ImportLinesGrid.tsx", imports],
    ["src/modules/purchases/components/PurchaseLinesGrid.tsx", purchase],
  ]) {
    const src = read(file);
    for (const c of cols) assert.match(src, new RegExp(`key: "${c.key}",[\\s\\S]{0,120}width: ${c.width},`), `${file}: ${c.key} width`);
  }
});

test("a scanner's barcode is told apart from a typed name or code", () => {
  assert.equal(isBarcodeLike("4760123456789"), true);
  assert.equal(isBarcodeLike(" 12345678 "), true);
  assert.equal(isBarcodeLike("12345"), false);
  assert.equal(isBarcodeLike("MDF-18"), false);
  assert.equal(isBarcodeLike("123456789012345"), false);
});

// ── Imports lines (business rules moved out of the form) ──────────────────────────────────

const sheet = { id: "p-sheet", code: "MDF18", name: "MDF 18 mm", unit: "vərəq", sheetLengthM: 4 };
const box = { id: "p-box", code: "BOX", name: "Box", unit: "ədəd", sheetLengthM: null };

test("an import line follows its product: unit and metres for sheet products", () => {
  const line = { ...newLine(box, 3), unitPriceFc: 12.5 };
  const changed = changeLineProduct(line, sheet);
  assert.equal(changed.productId, "p-sheet");
  assert.equal(changed.purchaseUnit, "vərəq");
  assert.equal(changed.qtyStock, 12, "3 sheets × 4 m");
  assert.equal(changed.unitPriceFc, 12.5, "the price typed stays");
  assert.equal(changed.key, line.key);

  assert.equal(setLineQtyPurchase(changed, 2.5, sheet).qtyStock, 10);
  // Not a sheet product: the stock quantity is typed on its own.
  const plain = setLineQtyPurchase(line, 7, box);
  assert.equal(plain.qtyPurchase, 7);
  assert.equal(plain.qtyStock, 3);

  const copy = duplicateLine(changed);
  assert.notEqual(copy.key, changed.key);
  assert.deepEqual({ ...copy, key: changed.key }, changed);
});

// ── Wiring ─────────────────────────────────────────────────────────────────────────────────

test("migrated forms switch on UI_STANDARD and keep the old editor when it is off", () => {
  const imports = read("src/modules/imports/components/ImportFormScreen.tsx");
  // IMP-4: the standard layout returns early with the grids; flag off keeps the IMP-1 layout
  // (its table and cost cards) with the standard pickers, no native controls.
  assert.match(imports, /if \(uiStandard\) \{[\s\S]*<ImportLinesGrid[\s\S]*<ImportCostsGrid/);
  assert.match(imports, /Flag off: the IMP-1 layout[\s\S]*<CostRow/, "flag off: today's layout");
  assert.doesNotMatch(imports, /<datalist\b|<select\b/);
  const purchase = read("src/modules/purchases/components/PurchaseForm.tsx");
  assert.match(purchase, /uiStandard \? \([\s\S]{0,120}<PurchaseLinesGrid/);
  assert.match(purchase, /<ProductCombobox/, "flag off: today's editor");
  // One place to add a line: the grid's own row, not a button above the table.
  assert.match(purchase, /\{uiStandard \? null : \(\s*<button[\s\S]{0,120}onClick=\{addRow\}/);
});

test("LineGrid: add row at the bottom, no native select/date, one-line cells", () => {
  const grid = read("src/components/line-grid/LineGrid.tsx");
  const cells = read("src/components/line-grid/cells.tsx");
  assert.ok(grid.indexOf("{rows}") < grid.indexOf("{addRow}"), "the add row comes after the lines");
  for (const src of [grid, cells]) {
    assert.doesNotMatch(src, /<select|type="date"|<datalist/);
  }
  assert.match(cells, /data-ui-check="single-line"/);
  assert.match(cells, /inlineAdd=\{false\}/, "no + button eating the product cell");
  assert.match(cells, /scanBarcodes/);
});

test("every LineGrid text exists in az, en and ru", () => {
  const keys = Object.keys(enMessages.uiStandard.lineGrid);
  assert.ok(keys.length >= 16);
  for (const [name, messages] of [["az", azMessages], ["ru", ruMessages]]) {
    assert.deepEqual(Object.keys(messages.uiStandard.lineGrid).sort(), [...keys].sort(), name);
    for (const k of keys) assert.ok(messages.uiStandard.lineGrid[k].trim(), `${name}.${k}`);
  }
  const labels = read("src/i18n/uiStandardLabels.ts");
  for (const k of ["addLine", "addLineShortcut", "empty", "columns", "duplicate", "remove", "details", "total"]) {
    assert.match(labels, new RegExp(`${k}: k\\("${k}"\\)`));
  }
});
