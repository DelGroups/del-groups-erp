// UI-6: every table on the grid standard. The shared StandardGrid helpers (sorting, "code · name",
// totals), the raw-table guard (a fixture with a raw table fails, an allowlisted count passes) and
// the audit file.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { codeName, compareValues, sortRows, standardGridKey, sumBy, toggleSort } from "../src/components/lists/standardGridLogic.ts";
import { UI_GUARD_RULES, countViolations, globToRegExp, isExemptPath, scanSources, uiGuardConfigs } from "../scripts/ui-guard-rules.mjs";
import { rawTableIssues } from "../scripts/ui-guard.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── StandardGrid helpers ──────────────────────────────────────────────────────

test("a header click sorts ascending, then descending, then back to the table's order", () => {
  assert.deepEqual(toggleSort(null, "amount"), { key: "amount", dir: "asc" });
  assert.deepEqual(toggleSort({ key: "amount", dir: "asc" }, "amount"), { key: "amount", dir: "desc" });
  assert.equal(toggleSort({ key: "amount", dir: "desc" }, "amount"), null);
  assert.deepEqual(toggleSort({ key: "amount", dir: "desc" }, "date"), { key: "date", dir: "asc" });
});

test("values compare as numbers, dates or text (numeric-aware); empty values go last", () => {
  assert.ok(compareValues(2, 10) < 0);
  assert.ok(compareValues("INV-2", "INV-10") < 0, "numeric-aware text");
  assert.ok(compareValues(new Date("2026-01-02"), new Date("2026-01-01")) > 0);
  assert.ok(compareValues(null, 1) > 0);
  assert.equal(compareValues("", null), 0);
  assert.ok(compareValues("ə", "z", "az") !== 0);
});

test("sortRows is stable, keeps empty values at the end in both directions, and leaves unsortable columns alone", () => {
  const rows = [
    { id: "a", n: 3 },
    { id: "b", n: null },
    { id: "c", n: 1 },
    { id: "d", n: 3 },
  ];
  const by = (row, key) => (key === "n" ? row.n : undefined);
  assert.deepEqual(sortRows(rows, { key: "n", dir: "asc" }, by).map((r) => r.id), ["c", "a", "d", "b"]);
  assert.deepEqual(sortRows(rows, { key: "n", dir: "desc" }, by).map((r) => r.id), ["a", "d", "c", "b"]);
  assert.equal(sortRows(rows, null, by), rows);
  assert.equal(sortRows(rows, { key: "x", dir: "asc" }, by), rows, "no sort value: the table's own order");
});

test("code · name on one line, sums over rows, storage key", () => {
  assert.equal(codeName("1100", "Kassa"), "1100 · Kassa");
  assert.equal(codeName("", "Kassa"), "Kassa");
  assert.equal(codeName("1100", null), "1100");
  assert.equal(codeName("Kassa", "Kassa"), "Kassa");
  assert.equal(codeName(null, undefined), "—");
  assert.equal(sumBy([{ v: 0.1 }, { v: 0.2 }, { v: null }, { v: Number.NaN }], (r) => r.v), 0.3);
  assert.equal(standardGridKey("cash-bank-accounts"), "grid:cash-bank-accounts");
});

// ── Raw-table guard ───────────────────────────────────────────────────────────

test("the rawTable rule counts raw tables and imports of the old table component", () => {
  assert.ok(UI_GUARD_RULES.rawTable, "rule exists");
  const text = '<table className="x">\n<table\n>\nimport { Td } from "@/components/ui/table";\n// <TableWrap> is not counted';
  assert.equal(countViolations(text, "rawTable"), 3);
  assert.equal(countViolations("<DataGrid />\n<tablet>", "rawTable"), 0);
});

test("grid components, print layouts and print sheets are exempt", () => {
  for (const file of [
    "src/design-system/components/DataGrid.tsx",
    "src/components/print/InvoicePrintLayout.tsx",
    "src/components/line-grid/LineGrid.tsx",
    "src/modules/imports/components/CostSheet.tsx",
    "src/modules/purchases/components/PurchasePrintTemplate.tsx",
  ])
    assert.ok(isExemptPath(file, "rawTable"), file);
  assert.equal(isExemptPath("src/modules/sales/components/SalesPage.tsx", "rawTable"), false);
  assert.equal(isExemptPath("src/design-system/components/DataGrid.tsx", "select"), false, "only for its category");
  assert.ok(globToRegExp("src/**/*Sheet.tsx").test("src/Sheet.tsx"));
  assert.equal(globToRegExp("src/**/*Sheet.tsx").test("src/a/Sheet.tsx.bak"), false);
  assert.deepEqual(scanSources([["src/components/print/X.tsx", "<table>"]]).rawTable, {});
  // Lint lifts the rule on the exempt globs too.
  const configs = uiGuardConfigs({});
  assert.ok(configs.some((c) => c.files.includes("src/design-system/**")));
});

test("ui:guard fails on a new raw table and passes an allowlisted count", () => {
  const fixture = [["src/modules/demo/components/DemoPage.tsx", "export function DemoPage() { return <table><tbody /></table>; }"]];
  const failing = rawTableIssues({ rawTable: {} }, fixture);
  assert.equal(failing.length, 1);
  assert.equal(failing[0].rule, "raw-table");
  assert.match(failing[0].where, /DemoPage\.tsx/);
  assert.deepEqual(rawTableIssues({ rawTable: { "src/modules/demo/components/DemoPage.tsx": 1 } }, fixture), []);
  assert.equal(rawTableIssues({ rawTable: { "src/modules/demo/components/DemoPage.tsx": 1 } }, [[fixture[0][0], "<table /><table />"]]).length, 1, "a second table in an allowlisted file fails");
  assert.deepEqual(rawTableIssues({ rawTable: {} }, [["src/components/print/Demo.tsx", "<table />"]]), [], "print layouts are exempt");
});

test("the rawTable allowlist only shrinks", () => {
  const allowlist = JSON.parse(read("scripts/ui-guard-allowlist.json"));
  const total = Object.values(allowlist.rawTable ?? {}).reduce((a, b) => a + b, 0);
  // Ceiling when the guard was added (UI-6): this total may only go down.
  assert.ok(total <= 127, `rawTable: ${total} > 127`);
  assert.deepEqual(rawTableIssues(allowlist), [], "every raw table in src/ is allowlisted");
});

// ── Audit and flag switches ───────────────────────────────────────────────────

test("the audit lists every allowlisted file with a decision", () => {
  assert.ok(existsSync(new URL("../docs/ui-tables-audit.md", import.meta.url)), "docs/ui-tables-audit.md");
  const audit = read("docs/ui-tables-audit.md");
  const allowlist = JSON.parse(read("scripts/ui-guard-allowlist.json"));
  for (const file of Object.keys(allowlist.rawTable)) assert.ok(audit.includes(file), `audit misses ${file}`);
  for (const line of audit.split("\n").filter((l) => /^\| `src\//.test(l))) assert.match(line, /\| (DataGrid|LineGrid|keep|later) /, line);
});

test("every converted screen keeps the flag switch (old table with UI_STANDARD off)", () => {
  const audit = read("docs/ui-tables-audit.md");
  const converted = audit
    .split("\n")
    .filter((l) => /^\| `src\//.test(l) && /\| (DataGrid|LineGrid) /.test(l) && /converted/.test(l))
    .map((l) => l.match(/`([^`]+)`/)[1]);
  assert.ok(converted.length > 0);
  for (const file of converted) {
    const text = read(file);
    // useUiStandard(), or the list's own switch (columns.grid / gridColumns.grid from useTableColumns).
    assert.match(text, /useUiStandard\(\)|[cC]olumns\.grid|uiStandard\b/, `${file}: no UI_STANDARD switch`);
    // StandardGrid, ListGrid, DataGrid, LineGrid or a module grid built on them (CommissionRulesGrid, DocumentLinesGrid).
    assert.match(text, /<\w*Grid\b/, `${file}: no grid`);
  }
});
