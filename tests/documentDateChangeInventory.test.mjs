// DATE-3: change the date of inventory and import documents in place (DOC_DATE_CHANGE, admins):
// stock transfers, write-offs, initial balances and stock receipts, posted counts, import receipts
// and import payments. The SQL rules are tested in supabase/tests/document_date_change_inventory.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DATE_CHANGE_CODES,
  DATE_CHANGE_DOCUMENT_TYPES,
  dateChangeAffectedKeys,
  dateChangePaymentsOption,
  issueText,
  parseResolvedDocument,
} from "../src/lib/documents/dateChange.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { translate } from "../src/i18n/translate.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261110152000_document_date_change_inventory.sql";
const NEW_TYPES = ["stock_transfer", "inventory_writeoff", "inventory_initial_balance", "inventory_count", "import_receipt", "import_payment"];

test("the six inventory and import types are supported; no payments option for them", () => {
  for (const type of NEW_TYPES) {
    assert.ok(DATE_CHANGE_DOCUMENT_TYPES.includes(type), type);
    assert.equal(dateChangePaymentsOption(type), null, type);
  }
  assert.deepEqual([...dateChangeAffectedKeys("stock_transfer")], ["stock_moves"]);
  assert.deepEqual([...dateChangeAffectedKeys("import_receipt")], ["journals", "stock_moves", "batches"]);
  assert.deepEqual([...dateChangeAffectedKeys("import_payment")], ["journals", "cash", "payments"]);
  assert.deepEqual(parseResolvedDocument({ type: "import_payment", id: "p1", label: "IMP-1 · 100.00 AZN", date: "2026-11-01" })?.type, "import_payment");
});

test("the new checks and type names exist in az, en and ru", () => {
  const codes = ["reposted_document", "count_polywood_switch", "import_before_confirm", "import_payment_before_payable", "fx_rate_kept"];
  for (const code of codes) {
    assert.ok(DATE_CHANGE_CODES.includes(code), code);
    for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.dateChange.issues[code]?.trim(), code);
  }
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const type of NEW_TYPES) assert.ok(m.dateChange.history.types[type]?.trim(), type);
    assert.ok(m.dateChange.importPayments?.trim());
  }
  const t = (k, p) => translate(enMessages, k, p);
  assert.equal(issueText({ code: "fx_rate_kept", message: "x" }, t), "Exchange rates do not change: the document keeps the rate it was booked with.");
});

test("menus: counts, initial balances, write-offs and imports, only while allowed and posted", () => {
  const screens = read("src/modules/inventory/components/InventoryScreens.tsx");
  assert.match(screens, /hidden: !\(dateChangeOn && r\.status === "posted"\) \},\r?\n\s+\{ key: "delete"/, "counts row menu");
  assert.match(screens, /dateChange\.formActions\(record\.status === "posted", \{ type: "inventory_count"/);
  assert.match(screens, /dateChange\.formActions\(isPosted, \{ type: "inventory_initial_balance"/);
  assert.match(screens, /dateChange\.formActions\(true, \{ type: "inventory_writeoff"/);
  assert.match(read("src/modules/inventory/components/InventoryCountsPage.tsx"), /hidden: !\(dateChange\.allowed && row\.status === "posted"\)/);
  assert.match(read("src/modules/inventory/components/InitialBalanceListPage.tsx"), /hidden: !\(dateChange\.allowed && isPosted\)/);
  assert.match(read("src/modules/inventory/components/DamagedGoodsPage.tsx"), /dateChange\.allowed\s+\? \(\) => dateChange\.open\(\{ type: "inventory_writeoff"/);
  assert.match(read("src/modules/inventory/components/InventoryCountDetailPage.tsx"), /dateChange\.allowed && isPosted \? \(/);
  const posting = read("src/modules/imports/components/PostingPanel.tsx");
  assert.match(posting, /const changeDate = dateChange\.allowed \?/);
  assert.match(posting, /type: "import_receipt"/);
  assert.match(posting, /type: "import_payment"/);
});

test("migration: needs DATE-2, guards module tables, lets only the engine move a posted count", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /to_regprocedure\('public\.resolve_date_change_document\(uuid\)'\) IS NULL/);
  for (const type of NEW_TYPES) assert.match(sql, new RegExp(`'${type}'`), type);
  for (const table of ["stock_transfers", "inventory_writeoffs", "inventory_initial_balances", "inventory_counts"]) {
    assert.ok(sql.includes(`to_regclass('public.${table}') IS NOT NULL`), table);
  }
  // The F2 rule keeps refusing a posted count's date, except while the engine sets the flag.
  assert.match(sql, /IF OLD\.status = 'posted' AND NOT v_engine THEN/);
  assert.match(sql, /set_config\('app\.document_date_change', 'on', true\)/);
  assert.match(sql, /'fx_rate_kept'/);
  assert.equal((sql.match(/IF NOT public\.user_is_admin\(\) THEN/g) ?? []).length, 3, "preview, apply and resolve check admin");
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/document_date_change_inventory\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261110152000_document_date_change_inventory/);
});
