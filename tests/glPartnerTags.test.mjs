// LED-2: partner tags on GL lines 1200 / 2100. SQL behaviour is tested in
// supabase/tests/gl_partner_tags.sql; these checks keep the fix from being lost later.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r/g, "");
const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

/** The text of the LAST migration that (re)defines a function: what production ends up with. */
function latestDefinition(signature) {
  for (const file of [...migrations].reverse()) {
    const sql = read(`supabase/migrations/${file}`);
    const at = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${signature.replace(/[()]/g, "\\$&")}`, "i"));
    if (at >= 0) return { file, body: sql.slice(at, sql.indexOf("$function$;", at) > 0 ? sql.indexOf("$function$;", at) : sql.indexOf("\n$$;", at)) };
  }
  throw new Error(`no migration defines ${signature}`);
}

test("the latest definition of every 1200 / 2100 poster keeps the partner tag", () => {
  const cases = [
    ["post_cash_transaction(p_account_id", /_gl_partner_tag\(v_counter_coa,[\s\S]*_gl_partner_tag\(v_counter_coa,/],
    ["_post_payment_lines(", /_gl_partner_tag\(v_counter,/],
    ["set_customer_opening_balance_atomic(", /_gl_partner_tag\('1200', public\._partner_ledger_partner\(p_customer_id, NULL\)\)/],
    ["set_supplier_opening_balance_atomic(", /_gl_partner_tag\('2100', public\._partner_ledger_partner\(NULL, p_supplier_id\)\)/],
    ["process_production_delivery_event(", /'partner_id', public\._partner_ledger_partner\(v_order\.customer_id, NULL\)/],
  ];
  for (const [signature, pattern] of cases) {
    const { file, body } = latestDefinition(signature);
    assert.match(body, pattern, `${signature} in ${file} lost the partner tag (LED-2)`);
    assert.doesNotMatch(body, /'partner_type', 'customer'|'partner_type', 'supplier'/, `${signature} in ${file} uses a customer/supplier id`);
  }
});

test("opening balances check the caller and are not open to anon", () => {
  const sql = read("supabase/migrations/20261112100000_gl_partner_tags.sql");
  assert.equal((sql.match(/PERFORM public\._opening_balance_authorize\(\);/g) ?? []).length, 2);
  assert.match(sql, /public\.has_permission\('can_manage_settings'\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_customer_opening_balance_atomic\(UUID, NUMERIC\) FROM PUBLIC, anon;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_supplier_opening_balance_atomic\(UUID, NUMERIC\) FROM PUBLIC, anon;/);
  // LED-1 must be there first.
  assert.match(sql, /RAISE EXCEPTION 'Run 20261111100000_partner_ledger\.sql \(LED-1\) before 20261112100000_gl_partner_tags\.sql'/);
});

test("the migration changes no account, amount or idempotency key of the cash posting", () => {
  const sql = read("supabase/migrations/20261112100000_gl_partner_tags.sql");
  assert.match(sql, /'idempotency_key', 'cash_tx:' \|\| v_tx_id::text/);
  assert.match(sql, /'idempotency_key', COALESCE\(p_idempotency, 'payment_lines:' \|\| v_txs\[1\]::text\)/);
  assert.equal((sql.match(/'coa_code', '1100'/g) ?? []).length, 3, "the 1100 line is left as it is (separate item)");
  // Delivery invoices keep their status: no 'posted' added to the delivery insert.
  assert.doesNotMatch(sql, /production_order_id, payments, status/);
});

const rules = (sql) => {
  const begin = sql.indexOf("-- matching rules (begin)");
  const end = sql.indexOf("-- matching rules (end)");
  assert.ok(begin > 0 && end > begin, "matching rules block");
  return sql.slice(begin, end);
};

test("the backfill fixes exactly the lines the report shows (same rules)", () => {
  const report = read("supabase/scripts/gl_partner_tags_report.sql");
  const backfill = read("supabase/scripts/gl_partner_tags_backfill.sql");
  for (const part of report.split("-- matching rules (begin)").slice(1)) assert.equal("-- matching rules (begin)" + part.slice(0, part.indexOf("-- matching rules (end)")), rules(backfill));
  assert.match(backfill, /where p\.partners_found = 1;/);
});

test("the reports only read; the backfill only sets the partner tag, with an audit row", () => {
  const code = (p) => read(p).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
  for (const p of ["supabase/scripts/gl_partner_tags_report.sql", "supabase/scripts/opening_balance_journals_report.sql"]) {
    assert.doesNotMatch(code(p), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/, p);
  }
  const backfill = code("supabase/scripts/gl_partner_tags_backfill.sql");
  const updates = backfill.match(/update public\.\w+/g) ?? [];
  assert.deepEqual(updates, ["update public.journal_entry_lines"]);
  assert.match(backfill, /set partner_id = f\.new_partner_id,\s*partner_type = 'partner'\s*from _gl_tag_fix f/);
  assert.doesNotMatch(backfill, /set[^;]*\b(debit|credit|coa_id|account_id|entry_date)\s*=/);
  assert.match(backfill, /insert into public\.audit_logs/);
  assert.match(backfill.trim(), /^begin;[\s\S]*commit;$/);
});
