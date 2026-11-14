# Accounting Guard: plan

**Del's request (2026-11-10, item 10):** a button that finds products with the same or a wrong name, a button that finds documents suspected of an accounting error, and a "professional accountant agent" that watches the whole system all the time, tells the admin when something is wrong or suspicious, and builds and stores its reports in a section of its own.

This file holds sections 1 and 2 of the plan. The prompts for each step (GUARD-1 to GUARD-5) are in Del's project files (`prompts/accounting-guard-2026-11-10/GUARD-plan-and-prompts.md`). What GUARD-1 actually built is listed at the end.

## 1. Where things stand (code on main, commit 7b02d4c)

- **Duplicate product names (F4) exist:** `stock_integrity_report()` in migration `20261029300000_duplicate_product_names.sql` has a `duplicate_name` kind (exact match on `lower(btrim(name))` only). It is shown at `/settings/stock-integrity` (`src/modules/inventory/components/StockIntegrityPage.tsx`). The other kinds are duplicate_code, duplicate_barcode, no_category, total_mismatch, polywood_mismatch and so on. "Similar" names (extra spaces, ə/e, ı/i, Cyrillic and Latin letters, typos) are not found. `pg_trgm` is not enabled yet.
- **The general ledger is only checked by a manual script:** `supabase/scripts/gl_partner_cash_check.sql` (read-only, run by hand in the SQL Editor). There is no automatic function for "suspicious documents".
- **The accounting base the guard builds on:** `journal_entries` (document_type, document_id, reversal_of, reversed_by) and `journal_entry_lines` (debit/credit, coa_id, partner_id, account_id), `chart_of_accounts`, `accounting_periods` (period lock), `sales` / `purchases` (total_amount, paid_amount, debt_amount, doc_date, created_by, status), `payments`, `transactions`, `accounts`, `invoice_amendments`, `audit_logs` and `audit_alerts`.
- **Notifications:** the bell in `NewShell.tsx` (`useNotifications`) only shows the plan-limit warning. There is no per-user notification table. The app sends no e-mail.
- **AI:** the built-in Claude assistant (`src/lib/ai/native/*`) exists behind the `AI_NATIVE_ENABLED` flag and `ANTHROPIC_API_KEY`, with read-only tools. The accountant agent uses the same router and key.
- **Scheduling:** only GitHub Actions (`tenant-usage.yml`, `billing.yml`). `pg_cron` is not enabled in the database.

## 2. Design (summary)

The guard has two layers. Both only **read and report**: they never post, correct or delete a document.

1. **Rule engine (SQL, deterministic and cheap):** a set of checks, each one its own SQL function with the same output. `guard_scan()` runs every enabled check and writes the results into the findings table. Every finding has a fingerprint, so the same problem does not raise a new alert on later runs. When a problem is no longer seen, it is resolved automatically.
2. **Accountant agent (Claude):** reads the findings and overall figures, ranks them, suggests the likely cause and the correct accounting fix (for example a reversal entry), reports unusual patterns that fixed rules do not see, and stores daily / monthly reports. Its tools are read-only. Only an admin can confirm a "false positive" it suggests.

### Tables (one migration)

| Table | Purpose |
|---|---|
| `guard_rules` | List of checks: code, category, default severity, enabled, params (thresholds, JSONB) |
| `guard_runs` | Each run: trigger (manual / scheduled / button), scope, start / end, counts of new / open / resolved findings, error |
| `guard_findings` | Each problem: rule_code, severity, fingerprint (unique), entity_type / entity_id, doc_no, partner, amount, details JSONB, status (open / acknowledged / resolved / auto_resolved / false_positive), first_seen, last_seen, resolved_by, note |
| `guard_finding_events` | History of each finding: who set which status and why (full log) |
| `guard_reports` | Stored reports: kind (daily / monthly / on_demand / scan), period, body (Markdown), summary JSONB, model, cost, created_by (system / ai / user) |
| `guard_notifications` | Notification per admin: finding_id or report_id, read_at |

Access: admins only (`isAdminRole` / `can_manage_settings`); RLS on every table; writes only through SECURITY DEFINER functions.

### Checks (first version)

**A. General ledger (critical)**
- A1 Unbalanced journal entry (total debit ≠ total credit)
- A2 Journal entry with no lines or with zero lines
- A3 Orphan journal entry (the source document was deleted)
- A4 Posted invoice / payment with no journal entry, or COGS not posted
- A5 Invoice amount ≠ the amount of its journal entry
- A6 The same source document posted twice (double posting)
- A7 Entry posted or changed inside a closed period
- A8 Broken reversal chain (reversed_by pointing nowhere, reversed twice)
- A9 GL balance of a cash / bank account ≠ the account's own balance (`accounts.balance`)
- A10 Sum of customer debts ≠ the receivable account; sum of debts to suppliers ≠ the payable account

**B. Documents**
- B1 paid_amount greater than the invoice total, or debt ≠ total − paid, or a negative amount
- B2 Possibly duplicate invoice: same partner, same amount, 0–2 days apart
- B3 Duplicate document number
- B4 Payment dated before the invoice; a date in the future
- B5 Document dated far back (more than N days before it was created), or a date changed by an admin (`invoice_amendments`)
- B6 Sale below cost, zero price, discount above X %
- B7 Amount unusual for the same partner or product (for example more than 5 times the median)
- B8 Large cash expense without an attachment
- B9 Document deleted or changed after posting (`audit_logs` with DELETE / UPDATE on a posted document)

**C. Cash and bank**
- C1 Negative cash / bank balance at any moment (running balance by date)
- C2 Account balance ≠ the sum of its transactions

**D. Business partners**
- D1 Customer with a credit balance (paid too much; maybe paid twice)
- D2 Payments to a supplier above the supplier's invoices
- D3 Old debt (more than 90 days)

**E. Stock**
- E1 Every current kind of `stock_integrity_report()` (no duplicated logic: call that function)
- E2 Negative stock in a warehouse
- E3 Sale of a product that had no stock on the document date (backdated documents)
- E4 Zero unit cost, or a sudden jump in purchase price
- E5 Large inventory count difference

**F. Product data (the "duplicate or wrong name" button)**
- F1 Exactly the same name (the current duplicate_name)
- F2 Similar name: normalisation (spaces, punctuation, upper / lower case, ə→e, ı→i, ö→o, ü→u, ş→s, ç→c, ğ→g, Cyrillic look-alike letters) and `pg_trgm` similarity above a threshold (default 0.85)
- F3 Name in the code column, code in the name column, leading / trailing or double spaces
- F4 No category, no unit, zero sale or purchase price
- F5 Duplicate code or barcode (the current kinds)

Severity: critical (A1–A6, A9, C1) / high / medium / low. Every threshold can be changed in `guard_rules.params`.

### Running and scheduling

- **Buttons (immediate):** "Find duplicate or wrong products" on the product list and the Stock integrity page; "Find suspicious documents" on the sales and purchase invoice lists and the guard page. Each button runs `guard_scan(scope)` with its category and opens the result. Admins only.
- **Automatic:** `pg_cron` inside the database (every 30 minutes a scan of documents changed since the last run, every night at 02:00 Baku a full scan). It does not depend on the server or GitHub and works for SaaS companies too. Del enables `pg_cron` once in Supabase (Database → Extensions, or Integrations → Cron).
- **Accountant agent:** a server route `/api/guard/agent` called with the secret key `GUARD_CRON_SECRET` (only in `.env.production`). Every night after the full scan a scheduled GitHub Action (like `tenant-usage.yml`) calls it and a daily report is stored; on the first day of each month a deeper monthly report. An admin can also press "Ask the accountant" or "Build a report" by hand. No trigger is added to the invoice posting path, so posting a document is never slowed down or broken by the guard.

### Alerts for the admin

- Bell at the top of the page: new critical / high findings and fresh reports (admins only).
- "Accounting Guard" widget on the admin home page: health score, open counts by severity.
- E-mail / Telegram: no infrastructure yet; later, as a separate step (GUARD-6).

### Its own section: "Accounting Guard" (`/finance/guard`, admins only)

Tabs: **Dashboard** (score, trend, most important items) · **Findings** (table with filters by severity / category / status / date / partner, open the document, buttons "Seen", "Resolved", "Not an error" with a required reason, Excel / PDF export) · **Reports** (stored agent and scan reports, view, PDF / Excel export) · **Rules** (on / off, severity, thresholds) · **Runs** (history of runs and errors). Every status change is written to `guard_finding_events` and `audit_logs`.

### Flags (off by default)

- `ACCOUNTING_GUARD=true` turns on the section, the buttons, the notifications and the manual scan (admins only).
- `ACCOUNTING_GUARD_AI=true` turns on the agent layer (needs `ANTHROPIC_API_KEY`).
- `GUARD_CRON_SECRET` the key of the scheduled route (Del sets it on the server himself; never in chat or in the repo).

### Order of the PRs

| # | Prompt | Branch | Suggested migration* |
|---|---|---|---|
| 1 | GUARD-1 tables + engine + checks A, B, C and D | `saas/accounting-guard-core` | `20261120100000_accounting_guard_core.sql` |
| 2 | GUARD-2 product data (F) + stock checks (E) + products button | `saas/accounting-guard-products` | `20261120110000_accounting_guard_products.sql` |
| 3 | GUARD-3 guard section + suspicious documents button + notifications + widget | `saas/accounting-guard-ui` | none (or `20261120120000_accounting_guard_notifications.sql` if needed) |
| 4 | GUARD-4 scheduling with pg_cron + incremental scan | `saas/accounting-guard-schedule` | `20261120130000_accounting_guard_cron.sql` |
| 5 | GUARD-5 Claude accountant agent + stored reports | `saas/accounting-guard-agent` | `20261120140000_accounting_guard_reports.sql` (if GUARD-1 was not enough) |
| 6 | GUARD-6 (later, optional) e-mail / Telegram, merge tool for duplicate products | separate | separate |

\* Before choosing, check `ls supabase/migrations` and the open PRs; if other threads have taken the number, take the next free one.

**Merging duplicate products** is deliberately not in this stage: F4 decided that a person chooses which row is right, and a merge has irreversible effects on stock, invoices and unit cost. The guard only finds and reports. If Del wants it, GUARD-6 builds a merge wizard with a preview and a compensating stock document.

### Manual steps for Del after each merge

1. After each PR: run that migration's SQL on the test database, then on production (the order is written in each PR).
2. `ACCOUNTING_GUARD=true` in `.env.production`, then restart.
3. After GUARD-4: enable `pg_cron` in Supabase, then run its migration.
4. After GUARD-5: `ACCOUNTING_GUARD_AI=true` and `GUARD_CRON_SECRET` on the server, and the same secret in GitHub (Settings → Secrets → Actions).

## What GUARD-1 built

Migration `supabase/migrations/20261120100000_accounting_guard_core.sql`, tests in `supabase/tests/accounting_guard.sql` (CI: db-baseline) and `tests/accountingGuard.test.mjs`, flag helper `src/lib/features/accountingGuard.ts`.

- Tables `guard_rules`, `guard_runs`, `guard_findings`, `guard_finding_events` (`guard_reports` and `guard_notifications` come with GUARD-3 / GUARD-5). RLS on, SELECT for admins (`user_is_admin()`), no write policy.
- One function per rule, `guard_check_<code>(p_params jsonb, p_since timestamptz)`, all with the same columns (fingerprint, severity, entity_type, entity_id, doc_no, doc_date, partner_type, partner_id, amount, details).
- `guard_scan(p_scope text[], p_trigger text, p_since timestamptz)` returns the run id. `p_since` is for the incremental scan of GUARD-4; with it set, nothing is auto-resolved.
- `guard_set_finding_status(p_id, p_status, p_note)` for admins: open, acknowledged, resolved, false_positive (a reason is required for the last two).
- Rule categories used as scan scopes: `ledger` (A), `documents` (B), `cash` (C), `partners` (D). `products` and `stock` are allowed for GUARD-2.

How the rules read the data (checked against the schema):

- A sale's journal entry is `document_type` `invoice` (older `sale`) with `document_id` = the sale; a purchase's is `bill` (older `purchase`); COGS is `sale_cogs` or `sales.cogs_journal_entry_id`; a partner payment's entry is `payments.journal_entry_id`. "Live" = `reversal_of` and `reversed_by` both empty.
- A6 counts types that own exactly one live entry per document. Opening balances (`customer_opening_balance`, `supplier_opening_balance`) are left out on purpose: every change of an opening balance posts a delta entry for the same customer / supplier.
- A9 compares `accounts.balance` with the journal lines that name the account on 1000 / 1100 or on the account's own ledger (`accounts.coa_id`), as table 5 of `gl_partner_cash_check.sql`.
- A10, D1, D2 use the LED-1 partner ledger (`get_partner_balances`), D3 the LED-4 open items (`_partner_open_items`).
- B3: `sales.doc_no`, `sales.invoice_number` and `purchases.invoice_number` have unique indexes, so B3 finds the same number written differently (case, spaces).
- B5 also reports every date change of DATE-1..3 (`document_date_changes`).
- B8 reads `expense_attachments`; "cash" = the expense's account has type Kassa / cash.
- B9 reads `audit_logs`: sales and purchases are audited on DELETE only; cash rows and expenses on UPDATE too.
- C1 walks the cash rows of an account back from today's `accounts.balance`, so an opening balance typed without a cash row does not create a false alarm (C2 reports that difference).

## What GUARD-2 built

Migration `supabase/migrations/20261120110000_accounting_guard_products.sql` (needs GUARD-1), tests added to `supabase/tests/accounting_guard.sql` and `tests/accountingGuardNames.test.mjs`, the "Find duplicate or wrong names" drawer (`src/components/guard/DuplicateNamesButton.tsx`, `src/lib/actions/accountingGuard.ts`, `src/lib/guard/nameFindings.ts`).

Rules, in the categories `products` and `stock` (scan scopes are the category or the rule code):

| Rule | What it reports |
|---|---|
| F1 | The exact same name (lower case, trimmed) on several stockable products. It reads the `duplicate_name` kind of `stock_integrity_report()`; the logic is not copied. One finding per name. |
| F2 | Similar names: equal after `guard_normalize_name()` (case, spaces, punctuation, ə ı ö ü ş ç ğ, Cyrillic look-alikes) or `pg_trgm` similarity at least `params.threshold` (0.85). Pairs with the same raw name are F1's. Pairs are joined into clusters: one finding per cluster, fingerprinted by its smallest product id, with every product's id, code, name, unit, category, stock and last movement date. |
| F3 | Stray spaces in a name or code, a code that equals the name, a code with a space, a name that is another product's code. |
| F4 | No category (the `no_category` kind of the report), no unit, a zero or empty sale price, a zero or empty buy price. |
| F5 | The same code or barcode (the `duplicate_code` / `duplicate_barcode` kinds of the report), one finding per value. |
| E1 | Every other kind of `stock_integrity_report()` (total or Polywood mismatch, no stock row, lost subcategory and so on), except the ones F1, F4 and F5 own and `service_or_composite` (it only says what a product is; `params.ignore_kinds`). |
| E2 | A warehouse row below zero, or a product total below zero. |
| E3 | A posted sale whose stock movement left the product's balance below zero (balance after each movement = today's stock minus every later movement). Polywood products are left out. |
| E4 | Stock on a FIFO batch with zero unit cost; a purchase line priced above the product's previous purchase by more than `params.pct` (50), in AZN. |
| E5 | A posted inventory count line that differs from the book quantity by more than `params.pct` (20 %), or where nothing was expected and something was found. |

Notes:

- `guard_normalize_name(text)` is IMMUTABLE and has a trigram index (`idx_products_guard_name_trgm`) when `pg_trgm` is available. Without `pg_trgm` F2 compares equal normalised names only.
- A "not a duplicate" decision on a cluster survives changes of the cards' stock and last movement; it lapses when a product joins or leaves the cluster (`_guard_details_hash` ignores `products`, the cards, and keeps `product_ids`).
- The drawer lists F1, F2, F3 and F5 findings. "Not a duplicate" sets the finding to `false_positive` with a required reason. "Open in Accounting Guard" links to `/finance/guard?tab=findings&finding=<id>`, which GUARD-3 builds. There is no merge and no delete.

## What GUARD-3 built

Migration `supabase/migrations/20261120120000_accounting_guard_ui.sql` (needs GUARD-1), SQL tests `supabase/tests/accounting_guard_ui.sql` (CI step), `tests/accountingGuardSection.test.mjs`, the section `/finance/guard` (`src/components/guard/*`, `src/app/finance/guard/page.tsx`), the actions `src/lib/actions/accountingGuardSection.ts`, the pure helpers `src/lib/guard/*`.

- **The section** (admins only, `ACCOUNTING_GUARD=true`, a 404 otherwise; menu entry under Finance; route needs `can_manage_settings`). The tab, the filters and the open finding live in the URL.
  - **Dashboard:** health score (100 minus 10 per critical, 5 per high, 2 per medium, 1 per low open finding, never below 0; the formula is in the score's text), open findings by severity and by category (each a link to the Findings tab with that filter), the trend of open findings over the last 30 scans, the last scan, the ten worst open findings, and "Scan now" (the one primary action).
  - **Findings:** filters by severity, category, rule, status, dates, partner, who created the document, document kind and search; a grid with a side panel per finding (the document and partner as links, the finding's facts, its history from `guard_finding_events`); "Mark as seen", "Resolved" and "Not an error" (the last two with a required reason), "Reopen"; bulk "Mark as seen"; Excel, PDF (the print dialog) and "Save as report" for the filtered list.
  - **Reports:** saved reports (`guard_reports`): snapshots of the findings now, and from GUARD-5 the accountant agent's reports. View, PDF and (for snapshots) Excel.
  - **Rules:** switch a rule on or off, change its severity and its thresholds. The database validates every value again and writes the change to the audit log.
  - **Runs:** every scan with its trigger, scope, counts, duration and failed rules.
- **"Find suspicious documents"** on the sales and purchase lists (classic and new screens) runs the `ledger`, `documents`, `cash` and `partners` rules and opens the Findings tab filtered to that kind of document. A small warning chip in the sale and purchase view shows when a document has findings.
- **The bell** shows new critical and high findings and new reports since the admin last opened the section (`guard_admin_state`). The **home widget** "Accounting Guard" shows the score and the open findings by severity.
- Added to the database: `guard_reports`, `guard_admin_state`, and the functions `guard_dashboard`, `guard_update_rule`, `guard_bulk_set_status`, `guard_create_report`, `guard_notification_state`, `guard_mark_seen`. All admin only; none writes business data.

## What GUARD-4 built

Migration `supabase/migrations/20261120130000_accounting_guard_cron.sql` (needs GUARD-1 and GUARD-3), SQL tests `supabase/tests/accounting_guard_cron.sql` (CI step), `tests/accountingGuardSchedule.test.mjs`, the "Automatic scan" card on the Rules tab (`src/components/guard/GuardScheduleCard.tsx`), `src/lib/guard/schedule.ts`.

- **Off by default.** The setting `system_settings` key `accounting_guard` is `{enabled: false, incremental_minutes: 30, nightly_hour_utc: 22, retention_days: 365}`. The scheduled functions do nothing while `enabled` is false, so merging changes nothing.
- **Two jobs in pg_cron:** `guard-incremental` (every 10, 15, 30 or 60 minutes) and `guard-full` (every night at the chosen UTC hour; 22:00 UTC is 02:00 in Baku). Both call `guard_scheduled_run(mode)`. They are created while pg_cron exists, here or the next time an admin saves the schedule, and they exist while the setting is off (then they do nothing).
- **Incremental scan:** runs only the checks that can look at changes (`guard_rules.full_only = false`), over documents and entries changed since the last good scheduled scan (5 minutes earlier, for documents saved while it ran). It closes nothing (no auto-resolve): a fixed problem is closed by the next full scan. The first scheduled scan is a full one.
- **Full scan:** every check, with auto-resolve; then the retention clean-up, which deletes only the guard's own old closed findings (`auto_resolved`) and old scans. Open, seen and "not an error" findings are never deleted.
- **Checks that need everything** run only in the full scan: A8, A9, A10, C1, C2, D1 to D3, F1 to F5, E1, E2, E4.
- **No pg_cron needed to merge:** on a database without it (CI, a new tenant) the migration applies, the settings are stored, and a notice says what to do. One scan runs at a time.
- **The card** (admins): turn it on, how often it looks at changed documents, the nightly hour (with the Baku time), how long closed findings and old scans are kept, the next runs, the last scheduled scan and the pg_cron jobs; without pg_cron it lists the steps.

## What GUARD-5 built

The accountant agent: Claude reads the findings and the books like a senior accountant and writes saved reports. **It never posts, edits, reverses or deletes anything; it proposes, an admin decides.**

- **Switches (all off by default):** `ACCOUNTING_GUARD=true`, `ACCOUNTING_GUARD_AI=true`, `ANTHROPIC_API_KEY`, `GUARD_CRON_SECRET` (at least 16 characters) on the server; optional `GUARD_AI_MONTHLY_BUDGET_USD` (default 15). Nothing is stored in the repository.
- **Tools (read-only):** list and open findings, read one sale / purchase / journal entry by id, the trial balance, a partner statement, the rules, its memory. The only things it can write are its own notes (`guard_memory_save`) and a "probably not an error" suggestion on a finding (`guard_set_agent_suggestion`); an admin confirms (the ordinary status change, with the reason) or dismisses it. It has no tool to change a status, delete a note, post or scan.
- **Reports:** daily (standard model) and monthly (deep model) from a scheduled GitHub workflow that calls `POST /api/guard/agent` with the secret; on demand from the Reports tab ("Ask the accountant" or "Build report"). Saved in `guard_reports` as written by AI with model, tokens and cost; scheduled reports are new to every admin (the bell counts them).
- **Memory:** `guard_agent_memory`, at most 500 notes, one per subject, shown on the Memory tab where admins add, edit and delete.
- **Budget:** every call is in `guard_ai_usage`; at the monthly budget the agent stops before calling Claude. On-demand calls also count against the plan's AI credit.
- **Tests:** `supabase/tests/accounting_guard_agent.sql` and `tests/accountingGuardAgent.test.mjs` (with a stand-in for Claude).

### Model router (after GUARD-5)

The agent picks the cheapest model that can do the task (`src/lib/guard/agentRouter.ts`): **Haiku** for a quiet daily review (nothing open, or no new serious findings and at most 10 new ones) and for plain questions; **Sonnet** when there are new critical or high findings, a busy day (more than 10 new), a general review, or an ordinary question; **Opus** for the monthly review and for questions that ask for analysis ("why", compare, forecast). A Haiku run that does not produce a proper report is repeated once with Sonnet, and both runs are logged in `guard_ai_usage`. `GUARD_AI_FORCE_TIER` pins one tier for everything. The saved report records the route in its summary.
