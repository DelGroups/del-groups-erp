// GRID-2: the sales invoice lines in the shared LineGrid (behind UI_STANDARD).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultLineGridWidth, LINE_GRID_ROOM_AT_1280, removeLineAt, reorderByKeys } from "../src/components/line-grid/logic.ts";
import {
  addScannedLine,
  applySaleLinePatch,
  duplicateSaleLine,
  isPolywoodMeterLine,
  saleCurrencyPatch,
  saleMetricHint,
  salePriceTierPatch,
  saleQuantityBlurPatch,
  saleQuantityPatch,
} from "../src/modules/sales/lib/saleLineEdits.ts";
import { isDimensionalInvoiceProduct, resolveInvoiceLineUnitPrice } from "../src/modules/sales/lib/resolveInvoiceLinePrice.ts";
import { mapSaleItemToRpcPayload } from "../src/modules/sales/lib/submitSale.ts";
import { calcCurrencyBreakdown, calcLineTotal, createEmptySaleItem } from "../src/types/database.types.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────

const BOX = { id: "p-box", code: "BOX-1", name: "Qutu", unit: "Ədəd", sell_price: 10, price_wholesale: 8, price_distributor: 7, stock: 50, vat_rate: 18 };
const MDF = { id: "p-mdf", code: "MDF18", name: "MDF 18 mm", unit: "Metr", sell_price: 30, sell_price_cut: 12, is_dimensional: true, full_sheet_length_m: 4, stock: 40 };
const GLUE = { id: "p-glue", code: "GL", name: "Yapışqan", unit: "Ədəd", sell_price: 4.5, stock: 3 };
const PRODUCTS = [BOX, MDF, GLUE];

const line = (id, over = {}) => ({ ...createEmptySaleItem("w-1", "Əsas anbar"), id, ...over });
const withProduct = (id, p, over = {}) =>
  applySaleLinePatch(line(id), { product_id: p.id, product_code: p.code, product_name: p.name, unit: p.unit, unit_price: p.sell_price, quantity: 1, price_tier: "retail", ...over });

// ── The old editor, as the inline handlers of the old line table were before GRID-2 ──────────

function oldItemChange(row, patch) {
  const updated = { ...row, ...patch };
  updated.total = calcLineTotal(updated.quantity, updated.unit_price, updated.discount_percent, updated.discount_type);
  return updated;
}
function oldIsPolywoodMeterLine(row, product) {
  const poly = product?.inventory_mode === "polywood" || product?.is_dimensional === true;
  return poly && (row.polywood_sale_mode === "linear_m" || row.unit === "Metr");
}
function oldQuantity(row, nextQuantity) {
  const rowProduct = PRODUCTS.find((p) => p.id === row.product_id);
  const patch = { quantity: nextQuantity };
  if (oldIsPolywoodMeterLine(row, rowProduct) || row.unit === "Metr") {
    patch.polywood_cut_confirmed = false;
    patch.polywood_length_m = row.unit === "Metr" ? nextQuantity : null;
    if (rowProduct && row.unit === "Metr") {
      patch.unit_price = resolveInvoiceLineUnitPrice(rowProduct, {
        unit: row.unit,
        quantity: nextQuantity,
        polywood_sale_mode: "linear_m",
        polywood_length_m: nextQuantity,
        polywood_full_sheet_length_m: row.polywood_full_sheet_length_m || Number(rowProduct.full_sheet_length_m) || 4,
        priceTier: row.price_tier,
      });
    }
  }
  return oldItemChange(row, patch);
}
function oldQuantityBlur(row) {
  const rowProduct = PRODUCTS.find((p) => p.id === row.product_id);
  const meterLine = oldIsPolywoodMeterLine(row, rowProduct) || (rowProduct && row.unit === "Metr" && isDimensionalInvoiceProduct(rowProduct));
  if (!meterLine) return row;
  return oldItemChange(row, {
    unit_price: resolveInvoiceLineUnitPrice(rowProduct, {
      unit: row.unit,
      quantity: row.quantity,
      polywood_sale_mode: "linear_m",
      polywood_length_m: row.polywood_length_m ?? row.quantity,
      polywood_full_sheet_length_m: row.polywood_full_sheet_length_m || Number(rowProduct?.full_sheet_length_m) || 4,
      priceTier: row.price_tier,
    }),
  });
}
function oldPriceTier(row, nextTier) {
  const rowProduct = PRODUCTS.find((p) => p.id === row.product_id);
  return oldItemChange(row, {
    price_tier: nextTier,
    unit_price: resolveInvoiceLineUnitPrice(rowProduct, {
      unit: row.unit,
      quantity: row.quantity,
      polywood_sale_mode: row.polywood_sale_mode,
      polywood_length_m: row.polywood_length_m,
      polywood_full_sheet_length_m: row.polywood_full_sheet_length_m,
      priceTier: nextTier,
    }),
  });
}
function oldCurrency(row, nextCurrency) {
  return oldItemChange(row, { currency: nextCurrency, exchange_rate: nextCurrency === "AZN" ? 1 : row.exchange_rate || 1 });
}

// ── The new editor: the grid calls the form's handlers, which use saleLineEdits ─────────────

const productOf = (row) => PRODUCTS.find((p) => p.id === row.product_id);
const newQuantity = (row, q) => applySaleLinePatch(row, saleQuantityPatch(row, productOf(row), q));
const newQuantityBlur = (row) => {
  const patch = saleQuantityBlurPatch(row, productOf(row));
  return patch ? applySaleLinePatch(row, patch) : row;
};
const newPriceTier = (row, tier) => applySaleLinePatch(row, salePriceTierPatch(row, productOf(row), tier));
const newCurrency = (row, c) => applySaleLinePatch(row, saleCurrencyPatch(row, c));

// The same user edits, in the same order, on three lines.
function edit(editor) {
  const [quantity, blur, tier, currency, change] = editor;
  let box = withProduct("1", BOX);
  box = quantity(box, 3);
  box = blur(box);
  box = tier(box, "wholesale");
  box = change(box, { discount_percent: 10 });
  let mdf = withProduct("2", MDF, { unit: "Metr", polywood_sale_mode: "linear_m" });
  mdf = quantity(mdf, 2.5);
  mdf = blur(mdf);
  mdf = currency(mdf, "USD");
  mdf = change(mdf, { exchange_rate: 1.7, discount_type: "fixed", discount_percent: 2 });
  let glue = withProduct("3", GLUE);
  glue = quantity(glue, 2);
  glue = tier(glue, "distributor");
  glue = currency(glue, "EUR");
  glue = currency(glue, "AZN");
  glue = change(glue, { extra_info: "Qırmızı" });
  return [box, mdf, glue];
}

test("payload: the same lines give the identical submitSale payload with the old and the new editor", () => {
  const before = edit([oldQuantity, oldQuantityBlur, oldPriceTier, oldCurrency, oldItemChange]);
  const after = edit([newQuantity, newQuantityBlur, newPriceTier, newCurrency, applySaleLinePatch]);
  assert.deepEqual(after, before, "same SaleItem state");
  for (const decrementStock of [true, false]) {
    assert.deepEqual(after.map((i) => mapSaleItemToRpcPayload(i, decrementStock)), before.map((i) => mapSaleItemToRpcPayload(i, decrementStock)));
  }
  assert.deepEqual(calcCurrencyBreakdown(after), calcCurrencyBreakdown(before));
  // Sanity: the edits did something (wholesale price, metre price, discount, rate).
  assert.equal(after[0].unit_price, 8);
  assert.equal(after[0].total, 21.6);
  assert.equal(after[1].unit_price, 12, "metre price of the cut piece");
  assert.equal(after[1].polywood_length_m, 2.5);
  assert.equal(after[1].exchange_rate, 1.7);
  assert.equal(after[2].exchange_rate, 1, "back to AZN: rate 1");
  assert.equal(isPolywoodMeterLine(after[1], MDF), true);
});

test("both editors call the same line-edit handlers; the grid adds no field of its own", () => {
  const form = read("src/modules/sales/components/InvoiceForm.tsx");
  // Old table and grid use the same handlers.
  assert.match(form, /onChange=\{\(e\) => handleQuantityChange\(row, Number\(e\.target\.value\) \|\| 0\)\}/);
  assert.match(form, /onBlur=\{\(\) => handleQuantityBlur\(row\)\}/);
  assert.match(form, /onChange=\{\(e\) => handlePriceTierChange\(row, e\.target\.value as PriceTier\)\}/);
  assert.match(form, /onChange=\{\(e\) => handleCurrencyChange\(row, e\.target\.value as InvoiceCurrency\)\}/);
  for (const prop of ["onQuantity={handleQuantityChange}", "onQuantityCommit={handleQuantityBlur}", "onPriceTier={handlePriceTierChange}", "onCurrency={handleCurrencyChange}", "onUpdate={handleItemChange}", "onWarehouse={handleWarehouseSelect}", "onUnit={handleUnitChange}"]) {
    assert.ok(form.includes(prop), prop);
  }
  // The payload is still built from the same items state.
  assert.match(form, /const result = await submitSale\(\{\s*header: salesPayload,\s*items: saleItems,/);
  const grid = read("src/modules/sales/components/SalesLinesGrid.tsx");
  assert.doesNotMatch(grid, /submitSale|supabase|resolveInvoiceLineUnitPrice|calcLineTotal/, "no business rules in the grid (rule 7)");
});

// ── Lines: add, remove, duplicate, reorder ───────────────────────────────────────────────

test("add, remove, duplicate and reorder lines", () => {
  const lines = [withProduct("a", BOX), withProduct("b", GLUE)];
  const added = [...lines, createEmptySaleItem("w-1", "Əsas anbar")];
  assert.equal(added.length, 3);
  assert.equal(added[2].product_id, "");
  assert.equal(added[2].warehouse_id, "w-1");

  const copy = duplicateSaleLine(lines, "a", "a2");
  assert.deepEqual(copy.map((r) => r.id), ["a", "a2", "b"]);
  const strip = (row) => {
    const rest = { ...row };
    delete rest.id;
    delete rest.polywood_cut_confirmed;
    return rest;
  };
  assert.deepEqual(strip(copy[1]), strip(copy[0]), "the copy is the same line under a new id");
  // A confirmed cut is not copied: the copy needs its own smart-cut check before posting.
  const cut = [withProduct("m", MDF, { unit: "Metr", polywood_sale_mode: "linear_m", polywood_cut_confirmed: true })];
  const cutCopy = duplicateSaleLine(cut, "m", "m2");
  assert.equal(cutCopy[0].polywood_cut_confirmed, true);
  assert.equal(cutCopy[1].polywood_cut_confirmed, false);
  assert.deepEqual(lines.map((r) => r.id), ["a", "b"], "input unchanged");

  assert.deepEqual(removeLineAt(copy, 1).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(reorderByKeys(copy, ["b", "a", "a2"], (r) => r.id).map((r) => r.id), ["b", "a", "a2"]);

  const form = read("src/modules/sales/components/InvoiceForm.tsx");
  assert.match(form, /onAdd=\{addRow\}[\s\S]{0,80}onRemove=\{removeRow\}[\s\S]{0,80}onDuplicate=\{duplicateRow\}[\s\S]{0,80}onReorder=\{reorderRows\}/);
});

// ── Barcode ──────────────────────────────────────────────────────────────────────────────

test("a barcode adds one to the line that has the product, else fills an empty line, else adds one", () => {
  const apply = (row, quantity) => applySaleLinePatch(row, { product_id: BOX.id, product_name: BOX.name, unit_price: 10, quantity });
  const fresh = () => line("new");

  const has = [withProduct("a", GLUE), withProduct("b", BOX, { quantity: 2 })];
  const again = addScannedLine(has, BOX.id, apply, fresh);
  assert.equal(again.length, 2);
  assert.equal(again[1].quantity, 3, "scanned again: quantity + 1");
  assert.equal(again[1].total, 30);

  const withEmpty = [withProduct("a", GLUE), line("e")];
  const filled = addScannedLine(withEmpty, BOX.id, apply, fresh);
  assert.deepEqual(filled.map((r) => [r.id, r.product_id, r.quantity]), [["a", GLUE.id, 1], ["e", BOX.id, 1]]);

  // Scanned into a line's own (empty) product cell: that line, not the first empty one.
  const twoEmpty = [line("e1"), withProduct("a", GLUE), line("e2")];
  const into = addScannedLine(twoEmpty, BOX.id, apply, fresh, "e2");
  assert.deepEqual(into.map((r) => [r.id, r.product_id]), [["e1", ""], ["a", GLUE.id], ["e2", BOX.id]]);
  // A cell of a line that already has a product: the first empty line, as the scan bar does.
  assert.equal(addScannedLine(twoEmpty, BOX.id, apply, fresh, "a")[0].product_id, BOX.id);

  const full = addScannedLine([withProduct("a", GLUE)], BOX.id, apply, fresh);
  assert.deepEqual(full.map((r) => [r.id, r.product_id]), [["a", GLUE.id], ["new", BOX.id]]);

  // The scan bar and a barcode scanned into a grid cell take the same path.
  const form = read("src/modules/sales/components/InvoiceForm.tsx");
  assert.match(form, /await addScannedProduct\(product\);/);
  assert.match(form, /const handleGridBarcodeHit = \(rowId: string, record: LookupRecord\) => \{[\s\S]{0,300}void addScannedProduct\(product, rowId\);/);
  assert.match(form, /addScannedLine\(\s*prev,\s*product\.id,/);
  const cells = read("src/components/line-grid/cells.tsx");
  assert.match(cells, /onBarcodeHit=\{onBarcodeHit\}/);
  const lookup = read("src/components/lookups/EntityLookup.tsx");
  assert.match(lookup, /if \(onBarcodeHit\) onBarcodeHit\(hits\[0\]\);\s*else pick\(hits\[0\]\.id\);/);
});

// ── Columns and wiring ───────────────────────────────────────────────────────────────────

test("the default sales columns fit a 1280 px window; the rest are optional", () => {
  const defaults = [
    { key: "product", type: "text", width: 264 },
    { key: "quantity", type: "number", width: 124 },
    { key: "unit_price", type: "money", width: 112 },
    { key: "discount", type: "number", width: 100 },
    { key: "vat_rate", type: "number", width: 72 },
    { key: "total", type: "money", width: 120 },
  ];
  const width = defaultLineGridWidth(defaults, { reorder: true });
  assert.ok(width <= LINE_GRID_ROOM_AT_1280, `sales: ${width} > ${LINE_GRID_ROOM_AT_1280}`);
  const src = read("src/modules/sales/components/SalesLinesGrid.tsx");
  for (const c of defaults) assert.match(src, new RegExp(`key: "${c.key}",\\s*header: [^\\r\\n]+\\r?\\n\\s*type: "${c.type}",\\s*width: ${c.width},\\r?\\n(?!\\s*optional)`), c.key);
  for (const key of ["warehouse", "price_tier", "currency", "exchange_rate", "product_code", "unit", "discount_type", "extra_info"]) {
    assert.match(src, new RegExp(`key: "${key}",[\\s\\S]{0,120}optional: true,`), `${key} is optional`);
  }
  assert.match(src, /key: "product",[\s\S]{0,400}<LineProductCell/, "product first (sticky)");
  assert.doesNotMatch(src, /<select|<input|type="date"/, "no native controls in the grid");
  // Errors as red outline + tooltip (rule 2): stock on the quantity, a missing warehouse.
  // A stock shortfall stays a note (amber outline + tooltip), as in the old table, not an error.
  assert.match(src, /key: "quantity",[\s\S]{0,120}warning: \(row\) => stockWarning\(row\)/);
  // A cleared number cell keeps the line's value (no jump to "0" while retyping).
  assert.match(src, /onChange=\{\(v\) => v !== null && props\.onQuantity\(row, v\)\}/);
  assert.doesNotMatch(src, /v \?\? 0/);
  // The product search of a Polywood warehouse row is narrowed, as the old list was.
  assert.match(src, /where=\{props\.productWhere\(row\)\}/);
});

test("UI_STANDARD switches the editor; with it off the old table, scan bar and buttons stay", () => {
  const form = read("src/modules/sales/components/InvoiceForm.tsx");
  assert.match(form, /const salesGrid = uiStandard && !polywoodOnly;/);
  assert.match(form, /\{salesGrid \? \(\s*<div className="p-2">\s*<SalesLinesGrid/);
  assert.match(form, /\{salesGrid \? null : \(\s*<div className="relative z-0 overflow-visible border-b border-amber-200 bg-amber-50 px-4 py-3">\s*<BarcodeScanField/, "scan bar only with the old table");
  assert.match(form, /\{!salesGrid && selectedRowIds\.size > 0 \? \(/, "the checkbox bar only with the old table");
  assert.equal((form.match(/\{salesGrid \? null : \(\s*<(?:Button|button)[\s\S]{0,200}onClick=\{addRow\}/g) ?? []).length, 2, "both header Add row buttons only with the old table");
  // The old table is still there for the flag-off path.
  assert.match(form, /<table \{\.\.\.gridTableProps\} className="app-table w-full text-left text-sm">/);
  assert.match(form, /<ProductCombobox/);
});

test("the sales grid texts exist in az, en and ru, in sentence case", () => {
  const keys = Object.keys(enMessages.invoice.salesLines);
  assert.ok(keys.length >= 15);
  for (const [name, m] of [["az", azMessages], ["ru", ruMessages], ["en", enMessages]]) {
    assert.deepEqual(Object.keys(m.invoice.salesLines).sort(), [...keys].sort(), name);
    for (const k of keys) {
      const s = m.invoice.salesLines[k];
      assert.ok(s.trim(), `${name}.${k}`);
      // TXT-1: sentence case, not ALL CAPS (the VAT abbreviation is the only exception).
      if (!/^(ƏDV|VAT|НДС) %$/.test(s)) assert.match(s, /^\P{Ll}*\p{Lu}?[^]*\p{Ll}/u, `${name}.${k} not ALL CAPS`);
    }
    assert.match(m.invoice.salesLines.stock, /\{count\}.*\{unit\}/);
  }
  const src = read("src/modules/sales/components/SalesLinesGrid.tsx");
  for (const k of src.matchAll(/k\("([a-zA-Z]+)"\)/g)) assert.ok(keys.includes(k[1]), `invoice.salesLines.${k[1]} used but missing`);
});

test("a line without a warehouse shows the warehouse column, so its error is visible", () => {
  const src = read("src/modules/sales/components/SalesLinesGrid.tsx");
  assert.match(src, /key: "warehouse",[\s\S]{0,200}error: \(row\) => \(row\.product_id && !row\.warehouse_id \? k\("noWarehouse"\) : null\)/);
  assert.match(src, /forceShown=\{items\.some\(\(row\) => row\.product_id && !row\.warehouse_id\) \? FORCE_WAREHOUSE : NONE\}/);
});

test("the metre-line price hint is one shared rule", () => {
  const mdf = withProduct("m", MDF, { unit: "Metr", polywood_sale_mode: "linear_m", unit_price: 12 });
  assert.deepEqual(saleMetricHint(mdf, MDF), { unitPrice: 12, barLengthM: 4, mode: "linear_m" });
  assert.equal(saleMetricHint(withProduct("b", BOX), BOX), null);
  assert.equal(saleMetricHint({ ...mdf, unit_price: 0 }, MDF), null);
  const form = read("src/modules/sales/components/InvoiceForm.tsx");
  assert.match(form, /const gridMetricHint = \(row: SaleItem\) => saleMetricHint\(row, productOfRow\(row\)\);/);
});
