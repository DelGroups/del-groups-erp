// GUARD-1: the ACCOUNTING_GUARD flag helper and the migration's hard rules (read-only, no trigger,
// admin-only access). The SQL behaviour itself is checked by supabase/tests/accounting_guard.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCOUNTING_GUARD_CATEGORIES,
  ACCOUNTING_GUARD_STATUSES,
  accountingGuardActive,
  isAccountingGuardEnabled,
} from "../src/lib/features/accountingGuard.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261120100000_accounting_guard_core.sql";

test("ACCOUNTING_GUARD is off unless it is exactly true", () => {
  assert.equal(isAccountingGuardEnabled({}), false);
  assert.equal(isAccountingGuardEnabled({ ACCOUNTING_GUARD: "" }), false);
  assert.equal(isAccountingGuardEnabled({ ACCOUNTING_GUARD: "false" }), false);
  assert.equal(isAccountingGuardEnabled({ ACCOUNTING_GUARD: "1" }), false);
  assert.equal(isAccountingGuardEnabled({ ACCOUNTING_GUARD: "yes" }), false);
  assert.equal(isAccountingGuardEnabled({ ACCOUNTING_GUARD: "true" }), true);
  assert.equal(isAccountingGuardEnabled({ ACCOUNTING_GUARD: " TRUE " }), true);
});

test("only an admin gets the guard, and only with the flag on", () => {
  assert.equal(accountingGuardActive({ enabled: false, isAdmin: true }), false);
  assert.equal(accountingGuardActive({ enabled: true, isAdmin: false }), false);
  assert.equal(accountingGuardActive({ enabled: false, isAdmin: false }), false);
  assert.equal(accountingGuardActive({ enabled: true, isAdmin: true }), true);
});

test("categories and statuses match the database", () => {
  const sql = read(MIGRATION);
  for (const c of ACCOUNTING_GUARD_CATEGORIES) assert.match(sql, new RegExp(`'${c}'`), c);
  const statusCheck = sql.match(/guard_findings_status_check CHECK \(status IN \(([^)]*)\)\)/);
  assert.ok(statusCheck, "status check constraint");
  assert.deepEqual(
    statusCheck[1].split(",").map((s) => s.trim().replace(/'/g, "")),
    [...ACCOUNTING_GUARD_STATUSES],
  );
});

test("the migration seeds every rule of the plan, each with its own check function", () => {
  const sql = read(MIGRATION);
  const codes = [
    "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10",
    "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9",
    "C1", "C2", "D1", "D2", "D3",
  ];
  for (const code of codes) {
    assert.match(sql, new RegExp(`\\('${code}',\\s+'(ledger|documents|cash|partners)'`), `seed ${code}`);
    assert.match(sql, new RegExp(`FUNCTION public\\.guard_check_${code.toLowerCase()}\\(p_params JSONB, p_since TIMESTAMPTZ\\)`), `function ${code}`);
  }
});

test("the guard never writes business data and adds no trigger", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /the guard NEVER posts, edits, reverses or deletes business data/);
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?TRIGGER/i);
  const business = ["journal_entries", "journal_entry_lines", "sales", "sale_items", "purchases", "payments",
    "transactions", "accounts", "expenses", "partners", "customers", "suppliers", "invoice_amendments"];
  for (const t of business) {
    assert.doesNotMatch(sql, new RegExp(`(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\\s+public\\.${t}\\b`, "i"), t);
  }
  // The only writes outside guard_* tables: the audit row of an admin's status change.
  const writes = [...sql.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes.filter((t) => !t.startsWith("guard_")))], ["audit_logs"]);
});

test("access: RLS on, admins read, writes only through the functions", () => {
  const sql = read(MIGRATION);
  for (const t of ["guard_rules", "guard_runs", "guard_findings", "guard_finding_events"]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), t);
    assert.match(sql, new RegExp(`CREATE POLICY ${t}_select ON public\\.${t} FOR SELECT TO authenticated USING \\(public\\._guard_is_admin\\(\\)\\)`), t);
  }
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guard_scan[\s\S]*?SECURITY DEFINER[\s\S]*?PERFORM public\._guard_authorize\(\);/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guard_set_finding_status[\s\S]*?SECURITY DEFINER[\s\S]*?PERFORM public\._guard_authorize\(\);/);
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
});

test("the SQL checks run in CI", () => {
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/accounting_guard\.sql/);
});
