// Fix F4: duplicate product names are detected and warned about, never blocked.
// The database side is checked by supabase/tests/duplicate_product_names.sql in CI.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkImportNames,
  codeLooksLikeName,
  findSameNameProducts,
  hasImportNameWarning,
  normalizeProductName,
  productHref,
  rowsToImport,
} from "../src/lib/products/duplicateNames.ts";
import { parseBulkImportCsv, BULK_IMPORT_CSV_HEADERS } from "../src/lib/products/bulkImport.ts";
import { STOCK_ISSUE_KINDS, AUTO_FIX_KINDS, groupDuplicateNames, groupStockIssues } from "../src/modules/inventory/lib/stockIntegrity.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261029300000_duplicate_product_names.sql";

// The two pairs found on production (2026-10-29).
const CATALOG = [
  { id: "p1", code: "KON-S", name: "Konik bar", stock: 194 },
  { id: "p2", code: "Konik bar", name: "Konik bar", stock: 182 },
  { id: "p3", code: "MEM-85-KV-QA", name: "Qara 85 cm kvadrat", stock: 1 },
  { id: "p4", code: "Qara 85 cm kvadrat", name: "Qara 85 cm kvadrat", stock: 1 },
  { id: "s1", code: "SVC-1", name: "Montaj", stock: 0, is_service: true },
  { id: "k1", code: "KIT-1", name: "Montaj", stock: 0, is_composite: true },
  { id: "m1", code: "MON-1", name: "Montaj", stock: 3 },
];

test("normalisation is lower(btrim(name)): outer spaces and case only", () => {
  assert.equal(normalizeProductName("  Konik BAR  "), "konik bar");
  assert.equal(normalizeProductName("Konik  bar"), "konik  bar", "inner spaces are kept, as btrim keeps them");
  assert.equal(normalizeProductName(null), "");
  assert.equal(normalizeProductName(undefined), "");
  assert.equal(normalizeProductName("   "), "");
});

test("same-name products: stockable only, the edited product excluded, blank names never match", () => {
  assert.deepEqual(findSameNameProducts(" konik BAR", CATALOG).map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(findSameNameProducts("Konik bar", CATALOG, "p1").map((p) => p.id), ["p2"], "editing p1 warns about p2");
  assert.deepEqual(findSameNameProducts("Montaj", CATALOG).map((p) => p.id), ["m1"], "services and composites are not counted");
  assert.deepEqual(findSameNameProducts("  ", CATALOG), []);
  assert.deepEqual(findSameNameProducts("Konik", CATALOG), [], "a prefix is not the same name");
});

test("code looks like a name: the production pattern", () => {
  assert.equal(codeLooksLikeName("Konik bar", "Konik bar"), true);
  assert.equal(codeLooksLikeName(" konik BAR ", "Konik bar"), true);
  assert.equal(codeLooksLikeName("KON-S", "Konik bar"), false);
  assert.equal(codeLooksLikeName("", ""), false);
});

function csv(rows) {
  const header = BULK_IMPORT_CSV_HEADERS.join(",");
  const lines = rows.map(([code, name]) => [code, name, ...BULK_IMPORT_CSV_HEADERS.slice(2).map(() => "")].join(","));
  return [header, ...lines].join("\n");
}

test("import preview: existing name, same name in the file, code that looks like a name", () => {
  const parsed = parseBulkImportCsv(
    csv([
      ["KON-2", "konik bar"], // row 2: same name as two existing products
      ["Yeni mal", "Yeni mal"], // row 3: code = name
      ["NEW-1", "Yeni mal"], // row 4: same name as row 3 in this file
      ["KON-S", "Konik bar"], // row 5: existing code, the import skips it: no new duplicate
      ["MON-2", "Montaj"], // row 6: one stockable Montaj exists
      ["OK-1", "Tamamilə yeni"], // row 7: clean
    ])
  );
  assert.equal(parsed.parseError, undefined);
  const checks = checkImportNames(parsed.rows, CATALOG);

  assert.deepEqual(checks.get(2).existing.map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(checks.get(2).fileRows, []);
  assert.equal(checks.get(2).codeLooksLikeName, false);

  assert.equal(checks.get(3).codeLooksLikeName, true);
  assert.deepEqual(checks.get(3).fileRows, [4]);
  assert.deepEqual(checks.get(4).fileRows, [3]);
  assert.equal(checks.get(4).codeLooksLikeName, false);

  assert.equal(checks.has(5), false, "a row with an existing code is skipped by the import, not a duplicate");
  // ... and it does not count as a same-name row of the file either.
  assert.ok(!checks.get(2).fileRows.includes(5));
  assert.deepEqual(checks.get(6).existing.map((p) => p.id), ["m1"]);
  assert.equal(checks.has(7), false);
  assert.equal(hasImportNameWarning(checks.get(7)), false);
  assert.equal(hasImportNameWarning(checks.get(3)), true);

  // A warning, not a block: flagged rows stay valid and are imported unless the user skips them.
  assert.ok(parsed.rows.every((row) => row.isValid));
  assert.equal(rowsToImport(parsed.rows, new Set()).length, 6);
  assert.deepEqual(
    rowsToImport(parsed.rows, new Set([2, 3])).map((row) => row.rowNumber),
    [4, 5, 6, 7]
  );
});

test("import preview: invalid rows are never imported, checked or compared", () => {
  const parsed = parseBulkImportCsv(csv([["", "Bir"], ["A-1", "Bir"]]));
  assert.equal(parsed.rows[0].isValid, false);
  assert.deepEqual(rowsToImport(parsed.rows, new Set()).map((row) => row.rowNumber), [3]);
  assert.equal(checkImportNames(parsed.rows, []).size, 0, "the invalid row 2 is not a same-name row of row 3");
});

test("stock integrity: duplicate_name is a review kind, grouped per name", () => {
  assert.ok(STOCK_ISSUE_KINDS.includes("duplicate_name"));
  assert.ok(!AUTO_FIX_KINDS.includes("duplicate_name"), "never fixed automatically");
  const rows = [
    { issue: "duplicate_name", product_id: "p1", product_code: "KON-S", product_name: "Konik bar", details: "name = konik bar", fixable: false, stock_before: 194, stock_after: null },
    { issue: "duplicate_name", product_id: "p2", product_code: "Konik bar", product_name: "Konik bar", details: "name = konik bar", fixable: false, stock_before: 182, stock_after: null },
    { issue: "duplicate_name", product_id: "p3", product_code: "MEM-85-KV-QA", product_name: "Qara 85 cm kvadrat", details: "name = qara 85 cm kvadrat", fixable: false, stock_before: 1, stock_after: null },
    { issue: "duplicate_code", product_id: "x", product_code: "X", product_name: "X", details: "code = X", fixable: false, stock_before: null, stock_after: null },
  ];
  const groups = groupDuplicateNames(rows);
  assert.deepEqual(groups.map((g) => [g.key, g.rows.map((r) => r.product_id)]), [
    ["konik bar", ["p1", "p2"]],
    ["qara 85 cm kvadrat", ["p3"]],
  ]);
  const kind = groupStockIssues(rows).find((g) => g.kind === "duplicate_name");
  assert.equal(kind.autoFix, false);
  assert.equal(kind.info, false);
  assert.equal(kind.fixableCount, 0);
});

test("product links open the products page on that product", () => {
  assert.equal(productHref("00000000-0000-0000-0000-000000000001"), "/products?highlight=00000000-0000-0000-0000-000000000001");
  const page = read("src/app/products/page.client.tsx");
  assert.match(page, /get\("highlight"\)/);
  assert.match(read("src/modules/inventory/components/StockIntegrityPage.tsx"), /groupDuplicateNames/);
});

test("the warning is wired into the product form, quick scan and the import", () => {
  assert.match(read("src/components/products/ProductForm.tsx"), /<DuplicateNameWarning products=\{sameNameProducts\}/);
  assert.match(read("src/components/products/QuickScanModal.tsx"), /<DuplicateNameWarning products=\{sameNameProducts\}/);
  const modal = read("src/components/products/BulkImportModal.tsx");
  assert.match(modal, /checkImportNames\(rows, products\)/);
  assert.match(modal, /rowsToImport\(rows, skipped\)/);
  const page = read("src/app/products/page.client.tsx");
  assert.equal((page.match(/products=\{products\}/g) || []).length, 2, "quick scan and import get the catalog");
});

test("migration: create or replace only, no data changes, no unique constraint on name", () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.stock_integrity_report\(\)/);
  assert.match(sql, /'duplicate_name'/);
  assert.match(sql, /PARTITION BY lower\(btrim\(p\.name\)\)/);
  assert.match(sql, /WHERE NOT p\.svc AND NOT p\.comp/);
  assert.doesNotMatch(sql, /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+)/i);
  assert.doesNotMatch(sql, /stock_integrity_fix/, "the fix function is unchanged and keeps refusing the kind");
  // The rest of the report is the F2 version.
  for (const kind of ["null_warehouse_row", "total_mismatch", "stock_only_in_list", "polywood_mismatch", "subcategory_lost", "duplicate_code", "duplicate_barcode", "no_category", "category_text_differs", "service_or_composite"]) {
    assert.match(sql, new RegExp(`'${kind}'`), kind);
  }
  assert.match(read("supabase/scripts/product_integrity_check.sql"), /'duplicate_name'/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/duplicate_product_names\.sql/);
});

test("strings exist in az, en and ru", () => {
  for (const messages of [azMessages, enMessages, ruMessages]) {
    assert.ok(messages.stockIntegrity.kinds.duplicate_name);
    assert.ok(messages.stockIntegrity.hints.duplicate_name);
    assert.ok(messages.stockIntegrity.colCode && messages.stockIntegrity.colStock);
    for (const key of ["title", "body", "stock", "open", "newTab"]) assert.ok(messages.products.duplicateName[key], key);
    for (const key of ["colSkip", "skip", "skipped", "skippedCount", "nameExists", "nameInFile", "codeLooksLikeName", "nameWarningSummary", "skipFlagged", "importFlagged"]) {
      assert.ok(messages.products.bulkImport[key], key);
    }
  }
});
