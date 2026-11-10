# ترتیب اجرای همه پرامپت‌ها (۲۲ پرامپت، ۲۰۲۶-۱۱-۱۰)

هر ردیف یک فایل جدا در همین پوشه است (`NN-نام.md`). متن فایل را کامل در Claude Code (VS Code) بدهید.
**قانون:** هر پرامپت یک شاخه و یک PR دارد. PR را merge کنید و (اگر SQL دارد) SQL را اجرا کنید، بعد پرامپت بعدی. پرامپت‌ها را پشت‌سرهم و نه موازی اجرا کنید، چون چند تا از آن‌ها همان توابع فروش، خرید و انبار را بازنویسی می‌کنند و هر کدام باید از آخرین main شروع کند.
SQL را فقط خود شما روی production اجرا می‌کنید (Claude Code فقط روی دیتابیس تست امتحان می‌کند).

## مرحله ۱: فرم فاکتورها (سریع، بدون خطر برای حسابداری)

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 1 | `01-INV-1.md` دکمه محصول جدید در فرم فروش و خرید | `saas/invoice-new-product` | ندارد | فلگ `INVOICE_TOOLS=true` |
| 2 | `02-INV-2.md` خروجی Excel و PDF فاکتور | `saas/invoice-export` | ندارد | همان فلگ |
| 3 | `03-INV-3.md` فیلتر فروشنده و ثبت‌کننده در لیست فاکتورها | `saas/invoice-list-person-filters` | ندارد | همان فلگ |
| 4 | `04-INV-4.md` مسئول انبارگردانی چندنفره | `saas/inventory-count-team` | `20261110100000_inventory_count_responsibles` | اجرای SQL، فلگ `COUNT_TEAM=true` |

## مرحله ۲: حساب هر طرف تجاری و گزارش بدهکار و طلبکار

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 5 | `05-LED-1.md` دفتر واحد طرف تجاری (فقط دیتابیس) | `saas/led-1-partner-ledger` | ۱ فایل | SQL را اجرا کنید، کوئری کنترل را اجرا و نتیجه را بفرستید |
| 6 | `06-LED-2.md` اصلاح `partner_id` در دفتر کل | `saas/led-2-gl-partner-fix` | ۱ مایگریشن + ۲ اسکریپت | مایگریشن؛ backfill فقط بعد از دیدن گزارش |
| 7 | `07-LED-3.md` صفحه صورت‌حساب هر طرف (مورد ۶) | `saas/led-3-partner-statement` | ندارد | `PARTNER_LEDGERS=true` (اول فقط ادمین) |
| 8 | `08-LED-4.md` بدهکاران، طلبکاران، گردش | `saas/led-4-debtors-creditors` | حداکثر ۱ فایل | SQL |
| 9 | `09-LED-5.md` گزارش سنی بدهی (Aging) | `saas/led-5-aging` | حداکثر ۱ فایل | SQL |

LED-1 باید قبل از ۷ تا ۹ merge شود. پیشوند مایگریشن‌های LED را خود Claude Code آزاد انتخاب می‌کند (با `ls supabase/migrations`).

## مرحله ۳: تغییر تاریخ سند (فقط ادمین)

قبل از لوت آمده، چون موتور تغییر تاریخ باید هنگام ساخت لوت‌ها از قبل وجود داشته باشد (LOT-1 به آن وصل می‌شود).

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 10 | `10-DATE-1.md` موتور + فاکتور فروش و خرید | `saas/doc-date-change-core` | `20261110150000_document_date_change_core` | SQL، فلگ `DOC_DATE_CHANGE=true` |
| 11 | `11-DATE-2.md` اسناد نقد و بانک | `saas/doc-date-change-cash` | `20261110151000_document_date_change_cash` | SQL |
| 12 | `12-DATE-3.md` اسناد انبار و واردات | `saas/doc-date-change-inventory` | `20261110152000_document_date_change_inventory` | SQL |

(پرامپت DATE یک تصمیم باز دارد: تغییر تاریخ در همان ردیف‌ها با لاگ، که پیشنهاد است، یا برگشت و ثبت دوباره. اگر نظر ندارید همان پیشنهاد اجرا می‌شود.)

## مرحله ۴: لوت و بچ و تاریخچه محصول (موارد ۴ و ۵)

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 13 | `13-LOT-1.md` هسته دیتابیس + backfill | `saas/lot-core` | `20261112100000_lot_core` | **SQL را هنوز اجرا نکنید** |
| 14 | `14-LOT-2.md` ورود کالا با لوت + برچسب | `saas/lot-inbound` | `20261112110000_lot_inbound` | **هنوز اجرا نکنید** |
| 15 | `15-LOT-3.md` خروج، انتقال اتمی، لغو | `saas/lot-outbound` | `20261112120000_lot_outbound` | حالا سه SQL را با هم و به ترتیب اجرا کنید، بعد `SELECT * FROM lot_integrity_report();` باید خالی باشد |
| 16 | `16-LOT-4.md` صفحه‌های لوت و کارت لوت | `saas/lot-ui` | فقط اگر لازم شد | `LOT_TRACKING=true` و `LOT_TRACKING_AUDIENCE=admins` |
| 17 | `17-LOT-5.md` گزارش تاریخچه محصول، فراخوان، انقضا | `saas/lot-reports` | `20261112140000_lot_reports` | SQL |

## مرحله ۵: نگهبان حسابداری (آخر، چون همه چیز را کنترل می‌کند)

| # | فایل | شاخه | SQL | بعد از merge |
|---|---|---|---|---|
| 18 | `18-GUARD-1.md` جدول‌ها و موتور قوانین | `saas/accounting-guard-core` | `20261120100000_accounting_guard_core` | SQL، `ACCOUNTING_GUARD=true` |
| 19 | `19-GUARD-2.md` اسم تکراری محصول و چک‌های انبار | `saas/accounting-guard-products` | `20261120110000_accounting_guard_products` | SQL |
| 20 | `20-GUARD-3.md` بخش نگهبان، دکمه سند مشکوک، اعلان | `saas/accounting-guard-ui` | ندارد یا `20261120120000_...` | — |
| 21 | `21-GUARD-4.md` نظارت دائمی با pg_cron | `saas/accounting-guard-schedule` | `20261120130000_accounting_guard_cron` | اول `pg_cron` را در Supabase فعال کنید، بعد SQL |
| 22 | `22-GUARD-5.md` ایجنت حسابدار Claude | `saas/accounting-guard-agent` | `20261120140000_accounting_guard_reports` | `ACCOUNTING_GUARD_AI=true` + secret سرور و GitHub |

یادآوری برای GUARD-1: بعد از اجرای LOT، قانون «یکپارچگی لوت» (خروجی `lot_integrity_report()`) هم باید یکی از چک‌ها باشد. در پرامپت GUARD-1 به Claude Code بگویید.

## چرا این ترتیب

- فرم‌های INV کوچک و بی‌خطرند و فوراً به کار می‌آیند.
- LED قبل از بقیه است چون دفتر واحد طرف تجاری و اصلاح `partner_id` پایه صحیح بودن مانده‌هاست (GUARD هم روی آن تکیه دارد).
- DATE قبل از LOT است تا لوت‌ها از اول با موتور تغییر تاریخ هماهنگ باشند.
- GUARD آخر است چون باید همه سیستم‌ها (لیدجر، تاریخ، لوت) را کنترل کند.

## هشدار

`.env.local` روی کامپیوتر شما به دیتابیس **production** وصل است. هر پرامپت می‌گوید SQL را فقط روی Supabase محلی یا پروژه تست `del-groups-erp-dev` امتحان کند. قبل از اجرا یک بار این را به Claude Code هم یادآوری کنید.


---

# پرامپت 01-INV-1

## INV-1: دکمه‌ی «تعریف محصول جدید» در فرم فروش و خرید

----
Before starting, check the list of available skills. Use every skill that fits this task
(frontend-design, design-system, accessibility-review, ux-copy, testing, code-review, and any
others that fit). At the end, say which skills you used, or that none fit. If a skill or tool you
need is missing, stop and tell me exactly what to install.

Task INV-1: add a visible "New product" button to the sales invoice form and the purchase
invoice form. Clicking it opens a popup to define a new product; when saved, the product is
created and added to the invoice lines, and nothing else in the form is lost.
Follow CLAUDE.md "SaaS program rules" and docs/ui-standard.md. Branch: saas/invoice-new-product
from the latest main. Open a draft PR; I review and merge.

Flag: create a new server flag INVOICE_TOOLS (off by default, same pattern as
src/lib/features/newUi.ts and how UI_STANDARD reaches client screens). INV-2 and INV-3 will reuse
it. With the flag off, both forms look and behave exactly as today.

What exists (check it yourself first):
- src/components/lookups/QuickCreateDialog.tsx already creates products (short form, full product
  form drawer, duplicate-name warning from F4, permission check canQuickCreate("product")).
  Reuse it. Do NOT write a second product form.
- Purchase form (src/modules/purchases/components/PurchaseForm.tsx + PurchaseLinesGrid.tsx): with
  UI_STANDARD on, "+ New product" exists only inside the product cell dropdown. With it off, the
  old QuickAddProductModal is used.
- Sales form (src/modules/sales/components/InvoiceForm.tsx): items header has "Select products"
  (InvoiceProductSelectorModal) and "Add row". No way to create a product.

Do:
1. In the items header of both forms, next to the existing buttons, add a "New product" button
   (secondary style, Plus icon), shown only when the flag is on and the user may create products
   (canQuickCreate). Hidden in the polywood-only sales mode, like "Select products".
2. Click opens QuickCreateDialog for "product" (as a modal over the form, focus trapped, Escape
   closes, form state kept). On save: the new product is selected into the first empty line, or
   a new line is added if none is empty, with its default price, unit and the line's warehouse
   rules the same as when the product is picked normally (use the same handler the form already
   uses on product pick, e.g. handleModalProductSelect / handleProductCreated). The product
   lookup caches are refreshed (lookupQueryKey("product") and the form's own products list) so
   it appears in search at once.
3. Also add a "+ New product" entry at the bottom of InvoiceProductSelectorModal (when its search
   finds nothing, prefill the typed text as the product name), behind the same flag.
4. Services and sheet products (metre stock) must work: check the created product's unit and
   is_service go through the same line logic as an existing product.
5. All strings in src/i18n (az, en, ru).

Tests: unit tests for the "where does the created product go" logic (empty line vs new line,
polywood-only hidden, permission). Run npm run lint, npm test, npm run build; all must pass (main
already has lint/tsc errors: compare against main and do not add new ones).
PR description: what changed, how tested, UI rules touched (ids), and "set INVOICE_TOOLS=true to
see it". Do not run the app on localhost against my .env.local (it points to production).
----

---


---

# پرامپت 02-INV-2

## INV-2: خروجی اکسل و PDF برای هر فاکتور

----
Before starting, check the list of available skills. Use every skill that fits this task
(xlsx, pdf, frontend-design, design-system, ux-copy, testing, code-review, and any others that
fit). At the end, say which skills you used, or that none fit. If a skill or tool you need is
missing, stop and tell me exactly what to install.

Task INV-2: every sales invoice and every purchase invoice can be downloaded as an Excel file
(.xlsx) and as a real PDF file (a downloaded .pdf, not the browser print dialog).
Follow CLAUDE.md "SaaS program rules". Branch: saas/invoice-export from the latest main. Open a
draft PR. Behind the INVOICE_TOOLS flag from INV-1 (if INV-1 is not merged yet, create the flag
the same way). With the flag off nothing changes.

Where (both places, one shared code path):
- The row "…" menu of the sales list (salesRowActions in src/modules/sales/components/SalesScreen.tsx)
  and of the purchase list (purchaseRowActions in PurchasesScreen.tsx), plus the classic lists
  (SalesPage.tsx / PurchasesPage.tsx rowActions) if they are still reachable.
- The actions menu inside the opened invoice (SaleFormScreen.tsx actions next to "Print", and
  the purchase form / PurchaseViewModal actions). The list actions already run through the form
  with ?do=<key>; follow that same pattern for "export_xlsx" and "export_pdf".
- Two entries: "Download Excel" and "Download PDF" (FileSpreadsheet / FileText icons), placed
  next to Print. Shown for drafts, posted and cancelled invoices (cancelled gets a clear
  "Cancelled" mark on the file, draft a "Draft" mark). Same permission as viewing the invoice.

Content (both formats, same data):
- Build the data from the same mapping the print uses (mapSaleToInvoicePrint and the purchase
  print data in PurchasePrintTemplate), so the file matches the printed invoice. Put the shared
  "invoice to export rows" mapping in a pure module (e.g. src/lib/export/invoiceExport.ts) that
  tests can load.
- Header: company branding (useCompanyBranding: name, VÖEN, address, logo in PDF), document
  number, date, customer or supplier (name, VÖEN), warehouse, salesperson / responsible, created
  by, currency and rate, status.
- Lines: no., product name, code, unit, quantity, price, discount, VAT, line total. Totals:
  subtotal, discount, VAT, extra costs, grand total, paid, remaining. Payments list if any.
- Numbers as real numbers in Excel (not text), 2 decimals, totals as values; column widths set;
  sheet name = document number.
- If the print offers official / regular layouts (PrintInvoiceModal), PDF uses the same choice:
  ask with the same modal, and official-only invoices skip the question.
- File name: <doc number>_<date>.xlsx / .pdf (safe characters only).

Libraries:
- Excel: use the library the repo already has (xlsx). Exports only write files; do not add a
  second Excel library. Note in the PR that the planned SheetJS upgrade is separate.
- PDF: pick ONE client-side library (for example @react-pdf/renderer or pdfmake), say why in the
  PR. It must render Azerbaijani (ə ğ ı ö ş ü ç) and Russian Cyrillic correctly: bundle a font
  file locally (e.g. Noto Sans, OFL licence) in public/fonts, no CDN. Load the library and the
  font with a dynamic import only when the user clicks, so page bundles do not grow.
- Never copy Odoo code, texts or layout.

Tests: unit tests for the export mapping (sale and purchase, with discount, VAT modes, extra
costs, foreign currency, cancelled/draft marks, file name). A test that the generated xlsx has
numeric cells and correct totals. Run npm run lint, npm test, npm run build; all must pass (compare
against main for existing errors). Attach one sample .xlsx and one sample .pdf from test data to
the PR (in docs/screenshots/invoice-export/), opened and checked for Azerbaijani letters.
PR description: what changed, how tested, UI rules touched, and "set INVOICE_TOOLS=true".
Do not run the app on localhost against my .env.local (it points to production).
----

---


---

# پرامپت 03-INV-3

## INV-3: فیلتر لیست فاکتورها بر اساس فروشنده و ثبت‌کننده‌ی سند

----
Before starting, check the list of available skills. Use every skill that fits this task
(frontend-design, design-system, accessibility-review, ux-copy, testing, code-review, and any
others that fit). At the end, say which skills you used, or that none fit. If a skill or tool you
need is missing, stop and tell me exactly what to install.

Task INV-3: in the sales invoice list and the purchase invoice list, the user can filter by a
chosen person: sales by salesperson (seller) and by the user who created the document; purchases
by supplier, by responsible person and by the user who created the document.
Follow CLAUDE.md "SaaS program rules" and docs/ui-standard.md. Branch: saas/invoice-list-person-filters
from the latest main. Open a draft PR. Behind the INVOICE_TOOLS flag (create it if INV-1 is not
merged yet). With the flag off the lists are exactly as today.

What exists: the view engine (src/views) has only fixed filters (FilterDef with static
conditions, e.g. "mine" = seller_id = current user) and one free-text search over all searchable
fields (matchesSearch in src/views/logic.ts). Sales rows have seller_id / seller_name and
created_by / created_by_name (src/modules/sales/views/sales.ts, fetchSales.ts). Purchase rows have
supplier_id / supplier_name, responsible_name and created_by_name (src/modules/purchases/views/purchases.ts).

Do:
1. Add a generic "value filter" to the view engine: a ViewDefinition can declare
   valueFilters: [{ field, labelKey }]. In SearchPanel each one shows as a dropdown
   (Combobox from the design system, searchable, multi-select) listing the distinct values found
   in the loaded records, sorted by name, with a count per value. Picking values filters rows
   (OR inside one filter, AND between filters and with the existing filters and search). Active
   picks show as removable chips like the other filters. Filter by id when the field has one
   (seller_id, created_by, supplier_id), and show the name.
2. Saved/favorite views and the URL state (if the engine keeps search state there) must carry
   the value filters too, so a filtered list can be bookmarked.
3. Sales: valueFilters seller (Satıcı) and created by (Sənədi yaradan). Purchases: supplier,
   responsible, created by. Make sure created_by_name is filled even when LIST_COLUMNS is off
   (useProfileNames / fetchSales currently resolve names only for the column); empty values show
   as "Unknown".
4. The same filters work in kanban, pivot, graph and calendar views (they share applySearch).
5. If the classic lists (SalesPage.tsx / PurchasesPage.tsx) are still reachable with NEW_UI off,
   leave them as they are and say so in the PR.
6. All strings in src/i18n (az, en, ru). Phone width: the dropdowns wrap, no sideways scroll.

Tests: unit tests in the views logic for value filters (single, multi, combined with fixed
filters and search, unknown values, by id). Run npm run lint, npm test, npm run build; all must
pass (compare against main for existing errors).
PR description: what changed, how tested, UI rules touched, and "set INVOICE_TOOLS=true".
Do not run the app on localhost against my .env.local (it points to production).
----

---


---

# پرامپت 04-INV-4

## INV-4: مسئول انبارگردانی به صورت انتخاب چند کارمند

یک فایل migration دارد (پیشنهاد شماره: `20261110100000`، قبل از استفاده Claude Code باید یکتا بودنش را چک کند). اول migration را اجرا کنید، بعد فلگ COUNT_TEAM را روشن کنید.

----
Before starting, check the list of available skills. Use every skill that fits this task
(frontend-design, design-system, accessibility-review, ux-copy, testing, code-review, supabase /
SQL skills, and any others that fit). At the end, say which skills you used, or that none fit. If
a skill or tool you need is missing, stop and tell me exactly what to install.

Task INV-4: in the inventory count (Anbar sayımı) the "Responsible" field becomes a list box of
employees where several people can be chosen, instead of free text.
Follow CLAUDE.md "SaaS program rules". Branch: saas/inventory-count-team from the latest main.
Open a draft PR. New server flag COUNT_TEAM (off by default, same pattern as
src/lib/features/newUi.ts). With the flag off the free-text field works exactly as today.

What exists:
- inventory_counts.responsible_name TEXT (supabase/migrations/20260924140000_inventory_counts.sql).
- New count form: src/modules/inventory/components/InventoryCountsPage.tsx (Input "responsible").
- Header edit on the count page: InventoryCountDetailPage.tsx, saved by RPC
  inventory_count_update_header(p_count_id, p_count_date, p_responsible, p_notes, p_actor)
  (20261028182000_inventory_count_backdate_admin_edit.sql), which also writes the count log.
- Actions: src/modules/inventory/actions/inventoryCount.ts. List/view: src/modules/inventory/views/inventory.ts.
- employees is behind RLS: SELECT needs can_view_hr (20260912180000_phase4_rls_inventory_trigger.sql).
  Warehouse staff do not have it, so they cannot read the employee list directly.

Do:
1. One migration (unique prefix; check ls supabase/migrations and open PRs, suggested
   20261110100000_inventory_count_responsibles.sql), idempotent:
   - Table inventory_count_responsibles (count_id → inventory_counts ON DELETE CASCADE,
     employee_id → employees, added_by, added_at, PRIMARY KEY (count_id, employee_id)), RLS:
     read for whoever can read the count, write only through the RPCs below.
   - RPC inventory_count_employee_options(): SECURITY DEFINER, set search_path, returns only
     id, full_name, employee_code, position/department of ACTIVE employees, allowed for users who
     may create or run counts (same permission check the count RPCs use). No salary or personal data.
   - RPC inventory_count_set_responsibles(p_count_id, p_employee_ids uuid[], p_actor): same
     rules as inventory_count_update_header (draft / in progress: anyone who may count; posted:
     admin only), replaces the set, writes responsible_name = names joined with ", " (so old
     lists, print and search keep working), and logs old and new names in the count log.
   - Keep inventory_count_update_header unchanged in signature (old screens still call it).
   - Do NOT backfill or guess employees from existing free text; old counts keep their text.
   - GRANTs like the other count RPCs. Note in the PR exactly what to run, in which order.
2. UI behind COUNT_TEAM, in both the new-count form and the header edit: a multi-select employee
   list box (searchable, chips for chosen people, keyboard accessible, Combobox / EntityLookup
   style from the design system), loaded from inventory_count_employee_options. Inline "+ New
   employee" quick-create only for users with can_manage_hr (project rule: never leave a form to
   create a related record). Old counts with only free text show that text read-only above the
   picker until people are chosen.
3. Count list and view engine: "Responsible" column shows the chosen names; group by and search
   still work (responsible_name stays filled).
4. Print / export of the count (if any) shows the names.
5. All strings in src/i18n (az, en, ru).

Tests: unit tests for the client mapping (ids ↔ names, old free-text counts). SQL: test the
migration on a local or branch database (never production): set responsibles on a draft, try on
a posted count as non-admin (refused), as admin (allowed + logged), employee options without
can_view_hr. Run npm run lint, npm test, npm run build; all must pass (compare against main).
PR description: what changed, how tested, the SQL to run in production and its order, then
"set COUNT_TEAM=true".
Do not run the app on localhost against my .env.local (it points to production).
----


---

# پرامپت 05-LED-1

### پرامپت LED-1: دفتر واحد طرف تجاری (دیتابیس، بدون UI)

```text
Before starting, check the list of available skills. Use every skill that fits this task
(finance:reconciliation, finance:financial-statements, finance:audit-support, data:sql-queries,
data:validate-data, engineering:testing-strategy, engineering:code-review, security-review, and any others
that fit). At the end, say which skills you used, or that none fit. If a skill or tool you need is
missing, stop and tell me exactly what to install.

Task LED-1: build ONE source of truth for every money movement of a business partner (customer,
supplier, or both), so that partner statements, the reconciliation act, debtor/creditor reports and
aging all read the same numbers. Database only in this PR, no UI. Follow CLAUDE.md "SaaS program rules".
Branch: saas/led-1-partner-ledger. One migration file. Read-only reports: nothing in this PR changes
existing balances, journals or documents.

## Why (verify each point in the code before you rely on it)
Today three places compute a partner balance and they disagree:
- src/lib/partners/fetchPartners.ts buildLedger(): partner page "Ledger" tab. Only sales and purchase
  invoices, no payments at all, and it uses remaining_balance instead of the invoice amount.
- get_partner_reconciliation_act (supabase/migrations/20260910200000_gl_osv_reconciliation_inventory_reports.sql):
  sales + purchases + public.payments only. It misses invoice payments (public.transactions with
  reference_type 'sale' / 'purchase', posted by process_invoice_payment_event via post_cash_transaction,
  including the multi-account payment lines from 20261105100000_imports_stages_pay.sql), opening
  balances, and every import debt and payment.
- compute_partner_open_receivables / _payables / _net_balance and customers.balance: open invoices +
  opening_balance, no import debts, no dates.
The GL (journal_entry_lines.partner_id on 1200 / 2100) is also incomplete: invoice payments post no
partner_id; set_customer_opening_balance_atomic and production orders pass customers.id where
partner_id references partners.id. That is fixed separately in LED-2; do not touch it here.

## What to build
1. Investigate first. List EVERY flow that changes what a partner owes us or we owe them: opening
   balances (customers and suppliers), posted sales invoices (with cancellation, reversal and the
   amendment/revision flow in 20261029100000_backdated_invoices_payments.sql), posted purchase invoices,
   invoice payments (single and multi-line), partner payments (public.payments, in and out), imports
   (supplier goods payable, every import_cost_lines payable to its own partner, prepay_import_supplier,
   pay_import_cost_advance, pay_import_payable, FX), consignment, returns if they exist, expenses or
   production orders charged to a partner, partner merge (merge_partners). Write the list with file and
   function for each into docs/ledgers/partner-ledger-spec.md. If a flow is ambiguous, say so there.
2. Migration: view public.partner_ledger_movements, one row per movement, columns:
   partner_id (partners.id, resolve customers.id / suppliers.id through resolve_unified_partner_id),
   entry_date (the document / payment date users chose, not created_at), source_type, source_id, doc_no,
   description, debit, credit (AZN, 2 decimals), currency_code, amount_fc, rate, due_date, created_by,
   created_at. Sign rule: debit = the partner owes us more (sales invoice, money we paid them);
   credit = we owe them more or they paid us (purchase invoice, import payable, money received).
   Balance = SUM(debit - credit); positive = debtor, negative = creditor. Exclude drafts and cancelled
   documents; a cancelled-after-posting document must net to zero or be excluded, never counted once.
   No double counting: an invoice paid at creation appears as invoice + payment, never twice.
3. Function get_partner_statement(p_partner_id uuid, p_from date, p_to date, p_side text default 'net')
   returns jsonb: partner header, opening balance before p_from, lines with running balance, period
   debit/credit totals, closing balance, per-currency subtotals. p_side: 'net' | 'receivable' | 'payable'
   (for a partner who is both customer and supplier).
4. Function get_partner_balances(p_as_of date) returns one row per partner with a non-zero balance:
   receivable, payable, net, last payment date and amount. LED-4 and LED-5 build on this.
5. Read-only check check_partner_ledger_integrity() returns per partner: ledger balance from the view,
   stored balance (compute_partner_net_balance), GL balance on 1200/2100 by partner_id, and the deltas.
   Also put the same query in supabase/scripts/partner_ledger_check.sql so Del can run it by hand.
6. Column partners.payment_terms_days integer not null default 0 check (>= 0). Add it to the partner
   form (with i18n az/en/ru) only if that is a small change; otherwise list it for LED-3.
7. Security: STABLE functions, search_path set, check can_view_financial_reports (use the existing
   permission helper used by other finance RPCs), REVOKE from PUBLIC and anon, GRANT to authenticated.
   Add indexes only where EXPLAIN shows the view needs them.

## Tests
- Never run SQL against production. My .env.local points to PRODUCTION: do not use it for SQL.
  Use a local Supabase (supabase start + all migrations) or the dev project del-groups-erp-dev.
- SQL test script supabase/tests/partner_ledger_test.sql with fixtures covering: invoice paid at
  creation, partly paid, paid by partner payment, cancelled after posting, amended invoice, opening
  balance, partner who is both customer and supplier, import with a foreign-currency supplier and a
  customs-broker cost line, prepayment. Assert the statement totals and that the view balance equals
  the sum of the fixtures.
- Node tests for any TS mapper you add. npm run lint, npm test, npm run build must pass.

## PR
Plain words: what changed, how tested, and the exact manual steps for Del:
which file to run in Supabase SQL Editor, in which order after which existing migration, and the
read-only check query to run afterwards and send back. List unrelated problems you found, don't fix them.
Choose a unique migration timestamp: check ls supabase/migrations and the open PRs.
```

---


---

# پرامپت 06-LED-2

### پرامپت LED-2: درست کردن partner_id در دفتر کل

```text
Before starting, check the list of available skills. Use every skill that fits this task
(finance:journal-entry, finance:reconciliation, finance:audit-support, data:sql-queries,
engineering:testing-strategy, engineering:code-review, security-review, and any others that fit).
At the end, say which skills you used, or that none fit. If a skill or tool you need is missing,
stop and tell me exactly what to install.

Task LED-2: every GL line on 1200 (receivables) and 2100 (payables) must carry the right
journal_entry_lines.partner_id (a partners.id), so the GL subledger by partner equals the partner
ledger from LED-1. Follow CLAUDE.md "SaaS program rules". Branch: saas/led-2-gl-partner-tags.
One migration file for the forward fix; separate scripts for history.

## Verify first, then fix going forward
1. Invoice payments: process_invoice_payment_event -> post_cash_transaction posts the counter line
   (1200 for sales, 2100 for purchases) without partner_id. Make the payment flows pass the partner
   (resolve_unified_partner_id) on that line. Keep signatures backward compatible (new optional
   parameter or a wrapper), keep idempotency keys unchanged. Check the multi-line payment path
   (_post_payment_lines) too.
2. set_customer_opening_balance_atomic / set_supplier_opening_balance_atomic
   (20260921110000_financial_opening_balances.sql) pass customers.id / suppliers.id as partner_id,
   but the column references partners.id. Reproduce on a test DB whether this makes the journal fail
   (that would explain why opening balances have no journal entry). Fix by resolving partners.id.
3. Production orders (latest definitions in 20261029200000_stock_per_warehouse.sql) pass
   v_order.customer_id as partner_id. Same fix.
4. Search all other create_journal_entry / post_journal_entry callers for lines on 1200 / 2100 without a
   correct partner_id and list them; fix the ones that are clearly the same bug.
Do NOT change account codes, amounts or the 1100 hardcode in this PR (that is a separate known item);
mention it in the PR.

## History (scripts, not migrations; Del decides)
- supabase/scripts/gl_partner_tags_report.sql: READ-ONLY. Lists 1200/2100 lines with NULL or invalid
  partner_id, which partner they should have (via transactions.reference_type/reference_id, document
  ids), and totals.
- supabase/scripts/gl_partner_tags_backfill.sql: only UPDATEs journal_entry_lines.partner_id where the
  report found exactly one right partner. Never changes amounts or accounts. Wrapped in a transaction
  with a before/after count. Idempotent.
- supabase/scripts/opening_balance_journals_report.sql: READ-ONLY, partners with opening_balance <> 0
  and no opening-balance journal. Do not post missing journals in this PR; describe the options.

## Tests
Never run SQL against production (my .env.local points to production). Local Supabase or
del-groups-erp-dev only. SQL test script with fixtures: sale paid at creation, purchase paid later,
opening balance set and changed, production order; assert partner_id on every 1200/2100 line and that
check_partner_ledger_integrity() from LED-1 shows zero GL delta for the fixtures.
npm run lint, npm test, npm run build must pass.

## PR
What changed in plain words, how tested, and Del's exact steps: run the migration, then run the
READ-ONLY report and send the result; run the backfill only after we review it. Unique migration
timestamp (check ls supabase/migrations and open PRs).
```

---


---

# پرامپت 07-LED-3

### پرامپت LED-3: صفحه‌ی صورت‌حساب طرف تجاری (مورد ۶)

```text
Before starting, check the list of available skills. Use every skill that fits this task
(frontend-design, design-system, design-critique, accessibility-review, ux-copy, finance:financial-statements,
xlsx, pdf, engineering:testing-strategy, engineering:code-review, chrome / browser skills, and any others
that fit). At the end, say which skills you used, or that none fit. If a skill or tool you need is
missing, stop and tell me exactly what to install.

Task LED-3: a separate account statement for every customer, supplier or partner in the accounting
section, built only on get_partner_statement from LED-1. Follow CLAUDE.md "SaaS program rules" and
docs/ui-standard.md (say in the PR which rule ids you touched). Read the relevant Next 16 guides in
node_modules/next/dist/docs/ first. Branch: saas/led-3-partner-statement.

## Feature flag
New server flag PARTNER_LEDGERS (src/lib/features/partnerLedgers.ts, same pattern as newImports.ts),
off unless "true", plus PARTNER_LEDGERS_AUDIENCE = admins | all (default admins, same idea as
NEW_HOME_AUDIENCE). Off = nothing changes for staff: old Ledger tab and old reconciliation act stay.
Only users with can_view_financial_reports ever see these pages.

## Build
1. Page "Hesab çıxarışı" in the accounting reports area next to the reconciliation act
   (suggested route /dashboard/reports/partner-statement; follow the NAV rules for where it appears
   in the menu and breadcrumbs). Controls: partner lookup (EntityLookup) with a type filter
   (customer / supplier / partner / all), date range (existing date range helpers, presets: this month,
   last month, this year, all time), side (net / receivable / payable, shown only if the partner is both).
   Header card: partner name, VÖEN, phone, credit limit and payment terms, opening balance, period debit,
   period credit, closing balance with a clear "debtor / creditor / settled" badge.
   Grid (StandardGrid / the UI_STANDARD list components): date, document type, document no (link that
   opens the document), description, debit, credit, running balance, currency + foreign amount (only
   when any row is not AZN), created by. Opening balance row first, totals row last. Per-currency
   subtotals under the grid when there is more than one currency.
2. Export: Excel via src/lib/export/exportXlsx.ts (one sheet, header block, numbers as numbers) and PDF /
   print with the company letterhead, reusing the print layout used by PartnerReconciliationDocument.tsx.
   File name: statement-<partner>-<from>-<to>.
3. Partner page src/app/dashboard/partners/[id]: with the flag on, the "Ledger" tab shows this statement
   (same component, last 12 months by default, link "open full statement"). Flag off: old tab unchanged.
4. Reconciliation act (/dashboard/reports/reconciliation): with the flag on, read from
   get_partner_statement so it includes invoice payments, opening balance and imports. Keep its
   document layout and signatures block.
5. Deep links: from customers, suppliers and partners lists and from the debtor/creditor reports later,
   "Hesab çıxarışı" opens this page with the partner preselected (query param).
6. All strings in src/i18n (az, en, ru). Empty, loading and error states per the UI standard. Works at
   1280px and on a phone without sideways page scroll.

## Tests
Node tests for the mapper, running balance, per-currency subtotals, and the flag/audience logic.
Check the page in Chrome on the live site only by reading; never press any button that writes.
npm run lint, npm test, npm run build must pass. Add before/after screenshots to the PR.

## PR
Plain words, how tested, UI rule ids touched, and Del's step: set PARTNER_LEDGERS=true (and
PARTNER_LEDGERS_AUDIENCE=admins) in the production env file and restart, as a copy-paste command block.
```

---


---

# پرامپت 08-LED-4

### پرامپت LED-4: گزارش بدهکاران و طلبکاران و گردش طرف‌ها (مورد ۷، بخش اول)

```text
Before starting, check the list of available skills. Use every skill that fits this task
(finance:financial-statements, finance:variance-analysis, data:build-dashboard, data:data-visualization,
dataviz, frontend-design, design-system, accessibility-review, ux-copy, xlsx, pdf,
engineering:testing-strategy, engineering:code-review, and any others that fit). At the end, say which
skills you used, or that none fit. If a skill or tool you need is missing, stop and tell me exactly what
to install.

Task LED-4: complete, advanced debtors and creditors reports in the accounting section, on the LED-1
partner ledger only (partner_ledger_movements / get_partner_balances). Behind PARTNER_LEDGERS
(from LED-3), can_view_financial_reports only. Follow CLAUDE.md "SaaS program rules" and
docs/ui-standard.md. Branch: saas/led-4-debtors-creditors. At most one migration (report RPCs).

## Build
1. Page "Debitor və kreditor borcları" with tabs Debtors / Creditors / Net.
   - As-of date (default today; any past date gives balances on that date).
   - Filters: partner type, minimum amount, currency, created by / salesperson of the open documents,
     only overdue, only over credit limit, search by name / VÖEN / phone. Filters live in the URL.
   - Columns: partner, phone, balance, of which overdue, oldest overdue days, open invoices count,
     credit limit and % used (warn above 100%), last payment date and amount, payment terms.
     Every row: open the LED-3 statement, open the partner.
   - KPI strip on top: total receivable, total payable, net, % overdue, top 10 debtors (small bar chart).
2. Turnover per partner ("Tərəfdaşlar üzrə dövriyyə"): for a period, per partner: opening balance,
   debit turnover, credit turnover, closing balance, with totals; same filters; drill to statement.
3. DSO and DPO for the selected period (state the formula in the UI help text and the PR), overall and
   per partner column.
4. Export Excel and PDF for every tab, with filters and as-of date printed in the header.
5. Link both reports from the accounting reports hub and from the home financial widgets where a
   receivable/payable total is already shown (only when the flag is on).
6. Server-side pagination and sorting for large lists; one RPC call per view, no N+1 queries.
7. All strings in src/i18n (az, en, ru).

## Tests
SQL fixtures (local Supabase or del-groups-erp-dev, never production) asserting as-of balances,
turnover totals equal the statement totals for each partner, and filters. Node tests for mappers,
KPI formulas, URL filter state. npm run lint, npm test, npm run build must pass. Screenshots in the PR.

## PR
Plain words, how tested, UI rule ids, and the SQL file for Del to run (order, after LED-1).
```

---


---

# پرامپت 09-LED-5

### پرامپت LED-5: گزارش سنی بدهی (Aging) (مورد ۷، بخش دوم)

```text
Before starting, check the list of available skills. Use every skill that fits this task
(finance:reconciliation, finance:financial-statements, data:sql-queries, data:validate-data, dataviz,
frontend-design, accessibility-review, xlsx, pdf, engineering:testing-strategy, engineering:code-review,
and any others that fit). At the end, say which skills you used, or that none fit. If a skill or tool you
need is missing, stop and tell me exactly what to install.

Task LED-5: receivables and payables aging, on any as-of date, on the LED-1 partner ledger only.
Behind PARTNER_LEDGERS, can_view_financial_reports only. Follow CLAUDE.md "SaaS program rules" and
docs/ui-standard.md. Branch: saas/led-5-aging. At most one migration.

## Rules
- Open items per partner as of the date: invoices and import payables minus the payments allocated
  to them up to that date. Payments linked to a specific invoice are applied to it. Payments not linked
  to an invoice (partner payments, advances) are applied FIFO to the oldest open item of the same side;
  what is left is shown as "unallocated advance", never hidden.
- Due date = document due_date; if empty, document date + partners.payment_terms_days.
- Buckets: not due, 1-30, 31-60, 61-90, 91-180, over 180 days past due. Bucket edges in one constant,
  documented.
- Foreign-currency import payables: age in AZN at the booked rate; show the currency amount too.
- Write the allocation as a pure SQL function get_partner_open_items(p_partner_id, p_as_of, p_side)
  and the report get_aging_report(p_as_of, p_side, filters jsonb). Document the method in
  docs/ledgers/partner-ledger-spec.md.

## Build
1. Page "Borcların yaş təhlili" with Receivables / Payables tabs, as-of date, the same filters as LED-4.
   Rows per partner with the bucket columns and total; totals row; stacked bar of buckets on top.
   Click a bucket cell = list of the open items in it (document, date, due date, days overdue,
   open amount) with links to the documents and the statement.
2. Export Excel and PDF.
3. Statement page (LED-3): add an "open items" section using get_partner_open_items.

## Tests
SQL fixtures (never production): partial payments, FIFO across three invoices, payment before
invoice (advance), payment after the as-of date (must not count), cancelled invoice, empty due date
with payment terms, a partner on both sides. Assert: sum of buckets + unallocated = ledger balance on
the as-of date, for every partner. Node tests for bucket logic and mappers.
npm run lint, npm test, npm run build must pass. Screenshots in the PR.

## PR
Plain words, how tested, UI rule ids, and the SQL file for Del to run (order, after LED-1/LED-4).
```

---


---

# پرامپت 10-DATE-1

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


---

# پرامپت 11-DATE-2

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

## Prompt DATE-2 — Cash documents

Check available skills, use every one that fits, and say which you used.

Branch: `saas/doc-date-change-cash`. Depends on DATE-1 being merged (start from latest main). One PR. Same rules as DATE-1.

Do:

1. Migration `supabase/migrations/20261110151000_document_date_change_cash.sql` (re-check the prefix). Add handlers to the engine for: invoice payments made from the three-dot menu (`process_invoice_payment_event` rows), partner payments (`create_partner_payment`), manual cash/bank transactions and transfers between accounts (both legs move together), expenses (`expense_documents`, including the VAT split rows and employee-paid expenses). For each: R1, R2, R6 on every account touched, R7 (payment not before its invoice, expense not before its source document), W2.
2. Read the existing balance checks (`insufficient_balance` in `20261107100000_gl_partner_cash_account.sql`, `20261005200000_expense_documents.sql`) and use the same balance rule in the timeline check; do not invent a second definition of "balance".
3. Add the menu item / form action in the lists and forms of these documents (flag + admin only).
4. Tests: one pass and one block per document type, plus a transfer whose destination would go negative.
5. `npm run lint`, `npm test`, `npm run build`.

PR as in DATE-1.

---


---

# پرامپت 12-DATE-3

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

## Prompt DATE-3 — Inventory and import documents

Check available skills, use every one that fits, and say which you used.

Branch: `saas/doc-date-change-inventory`. Depends on DATE-1 (and DATE-2 for import payments). One PR. Same rules as DATE-1.

Do:

1. Migration `supabase/migrations/20261110152000_document_date_change_inventory.sql` (re-check the prefix). Handlers for: stock transfers (out and in legs, R3 on both warehouses), inventory write-offs, initial balances and stock receipts (`inventory_initial_balances`), import documents (`imports_*`: receipts, payments, cost postings, late postings; stage order R7, W3 for FX: keep the original rate by default, option to re-rate is OUT of scope, only warn), production orders if they post stock.
2. Inventory counts: F2 already lets admins change a count's date (`inventory_count_date_changed`, `inventory_count_unpost`). Route posted counts through the same engine so the change is logged in `document_date_changes` and checked with R3/R8; keep F2's behaviour for drafts.
3. Menu item / form action for each (flag + admin only).
4. Tests: pass/block per document type; a transfer moved before the stock arrived in the source warehouse; an import receipt moved after a sale of its goods (R4).
5. `npm run lint`, `npm test`, `npm run build`.

PR as in DATE-1. List in the PR any document type that still cannot change date and why.


---

# پرامپت 13-LOT-1

## LOT-1: هسته پایگاه داده لوت، backfill و یکپارچگی

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: build the database core of a professional lot / batch tracking system (plan:
docs/lot-tracking/LOT-plan.md, read it fully first, sections 1-4, 11, 14). This PR adds the data
model, the automatic lot attribution of EVERY stock change, the backfill of today's stock and an
integrity check. No document flow passes lots yet (LOT-2 / LOT-3) and there is no UI except the
feature flag. Branch: saas/lot-core. Open a draft PR. Follow every rule in CLAUDE.md.

Context from the codebase (verify each point before relying on it):
- warehouse_stocks (product_id, warehouse_id nullable = default warehouse, current_stock) is the
  per-warehouse stock. stock_move / _stock_move_doc / adjust_warehouse_stock
  (20261029200000_stock_per_warehouse.sql, 20261028181000_product_stock_integrity.sql) change it;
  some paths write it directly (_inventory_count_set_stock, stock_integrity_fix, initial balance,
  src/lib/inventory/warehouseProductStock.ts). Treat NULL warehouse_id as stock_default_warehouse().
- Polywood (products.inventory_mode = 'polywood') stock follows polywood_pieces (length_m, status,
  warehouse_id, source_document_id); its warehouse_stocks rows are rebuilt from the pieces.
- inventory_batches / inventory_batch_consumptions are FIFO COST layers per product (no warehouse),
  consumed only by sales and inventory counts. Do NOT change them or any journal / COGS logic.
- stock_movements and inventory_batches get the document date via apply_document_date() /
  document_timestamp() (20261029100000_backdated_invoices_payments.sql).
- Numbering: document_number_counters (doc_type, year, last_no), see receive_import_shipment.
- audit_logs is purged by the retention setting; audit_alerts holds alerts.
- Permissions pattern: imports_can(text) in 20261030100000_imports_core.sql (admin, role
  permissions, overrides, _matrix). Feature flags: src/lib/features/*.ts (see newImports.ts).

1. Feature flag LOT_TRACKING in src/lib/features/lotTracking.ts (off unless "true"), plus an
   optional LOT_TRACKING_AUDIENCE=admins like NEW_HOME_AUDIENCE. Permissions lots.view and
   lots.manage in the permission matrix (inventory module manifest), admin has both. Unit tests.
2. Migration supabase/migrations/20261112100000_lot_core.sql (check `ls supabase/migrations` and
   open PRs first; pick another unique prefix if taken). One file, safe to re-run:
   a. Tables (RLS on; read with lots_can('view'); NO insert/update/delete policies: every write
      goes through SECURITY DEFINER functions):
      - stock_lots: id, lot_no text unique not null, product_id, supplier_batch_no, origin_type
        check in (import, purchase, opening, production, count_surplus, return, manual,
        unassigned), origin_doc_type, origin_doc_id, origin_line_id, origin_doc_no, supplier_id,
        import_shipment_id, customs_declaration_no, mfg_date, exp_date, received_date,
        qty_received, inventory_batch_id, status check in (active, quarantine, closed), notes,
        custom_fields jsonb default '{}', created_by, created_at, updated_at. One 'unassigned' lot
        per product (partial unique index). Indexes for FEFO picking: (product_id, status,
        exp_date nulls last, received_date, lot_no).
      - stock_lot_balances: lot_id, warehouse_id, qty, updated_at, PK (lot_id, warehouse_id);
        qty >= 0 except the unassigned lot. Index (warehouse_id, lot_id) where qty <> 0.
      - stock_lot_movements: immutable ledger. id, lot_id, product_id, warehouse_id, qty_delta
        (signed, never 0), balance_after, kind (in, out, transfer_in, transfer_out, reverse_in,
        reverse_out, correction), doc_type, doc_id, doc_line_id, doc_no, counterparty_type
        (customer, supplier, partner, employee, warehouse, none), counterparty_id, pick_mode
        (manual, fefo, fifo, reverse, mirror, new_lot, unassigned, backfill, no_context),
        reverses_movement_id, movement_date timestamptz (document date via apply_document_date),
        recorded_at default now(), created_by default auth.uid(). Indexes: (product_id,
        movement_date), (lot_id, movement_date), (doc_type, doc_id, doc_line_id).
      - stock_lot_events: lot_id, event (created, renamed, dates_changed, status_changed,
        note, corrected), old_values, new_values, reason, created_by, created_at. Permanent.
      - New columns: polywood_pieces.lot_id, polywood_pieces.parent_piece_id,
        inventory_batches.lot_id, products.lot_policy (auto | manual_required, default auto),
        products.shelf_life_days.
      - system_settings key lot_tracking: { number_format: 'LOT-{YYYY}-{NNNNN}', pick: 'fefo' }.
   b. lots_can(p_action) like imports_can; next_lot_no(p_date) using document_number_counters
      (doc_type 'lot', yearly) and the format setting.
   c. Lot context, transaction-local (set_config('erp.lot_ctx', ..., true)):
      lot_ctx_begin(p jsonb) / lot_ctx_end(). Fields: doc_type, doc_id, doc_line_id, doc_no,
      product_id, counterparty_type, counterparty_id, mode (normal | reverse | mirror),
      reverse_of {doc_type, doc_id, doc_line_id}, mirror_of {doc_type, doc_id, doc_line_id},
      lots [{lot_id | lot_no, qty}] chosen by the user, new_lot {lot_no?, supplier_batch_no,
      mfg_date, exp_date, origin_type, supplier_id, import_shipment_id, customs_declaration_no,
      inventory_batch_id}. A context whose product_id differs from the changed row is ignored.
   d. _lot_apply(product, warehouse, delta) and an AFTER INSERT / UPDATE OF current_stock,
      warehouse_id / DELETE trigger on warehouse_stocks that calls it with the row delta (skip
      services, kits and polywood). Rules (plan section 4):
      - in + mode reverse: give back to the lots the original document took (latest first, using
        its out movements minus earlier reversals), remainder as below.
      - in + mode mirror: same lots and quantities as the mirrored out movements (transfers).
      - in + chosen lots: those; in + new_lot or any document: a new lot (next_lot_no unless
        lot_no given), origin from the context; in with no context: the unassigned lot + alert.
      - out + chosen lots: those (remainder FEFO + alert); out + reverse: from the lots the
        original document put in; out otherwise: FEFO (exp_date, then received_date, lot_no)
        over active lots with qty > 0 in that warehouse; shortage: unassigned lot (may go
        negative) + an audit_alerts row 'lot_shortage'.
      - Every split writes one stock_lot_movements row per lot with balance_after.
      - It must NEVER raise for a normal stock change (wrap the body; on an unexpected error write
        an audit_alerts row 'lot_error' and let the stock change through). It must be fast.
   e. Polywood: triggers on polywood_pieces. INSERT of an available piece = in (length_m) to
      NEW.lot_id, else the parent piece's lot, else the context, else unassigned (set NEW.lot_id
      in a BEFORE trigger). Status leaving available (sold, used, deleted, …), length change,
      warehouse change = out / in / transfer of the length. Read the cutting code in
      process_mixed_dimensional_sale and every other INSERT INTO polywood_pieces (SQL and
      src/modules/polywood, src/lib/polywood) and make offcuts set parent_piece_id.
   f. Backfill (before creating the triggers): for every import receipt line and purchase line
      whose FIFO batch still has remaining_qty, create a lot (origin import / purchase, links,
      received_date = document date) with qty = LEAST(batch remaining_qty, stock still unassigned
      in that warehouse), oldest first; then one 'opening' lot per product x warehouse for the
      rest of warehouse_stocks.current_stock > 0; polywood pieces with source_document_id = an
      import receipt get that receipt's lot, the rest an opening lot per product x warehouse.
      Movements pick_mode 'backfill'. RAISE NOTICE the counts. Afterwards every product x
      warehouse must satisfy SUM(lot balances) = current_stock (and = available piece length for
      polywood); RAISE EXCEPTION if not.
   g. lot_integrity_report() (lots.view, admin sees all) and lot_integrity_fix(p_product,
      p_warehouse, p_reason) (admin only; posts 'correction' movements through the unassigned
      lot, logs stock_lot_events + audit_logs). Checks: sum mismatch, non-zero unassigned lot,
      negative balance, movements with pick_mode no_context in the last N days, lots past
      exp_date with stock.
   h. lot_update(p_lot_id, p_fields jsonb, p_reason) (lots.manage): supplier_batch_no, dates,
      notes, custom_fields; lot_no only while the lot has no out movement, else admin only with
      reason; lot_set_status(p_lot_id, p_status, p_reason). Both write stock_lot_events and
      audit_logs (module 'inventory').
   i. Grants: functions executable by authenticated only where they check lots_can themselves;
      internal ones (_lot_apply, triggers) revoked from public/anon/authenticated.
3. supabase/tests/lot_core.sql (pattern of supabase/tests/stock_per_warehouse.sql): backfill
   invariant, in/out FEFO/FIFO, chosen lots, reverse, mirror, unassigned + alert, polywood cut
   inheriting the lot, an unexpected error not blocking stock_move, integrity report and fix.
   Node test tests/lotCore.test.mjs for the flag and the migration text (no forbidden policies,
   trigger present, never-raise wrapper).
4. Update the module SQL ownership (supabase/modules/inventory/objects.json or the generator, as
   the repo does it) if new objects must be listed; run the checks the repo has for that.
5. Date-change compatibility: if apply_document_date_change / document_date_changes (prompts DATE-1..3)
   exist on main, register the lot rows with that engine: stock_lot_movements.movement_date and
   stock_lots.received_date move with their document, and add a timeline check that no lot balance
   goes negative at any date after the change. If the engine is not on main yet, say so in the PR and
   leave a clearly marked TODO; do not invent a second date engine.
6. Run npm run lint, npm test, npm run build; run the SQL test on a local or branch database
   (never production). Do not change any existing function except adding triggers.

PR description (CLAUDE.md rule 11, Persian summary + English details): what changed, how it was
tested, and the manual step: "Run 20261112100000_lot_core.sql on production ONLY together with
LOT-2 and LOT-3, in order, after all three are merged; then run lot_integrity_report() and
expect no rows." Say which ui-standard rules were touched (none expected). List unrelated
problems you find instead of fixing them.
```

---


---

# پرامپت 14-LOT-2

## LOT-2: ورود کالا با لوت (واردات، خرید، اول دوره، تولید، شمارش) و برچسب

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: every inbound stock document creates named lots (plan docs/lot-tracking/LOT-plan.md,
sections 2, 5, 7). Imports first and most carefully. Requires LOT-1 (saas/lot-core) merged: stop
and say so if supabase/migrations has no *_lot_core.sql. Branch: saas/lot-inbound. Draft PR.
Follow every rule in CLAUDE.md (read the relevant guide in node_modules/next/dist/docs/ first).

Context (verify): LOT-1 gives stock_lots, lot_ctx_begin/lot_ctx_end, next_lot_no, the triggers on
warehouse_stocks and polywood_pieces. receive_import_shipment (20261030110000_imports_posting.sql)
loops over p_lines: stock_move or polywood pieces, import_receipt_lines, stock_movements,
create_inventory_batch. Import UI: src/modules/imports/components (ImportLinesGrid,
ReceivingSheet, WarehouseSplitDrawer), save via import_shipment_save_draft (latest in
20261106100000_imports_duty_override.sql). Purchases: post_purchase_invoice_draft /
process_purchase_receipt_event (latest in 20261029200000_stock_per_warehouse.sql). Initial
balance, production ready event (finished goods), inventory_count_post (surplus).

1. Migration 20261112110000_lot_inbound.sql (check the prefix is free). Replace each function
   with the same signature (CREATE OR REPLACE, copy the latest body, change only the lot parts):
   - import_shipment_lines: lot_no_planned, supplier_batch_no, mfg_date, exp_date (draft only,
     written by import_shipment_save_draft from optional keys on each line; old callers keep
     working). Check lot_no_planned is unique against stock_lots and within the shipment.
   - receive_import_shipment: each p_lines entry may carry lots [{lot_no?, supplier_batch_no?,
     mfg_date?, exp_date?, qty_stock_unit}] summing to the entry's qty (else the line's planned
     values, one lot). Before each stock change call lot_ctx_begin with doc_type
     'import_receipt', doc_id receipt, doc_line_id receipt line, doc_no, counterparty supplier,
     new_lot {origin import, supplier_id, import_shipment_id, customs_declaration_no,
     inventory_batch_id}; lot_ctx_end after. A second receipt of the same shipment line adds to
     the SAME lot (same lot_no) unless the user gave another. Write import_receipt_lines.lot_id
     (new column) and inventory_batches.lot_id. Polywood sheets get lot_id on insert.
     Enforce products.lot_policy = 'manual_required' (supplier_batch_no and, with
     shelf_life_days, exp_date required; default exp_date = mfg_date + shelf_life_days).
   - cancel_import_shipment: reverse context (doc_type import_receipt) so stock leaves exactly
     the receipt lots; it already refuses when received stock was used.
   - Purchases (post + reverse), initial balance (post + unpost), production finished goods
     (origin production, lot_no from the order number when free, link the consumed material lots
     in custom_fields.material_lots from the order's out movements), inventory_count_post surplus
     (origin count_surplus) and inventory_count_unpost (reverse).
2. UI behind LOT_TRACKING (flag off = today's screens unchanged, no new keys sent):
   - ImportLinesGrid: Lot column group (lot no with an "auto" placeholder, supplier batch no,
     mfg / exp date); ReceivingSheet: prefilled lot fields per row and a "split into lots" action
     adding sub-rows (sum must equal the row, live validation); read-only lot chips on received
     lines linking to the lot card route /inventory/lots/[id] (the page comes in LOT-4; link only
     when the flag is on).
   - Purchase line and initial balance line: optional lot fields (same component).
   - After a receipt: "Print lot labels" (one label per lot, or per sheet for polywood): lot no as
     Code128 + QR, product, supplier batch, exp date, receipt no. Reuse the barcode / QR code the
     repo already uses for polywood pieces and products.
   - One shared typed component for the lot fields in src/modules/inventory (public API in
     src/modules/inventory/index.ts), used by imports and purchases through that API only.
3. All strings in src/i18n (az, en, ru). docs/ui-standard.md rules (forms, line grids).
4. Tests: supabase/tests/lot_inbound.sql (receipt with one lot, split lots, two receipts same
   lot, manual_required refusal, cancel reverse, purchase post/reverse, opening, production,
   count surplus/unpost, invariant after each); node tests for the lot fields component logic and
   payload building. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids, manual step "run with LOT-1 and LOT-3".
```

---


---

# پرامپت 15-LOT-3

## LOT-3: خروج کالا با لوت، انتقال اتمی، لغو و برگشت

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: every outbound and moving stock document records which lots it used, picked automatically
(FEFO, then FIFO) or chosen by the user, and every cancel / void / return gives back exactly
those lots (plan docs/lot-tracking/LOT-plan.md, sections 4, 6, 7). Requires LOT-1 merged (stop
otherwise); best after LOT-2. Branch: saas/lot-outbound. Draft PR. Follow every rule in CLAUDE.md.

Context (verify, latest bodies are mostly in 20261029200000_stock_per_warehouse.sql and
20261029100000_backdated_invoices_payments.sql): create_sale_atomic, post_sales_invoice_draft,
process_mixed_dimensional_sale (polywood), cancel_sales_invoice_atomic, _reverse_sales_invoice_
posting, restore_sale_stock, post_inventory_writeoff / update_inventory_writeoff, production
material issue / return_production_material_stock / delivery, create_consignment_dispatch_atomic /
settle_consignment_partner_atomic / consignment returns, inventory_count_post shortage, purchase
reverse. Stock transfers are written from TypeScript in
src/modules/inventory/lib/stockTransferServer.ts (not atomic).

1. Migration 20261112120000_lot_outbound.sql (check the prefix). CREATE OR REPLACE each function
   with the same signature, copying the latest body and adding only:
   - Per line: lot_ctx_begin(doc_type, doc_id, doc_line_id, doc_no, product, counterparty
     (customer for sales, partner for consignment, employee / order for production), lots
     chosen in the payload line key "lots": [{lot_id, qty}]) before the stock change, lot_ctx_end
     after. Validate chosen lots BEFORE moving stock: same product, available in the line's
     warehouse, not quarantine, quantities sum to the line quantity (stock unit); raise a clear
     Azerbaijani message naming product, lot and warehouse (like stock_shortage_message).
   - Kits: the component lines pick automatically.
   - Cancel / void / reverse / unpost / material return / consignment return: mode reverse with
     reverse_of = the original document (and line when known).
   - New RPC post_stock_transfer(p_payload jsonb): header + lines in one transaction (same
     tables and numbering the TS code uses today), out of the source with optional chosen lots,
     in to the target with mode mirror; polywood offcuts move their pieces (lot follows). The API
     route uses it when LOT_TRACKING is on, else the old path (so deploy order is safe).
   - Expired lots: chosen expired lot allowed only with lots.manage (warning in the UI); FEFO
     never picks quarantine lots.
2. UI behind LOT_TRACKING (flag off = no change, no "lots" key sent):
   - A typed LotPicker in src/modules/inventory (public API): Combobox of lots of the product in
     the line's warehouse with qty, supplier batch, exp date, status; FEFO suggestion first;
     split one line over several lots in a popover; expired / near-expiry / quarantine badges.
     Default is "Auto (FEFO)" so nobody has to pick.
   - Used in the sale form line grid, write-off form, stock transfer form, production material
     issue and consignment dispatch. Lot chips (read-only) on the posted documents' views.
   - Sales invoice print: lot numbers under each line when the setting
     lot_tracking.print_on_invoice is true (default false), in the settings page.
3. i18n (az, en, ru); docs/ui-standard.md (line grids, lookups, overlays).
4. Tests: supabase/tests/lot_outbound.sql: sale auto FEFO across two lots, sale with chosen lots,
   bad chosen lot refused before any stock moves, cancel and void restore the same lots, write-off
   update (reverse + re-apply), production issue and return, consignment dispatch / return /
   settle, transfer keeps lots (and polywood offcut), count shortage / unpost, purchase reverse,
   kit sale; invariant SUM(lot balances) = warehouse stock after each. Node tests for LotPicker
   allocation logic and the transfer route switch. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids, and the manual step: "After LOT-1,
LOT-2 and LOT-3 are merged run on production in this order: *_lot_core.sql, *_lot_inbound.sql,
*_lot_outbound.sql; then SELECT * FROM lot_integrity_report(); expect no rows." List unrelated
problems found.
```

---


---

# پرامپت 16-LOT-4

## LOT-4: صفحه‌های لوت (لیست، کارت لوت، اسکن، موجودی انبار)

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: the screens of the lot system, all behind LOT_TRACKING (plan docs/lot-tracking/
LOT-plan.md, section 9). Requires LOT-1..3 merged. Branch: saas/lot-ui. Draft PR. Follow every
rule in CLAUDE.md (read node_modules/next/dist/docs/ first; middleware is src/proxy.ts) and
docs/ui-standard.md (UI_STANDARD and UI_UNIFIED are on in production: use the unified page frame,
lists, overlays and tokens; check how the latest merged screens do it).

1. Inventory module routes (thin files in src/app, screens in src/modules/inventory):
   - /inventory/lots: list with search (lot no, supplier batch no, product name / code /
     barcode), filters (product, supplier, import shipment, warehouse, status, expiry window,
     has stock), column picker and saved views like the other lists, row menu (open, print
     label, quarantine / release, export). Excel and PDF export of the filtered rows with the
     export helper the repo already uses.
   - /inventory/lots/[id] lot card: header (lot no, product, supplier batch, status badge,
     dates, origin with links to the import shipment / receipt / purchase / production order,
     supplier, invoice no, customs declaration no); KPI tiles (received, on hand, sold, written
     off, at consignment partners, in production); balances per warehouse; tabs: Trace (backward
     origin chain; forward: customers with invoice links, qty, dates, grouped by customer),
     Movements (timeline of stock_lot_movements with running balance, document links, user,
     pick mode), History (stock_lot_events), Chatter (src/views/chatter). Unit cost only for
     users with the financial figures permission. Actions menu: edit (lot_update with reason),
     quarantine / release (lot_set_status), print label, export the card to PDF / Excel.
   - Warehouse stock page: expandable row per product showing its lots in that warehouse.
   - Products list row menu: "History" (opens the LOT-5 report prefiltered when it exists,
     else hide) and "Lots" (lots list filtered by product).
   - Barcode lookup (src/app/api/lookup-barcode) and the command palette / global search: a lot
     no or supplier batch no opens the lot card.
   - Navigation entry under Anbar via the inventory manifest, permission lots.view.
2. Server actions with requirePermissionAction / lots_can checks; reads through RPCs or views
   that respect RLS; pagination for movements (lots can have thousands).
3. Add a migration only if a read RPC or view is needed (20261112130000_lot_ui.sql, check the
   prefix); keep reads index-friendly.
4. i18n az / en / ru for every string. Accessibility and phone layout per ui-standard.
5. Tests: node tests for list filters, card data shaping, permission gating (financial figures
   hidden), barcode lookup of a lot, flag off = routes 404 and no menu items. Screenshots at
   1280 and phone width for the PR. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids touched and exceptions, manual step:
"set LOT_TRACKING=true and LOT_TRACKING_AUDIENCE=admins in .env.production when ready".
```

---


---

# پرامپت 17-LOT-5

## LOT-5: گزارش‌ها — تاریخچه محصول، ردیابی و فراخوان، انقضا، یکپارچگی

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: reports of the lot system and the product history report Del asked for: "a report by
product name that shows the whole history of a product, and every event of the product can be
followed by lot or batch number" (plan docs/lot-tracking/LOT-plan.md, section 10). Behind
LOT_TRACKING. Requires LOT-1..3 merged (LOT-4 helps for links). Branch: saas/lot-reports. Draft
PR. Follow every rule in CLAUDE.md and docs/ui-standard.md.

1. Migration 20261112140000_lot_reports.sql (check the prefix) with read RPCs that check
   lots_can('view') and hide money without the financial figures permission:
   - product_history(p_product, p_from, p_to, p_warehouse, p_lot, p_kinds, p_limit, p_offset):
     rows from stock_lot_movements joined to document headers (number, customer / supplier /
     partner name, line price), with running balance (total, and per warehouse when filtered),
     opening balance before p_from, totals in / out, closing; plus non-stock events of the
     product (created, edited, price changes from audit_logs while retained, count results)
     marked as such. Polywood in metres with pieces count.
   - lot_trace(p_lot_or_batch_no): backward chain and forward customers (with phone / email
     if the customer record has them), qty, invoices, remaining stock per warehouse.
   - lots_stock(p_warehouse, p_product, p_as_of): on hand by lot x warehouse with age in days
     and expiry; lots_expiry(p_days): expired or expiring with stock.
2. Reports screens under Hesabatlar (src/app/reports/...), each with filters, a data grid,
   totals, drill-down links to documents and lot cards, Excel and PDF export (the repo's export
   helper), print layout:
   - Məhsul tarixçəsi (product history): product lookup by name / code / barcode, date range
     (default this year), warehouse, lot (lookup by lot no or supplier batch no), event types.
     Also reachable from the products list row menu "History".
   - Lot trace / recall: one search box; result as origin -> warehouses -> customers; "export
     customer list" for a recall.
   - Stock by lot, and Expiry.
   - Lot integrity (admin only): lot_integrity_report() rows with a fix button
     (lot_integrity_fix with reason). Link it next to the existing StockIntegrityPage. Keep the
     RPC output stable: the future accounting guard agent (Del's item 10) will read it.
3. i18n az / en / ru; ui-standard lists and page frame; phone layout.
4. Tests: supabase/tests/lot_reports.sql (history running balance and opening balance across a
   sale, cancel, transfer and write-off; trace after a split receipt sold to two customers;
   permission without financial figures hides prices); node tests for report shaping and export
   columns. npm run lint, npm test, npm run build.

PR description: plain words, tests, ui-standard rule ids, manual step: run the migration on
production after LOT-1..3 SQL.
```


---

# پرامپت 18-GUARD-1

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


---

# پرامپت 19-GUARD-2

## پرامپت GUARD-2: داده محصول (اسم تکراری یا اشتباه) و چک‌های انبار

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: add product master-data and stock rules to the Accounting Guard, and a "Find duplicate or wrong
product names" button. Branch: saas/accounting-guard-products. Requires GUARD-1 merged (pull main
first). Open a PR. Behind ACCOUNTING_GUARD, admin only.

Migration: one file <unique prefix>_accounting_guard_products.sql (suggested 20261120110000; check
first). It may enable pg_trgm: CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions.

Rules (seed in guard_rules, category 'products' or 'stock')
F1 exact same name: reuse the duplicate_name logic, do not copy it twice; call
   stock_integrity_report() or move the shared part into one helper used by both.
F2 similar name: a normalising function public.guard_normalize_name(text) IMMUTABLE (lower case,
   trim, collapse spaces, drop punctuation, Azerbaijani letters ə->e ı->i ö->o ü->u ş->s ç->c ğ->g,
   Cyrillic look-alike letters to Latin), then pairs with equal normalised name OR
   similarity() >= params.threshold (default 0.85). Group the pairs into clusters; one finding per
   cluster with every product's id, code, name, unit, category, stock and last movement date.
   Add a trigram index on the normalised name so the scan stays fast on 10k products.
F3 name stored in the code column / code in the name column, leading/trailing/double spaces.
F4 missing category or unit, zero sale or purchase price on a stockable product.
F5 duplicate code / barcode (reuse the existing kinds).
E1 every other stock_integrity_report() kind becomes a finding (no duplicated logic).
E2 negative stock in any warehouse; E3 sale of a product that had no stock on the document date;
E4 zero unit cost, or purchase price that jumped more than params.pct=50 vs the previous purchase;
E5 inventory count variance above params.pct.

UI
- On the product list (both old and new UI) and on /settings/stock-integrity: admin-only button
  "Find duplicate or wrong names" that runs guard_scan(ARRAY['products']) and opens a dialog/drawer
  listing clusters (code, name, stock, unit, category, last movement), each product name links to its
  card. Actions per cluster: "Not a duplicate" (false_positive, reason required) and "Open in
  Accounting Guard". No merge and no delete in this PR.
- Follow docs/ui-standard.md and docs/ui-library rules; every string through src/i18n (az, en, ru).

Tests: extend supabase/tests/accounting_guard.sql with cases for each rule (e.g. "Konik bar" vs
"konik  bar", "Ağac" vs "Agac", Cyrillic "а" vs Latin "a", and two genuinely different names that
must not match). Unit tests for any TS helper. Run npm run lint, npm test, npm run build.
PR description as in CLAUDE.md, with the SQL to run and the UI rule ids touched.
```


---

# پرامپت 20-GUARD-3

## پرامپت GUARD-3: بخش «نگهبان حسابداری»، دکمه سندهای مشکوک، اعلان و ویجت

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: build the Accounting Guard section, the "Find suspicious documents" buttons, admin
notifications and a home widget. Branch: saas/accounting-guard-ui. Requires GUARD-1 and GUARD-2.
Behind ACCOUNTING_GUARD, admin only (pages 404 for others and when the flag is off). Open a PR.

Read first: node_modules/next/dist/docs/ (routing, server actions), docs/ui-standard.md (all of
part A and B), src/modules/inventory/components/StockIntegrityPage.tsx, src/components/shell/NewShell.tsx
(useNotifications / NotificationsButton), the home widget registry from PR #65, the DataGrid from UI-6.

Section /finance/guard (route + launcher entry under Finance, admin only), tabs:
1. Dashboard: health score (100 minus weighted open findings, explain the formula in a tooltip),
   open findings by severity and category, trend of the last 30 runs, top 10 open critical/high,
   last run time and a "Scan now" button.
2. Findings: DataGrid with filters (severity, category, rule, status, date range, partner, created
   by), search, column picker; row opens a drawer with details, the linked document (open
   sale/purchase/payment/journal entry in its own view), history from guard_finding_events, and
   actions Acknowledge / Resolved / False positive (reason required). Bulk acknowledge. Export the
   filtered list to Excel and PDF using the existing export helpers in src/lib/export.
3. Reports: list of guard_reports (empty until GUARD-5, then filled), view, export PDF/Excel.
   Also "Save current findings as report" (kind 'scan') for a dated snapshot.
4. Rules: enable/disable, severity, thresholds from params with validation.
5. Runs: run history with counts and errors.

Buttons: on the sales list and the purchase list (old and new UI), admin-only "Find suspicious
documents" that runs guard_scan(ARRAY['ledger','documents','cash','partners']) and opens the Findings
tab filtered to that module. In the sale/purchase document view, if open findings exist for that
document, show a small warning chip for admins that opens them.

Notifications: add guard items to the shell bell for admins: new critical/high findings since the
admin last opened the guard, and new reports. Store "last seen" per admin (small table
guard_notifications or a column, one migration only if needed, prefix checked first).
Home widget "Accounting Guard" for admins (score + open counts + link), registered like the other
widgets, hidden when the flag is off.

All strings through src/i18n (az, en, ru). Motion and Radix per the design system. Phone layout works.
Tests for score formula, filters, and permission gating. Playwright check of the pages at 1280 and
phone width with screenshots attached to the PR. Run npm run lint, npm test, npm run build.
PR description lists the UI rule ids touched.
```


---

# پرامپت 21-GUARD-4

## پرامپت GUARD-4: نظارت دائمی با pg_cron

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: make the Accounting Guard run by itself. Branch: saas/accounting-guard-schedule. Requires
GUARD-1..3. Open a PR.

Migration <unique prefix>_accounting_guard_cron.sql (suggested 20261120130000; check first):
- If the pg_cron extension is not installed, RAISE NOTICE with the steps for Del and exit without
  error (the migration must not fail on a database without pg_cron, including CI and new tenants).
- Otherwise schedule (idempotent: unschedule by name first):
  guard-incremental every 30 minutes: guard_scan(NULL,'scheduled') limited to documents and entries
  changed since the last successful run (pass p_since to each rule; rules that must see the whole
  ledger, such as A9/A10/C1, run only in the nightly job);
  guard-full nightly at 22:00 UTC (02:00 Baku): full scan with auto-resolve.
- A system_settings key 'accounting_guard' {enabled, incremental_minutes, nightly_hour_utc}; the
  scheduled job does nothing when enabled=false (default false, so merging changes nothing).
- Retention: delete auto_resolved findings and runs older than 365 days (configurable).
Rules tab gets a "Schedule" card to turn it on/off and see the next run (reads cron.job if present).
Tests: incremental scan only touches changed rows; the migration passes on a database without
pg_cron. Run npm run lint, npm test, npm run build.
PR description: exact steps for Del (enable pg_cron in Supabase dashboard, then run the SQL, then
switch it on in the Rules tab), on the test database first.
```


---

# پرامپت 22-GUARD-5

## پرامپت GUARD-5: ایجنت حسابدار حرفه‌ای (Claude)

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: add the AI accountant to the Accounting Guard: it reviews findings and the books like a senior
accountant, writes saved reports, and explains findings on request. Branch:
saas/accounting-guard-agent. Requires GUARD-1..4. Open a PR.

Flags: ACCOUNTING_GUARD_AI=true (off by default) + ANTHROPIC_API_KEY (already used by
src/lib/ai/native). Reuse src/lib/ai/native (router, store, usage log, tenant AI limits); read the
claude-api skill for current model ids. Default model: the standard tier; the monthly review uses the
deep tier. Every call is logged in ai_usage_log and counted against the tenant AI limit.

Behaviour
- Read-only tools only (new file src/lib/guard/agentTools.ts): list_findings, get_finding,
  get_document (sale/purchase/payment with lines and payments), get_journal_entry, partner_ledger,
  trial_balance(date range), account_movements, product_history, guard_rules. Every tool runs as the
  calling admin (or the service role for the scheduled job) and returns compact JSON. No tool can
  write business data.
- System prompt: a careful, sceptical chartered accountant for an Azerbaijani trading company (AZN,
  VAT 18%), double-entry, never invents numbers, cites finding ids and document numbers for every
  claim, separates "error" from "suspicious" from "probably fine", proposes the correct fix in
  accounting terms (e.g. reversal entry + correct entry, never deletion) but never performs it,
  and writes in the admin's UI language (az/en/ru).
- Daily report: new and still-open findings, ranked by risk and money at stake, likely cause,
  recommended action, plus anomalies the fixed rules miss (unusual partners, margins, cash patterns)
  from aggregated data. Monthly report: trial balance sanity, receivables/payables ageing, cash
  movements, margins, period-close readiness. Saved to guard_reports (body Markdown, summary JSON,
  model, tokens, cost). Suggested false positives are stored as suggestions on the finding; only an
  admin can confirm.
- "Ask the accountant" in the finding drawer and on the Reports tab: a chat bound to the guard
  tools, saved in ai_conversations.
- Scheduled run: POST /api/guard/agent (route handler, read the Next 16 route docs) with header
  Authorization: Bearer GUARD_CRON_SECRET (env, compared in constant time, never logged); 401
  otherwise. New workflow .github/workflows/accounting-guard.yml like tenant-usage.yml: daily 23:00 UTC,
  monthly on day 1, only on main, only when repository variable ACCOUNTING_GUARD_AI_ENABLED is
  'true', secret GUARD_CRON_SECRET and ERP base URL from secrets. A new report notifies admins (bell).
- Migration only if guard_reports needs columns GUARD-1 did not create (prefix checked first).

Tests: tools refuse writes and non-admins; route refuses a wrong secret; report rendering; a mocked
Claude client test of the report flow (no real API call in CI). Run npm run lint, npm test,
npm run build. PR description: env vars and GitHub secrets/variables Del must set (names only,
never values), expected monthly AI cost estimate, how to switch it off.
```
