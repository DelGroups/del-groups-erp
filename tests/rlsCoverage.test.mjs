// Every public table must have row level security on.
// 20261011150000 closed the 26 tables that still had it off.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const RLS_MIGRATION = "20261011150000_enable_rls_on_remaining_tables.sql";

// Tables that had RLS off on production on 2026-10-11.
const CLOSED_TABLES = [
  "chart_of_accounts",
  "document_expenses",
  "erp_events",
  "expense_categories",
  "financial_categories",
  "inventory_batch_consumptions",
  "inventory_batches",
  "inventory_initial_balance_items",
  "inventory_initial_balances",
  "journal_entries",
  "journal_entry_lines",
  "n8n_chat_histories",
  "partners",
  "payments",
  "polywood_inventory_items",
  "polywood_pieces",
  "product_bom",
  "production_contractors",
  "production_contracts",
  "production_expenses",
  "production_materials",
  "production_outsourcing",
  "purchase_requests",
  "sub_categories",
  "supplier_delivery_ratings",
  "warehouse_stocks",
];

// Written only by SECURITY DEFINER functions: no client write policy.
const READ_ONLY_TABLES = ["journal_entries", "journal_entry_lines", "payments", "supplier_delivery_ratings", "erp_events"];

// RLS for these is switched on by a dynamic loop (EXECUTE format(...)), which
// the static scan below cannot see.
const ENABLED_DYNAMICALLY = new Set([
  "consignment_dispatches",
  "consignment_inventory",
  "consignment_monthly_reports",
  "consignment_partners",
  "consignment_returns",
  "deals",
  "document_number_counters",
  "employee_advances",
  "employee_leaves",
  "payrolls",
  "quotations",
]);

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const sql = readFileSync(join(MIGRATIONS_DIR, RLS_MIGRATION), "utf8");

function policiesFor(table) {
  const re = new RegExp(`CREATE POLICY (${table}_\\w+) ON public\\.${table}\\b([\\s\\S]*?);`, "g");
  return [...sql.matchAll(re)].map((m) => ({ name: m[1], body: m[2] }));
}

test("the migration enables RLS on every table that had it off", () => {
  for (const table of CLOSED_TABLES) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), table);
  }
});

test("no policy is wide open", () => {
  assert.doesNotMatch(sql, /USING \(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /WITH CHECK \(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /\bTO (anon|public)\b/i);
});

test("ledger and payment tables get a read policy only", () => {
  for (const table of READ_ONLY_TABLES) {
    const names = policiesFor(table).map((p) => p.name);
    assert.deepEqual(names, [`${table}_select`], table);
  }
});

test("n8n chat history has no client policy", () => {
  assert.deepEqual(policiesFor("n8n_chat_histories"), []);
});

test("views over the ledger run as the caller", () => {
  for (const view of ["gl_accounts", "journal_lines", "gl_orphaned_document_entries"]) {
    assert.match(sql, new RegExp(`ALTER VIEW public\\.${view} SET \\(security_invoker = true\\);`), view);
  }
});

test("every table created by a migration has RLS enabled by a migration", () => {
  const created = new Set();
  const enabled = new Set();
  const name = String.raw`(?:public\.)?"?(\w+)"?`;
  for (const file of migrationFiles) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const m of text.matchAll(new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${name}\s*\(`, "gi"))) {
      created.add(m[1].toLowerCase());
    }
    for (const m of text.matchAll(
      new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${name}\s+enable\s+row\s+level\s+security`, "gi")
    )) {
      enabled.add(m[1].toLowerCase());
    }
  }
  const missing = [...created].filter((t) => !enabled.has(t) && !ENABLED_DYNAMICALLY.has(t)).sort();
  assert.deepEqual(missing, [], `tables without RLS: ${missing.join(", ")}`);
});
