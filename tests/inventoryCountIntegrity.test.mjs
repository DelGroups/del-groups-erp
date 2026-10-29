// Fix F2: product stock integrity, backdated counts (admins only) and admin edits of counts.
// The database side is checked by supabase/tests/inventory_count_integrity.sql in CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCountDate, countToday, isBackdated } from "../src/modules/inventory/lib/inventoryCountDates.ts";
import { AUTO_FIX_KINDS, groupStockIssues, isStockIssueKind, remainingAutoFixable, STOCK_ISSUE_KINDS } from "../src/modules/inventory/lib/stockIntegrity.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("today is Baku's date, also when UTC is still on the previous day", () => {
  // 21:30 UTC on 28 Oct = 01:30 on 29 Oct in Baku (UTC+4).
  assert.equal(countToday(new Date("2026-10-28T21:30:00Z")), "2026-10-29");
  assert.equal(countToday(new Date("2026-10-28T19:59:00Z")), "2026-10-28");
});

test("count date rules: no future date, past dates for admins only", () => {
  const today = "2026-10-29";
  assert.equal(checkCountDate("2026-10-29", { today, isAdmin: false }), null);
  assert.equal(checkCountDate("2026-10-28", { today, isAdmin: false }), "past_admin_only");
  assert.equal(checkCountDate("2026-10-28", { today, isAdmin: true }), null);
  assert.equal(checkCountDate("2026-10-30", { today, isAdmin: true }), "future");
  assert.equal(checkCountDate("2026-02-30", { today, isAdmin: true }), "invalid");
  assert.equal(checkCountDate("", { today, isAdmin: true }), "invalid");
  assert.equal(isBackdated("2026-10-28", today), true);
  assert.equal(isBackdated("2026-10-29", today), false);
});

test("integrity groups: auto-fixable kinds first, only the four safe kinds are fixable", () => {
  assert.deepEqual([...AUTO_FIX_KINDS], ["null_warehouse_row", "total_mismatch", "stock_only_in_list", "subcategory_lost"]);
  assert.ok(!AUTO_FIX_KINDS.includes("polywood_mismatch"), "polywood mismatches need the shop floor");
  const row = (issue, fixable, id = issue) => ({ issue, product_id: id, product_code: null, product_name: id, details: "", fixable, stock_before: null, stock_after: null });
  const groups = groupStockIssues([
    row("service_or_composite", false),
    row("polywood_mismatch", false),
    row("null_warehouse_row", true, "a"),
    row("null_warehouse_row", true, "b"),
    row("total_mismatch", true),
  ]);
  assert.deepEqual(groups.map((g) => g.kind), ["null_warehouse_row", "total_mismatch", "polywood_mismatch", "service_or_composite"]);
  assert.equal(groups[0].fixableCount, 2);
  assert.equal(groups[2].fixableCount, 0);
  assert.equal(groups[3].info, true);
  assert.equal(remainingAutoFixable([row("polywood_mismatch", false), row("subcategory_lost", true)]), 1);
  assert.equal(isStockIssueKind("total_mismatch"), true);
  assert.equal(isStockIssueKind("drop table"), false);
});

test("every issue kind the database reports is known to the page", () => {
  const sql = read("supabase/migrations/20261028181000_product_stock_integrity.sql");
  const report = sql.slice(sql.indexOf("FUNCTION public.stock_integrity_report"), sql.indexOf("FUNCTION public.stock_integrity_fix"));
  // The issue is the first value after "SELECT p.id," in each branch of the UNION.
  const kinds = new Set(
    [...report.matchAll(/SELECT p\.id,\s*(?:CASE WHEN [^']*? THEN '([a-z_]+)' ELSE '([a-z_]+)' END|'([a-z_]+)')/g)].flatMap((m) => m.slice(1).filter(Boolean))
  );
  assert.ok(kinds.size >= 12, `found ${kinds.size} kinds`);
  for (const kind of kinds) assert.ok(STOCK_ISSUE_KINDS.includes(kind), `${kind} has no label on the page`);
});

test("the stock trigger never writes the product total onto one warehouse row again", () => {
  const sql = read("supabase/migrations/20261028181000_product_stock_integrity.sql");
  const trigger = sql.slice(sql.indexOf("FUNCTION public.upsert_warehouse_stock_from_product"), sql.indexOf("DROP TRIGGER IF EXISTS trg_upsert_warehouse_stock_from_product"));
  assert.match(trigger, /app\.skip_stock_sync/);
  assert.match(trigger, /current_stock = current_stock \+ v_delta/);
  assert.doesNotMatch(trigger, /current_stock = COALESCE\(NEW\.stock/);
  assert.doesNotMatch(trigger, /ORDER BY ws\.updated_at DESC/);
});

test("count server actions enforce the date rule and admin-only unpost", () => {
  const actions = read("src/modules/inventory/actions/inventoryCount.ts");
  assert.match(actions, /checkCountDate\(/);
  assert.match(actions, /export async function unpostInventoryCountAction/);
  assert.match(actions, /inventory_count_unpost/);
  assert.match(actions, /isAdminRole\(profile\?\.role\)/);
  const integrity = read("src/modules/inventory/actions/stockIntegrity.ts");
  assert.match(integrity, /isAdminRole\(ctx\.profile\?\.role\)/);
  assert.match(integrity, /isStockIssueKind\(/);
});

test("new texts exist in az, en and ru", () => {
  const keys = [
    ["inventoryCount", "backdatedBadge"],
    ["inventoryCount", "backdatedWarning"],
    ["inventoryCount", "backdatedConfirm"],
    ["inventoryCount", "filterWithBook"],
    ["inventoryCount", "unpost"],
    ["inventoryCount", "unpostWarning"],
    ["inventoryCount", "editHeader"],
    ["stockIntegrity", "title"],
    ["stockIntegrity", "noLedgerNote"],
  ];
  for (const [section, key] of keys) {
    for (const [lang, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
      assert.equal(typeof messages[section]?.[key], "string", `${lang}.${section}.${key}`);
    }
  }
  for (const kind of STOCK_ISSUE_KINDS) {
    for (const [lang, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
      assert.equal(typeof messages.stockIntegrity?.kinds?.[kind], "string", `${lang}.stockIntegrity.kinds.${kind}`);
    }
  }
});
