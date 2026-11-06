// GL-1: partner cash payments on the cash account's own ledger. The database behaviour is checked
// by supabase/tests/gl_partner_cash_account.sql in CI; this keeps the migration and the production
// check script honest: the fix touches only the cash line's ledger, and the script writes nothing.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261107100000_gl_partner_cash_account.sql";
const SCRIPT = "supabase/scripts/gl_partner_cash_check.sql";

test("the migration books the cash line on the account's own ledger, same signatures and keys", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.gl_coa_for_cash_account\(p_account_id UUID, p_payment_method TEXT\)/);
  assert.match(sql, /JOIN public\.chart_of_accounts c ON c\.id = a\.coa_id/);
  assert.match(sql, /public\.gl_coa_for_payment_method\(p_payment_method\)\n  \);/, "the method is only the fallback");
  // Same signatures as before.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.post_partner_payment_gl_journal\(\n  p_payment_id UUID,/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_partner_payment\(p_payload jsonb\)/);
  // Both cash lines use the helper; no call to the method rule is left outside the helper.
  assert.match(sql, /v_coa_cash := public\.gl_coa_for_cash_account\(p_cash_account_id, p_payment_method\);/);
  assert.match(sql, /'account_code', public\.gl_coa_for_cash_account\(v_cash_account_id, v_method\),/);
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.equal(code.match(/gl_coa_for_payment_method\(/g)?.length, 1, "only the helper's fallback calls the method rule");
  // Idempotency keys unchanged (journal in, journal out, and the multi-line path).
  assert.equal(code.match(/'idempotency_key', 'partner_payment:' \|\| /g)?.length, 3);
  // Nothing changes in the stored data: no top-level UPDATE / DELETE / INSERT / ALTER (only function bodies).
  assert.doesNotMatch(code, /^(UPDATE|DELETE|INSERT|ALTER|TRUNCATE)\b/im);
});

test("the check script is read-only outside its commented optional blocks", () => {
  const code = read(SCRIPT)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(code, /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|perform|do\s*\$\$|call)\b/i);
  assert.equal(code.match(/^select '/gm)?.length, 5, "five small reports");
  for (const report of ["1. partner payments", "2. accounts", "3. flagged partner lines", "4. flagged totals", "5. gl vs balance"]) {
    assert.ok(code.includes(`'${report}'`), report);
  }
  // The optional reclassification keeps the period lock and is idempotent.
  const all = read(SCRIPT);
  assert.match(all, /--\s+if public\.is_accounting_period_closed\(v_date\) then/);
  assert.match(all, /--\s+'idempotency_key', format\('gl1-reclass:%s:%s:%s→%s'/);
});

test("the SQL test runs in CI, after the migration, and the import tests re-apply it", () => {
  const ci = read(".github/workflows/db-baseline.yml");
  assert.match(ci, /supabase\/tests\/gl_partner_cash_account\.sql/);
  for (const t of ["imports_core", "imports_posting", "imports_fx"]) {
    assert.match(read(`supabase/tests/${t}.sql`), /\\ir \.\.\/migrations\/20261107100000_gl_partner_cash_account\.sql/, t);
  }
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261107100000_gl_partner_cash_account/);
});
