## پرامپت GUARD-1: جدول‌ها، موتور قوانین و چک‌های حسابداری

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: build the core of the Accounting Guard: a read-only rule engine that scans the ledger and
documents for errors and suspicious entries and stores findings. Branch: saas/accounting-guard-core.
Open a PR. Follow CLAUDE.md (SaaS program rules) and read the plan in
docs/accounting-guard-plan.md (copy /mnt/project-files/prompts/accounting-guard-2026-11-10/GUARD-plan-and-prompts.md
sections 1-2 into that file in this PR, in English, so the plan lives in the repo).

Hard rules
- The guard NEVER posts, edits, reverses or deletes business data. It only reads business tables and
  writes to its own guard_* tables. Say this in the migration header and test it.
- No trigger on sales, purchases, payments, journal_entries or any posting path.
- Feature flag ACCOUNTING_GUARD (server env, "true" to enable, off by default), in
  src/lib/features/accountingGuard.ts like newImports.ts. Admin only (isAdminRole / can_manage_settings).
- One migration: supabase/migrations/<unique prefix>_accounting_guard_core.sql (suggested
  20261120100000; check ls supabase/migrations and open PRs first). Safe to re-run.

Read first
- supabase/migrations/20261029300000_duplicate_product_names.sql and
  20261028181000_product_stock_integrity.sql (stock_integrity_report, _stock_integrity_authorize: copy
  that authorize pattern).
- supabase/migrations/20260919120000_gl_integrity_period_lock_reversal.sql (accounting_periods,
  reversal_of / reversed_by), 20261107100000_gl_partner_cash_account.sql and
  supabase/scripts/gl_partner_cash_check.sql (how cash ledgers 1000/1100 and accounts.coa_id work).
- supabase/baseline/03_tables.sql for sales, purchases, payments, transactions, accounts,
  journal_entries, journal_entry_lines; 20261029100000_backdated_invoices_payments.sql and
  invoice_amendments; 20260909160000_audit_logs.sql and 20260909210000_audit_retention_alerts.sql.

Schema (RLS on, SELECT for admins only, writes only through SECURITY DEFINER functions)
- guard_rules(code PK, category, default_severity, enabled, params JSONB, description_key)
  seeded with every rule below.
- guard_runs(id, trigger 'manual'|'button'|'scheduled', scope TEXT[], started_by, started_at,
  finished_at, status, new_count, open_count, resolved_count, error).
- guard_findings(id, rule_code, severity, fingerprint UNIQUE, entity_type, entity_id, doc_no,
  doc_date, partner_type, partner_id, amount, details JSONB, status 'open'|'acknowledged'|
  'resolved'|'auto_resolved'|'false_positive', first_seen_run, last_seen_run, first_seen_at,
  last_seen_at, resolved_by, resolved_at, note).
- guard_finding_events(id, finding_id, actor, from_status, to_status, note, created_at).

Engine
- Each rule is its own function public.guard_check_<code>(p_params JSONB, p_since TIMESTAMPTZ)
  RETURNS TABLE(fingerprint, severity, entity_type, entity_id, doc_no, doc_date, partner_type,
  partner_id, amount, details). Fingerprint = rule code + stable ids (never amounts that change).
- public.guard_scan(p_scope TEXT[] DEFAULT NULL, p_trigger TEXT DEFAULT 'manual') runs every enabled
  rule in scope (category or rule codes), upserts findings by fingerprint (new -> open; seen again ->
  last_seen updated, status kept; open/acknowledged not seen this run (full scope only) ->
  auto_resolved; false_positive stays false_positive and is not re-opened unless details changed
  materially), writes guard_runs, and returns the run id. One failing rule logs its error in the
  run and does not stop the others.
- public.guard_set_finding_status(p_id, p_status, p_note): admins only; note required for
  false_positive and resolved; writes guard_finding_events and audit_logs.

Rules in this PR (thresholds in params)
A1 unbalanced journal entry; A2 entry with no lines or only zero lines; A3 orphan entry (source
document missing); A4 posted sale/purchase/payment with no journal entry, or sale with total_cogs > 0
and no cogs_journal_entry_id; A5 document total differs from its entry (tolerance 0.01); A6 same
source posted twice (not counting reversal pairs); A7 entry dated in a closed accounting_period but
posted after it closed; A8 broken reversal chain; A9 cash/bank account balance differs from its GL
ledger lines; A10 sum of customer / supplier debts differs from receivable / payable accounts.
B1 paid_amount > total, debt != total - paid, negative amounts; B2 possible duplicate invoice (same
partner, same total, doc_date within params.days=2); B3 duplicate document number; B4 payment dated
before its invoice, or any document dated in the future; B5 document dated more than params.days=30
before it was created, and every admin date change from invoice_amendments; B6 sale line below cost,
zero price, or discount above params.max_discount_pct=30; B7 total above params.factor=5 x the
partner's median (needs >= 5 earlier documents); B8 cash expense above params.amount without
attachment; B9 posted document updated or deleted (audit_logs).
C1 cash/bank running balance below zero on any date; C2 accounts.balance differs from its
transactions.
D1 customer with credit balance; D2 supplier paid more than invoiced; D3 debt older than
params.days=90.
Check every column name against the real schema; if a rule cannot be built because data is missing,
leave it seeded with enabled=false and say why in the PR.

Tests
- supabase/tests/accounting_guard.sql (run by the existing db-baseline CI like the other files):
  for every rule, seed one bad case and one good case and assert exactly one finding; assert a second
  scan does not duplicate; assert auto_resolve after fixing the data; assert false_positive stays;
  assert a non-admin cannot call guard_scan or read guard_findings; assert the guard wrote nothing to
  business tables (row counts and checksums before/after).
- Node test for the flag helper.
Run npm run lint, npm test, npm run build. All must pass.

PR description: what changed in plain words, how it was tested, the exact SQL to run (file name and
order: test database first, then production), and that nothing changes for staff while
ACCOUNTING_GUARD is off. List the rule ids that were left disabled and why.
```
