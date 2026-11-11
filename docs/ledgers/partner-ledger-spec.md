# Partner ledger (LED-1): every flow that changes a partner balance

One source of truth for what a business partner (customer, supplier or both) owes us or we owe
them: the view `public.partner_ledger_movements`
(`supabase/migrations/20261111100000_partner_ledger.sql`). Partner statements, the
reconciliation act, debtor/creditor reports (LED-4) and aging (LED-5) read it. Read-only: this
PR changes no balance, journal or document.

**Sign rule.** `debit` = the partner owes us more (sales invoice, money we paid them). `credit` =
we owe them more, or they paid us (purchase invoice, import payable, money received).
Balance = `SUM(debit - credit)`: positive = debtor (owes us), negative = creditor (we owe them).
Amounts are AZN with 2 decimals.

**Partner.** `partners.id`. Rows that carry a customer or supplier id are resolved with
`_partner_ledger_partner(customer_id, supplier_id)`: the live partner linked to it, else a deleted
(merged-away) one, so a deleted partner keeps its invoices and opening balance next to its payments.

**Side.** For a partner who is both customer and supplier, statements and balances can show one side:
customer side (`receivable`: customer opening balance, sales, their payments, production advances) or
supplier side (`payable`: supplier opening balance, purchases, their payments, imports). A partner
payment goes to the partner's own side (a refund from a supplier stays on the supplier side); only for
a partner who is both does its direction decide (in → customer side, out → supplier side).

**Date.** The date users chose for the document or payment (doc_date, payment date, document
date), never `created_at`, except where no such date exists (noted below).

**Status rule for documents.** Drafts (`status = 'draft'`) and cancelled documents
(`cancelled`, `void`, `voided`, `deleted`, `ləğv edildi`, `legv edildi`; the same list as
`isInvoiceCancelled` in src/lib/invoices/invoiceStatus.ts) are left out. Their cash is handled by
the cash rule below, so a cancelled-after-posting invoice nets to zero.

## Flows

| # | Flow | Where (file, function) | In the ledger as | Side |
|---|---|---|---|---|
| 1 | Customer opening balance | `set_customer_opening_balance_atomic` (baseline 04_functions; GL `customer_opening_balance` on 1200/3900) | `customers.opening_balance`, one row `opening_customer` | debit if > 0, credit if < 0 |
| 2 | Supplier opening balance | `set_supplier_opening_balance_atomic` (GL `supplier_opening_balance` on 3900/2100) | `suppliers.opening_balance`, one row `opening_supplier` | credit if > 0 (we owe), debit if < 0 |
| 3 | Posted sales invoice | `process_sales_invoice_event`, `post_sale_invoice_gl_journal`; sales rows also come from production delivery (`process_production_delivery_event`), consignment settlement (`settle_consignment_partner_atomic`) and polywood (`process_mixed_dimensional_sale`) | `sales.total_amount` (AZN, lines converted with their rates), dated `doc_date` | debit |
| 4 | Posted purchase invoice | purchase submit + `post_purchase_bill_gl_journal` | `purchases.total_amount`, dated `doc_date` | credit |
| 5 | Invoice cancelled / voided after posting | `cancel_sales_invoice_atomic` → `_reverse_sales_invoice_posting` (cash reversed with `reverse_document_cash_transactions`), `void_sale_atomic`, `void_sale_invoice`, purchase void | invoice left out; its payments and their storno rows both stay, so they net to zero. A payment that was never refunded stays as the partner's credit (correct: the money is still with us) | — |
| 6 | Amended posted invoice (revision) | `amend_posted_sales_invoice`, `amend_posted_purchase_invoice` (20261029100000_backdated_invoices_payments.sql; history in `invoice_amendments`) | the invoice at its **current** `total_amount` and `doc_date`; payments re-posted by the amendment show as storno + new payment rows. Earlier revisions are not shown as separate lines (history stays in `invoice_amendments`) | — |
| 7 | Invoice payment, single account, also a payment made in the invoice form ("paid at creation") | `process_invoice_payment_event`, `post_sales_invoice_draft`, `post_purchase_invoice_draft`, `process_sales_invoice_event` → `post_cash_transaction(account, type, amount, category, notes, NULL, 'sale' / 'purchase', invoice id)` | `transactions` with **`source_type`** `sale` / `purchase` and `source_id` = the invoice (older rows: `reference_type` / `reference_id`), dated `transaction_date` (Baku), AZN. Rows whose category starts with "Əlavə Xərc" (extra costs paid with the invoice to third parties, `apply_document_additional_expenses`) are left out | money in: credit; money out: debit |
| 8 | Invoice payment, several accounts | `process_invoice_payment_event` → `_post_payment_lines` (multi-line, 20261105100000_imports_stages_pay.sql), which writes `source_type` / `source_id` only | one `transactions` row per account, same as 7 | same as 7 |
| 9 | Invoice payment reversed (storno) | `reverse_document_cash_transactions`: a new row `reference_type = 'storno'`, `reference_id` = the reversed row, type swapped | the storno as an opposite movement, dated its own date | opposite of the payment |
| 10 | Partner payment in / out (not tied to an invoice) | `create_partner_payment` → `public.payments` + `transactions` (`reference_type = 'partner_payment'`), GL 1200 / 2100 | `public.payments`, dated `payment_date` (Baku) | `in`: credit; `out`: debit |
| 11 | Import: supplier goods payable | `confirm_import_shipment` → `import_payables` (source goods), GL 2100 credit with partner | GL line on 2100 with partner (entry `document_type` `import_*`) | credit |
| 12 | Import: cost line payable to its own partner (customs broker, carrier…) | `add_import_cost`, `confirm_import_shipment`, `finalize_import_cost`, `apply_late_import_cost` (`_imports_cost_lines`) → `import_payables` per cost line | GL line on 2100 with partner | credit |
| 13 | Import: payment of a payable (one or more accounts, FX) | `pay_import_payable` → `import_payments` + `import_payment_splits` + **also** `public.payments` rows (their `transaction_id` points at a cash row with an `import_…` source) | GL line on 2100 = `settled_azn` (the part of the payable it closes); the FX difference goes to 6260 / 4960, not to the partner. The `public.payments` copies are **left out** (they would count the payment twice, at the cash amount) | debit |
| 14 | Import: supplier prepayment / cost advance (draft shipment) | `prepay_import_supplier`, `pay_import_cost_advance` → `_imports_advance_post` → `import_prepayments` + `public.payments` (`'import_prepayment:…'`, `'import_cost_advance:…'`) | GL line on 2100 (debit at the prepayment rate); the `public.payments` copies left out | debit |
| 15 | Import: prepayment applied at confirmation, FX correction of a cost advance | `confirm_import_shipment` (status `applied`, payable `paid_azn`; correction line "Xərc avansı, məzənnə fərqi" on 2100) | GL lines on 2100 as posted | as posted |
| 16 | Import shipment cancelled | `cancel_import_shipment`: payables and prepayments `cancelled`, cash reversed, every entry reversed with `reverse_journal_entry` (same `document_type`, partner kept, debit/credit swapped) | the reversal entries cancel the originals | nets to zero |
| 17 | Consignment | `create_consignment_dispatch_atomic` (stock only), `settle_consignment_partner_atomic` (creates a **sales invoice** for the consignment partner's customer) | via flow 3 | debit |
| 18 | Production orders charged to a customer | `process_production_delivery_event` creates a **sales invoice** (flow 3); its GL line passes `customers.id` as partner (LED-2) | via flow 3 | debit |
| 19 | Returns | no sales/purchase return document exists; `consignment_returns` moves stock only | — | — |
| 20 | Expenses with a supplier | `expenses.supplier_id` is informational; expenses are paid in cash and never post to 2100 | not in the ledger | — |
| 22 | Production order advance from the customer | `process_production_advance_payment_event`, `process_production_delivery_event` → `post_cash_transaction(..., 'Satış Ödənişi', ..., order id, 'production', order id)`; the delivery then creates the sales invoice (flow 3) | `transactions` with `source_type = 'production'`, partner = the order's customer. Production **expenses** use `production_expense` and are not partner money | credit |
| 21 | Partner merge | `merge_partners`: points the source partner's sales/purchases (by customer/supplier id) and the customer/supplier ids to the target, marks the source deleted | invoices follow the target | — |

## Ambiguous or incomplete (please confirm)

0. **The task text says invoice payments carry `reference_type 'sale' / 'purchase'`; they do not.**
   `post_cash_transaction` and `_post_payment_lines` write `source_type` / `source_id` only
   (checked on a database built from the repo: a payment made in the invoice form has
   `reference_type` NULL, `source_type` 'sale'). The ledger reads both, so older rows that do have
   `reference_type` also count.

1. **Merge leaves payments behind.** `merge_partners` does not move `public.payments`,
   `import_payables`, `import_prepayments` or GL lines, and when both partners had a customer (or
   supplier) the source keeps its own. No column records which partner it was merged into. The
   ledger keeps all of these on the deleted partner (its invoices, opening balance and payments
   together); `get_partner_balances` lists such a partner while its balance is not zero (flag
   `is_deleted`). Fixing merge is outside LED-1.
2. **Opening balance date.** Opening balances store no date (each change posts a GL entry dated
   the day it was set). They are what was owed before the ERP, so the ledger dates them
   1900-01-01: they come before every movement and are part of every as-of balance. A later edit
   of an opening balance therefore also changes past as-of balances (there is no history of it).
3. **Manual treasury receipts.** A cash-in with a "Satış…" category that is not tied to an invoice
   or a partner payment posts to 1200 (`coa_credit_for_cash_in`) with no partner
   (`transactions.counterparty_id` is never written). It cannot be attributed to a partner, so it
   is not in the ledger; it shows up as GL 1200 without a partner in the integrity check.
4. **Imports come from the GL.** Imports are the only flow whose journal lines always carry
   `partners.id` (`_imports_line` with `resolve_unified_partner_id`), and the GL is the only place
   with the exact amounts (settled AZN, FX corrections of cost advances). If a supplier has no
   partners row, its import lines have no partner and are not in the ledger (integrity check:
   GL without partner).
5. **Invoice currency.** Sales and purchase totals are AZN (lines converted with their rates).
   `currency_code` / `amount_fc` / `rate` are informational: the invoice header currency and rate
   (`amount_fc = total / rate`) when it is not AZN. Import rows carry the payable / payment /
   prepayment currency, amount and rate when the journal entry belongs to exactly one of them.
6. **Invoice payment rows before source linkage.** `transactions` rows written before
   `reference_type` existed are not tied to an invoice; they are not in the ledger (the invoice
   then shows as unpaid in the statement while `remaining_balance` says paid). The integrity
   check shows the difference against `compute_partner_net_balance`.
8. **Advance without a link.** `complete_custom_production_delivery_atomic` books an advance
   (`Mədaxil`, "Satış Ödənişi") with no source, reference or order id, so it cannot be attributed to
   a customer; it is not in the ledger. Its GL line has no partner either.
7. **Cash on draft or cancelled invoices.** A draft never posts cash; if one did, its cash rows
   still count (money really moved), and the draft itself does not. A cancelled invoice's cash
   counts with its storno rows, so it nets to zero when the money was returned.

## Known differences with today's numbers (expected, not errors)

- `compute_partner_net_balance` sums `remaining_balance` of open invoices and only matches
  `partner_id` (not customer/supplier ids); it has no opening balance, no partner payments and
  no imports. The new ledger includes all of them.
- `get_partner_reconciliation_act` adds `public.payments` (which includes the import payment
  copies, see flow 13) but misses invoice payments, opening balances and imports.
- The GL (1200/2100 by `partner_id`) misses invoice payments (no partner) and uses `customers.id`
  for opening balances and production deliveries: fixed in LED-2.

`check_partner_ledger_integrity()` and `supabase/scripts/partner_ledger_check.sql` show all three
side by side with the deltas.

## The integrity check as a control

`check_partner_ledger_integrity()` / `supabase/scripts/partner_ledger_check.sql` is a **detective,
IT-dependent manual control** over receivables and payables (assertions: completeness, accuracy,
existence of partner balances).

- **What it tests:** per partner, the ledger balance against today's stored balance and the GL
  control accounts 1200 / 2100; plus GL movement on 1200 / 2100 that names no partner.
- **When:** once after this migration (baseline), then monthly after closing the month, and after
  any data fix to partners, invoices or payments.
- **Who:** run by the accountant, reviewed by Del (two different people).
- **Evidence to keep:** the three result sets exported with the run date, the reviewer's name and
  date, and a note per partner difference: expected (one of the known causes above: LED-2 partner
  ids, stored balance without imports / payments / opening balance) or an error to fix.
- **Differences:** expected ones should shrink to zero once LED-2 is applied. A difference
  without a known cause is investigated before the month is closed; one older than 60 days goes to
  Del.
