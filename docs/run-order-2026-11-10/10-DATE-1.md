(Shared design for all DATE prompts, read first)

## Shared design (read before any DATE prompt)

### Why re-date in place, not reverse and re-post

The amend RPCs from F1 reverse the whole invoice and post it again. For a date-only change that fails on purchases whose goods were sold, and it rewrites FIFO consumption and COGS for nothing. A date change keeps the amounts, lines, accounts and partners: only *when* changes. So the engine moves the dates of the rows the document already created, inside one transaction, after the timeline checks prove nothing goes negative and no ordering breaks. The ledger stays balanced (same lines, same amounts); the period guard (`guard_journal_entry_period`, BEFORE UPDATE) still refuses a closed period, and the engine must also check the OLD date explicitly because the guard only reads NEW on update. Every moved row is recorded (table, id, old timestamp, new timestamp) so the change can be audited and undone by applying the reverse change.

If Del picks "reverse and re-post" instead, keep the same preview/blocker engine and call the existing amend RPCs for sales/purchases, and accept that purchases with consumed goods stay blocked.

### Objects (DATE-1 creates them; DATE-2/3 add handlers)

- Table `document_date_changes`: id, document_type, document_id, document_label, old_date, new_date, reason (NOT NULL, non-blank), moved_rows JSONB (`[{table, id, column, old, new}]`), warnings_acknowledged JSONB, options JSONB, changed_by, changed_by_name, changed_at. RLS: select for admins only; insert only through the security-definer RPC.
- Registry: a SQL function `_date_change_handler(document_type)` (or a CASE inside the two RPCs) mapping each document type to: how to lock and read the header (date column, status), how to find its rows (`journal_entries` by `COALESCE(document_id, source_id)`, `transactions` by `source_type/source_id`, `stock_movements` by `reference_type/reference_id`, `inventory_batches` by `document_id`, `inventory_batch_consumptions` by `sale_id` etc., `polywood_pieces` by source document / sale line), and its dependent documents (payments, returns, slips, import stages). Verify each mapping against the real columns in `supabase/baseline` + migrations; do not guess.
- `preview_document_date_change(p_document_type text, p_document_id uuid, p_new_date date, p_options jsonb default '{}')` → `{ok, blockers:[{code, message, details}], warnings:[{code, message, details}], affected:{journals, cash, stock_moves, batches, pieces, dependents:[...]}}`. STABLE, security definer, admin only. Read-only.
- `apply_document_date_change(p_document_type, p_document_id, p_new_date, p_reason, p_options jsonb default '{}', p_acknowledged_warnings text[] default '{}')`: admin only (`user_is_admin()`, NOT the `can_edit_posted_*` permissions), locks the document `FOR UPDATE` and the touched products/accounts in a fixed order (by id) to avoid deadlocks, re-runs the preview inside the transaction, refuses if any blocker or any warning code not in `p_acknowledged_warnings`, then moves the rows, updates the header date, writes `document_date_changes`, the chatter (`mail_messages` when present), and `log_erp_event('document_date_change', ...)` with an idempotency key `date_change:<type>:<id>:<new_date>:<count>`. Returns the change id and counts.
- Timestamps: keep each row's Baku time of day, move the day (reuse the idea of `document_timestamp()`). `journal_entries.entry_date` and `.date` both; `transactions.transaction_date`; `stock_movements.created_at`; `inventory_batches.created_at`; `inventory_batch_consumptions.created_at`. Header columns (`sales.doc_date`, `purchases.doc_date`, ...). Do not touch `created_at` of the header itself (that is when it was typed in) except where the module uses it as the document date; say which in the PR.
- Option `move_same_day_payments` (default false): when the invoice moves later than its payments, move the payments recorded on the old invoice date along with it (they are re-checked by R6/R7 like everything else). Payments on other days are a blocker listing them.

### Timeline checks (the core, write them once and reuse)

- `_stock_timeline_violations(p_moves jsonb)`: input = this document's stock movements with old and new timestamps. For each (product_id, warehouse_id), compute the running balance over all `stock_movements` of that pair ordered by (timestamp, id), with this document's rows at their new timestamps; return each point where the balance < -0.0005 with date, product name, warehouse, shortfall. Only the window between min(old,new) and the end matters, but the starting balance must include everything before it. Use the same quantity sign and unit rules the stock functions use (Polywood metres, kits exploded through BOM, services skipped). Respect existing negative-stock settings if a product/warehouse allows negative stock (search the code; if none exists, negative is always a blocker).
- `_cash_timeline_violations(p_moves jsonb)`: same idea over `transactions` per cash/bank account (`account_id` or whatever the balance functions use: read `get_account_balance` / the insufficient_balance checks in `20261107100000_gl_partner_cash_account.sql` and `20261005200000_expense_documents.sql`, and use the same rule). Exclude storno pairs the way `_invoice_payments_before` does.
- FIFO (R4), Polywood (R5), inventory counts (R8: a posted `inventory_counts` row with an item for the same product and warehouse whose count date is between old and new date), dependents (R7).
- Each check returns rows; preview turns them into blocker/warning entries with readable az/en/ru messages (codes in SQL, texts through src/i18n in the UI; SQL `MESSAGE` stays Azerbaijani like the rest of the codebase).

### UI

- Flag `DOC_DATE_CHANGE` (env + `src/lib/features/docDateChange.ts`, same pattern as `newImports.ts`), off by default.
- Admin-only menu item "Tarixi dəyiş" in the three-dot menu of each supported list row and in the document form's header actions (only for posted documents; drafts already edit the date in the form).
- Dialog (Radix, design tokens, docs/ui-standard.md): current date, new date picker (max today), reason (required), option checkbox(es), a "Yoxla" step that calls preview and shows blockers (red, apply disabled) and warnings (amber, each must be ticked), affected counts, then "Tətbiq et". After success: toast, refresh the document, the change appears in the chatter.
- Admin page "Tarix dəyişiklikləri" (under Settings › Audit or Accounting reports, wherever audit pages live now): filters by document type, user, date range; columns: when, who, document (link), old → new, reason, rows moved; row detail shows `moved_rows`.
- Every string through src/i18n (az, en, ru).

### Tests (each PR)

- SQL tests in `supabase/tests/` (wired into CI like the existing ones): for every rule a passing case and a failing case. At least: sale moved before the purchase that supplied it (R3 blocked); purchase with sold goods moved earlier (allowed) and later than the sale (R4 blocked); payment moved before the cash came in (R6 blocked); invoice moved after its payment (R7 blocked, allowed with `move_same_day_payments` when same day); posted count in between (R8); closed period old or new (R2); non-admin with `can_edit_posted_sales` refused (R1); journal stays balanced and every moved row is listed in `document_date_changes`; apply twice with the same args is idempotent; applying the reverse change restores the original timestamps.
- Unit tests for the dialog state (preview → acknowledge → apply) and the i18n keys.

---

---

## Prompt DATE-1 — Engine, sales and purchase invoices, dialog, history page

Check available skills, use every one that fits, and say which you used.

Branch: `saas/doc-date-change-core`. One PR, never push to main. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (Next 16, middleware is `src/proxy.ts`). Follow the SaaS program rules in CLAUDE.md and `docs/ui-standard.md`.

Read first: this file's "Shared design" section, `supabase/migrations/20261029100000_backdated_invoices_payments.sql` (document date helpers, amend RPCs, `_invoice_payments_before`), `20260919120000_gl_integrity_period_lock_reversal.sql` (period guard, ledger immutability), `20261029200000_stock_per_warehouse.sql`, `20261028182000_inventory_count_backdate_admin_edit.sql` (`inventory_count_book_qty_at`), `src/modules/sales/lib/submitSale.ts`, `src/modules/purchases/lib/submitPurchase.ts`.

Do:

1. Migration `supabase/migrations/20261110150000_document_date_change_core.sql` (prefix reserved; re-check `ls supabase/migrations` and open PRs first). Creates `document_date_changes`, the timeline check helpers, `preview_document_date_change`, `apply_document_date_change`, with handlers for `sale` and `purchase` (and the payments recorded inside them). `create or replace` / `if not exists`, safe to re-run, no data changes. Grants: execute to authenticated (the functions check admin themselves), nothing to anon.
2. Make sure the amend RPCs from F1 still work unchanged. Do not change who can amend; only the new date-change path is admin-only.
3. Feature flag `DOC_DATE_CHANGE`, the dialog, the three-dot menu item and form action for sales and purchases (old and new UI, wherever posted invoices are listed/opened), and the admin history page. Hidden unless the flag is on AND the user is admin.
4. In the sales/purchase forms, when the flag is on and an admin edits a posted invoice and changes ONLY the date, route it to the date-change dialog instead of the full amend (say so in the UI). Any other change keeps using amend.
5. Tests as in "Shared design › Tests" for sale and purchase.
6. `npm run lint`, `npm test`, `npm run build` must pass.

Do not: run SQL on production; re-date existing documents; change FIFO costs or COGS amounts; fix unrelated problems (list them in the PR).

PR: plain-words description, how it was tested, UI rules touched (rule ids), and Del's manual steps: run the migration on the test project `del-groups-erp-dev` in the SQL Editor, test, then production; set `DOC_DATE_CHANGE=true` only when ready.

---
