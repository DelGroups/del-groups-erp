# Database & ERP Integration Audit Report

**Project:** Del Groups ERP  
**Date:** September 1, 2026  
**Scope:** Live Supabase (`cuppxakkeetejwyxelml`) schema, RPC layer, TypeScript integration  
**Migrations applied:** `20260901113000_finance_expenses_source_linkage`, `20260901114000_db_audit_fixes`

---

## Executive summary

A full cross-check of TypeScript RPC callers against the live PostgreSQL schema found **five critical gaps** that would cause runtime failures or silent ledger drift. All were patched in migration `20260901114000_db_audit_fixes` and one TypeScript fix (`submitPurchase.ts`). **`npm run build` passes.** Migration history is synchronized with the remote database.

| Area | Before | After |
|------|--------|-------|
| Production permission checks | `user_has_permission()` **missing** on DB | Alias to `has_permission()` created |
| Warehouse polywood filter | App reads `warehouse_type`; DB had only `is_polywood` | `warehouse_type` added + backfilled |
| Transaction production link | `production_order_id` column missing | Column + FK + index added |
| Performance indexes | Several join columns unindexed | Indexes on journal, line items, warehouses |
| RPC privileges | `service_role` lacked EXECUTE on many RPCs | Dynamic GRANT for all deployed overloads |

---

## 1. Schema & code alignment audit

### 1.1 Sales (`submitSale.ts` → `process_sales_invoice_event`)

| Payload field | RPC expectation | Status |
|---------------|-----------------|--------|
| `idempotency_key` | Idempotency via `erp_events` | ✅ Aligned |
| `header.*` totals | `total_amount`, `paid_amount`, `remaining_balance` | ✅ Aligned |
| `items[]` product/warehouse/polywood fields | `sale_items` insert + stock demand | ✅ Aligned |
| `payments[]` | `post_cash_transaction` with `source_type='sale'` | ✅ Aligned (migration 113000) |
| `additional_expenses[]` | `apply_document_additional_expenses` | ✅ Aligned |

**Idempotency:** Safe retries — duplicate `idempotency_key` returns cached `erp_events.result`.

### 1.2 Purchases (`submitPurchase.ts` → `process_purchase_receipt_event`)

| Payload field | RPC expectation | Status |
|---------------|-----------------|--------|
| `idempotency_key` | Event deduplication | ✅ Aligned |
| `header.debt_amount` | Must equal `total - paid` | ✅ Validated in RPC |
| `additional_expenses[]` | Landed costs + immediate cash | ✅ Aligned |
| **Edit flow payments** | `post_cash_transaction` + `source_type` | ⚠️ **Fixed in TS** — edit payments now pass `sourceType: 'purchase'` |

**Note:** `updatePurchase()` remains multi-step (not atomic). New purchases use the event RPC; edits still use client-side stock/supplier adjustments.

### 1.3 Payments (`recordSalePayment.ts` / `recordPurchasePayment.ts`)

| Payload field | RPC expectation | Status |
|---------------|-----------------|--------|
| `idempotency_key` | Per-payment key | ✅ Aligned |
| `document_type` | `sale` \| `purchase` | ✅ Aligned |
| `account_id` (UUID string) | Cast to UUID in RPC | ✅ Aligned |
| Cash + journal | `post_cash_transaction` + journal linkage | ✅ Aligned |

### 1.4 Production (`production.ts` / `delivery.ts`)

| RPC | TS caller | Status |
|-----|-----------|--------|
| `process_production_material_issue_event(order_id, material_ids?, update_status?)` | `production.ts` admin client | ✅ Signature match |
| `process_production_ready_event(order_id)` | `production.ts` | ✅ Aligned |
| `process_production_delivery_event(order_id, account_id?)` | `delivery.ts` | ✅ Aligned |
| `create_production_expense_atomic(...)` | `production.ts` | ✅ Aligned |

**Critical fix:** All production RPCs called `user_has_permission()` which **did not exist** on the live DB (only `has_permission()`). Production material issue, ready, delivery, and expense RPCs would fail with `function does not exist` for non-Admin paths.

### 1.5 Finance ledger (`accountLedger.ts`)

| RPC | Parameters | Status |
|-----|------------|--------|
| `post_cash_transaction` | 8-arg overload with `p_source_type`, `p_source_id` | ✅ Both overloads granted |
| `reconcile_account_balance_atomic` | `p_account_id` optional | ✅ Aligned |

**Live DB gap fixed:** `transactions.production_order_id` was missing although `post_cash_transaction` inserts it. Column and FK added in audit migration.

### 1.6 Outstanding code/schema gaps (not patched in this pass)

| Issue | Risk | Recommendation |
|-------|------|----------------|
| `consignments/InvoiceForm.tsx` calls `post_sale` RPC | **RPC not in schema** — consignment invoicing will fail | Migrate to `process_sales_invoice_event` or restore legacy RPC |
| `resolve_coa_id()` not on live DB | Journal COA resolution may use alternate path inside `post_journal_entry` | Deploy `chart-of-accounts-migration.sql` if COA errors appear |
| `create_expense_atomic` / `process_payroll_atomic` not deployed | Finance/payroll actions will fail when used | Add migration when module goes live |
| `updatePurchase()` non-atomic | Partial failure can drift stock/AP | Implement `update_purchase_atomic` event |

---

## 2. Critical database errors fixed

### 2.1 `user_has_permission()` missing

- **Symptom:** Production RPCs and RLS policies reference `user_has_permission`; live DB only had `has_permission`.
- **Fix:** `CREATE FUNCTION user_has_permission(perm) → has_permission(perm)` with `SECURITY DEFINER`.

### 2.2 `warehouses.warehouse_type` vs `is_polywood`

- **Symptom:** App filters polywood warehouses via `warehouse_type = 'polywood'`; live DB only had boolean `is_polywood`.
- **Fix:** Added `warehouse_type TEXT`, backfilled from `is_polywood`, default `general`.

### 2.3 `transactions.production_order_id`

- **Symptom:** `post_cash_transaction` and production expense paths expect production linkage column.
- **Fix:** Added nullable UUID column, FK to `production_orders` `ON DELETE SET NULL`, partial index.

### 2.4 Foreign keys

- `sale_items.product_id` — FK already present (`fk_sale_items_product`).
- `purchase_items.product_id` — FK added where missing (`ON DELETE RESTRICT`).

### 2.5 Sub-ledger sync (verified design)

| Function | Source of truth | Drift control |
|----------|-----------------|---------------|
| `refresh_customer_ar_balance` | `SUM(sales.remaining_balance)` | Called after sale create/payment/void |
| `refresh_supplier_ap_balance` | `SUM(purchases.debt_amount)` | Called after purchase receipt/payment |
| `reconcile_account_balance_atomic` | `SUM(transactions)` per account | Admin reconciliation RPC |
| `post_cash_transaction` | Updates `accounts.balance` + journal | Single atomic function |

**Idempotency:** `erp_events.idempotency_key` unique index + `find_erp_event_by_idempotency` on all major event processors.

### 2.6 SECURITY DEFINER & GRANT EXECUTE

- Financial mutation RPCs granted to **`authenticated`** and **`service_role`** (admin/server actions).
- **`anon`** intentionally excluded from mutation RPCs.
- Dynamic grant loop covers all overloads (e.g. dual `post_cash_transaction` signatures).

---

## 3. Performance indexes added

| Index | Table | Purpose |
|-------|-------|---------|
| `idx_journal_entries_source` | `journal_entries` | Source document lookups |
| `idx_journal_entry_lines_entry` | `journal_entry_lines` | Line expansion by entry |
| `idx_sale_items_sale_id` | `sale_items` | Invoice line fetch |
| `idx_sale_items_product_id` | `sale_items` | Product sales history |
| `idx_purchase_items_purchase_id` | `purchase_items` | Purchase line fetch |
| `idx_purchase_items_product_id` | `purchase_items` | Product purchase history |
| `idx_warehouses_warehouse_type` | `warehouses` | Warehouse type filter |
| `idx_warehouses_is_polywood` | `warehouses` | Legacy polywood flag (partial) |
| `idx_warehouses_polywood_type` | `warehouses` | Polywood type filter (partial) |
| `idx_transactions_production_order` | `transactions` | Production cost queries |

**Already present (prior migration):** `idx_transactions_source`, `idx_erp_events_idempotency`, `idx_production_orders_status`.

---

## 4. Deployment record

| Step | Result |
|------|--------|
| `supabase/migrations/20260901114000_db_audit_fixes.sql` | Applied to live DB |
| `supabase migration repair --status applied 20260901114000` | History synchronized |
| `npx supabase db push` | Intermittent connection errors; SQL applied via `db query` + repair |
| `npm run build` | ✅ Success |

---

## 5. TypeScript changes in this audit

**`src/lib/purchases/submitPurchase.ts`**

- `processPurchasePaymentsOnEdit` now passes `sourceType: 'purchase'` and `sourceId: purchaseId` into `postCashTransaction` so edit-flow payments link to the purchase document in `transactions.source_*` columns.

---

## 6. Recommended follow-ups

1. Deploy `types/chart-of-accounts-migration.sql` + `resolve_coa_id` if journal posting errors reference missing COA codes.
2. Replace consignment `post_sale` RPC with `process_sales_invoice_event` or add legacy RPC.
3. Implement atomic `update_purchase_atomic` / `update_sale_atomic` events.
4. Add `warehouse_type` to canonical `types/schema.sql` alongside `is_polywood` for documentation parity.
5. Schedule periodic `reconcile_customer_ar_balances()` and `reconcile_account_balance_atomic()` in admin settings.

---

*Generated by automated schema/code audit — Del Groups ERP engineering.*
