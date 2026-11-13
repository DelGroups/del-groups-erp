# پرامپت‌های انتقال پول بین حساب‌ها و انتقال جنس بین انبارها (۲۰۲۶-۱۱-۱۳)

سه پرامپت، به ترتیب. هر پرامپت را جدا در Claude Code (VS Code) اجرا کنید، PR را بررسی و merge کنید، بعد سراغ بعدی بروید.

| ترتیب | پرامپت | چه می‌سازد | پیش‌نیاز |
|---|---|---|---|
| ۱ | TR-1 | انتقال پول بین کاسا و بانک (دو ردیف به هم وصل + یک سند حسابداری) | هیچ؛ همین حالا قابل اجراست |
| ۲ | STK-1 | انتقال جنس بین انبارها: ثبت اتمی، لیست، صفحه‌ی سند، لغو | هیچ؛ بهتر است قبل از LOT-3 اجرا شود |
| ۳ | TR-2 | «تغییر تاریخ» برای هر دو نوع انتقال | TR-1، STK-1 و DATE-2 و DATE-3 merge شده باشند |

## آنچه در کد پیدا شد (خلاصه)

**انتقال پول:** هنوز وجود ندارد. حساب‌های کاسا و بانک در جدول `accounts` هستند (نوع `Kassa` یا `Bank`، ستون `balance`، ستون `coa_id`). هر حرکت پول یک ردیف در `transactions` است (`type` = `Mədaxil` یا `Məxaric`) و `post_cash_transaction` موجودی را چک می‌کند و سند حسابداری می‌زند. صفحه‌ی کاسا و بانک (`/cash-bank`) موجودی هر حساب را از جمع درآمد منهای هزینه حساب می‌کند و ردیف‌های نوع `TRANSFER` را نادیده می‌گیرد؛ پس اگر انتقال فقط با نوع TRANSFER ثبت شود، موجودی‌ها روی صفحه عوض نمی‌شوند. TR-1 این را درست می‌کند.

**انتقال جنس:** از قبل یک فرم ساده هست (`/inventory/transfers/new`، جدول `stock_transfers` و `stock_transfer_items`) ولی:
- ثبت اتمی نیست: هر سطر جدا از TypeScript نوشته می‌شود. اگر وسط کار خطا بدهد، فقط سرِ سند پاک می‌شود و موجودیِ جابه‌جا شده‌ی سطرهای قبلی برنمی‌گردد.
- موجودیِ کافی را از عددی که مرورگر فرستاده چک می‌کند و در دیتابیس در صفر «گیر» می‌کند به جای این‌که رد کند.
- شماره‌ی سند تصادفی است (`TRN-سال-۴رقم`) و ممکن است تکراری شود.
- لیست سندها، صفحه‌ی مشاهده، لغو و تغییر تاریخ ندارد.
- برای انتقال جنس سند حسابداری لازم نیست: لایه‌های FIFO انبار ندارند و همه‌ی انبارها روی یک حساب موجودی هستند (STK-1 این را تأیید می‌کند).

## تغییر کوچک در پرامپت‌های قبلی (فایل ALL-PROMPTS-IN-ORDER-2026-11-10.md)

- **DATE-2:** بخش «transfers between accounts» را انجام ندهد؛ TR-2 آن را می‌سازد.
- **DATE-3:** اگر STK-1 قبلاً merge شده، handler انتقال جنس باید وضعیت `cancelled` و ردیف‌های لغو را هم بشناسد. اگر DATE-3 این را ساخته باشد، TR-2 فقط آن را بررسی می‌کند.
- **LOT-3:** تابع `post_stock_transfer` بعد از STK-1 وجود دارد. LOT-3 باید همان را با `CREATE OR REPLACE` گسترش دهد (لوت‌ها را اضافه کند) و تابع دیگری نسازد. شماره‌ی migration آن باید **بعد از** شماره‌ی STK-1 باشد (مثلاً یک شماره‌ی آزاد بعد از `20261201110000`)، وگرنه روی دیتابیس تازه نسخه‌ی بدون لوت روی نسخه‌ی لوت‌دار نوشته می‌شود.

این سه یادداشت در خودِ پرامپت‌ها هم آمده است.

## شماره‌ی migrationها

از `20261201100000` شروع می‌شوند تا با هیچ شماره‌ای روی main، در PRهای باز یا در پرامپت‌های قبلی (که تا `20261126100000` می‌روند) تداخل نداشته باشند. هر پرامپت از Claude Code می‌خواهد قبل از استفاده دوباره چک کند.

---

# پرامپت ۱ — TR-1

## TR-1: انتقال پول بین حساب‌های کاسا و بانک

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: money transfer between two cash / bank accounts (Kassa → Bank, Bank → Kassa, Kassa →
Kassa, Bank → Bank). One transfer document makes two linked cash rows (out of the source, into
the destination) and one balanced journal entry, all in one database transaction. Behind the
feature flag CASH_TRANSFERS (off by default). Branch: saas/cash-transfers. Draft PR. Follow every
rule in CLAUDE.md (read the Next 16 guides in node_modules/next/dist/docs/ before writing Next
code; middleware is src/proxy.ts).

Context (verify each point in the code before you rely on it):
- Accounts: public.accounts (code, name, type 'Kassa' | 'Bank', balance, coa_id). No currency
  column: transfers are in AZN only. Create / edit: src/lib/actions/finance.ts
  (createAccountAction, ACCOUNT_TYPES).
- Cash rows: public.transactions (account_id, type 'Mədaxil' | 'Məxaric', amount, category,
  unified_type, reference_type / reference_id, source_type / source_id, transaction_date,
  journal_entry_id, created_by). Latest post_cash_transaction is in
  supabase/migrations/20261112100000_gl_partner_tags.sql: it locks the account row, refuses
  spending below zero with 'Kassa/bank balansı kifayət etmir', updates accounts.balance and
  posts a journal through post_journal_entry. Do NOT use it for the two transfer legs: it would
  book a counter account from coa_credit_for_cash_in / coa_debit_for_cash_out.
- Ledger code of an account: gl_coa_for_cash_account(account_id, method)
  (20261107100000_gl_partner_cash_account.sql). Today every account is on 1100, so most transfers
  will be Dr 1100 / Cr 1100 with account_id on each line. That is correct: post it anyway, so the
  per-account sub-ledger (journal_entry_lines.account_id) and the audit trail are complete.
- Journals: create_journal_entry / post_journal_entry (numbering in
  20261111200000_journal_entry_no_sequence.sql), reverse_journal_entry and the period lock
  (assert_accounting_period_open, guard_journal_entry_period) in
  20260919120000_gl_integrity_period_lock_reversal.sql.
- Back-dated documents: use_document_date(date) + the apply_document_date triggers on
  transactions and journal_entries (20261029100000_backdated_invoices_payments.sql). A closed
  period is refused there with a readable message.
- Storno rule: a cash row with reference_type 'storno' and reference_id = the cancelled row
  (_is_storno_pair in 20261110150000_document_date_change_core.sql). _cash_events (the DATE
  engine's cash timeline) reads type Mədaxil / Məxaric, so the legs must use those types.
- UI: the cash and bank page src/modules/accounting/components/CashBankPage.tsx (classic) and
  CashBankScreen on the view engine (src/modules/accounting/views/accounting.ts,
  AccountingScreens.tsx). Ledger mapping and balances: src/lib/finance/unifiedLedger.ts
  (computeAccountLedgerBalances counts only INCOME and EXPENSE, so TRANSFER rows change no
  balance today; ledgerToRecord gives transfers net 0). Locked sources: LOCKED_SOURCES
  (views/accounting.ts) and LINKED_TRANSACTION_SOURCES (lib/actions/finance.ts).
- Lookups with inline quick-create: src/components/lookups (EntityLookup, QuickCreateDialog,
  registry kind "account"). Flag pattern to copy: src/lib/features/docDateChange.ts and its
  provider. Account scope for non-admins: access.scopes.allowed_financial_accounts
  (src/lib/auth/permissionMatrix.ts, used in fetchUnifiedLedgerAction).

1. Migration supabase/migrations/20261201100000_cash_transfers.sql (check `ls
   supabase/migrations` and the open PRs; pick the next free prefix if it is taken). Safe to re-run.
   - Sequence cash_transfer_no_seq and table public.cash_transfers: id, transfer_no TEXT UNIQUE
     ('KT-' || year || '-' || 6-digit counter), transfer_date DATE, from_account_id,
     to_account_id (FK accounts, CHECK from <> to), amount NUMERIC(14,2) CHECK > 0, fee_amount
     NUMERIC(14,2) DEFAULT 0 CHECK >= 0 (bank commission paid from the source account), notes,
     status 'posted' | 'cancelled', out_tx_id, in_tx_id, fee_tx_id, journal_entry_id,
     idempotency_key UNIQUE, created_by, created_at, cancelled_at, cancelled_by, cancel_reason,
     cancel_journal_entry_id. Indexes on transfer_date and each account. RLS: select for
     can_view_finance; no direct insert / update / delete (only the RPCs).
   - RPC post_cash_transfer(p_payload jsonb) RETURNS jsonb, SECURITY DEFINER:
     a. require_permission('can_manage_finance'); idempotency_key returns the existing transfer.
     b. Validate: both accounts exist and differ, amount > 0, fee >= 0, date not in the future;
        for a non-admin both accounts must be in the user's allowed_financial_accounts (when
        that list is not empty). Messages in Azerbaijani.
     c. use_document_date(transfer_date) (closed period refused there).
     d. Lock both account rows in id order (no deadlock when two transfers cross), then refuse
        when source balance < amount + fee with the same message post_cash_transaction uses.
     e. Insert the out leg (source, 'Məxaric') and the in leg (destination, 'Mədaxil'): both
        unified_type 'TRANSFER', category 'Hesablararası köçürmə', reference_type and
        source_type 'cash_transfer', reference_id and source_id = the transfer id, description
        "KT-… : <from name> → <to name>", created_by. Update both balances.
     f. One journal via create_journal_entry: document_type / source_type 'cash_transfer',
        document_id / source_id = transfer id, idempotency 'cash_transfer:' || id;
        Dr gl_coa_for_cash_account(to) with account_id = to, Cr gl_coa_for_cash_account(from)
        with account_id = from. Set journal_entry_id on both legs and the header.
     g. Fee > 0: post_cash_transaction(from, 'Məxaric', fee, 'Bank xərcləri', memo, NULL,
        'cash_transfer', id), then set its unified_type 'EXPENSE'; fee_tx_id = that row. Make
        sure 'Bank xərcləri' maps to an expense account in coa_debit_for_cash_out (verify; add
        the mapping in this migration only if it is missing).
     h. Return {success, transfer_id, transfer_no, out_tx_id, in_tx_id, journal_entry_id}.
   - RPC cancel_cash_transfer(p_transfer_id uuid, p_reason text) RETURNS jsonb: can_manage_finance,
     reason required, status must be 'posted', today's period open. Lock both accounts (id
     order); refuse when the destination balance is now below the amount ("Köçürülən pul artıq
     xərclənib: …"). Write storno rows for each leg (and the fee row): opposite type,
     reference_type 'storno', reference_id = the original row, same category; restore both
     balances; reverse the journal(s) with reverse_journal_entry. Status 'cancelled' with who,
     when, why. Nothing is deleted.
   - Guard: a BEFORE UPDATE OR DELETE trigger on transactions that refuses changing amount,
     account_id or type of a row whose source_type is 'cash_transfer' (unless the call comes
     from the transfer RPCs; use a transaction-local setting like stock_sync_skip does), so the
     ledger's edit / delete cannot break a pair.
   - Grants: execute to authenticated and service_role; revoke from PUBLIC, anon.
2. Server side (TypeScript): src/modules/accounting/actions/cashTransfers.ts with
   createCashTransferAction, cancelCashTransferAction, fetchCashTransfersAction,
   fetchCashTransferAction (requirePermissionAction, same error mapping as the finance
   actions). Add 'cash_transfer' to LINKED_TRANSACTION_SOURCES and LOCKED_SOURCES, and
   'Hesablararası köçürmə' to the reference labels.
3. Balances: in src/lib/finance/unifiedLedger.ts a TRANSFER row with a known direction
   (legacy_type Mədaxil / Məxaric) moves its account's ledger balance (in +, out −), shown in
   its own columns (transfer in / out), while summarizeUnifiedLedger and the income / expense
   KPIs keep leaving transfers out. Old legacy rows of type 'transfer' with no direction stay
   at 0. Same for ledgerToRecord (net signed for transfer legs in the account view only).
   Put the direction rule in a small pure helper (src/lib/finance/cashTransfer.ts) with tests.
4. UI behind CASH_TRANSFERS (flag off = nothing changes, no new button or menu item):
   - Feature flag file src/lib/features/cashTransfers.ts + provider, server-only env value.
   - Cash and bank page (classic and view engine): header button "Köçürmə" and a row action
     "Bu hesabdan köçür" (source pre-filled).
   - Transfer dialog (Dialog from the design system, docs/ui-standard.md overlay and form
     rules): From account and To account as EntityLookup kind "account" with inline
     quick-create (the new account is created and selected without closing the dialog or losing
     what was typed); the To list leaves out the chosen From; each option shows its current
     balance. Amount (money input) with the source balance shown under it and a live error when
     amount + fee is more; optional fee; date (DateField, default today, future refused,
     back-dated allowed); note. Save calls the action with an idempotency key made when the
     dialog opens (double click safe). Success toast with the number and a link.
   - List page /cash-bank/transfers (DataGrid / view engine like the other lists): number,
     date, from, to, amount, fee, status chip, created by; filters for date range, account,
     status; search by number or note; totals row. Menu entry under the money group next to
     cash and bank (appMenu.ts, module manifest), permission can_view_finance.
   - Detail page /cash-bank/transfers/[id]: header fields, both legs with their accounts, the
     journal lines, history (created / cancelled, with reason), Print (reuse the ledger receipt
     print, src/modules/accounting/lib/printLedgerReceipt.ts) and Cancel (dialog with required
     reason; only can_manage_finance; hidden when cancelled).
   - In the ledger, a transfer leg shows "Köçürmə KT-…: A → B" and opens the transfer; it has
     no edit / delete actions.
   - Leave a clear extension point for TR-2: the detail page gets a slot where the date change
     button will go (do not build it now).
5. i18n: every string in az, en and ru (src/i18n).
6. Tests:
   - supabase/tests/cash_transfers.sql: Kassa → Bank moves both balances and the ledger sums;
     the journal balances and has account_id on both lines; fee row and its expense journal;
     shortage refused and nothing written; same account refused; future date refused; closed
     period refused; idempotency returns the same transfer; non-admin outside the account
     scope refused; cancel restores both balances and writes storno rows that
     _is_storno_pair sees; cancel refused when the destination already spent the money;
     _cash_events of each account sees its leg; the guard trigger refuses editing a leg.
   - Node tests (tests/*.test.mjs): direction helper, balances with transfer rows,
     summary totals unchanged by transfers, dialog validation logic.
   - npm run lint, npm test, npm run build (compare lint / type errors against main; do not
     fix unrelated ones).

PR description (CLAUDE.md rule 11 and 13): plain words, how it was tested, ui-standard rule ids
touched, and the manual steps for Del:
  "1) Run supabase/migrations/20261201100000_cash_transfers.sql on production (SQL Editor, Run).
   2) Set CASH_TRANSFERS=true in .env.production and restart the app."
List unrelated problems you found; do not fix them.
```

---

# پرامپت ۲ — STK-1

## STK-1: انتقال جنس بین انبارها — ثبت اتمی، لیست، صفحه‌ی سند، لغو

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: make the existing stock transfer between warehouses safe and complete: one atomic
database function posts the whole document, a list page, a document page, print and cancel.
Behind the feature flag STOCK_TRANSFERS_V2 (off = today's code path, unchanged). Branch:
saas/stock-transfers-v2. Draft PR. Follow every rule in CLAUDE.md (read the Next 16 guides in
node_modules/next/dist/docs/ first; middleware is src/proxy.ts).

Context (verify each point before you rely on it):
- Tables: stock_transfers (reference_number UNIQUE, from / to warehouse, transfer_date, status
  'pending' | 'completed', notes, created_by) and stock_transfer_items (product, offcut_id →
  polywood_pieces, quantity, code / name / unit / barcode copies), in
  20260916150000_stock_transfers_and_multi_warehouse_stocks.sql.
- Today's writer: src/modules/inventory/lib/stockTransferServer.ts via
  src/app/api/inventory/transfers/route.ts (can_manage_warehouses + module check). Problems to
  fix: (1) not atomic: each line is written separately and on error only the header is deleted,
  so stock already moved for earlier lines stays moved; (2) the shortage check trusts
  available_stock sent by the browser; adjust_warehouse_stock clamps at zero instead of
  refusing; (3) reference_number is random (generateStockTransferDocumentNumber in
  src/types/database.types.ts: TRN-<year>-<4 random digits>) and can collide; (4) no list,
  view, cancel.
- Stock functions (latest bodies in 20261029200000_stock_per_warehouse.sql and
  20261028181000_product_stock_integrity.sql): stock_move(product, warehouse, delta, strict)
  refuses a shortage with stock_shortage_message when strict; stock_available(product,
  warehouse); _stock_row_for; Polywood products move through their pieces
  (polywood_pieces.warehouse_id, status 'available') and _stock_sync_polywood_rows. Kits
  (product_bom) and services hold no stock of their own: verify, then refuse them on a
  transfer line with a clear message.
- Stock movements: recordStockMovement writes stock_movements with reference_type
  TRANSFER_OUT / TRANSFER_IN (STOCK_TRANSFER_OUT_REF / _IN_REF in lib/stockTransfer.ts). The
  DATE engine (_stock_events in 20261110150000_document_date_change_core.sql) and DATE-3 read
  these rows: keep the same reference types.
- No journal entry: FIFO layers (inventory_batches) have no warehouse and all warehouses share
  one inventory account. Verify this and say it in the PR; if you find warehouses on different
  inventory accounts, stop and report instead of guessing.
- Back-dating: use_document_date(date) dates stock_movements through apply_document_date.
  DATE-1's _stock_timeline_violations(moves) can check that a back-dated transfer does not make
  the source warehouse negative at that moment.
- UI today: src/modules/inventory/components/StockTransferNewPage.tsx (already on LineGrid and
  EntityLookup with UI_STANDARD), print template StockTransferPrintTemplate.tsx, entry points
  from WarehouseStockPage.tsx and InventoryScreens.tsx (row action "transfer"), menu
  src/lib/shell/appMenu.ts ("movements" group) and src/modules/inventory/manifest.ts (route
  /inventory/transfers/new only). Warehouse scope for non-admins:
  access.scopes.allowed_warehouses (src/lib/auth/permissionMatrix.ts).
- Lot tracking (LOT-1..5 in docs/prompts/ALL-PROMPTS-IN-ORDER-2026-11-10.md) is planned, not
  merged: LOT-3 will extend the function made here with lots. Reserve the payload line key
  "lots" (accept and ignore it now) and do not build lot logic in this PR.

1. Migration supabase/migrations/20261201110000_stock_transfers_atomic.sql (check `ls
   supabase/migrations` and the open PRs first; it must sort after 20261201100000). Safe to
   re-run.
   - Sequence stock_transfer_no_seq; numbers 'TRN-' || year || '-' || 6-digit counter (6 digits
     can never equal an old 4-digit number).
   - stock_transfers: add idempotency_key UNIQUE, cancelled_at, cancelled_by, cancel_reason;
     widen the status check to 'pending' | 'completed' | 'cancelled' (drop and re-create the
     constraint by name). stock_transfer_items: add line_no.
   - RPC post_stock_transfer(p_payload jsonb) RETURNS jsonb, SECURITY DEFINER, all in one
     transaction:
     a. require_permission('can_manage_warehouses'); for non-admins both warehouses must be
        in allowed_warehouses when that list is not empty; idempotency key returns the
        existing document.
     b. Validate: warehouses exist and differ; at least one line; quantity > 0; no kits or
        services; same product on two lines (without offcut) is merged; date not in the future.
     c. use_document_date(transfer_date).
     d. Per ordinary line: stock_move(product, from, -qty, true) (refuses a shortage with the
        product, warehouse and missing quantity), then stock_move(product, to, +qty, true).
        Per Polywood offcut line: the piece must be 'available' and in the source warehouse;
        set its warehouse_id to the target and re-sync both warehouses' rows the way the
        Polywood code does. Write the two stock_movements rows per line (TRANSFER_OUT on the
        source, TRANSFER_IN on the target, reference_id = transfer id, source_line_id = the
        item id, description "Anbarlar arası transfer — TRN-…").
     e. Back-dated (date < today): run _stock_timeline_violations on the out moves; refuse when
        it returns rows (message names product, warehouse, date and shortfall).
     f. Header status 'completed'. Return {success, transfer_id, reference_number}.
   - RPC cancel_stock_transfer(p_transfer_id uuid, p_reason text) RETURNS jsonb: same
     permission and scope; reason required; status 'completed'; refuse when the goods already
     left the target (stock_move(product, to, -qty, true) refuses; Polywood: the piece must
     still be available in the target). Move everything back, write stock_movements with
     reference_type TRANSFER_CANCEL_OUT (target) and TRANSFER_CANCEL_IN (source), set status
     'cancelled' with who / when / why. Nothing is deleted.
   - Grants: execute to authenticated and service_role; revoke from PUBLIC, anon.
2. Server: when STOCK_TRANSFERS_V2 is on, the API route calls post_stock_transfer (one RPC,
   payload built from the form) and maps its errors; when off, today's
   stockTransferServer.ts path is used unchanged. If the RPC is missing (PGRST202, migration
   not run yet) fall back to the old path, so deploy order is safe. New server actions in
   src/modules/inventory/actions/stockTransfer.ts: fetchStockTransfersAction,
   fetchStockTransferAction, cancelStockTransferAction.
3. UI behind STOCK_TRANSFERS_V2 (flag file src/lib/features/stockTransfersV2.ts + provider,
   like docDateChange.ts; off = nothing changes):
   - List page /inventory/transfers (DataGrid / view engine like the other document lists):
     number, date, from, to, line count, total quantity, status chip, created by; filters
     (date range, warehouse from / to, status, created by), search by number, product or note.
     The menu item and the stock page "transfer" actions keep going to /new; the menu gets
     the list as its main entry.
   - Document page /inventory/transfers/[id]: header, lines (code, name, unit, quantity,
     offcut length), stock movements of the document, history, Print (existing template),
     "Copy as new" (opens /new pre-filled), Cancel (dialog with required reason, can_manage_
     warehouses, hidden when cancelled). Leave a slot for TR-2's date change button.
   - New transfer form (StockTransferNewPage): keep LineGrid and the EntityLookup warehouse
     fields with inline quick-create; the product cell keeps "+ New product" and barcode scan.
     Add: the available quantity in the source warehouse on every line (from the server, not
     typed), a live error when a quantity is more, re-check of every line when the source
     warehouse changes (lines that are no longer available are marked, not silently dropped),
     the date field (default today, no future), and an idempotency key made when the form
     opens. After save go to the document page.
4. i18n: every string in az, en and ru. Follow docs/ui-standard.md (lists, forms, line grids,
   overlays).
5. Tests:
   - supabase/tests/stock_transfers_atomic.sql: transfer moves both warehouse rows and keeps
     the product total; shortage refused and nothing written (no header, no movements, no
     stock change) even when an earlier line was fine; same warehouse refused; kit and service
     refused; duplicate lines merged; Polywood offcut moves its piece; offcut not in the
     source refused; back-dated transfer before the stock arrived refused; idempotency;
     numbering from the sequence; non-admin outside the warehouse scope refused; cancel moves
     everything back; cancel refused when the goods were sold from the target; DATE engine
     _stock_events sees the movements.
   - Node tests: the route switch (flag on / off / RPC missing), form validation and the
     "available" re-check logic.
   - npm run lint, npm test, npm run build (compare against main for old errors).

PR description: plain words, tests, ui-standard rule ids, the bugs fixed in the old path
(non-atomic write, trusted available stock, clamp at zero, random number), and the manual steps:
  "1) Run supabase/migrations/20261201110000_stock_transfers_atomic.sql on production.
   2) Set STOCK_TRANSFERS_V2=true in .env.production and restart the app."
Note for later prompts, to put in the PR too: LOT-3 must CREATE OR REPLACE post_stock_transfer
(add lots) instead of creating a new function, with a migration prefix after 20261201110000.
List unrelated problems found; do not fix them.
```

---

# پرامپت ۳ — TR-2

## TR-2: «تغییر تاریخ» برای انتقال پول و انتقال جنس

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: admins can change the date of a posted cash transfer and of a completed stock transfer
with the document date change engine (DATE-1), the same dialog and history. Both legs always
move together. Requires TR-1, STK-1, DATE-2 and DATE-3 merged: check git log / the migrations
and stop with a short report if any is missing. Behind DOC_DATE_CHANGE (admins only), like
DATE-1. Branch: saas/doc-date-change-transfers. Draft PR. Follow every rule in CLAUDE.md.

Context (verify): the engine is in 20261110150000_document_date_change_core.sql and was
extended by DATE-2 (*_document_date_change_cash.sql) and DATE-3
(*_document_date_change_inventory.sql): _date_change_header, _date_change_rows (handler
registry), _date_change_stock_moves, _stock_timeline_violations (R3), _cash_timeline_violations
(R6), preview_document_date_change, apply_document_date_change, document_date_changes. TS side:
src/lib/documents/dateChange.ts (DateChangeDocumentType), dateChangeApi.ts,
src/components/documents/DocumentDateChange.tsx. Cash transfers: cash_transfers (TR-1).
Stock transfers: stock_transfers (STK-1). DATE-2 was told to leave transfers between accounts
to this prompt; DATE-3 may already have a stock transfer handler.

1. Migration supabase/migrations/20261201120000_document_date_change_transfers.sql (check the
   prefix; it must sort after the DATE-2 and DATE-3 migrations and 20261201110000). For every
   engine function you change, CREATE OR REPLACE with the same signature, copy the LATEST body
   (after DATE-3) and only add branches; do not touch other handlers.
   - 'cash_transfer': header = transfer_no, transfer_date, posted when status 'posted'.
     Rows that move: cash_transfers.transfer_date, both legs' transaction_date, the fee row,
     their journals (journal_entries date / entry_date). R1 admin, R2 old and new dates in open
     periods, R6 on BOTH accounts with both legs moving together (moving a transfer earlier must
     not make the source negative on any day; moving it later must not leave a spending on
     the destination before the money arrived). Cancelled transfers are refused.
   - 'stock_transfer': if DATE-3 already added it, check that it moves the header
     transfer_date, both TRANSFER_OUT and TRANSFER_IN movements together, refuses cancelled
     documents and checks R3 on both warehouses; fix only what is missing. Otherwise add it:
     header = reference_number, transfer_date, posted when status 'completed'; rows: the
     header date and the document's stock_movements (TRANSFER_OUT / TRANSFER_IN); R3 on the
     source and the target; R8 (no posted inventory count of the same product and warehouse
     between the two dates).
   - Both are written to document_date_changes like the invoices (reason required).
2. TS / UI: add 'cash_transfer' and 'stock_transfer' to DateChangeDocumentType and the API;
   put the "Tarixi dəyiş" button in the slots TR-1 and STK-1 left on the two detail pages
   (admins, DOC_DATE_CHANGE on); show the history on the document pages and in Settings ›
   Date changes with the right document labels and links. i18n az, en, ru.
3. Tests: supabase/tests/document_date_change_transfers.sql: cash transfer moved earlier and
   later (pass); moved before the source had the money (blocked); moved after the destination
   spent it (blocked); closed period (blocked); cancelled transfer (blocked); both legs and the
   journal on the new day after apply; stock transfer moved before the goods arrived in the
   source (blocked); moved after a sale from the target (blocked); pass case with both
   movements moved. Node tests for the new document types in dateChange.ts. npm run lint,
   npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids, and the manual step: "Run
supabase/migrations/20261201120000_document_date_change_transfers.sql on production after the
DATE-2, DATE-3, TR-1 and STK-1 migrations." List unrelated problems found; do not fix them.
```
