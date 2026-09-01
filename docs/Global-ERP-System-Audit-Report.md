# Global ERP System Audit Report

**Project:** Del Groups ERP  
**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS · Supabase · PostgreSQL  
**Audit date:** August 29, 2026  
**Scope:** Database schema, RLS policies, server actions, client state, UI form handlers, API routes  
**Benchmarks:** Odoo, SAP Business One, ERPNext  

---

## Table of Contents

1. [Executive Architecture Rating](#1-executive-architecture-rating)
2. [Full Dependency & Constraint Matrix](#2-full-dependency--constraint-matrix)
3. [Accounting & Financial Flow Flaws](#3-accounting--financial-flow-flaws)
4. [Silent Failures & Unsafe Mutations](#4-silent-failures--unsafe-mutations)
5. [Actionable Technical Blueprint for Refactoring](#5-actionable-technical-blueprint-for-refactoring)
6. [Appendix: Layer-by-Layer Snapshot](#appendix-layer-by-layer-snapshot)

---

## 1. Executive Architecture Rating

### Overall Score: **5.8 / 10**

| Dimension | Score | Notes |
|-----------|-------|-------|
| Data model & constraints | 5.5 | Good production module design; core sales/finance tables lack FKs and UNIQUE guards |
| Transactional atomicity | 4.5 | Only 4 PostgreSQL RPCs; sales/purchases remain multi-step client mutations |
| Accounting integrity | 4.0 | Single-sided cash journal, not double-entry; AR/AP split across two fields |
| Module interconnectivity | 6.0 | Custom MTO delivery RPC is strong; Series production and standard sales are siloed |
| UI/UX & error surfacing | 6.5 | Production detail is best-in-class; sales/purchases still use `alert()` |
| Security (RLS/RBAC) | 7.0 | Permission-gated RLS on most tables; finance tables allow direct balance writes |

### Key Strengths

- **RBAC + RLS** on sales, purchases, inventory, production, consignment, and finance tables via `user_has_permission()`.
- **Custom MTO delivery** (`complete_custom_production_delivery_atomic`) is a proper cross-module atomic transaction: product SKU, stock, sale invoice, customer AR, advance cash, order closure.
- **Production costing model** in app code (`calcProductionCosting`) correctly rolls up materials + outsourcing + overhead + contractor fees.
- **Schema-resilience layer** (`safeQuery`, column-drop retries) shows awareness of live DB drift — pragmatic for incremental rollout.
- **Production UX** (preflight gates, sync delivery button, raw RPC error toasts, optimistic material rows with rollback) is ahead of other modules.

### Critical Bottlenecks

1. **Sales and purchases are not atomic** — the highest-volume financial paths use browser Supabase client with manual rollback, not PostgreSQL transactions.
2. **`submitSale` writes `transactions` but never updates `accounts.balance`** — cash accounts and the transaction journal diverge on every new invoice with payments.
3. **Dual AR tracking** — `sales.remaining_balance` vs `customers.balance` are updated by different code paths and can disagree.
4. **Live DB schema drift** — `production_materials` may lack `issued`, `line_cost`, `stage_no` on production DBs; app and RPC read different column sets → delivery blocked or COGS = 0.
5. **No global state store (Zustand)** — all state is local React `useState`; no shared cache, no dirty-form registry, no cross-page consistency layer.

---

## 2. Full Dependency & Constraint Matrix

### 2.1 Module Interconnectivity Map

```
Sales (sales + sale_items)
  ├─→ transactions (Mədaxil on payment) — accounts.balance NOT updated on create
  ├─→ customers.balance — NOT updated on credit sale via submitSale
  └─→ sales_commissions (pending until payroll)

Purchases (purchases + purchase_items)
  ├─→ products.stock (+qty)
  ├─→ suppliers.balance (+debt on create, -payment on pay)
  └─→ transactions (Məxaric on payment)

Production Custom (MTO)
  ├─→ production_materials → stock decrement on issue
  ├─→ production_expenses → create_production_expense_atomic → expenses + transactions
  └─→ Delivered → complete_custom_production_delivery_atomic
        ├─→ products (MTO SKU)
        ├─→ sales + sale_items
        ├─→ customers.balance (+remaining AR)
        ├─→ transactions + accounts (advance only)
        └─→ production_orders.sale_id, status=Delivered

Production Series
  ├─→ BOM → materials on create
  ├─→ Ready → incrementStandardStock (finished goods)
  └─→ Delivered → status label only (no sale, no RPC)

Finance
  ├─→ accounts.balance (denormalized cache)
  ├─→ transactions (single-sided journal)
  └─→ expenses (linked to accounts)
```

### 2.2 Preflight Gates by Module

| Module | Action | Required Preflight | Enforced Server | Enforced UI | Gap |
|--------|--------|-------------------|-----------------|-------------|-----|
| **Sales** | Create invoice | Customer, ≥1 line, stock | Partial (`submitSale`) | Customer + loose line check | No stock block; payments ≤ total unchecked; `accounts.balance` not updated |
| **Sales** | Record payment | Amount ≤ remaining, account | Yes | Yes | Non-atomic: sale updated before tx/account; account update errors ignored |
| **Purchases** | Create PO | Supplier, warehouse, lines | Yes | Supplier + warehouse only | Empty product lines fail only on server |
| **Purchases** | Record payment | Amount ≤ debt, account | Yes | Yes | Payment failure after stock/debt committed |
| **Production Custom** | Draft → In-Progress | Standard stock ≥ qty | Yes (standard only) | Implicit | Polywood stock not preflighted |
| **Production Custom** | Ready → Delivered | Customer, price > 0, all materials issued, advance account | RPC + server action | Strong preflight + confirm | Live DB may lack `issued` column → RPC `materials_pending` |
| **Production Series** | Ready | `finished_product_id` | Yes | Yes | — |
| **Production Series** | Delivered | None | Status flip only | None | No sale, no stock deduction — dead-end status |
| **Production** | Add expense | Account, amount ≥ 0 | RPC atomic | Basic | — |
| **Cash/Bank** | Create account | Name, type | Server | HTML `required` | No loading guard; fetch errors silent |
| **Payroll** | Process payroll | Account balance, commission IDs | RPC atomic | — | — |
| **Consignment** | Settlement | Partner inventory | Multi-step | Partial | Creates sale + customer balance without atomic RPC |
| **Inventory audit** | Apply adjustment | Audit items | Multi-step | Partial | No atomic RPC |
| **Warehouse slips** | Approve | Slip items | Multi-step | Partial | `source_document_id` has no FK |

### 2.3 Missing Database Constraints (Priority)

| Table.Column | Missing Constraint | Business Risk |
|--------------|-------------------|---------------|
| `sales.customer_id` | FK → `customers` | Orphan invoices |
| `sales.doc_no` | UNIQUE | Duplicate invoice numbers |
| `sale_items.product_id` | FK → `products` | Lines survive product deletion |
| `transactions` | FK to `sales` / `purchases` / `expenses` | Orphan ledger rows |
| `purchases.invoice_number` | UNIQUE (per supplier) | Duplicate AP documents |
| `products.code`, `products.barcode` | UNIQUE | Catalog duplicates |
| `products.stock` | CHECK ≥ 0 | Negative inventory under concurrency |
| `production_materials.quantity` | CHECK > 0 | Zero-qty material rows |
| `production_contractors.contractor_id` | FK | Untraceable labor cost |
| `warehouse_slips.source_document_id` | FK | Slips reference ghost documents |

### 2.4 Atomic RPC Inventory

| RPC | Status | Covers |
|-----|--------|--------|
| `create_expense_atomic` | ✅ Deployed | Expense + transaction + account debit |
| `process_payroll_atomic` | ✅ Deployed | Salary + commissions + transaction |
| `create_production_expense_atomic` | ✅ Deployed | Production expense + finance side |
| `complete_custom_production_delivery_atomic` | ✅ Deployed | Full Custom MTO delivery |
| `create_sale_atomic` | ❌ Missing | Sale + stock + AR + cash |
| `record_payment_atomic` | ❌ Missing | Document + transaction + balances |
| `create_purchase_atomic` | ❌ Missing | Purchase + stock + AP + cash |
| `issue_production_materials_atomic` | ❌ Missing | Stock + material issued + reservation |
| `apply_inventory_audit_atomic` | ❌ Missing | Audit + stock + voucher |

### 2.5 Production Status Machine

```
Draft → In-Progress → Ready → Delivered → (terminal)
```

| Transition | Side Effects |
|------------|--------------|
| Draft → In-Progress | `allocateOrderMaterials`: stock check + issue all pending materials |
| In-Progress → Ready | No material movement |
| Ready → Delivered (Custom) | `complete_custom_production_delivery_atomic` RPC |
| Ready → Delivered (Series) | Status update only |
| Series at Ready | `incrementStandardStock` if not yet posted |

---

## 3. Accounting & Financial Flow Flaws

### 3.1 Not Double-Entry — By Design, Below ERP Standard

The system uses a **single-sided cash journal** (`transactions`: `Mədaxil` / `Məxaric`) plus denormalized balances:

```
accounts.balance         ← manual updates (not derived from SUM(transactions))
customers.balance        ← partial AR cache
suppliers.balance        ← AP cache (more consistent than AR)
sales.remaining_balance  ← primary AR for dashboard
purchases.debt_amount    ← primary AP for dashboard
```

Odoo, SAP B1, and ERPNext maintain journal entries with debit/credit pairs, receivable/payable GL accounts, and reconciliation reports. **This ERP does not.**

### 3.2 Sales Flow — Ledger Breaks on Creation

**Path:** `InvoiceForm` → `src/lib/sales/submitSale.ts`

| Step | What Happens | Problem |
|------|--------------|---------|
| 1 | Insert `sales` with `remaining_balance` | Credit sales set header AR but **not** `customers.balance` |
| 2 | Insert `sale_items`, decrement stock | OK with rollback |
| 3 | Insert `transactions` for each payment | **Does not update `accounts.balance`** |
| 4 | `recordSaleCommissions` | Failure logged only; sale still succeeds |

**Impact:** Financial report (`fetchFinancialReport`) sums `transactions`; cash-bank page shows `accounts.balance`. After a paid sale, journal shows inflows but account balances are stale until a separate `recordSalePayment` call.

### 3.3 Payment Recording — Document-First, Non-Atomic

**Path:** `src/lib/sales/recordSalePayment.ts` / `src/lib/purchases/recordPurchasePayment.ts`

```
1. UPDATE sales/purchases (paid_amount, remaining_balance/debt)  ← committed
2. INSERT transactions
3. UPDATE accounts.balance          ← errors not checked
4. UPDATE customers/suppliers.balance ← errors not checked
```

- If step 2 fails → document shows paid, no cash entry.
- If step 3 fails → transaction exists, account balance wrong.

### 3.4 Purchase Flow — Partial Rollback

**Path:** `src/lib/purchases/submitPurchase.ts`

Stock and supplier debt are committed before payments. If `processPurchasePayments` fails, the purchase exists with increased stock and AP but no payment transactions.

### 3.5 Opening Balances — No Journal

**Path:** `src/lib/actions/initialSetup.ts` / `createAccountAction`

Sets `accounts.balance` directly with no opening `transactions` row. Cash-bank balance and transaction history will never reconcile to zero at go-live.

### 3.6 AR/AP Reconciliation Matrix

| Event | `sales.remaining_balance` | `customers.balance` | `transactions` | `accounts.balance` |
|-------|---------------------------|---------------------|----------------|-------------------|
| Credit sale (`submitSale`) | ✅ Set | ❌ Not updated | ❌ No AR entry | — |
| Sale with cash (`submitSale`) | ✅ Set | ❌ | ✅ Mədaxil inserted | ❌ Not updated |
| Follow-up payment | ✅ Updated | ✅ Decremented | ✅ | ✅ (unchecked) |
| Production delivery RPC | ✅ On sale row | ✅ Incremented | ✅ Advance only | ✅ Advance only |
| Consignment settlement | ✅ | ✅ Incremented | ❌ No credit tx | — |
| Dashboard AR KPI | Sums `remaining_balance` | — | — | — |
| Customer page | — | Shows `balance` | — | — |

**Result:** Customer master balance and open-invoice sum can disagree.

### 3.7 COGS & Revenue Recognition

| Flow | Revenue | COGS | Inventory |
|------|---------|------|-----------|
| Standard retail sale | On invoice | Not posted to GL; `buy_price` on product only | Stock decremented |
| Custom MTO delivery | Sale RPC at Delivered | Embedded in `sale_items.extra_info` + product `buy_price` | Net-zero stock bump (receipt + issue) |
| Series production | Not at production Delivered | Calculated in UI only | FG posted at Ready; no auto-deduct at Delivered |

Production profitability card is **management accounting**, not posted to a general ledger.

### 3.8 Finance Write Paths Summary

| Path | Atomic? | Updates |
|------|---------|---------|
| `create_expense_atomic` | Yes (RPC) | `expenses` + `transactions` + `accounts.balance` |
| `process_payroll_atomic` | Yes (RPC) | `salary_payments` + `sales_commissions` + `transactions` + `accounts.balance` |
| `create_production_expense_atomic` | Yes (RPC) | `production_expenses` + `expenses` + `transactions` + `accounts.balance` |
| `complete_custom_production_delivery_atomic` | Yes (RPC) | sale + items + stock + customer balance + transaction + account + order |
| `submitSale` (app) | Manual rollback | sales + items + stock + transactions — **does NOT update `accounts.balance`** |
| `submitPurchase` (app) | Partial rollback | purchase + items + stock + supplier balance + transactions + accounts |
| `recordSalePayment` / `recordPurchasePayment` (app) | Multi-step, no TX | document + transaction + account (+ customer/supplier balance) |

---

## 4. Silent Failures & Unsafe Mutations

### 4.1 Critical (Financial / Data Corruption)

| ID | Location | Failure Mode | User Sees |
|----|----------|--------------|-----------|
| C1 | `src/lib/sales/submitSale.ts` L165–186 | Payment transactions without `accounts.balance` update | Success alert; cash account wrong |
| C2 | `src/lib/sales/recordSalePayment.ts` L66–80 | Account/customer update errors ignored | Payment appears saved; balances drift |
| C3 | `src/lib/purchases/submitPurchase.ts` | Payment step fails after stock + AP committed | Error alert; orphan purchase with stock |
| C4 | `updateProductionStatusAction` (Series Delivered) | Status set without business outcome | "Delivered" with no invoice or stock movement |
| C5 | Live DB without `production_materials.issued` | RPC blocks delivery; app/RPC disagree on issue state | Silent until sync button; raw RPC toast |
| C6 | `issueMaterialRow` with null `product_id` | Marks `issued=true`, no stock movement | Delivery RPC may pass with phantom materials |

### 4.2 High (Silent / Degraded)

| ID | Location | Failure Mode |
|----|----------|--------------|
| H1 | `src/app/cash-bank/page.client.tsx` fetch | Supabase errors ignored → empty lists |
| H2 | `recordSaleCommissions` | `console.error` only on failure |
| H3 | Reservation consume after stock issue | Error ignored; reservation stays `reserved` |
| H4 | `saveProductionContractAction` | Missing table → synthetic success, contract not persisted |
| H5 | `loadOrderBundleRelational` | Missing expense/contract tables → empty arrays, no error |
| H6 | Two sale pipelines | `submitSale` (main) vs `post_sale` RPC (consignment legacy) |
| H7 | `decrementStandardStock` | Read-modify-write without `FOR UPDATE` → race oversell |

### 4.3 Medium (UX / State Divergence)

| ID | Location | Failure Mode |
|----|----------|--------------|
| M1 | Sales/Purchases success | `saleId`/`purchaseId` returned but UI navigates to list only |
| M2 | No dirty-form guards | Close/cancel loses unsaved header edits |
| M3 | Production detail `run()` | Most actions set banner only, no toast |
| M4 | Production create wizard | Steps skippable; materials not required before submit |
| M5 | `ProductionOrderModal.close()` | Resets form without confirm |
| M6 | `InvoiceForm` | Stock shown but submit not blocked when insufficient |

### 4.4 Unsafe Mutation Patterns

```
❌ Client-side multi-step Supabase (no transaction boundary)
❌ Document UPDATE before cash-side INSERT
❌ Denormalized balance UPDATE without error handling
❌ Best-effort manual rollback (delete rows) vs ROLLBACK
❌ JSONB line items (writeoffs, audits, slips) with no referential integrity
✅ PostgreSQL RPC with FOR UPDATE + permission checks (production, expenses, payroll)
```

### 4.5 UI Feedback Patterns

| Pattern | Used In | Issue |
|---------|---------|-------|
| `alert()` | Sales, Purchases, Cash-Bank | Blocking, not localized toast; no success deep links |
| `useToast` (error only) | Production detail, barcode scans | No success variant |
| Inline banner | Production detail | Good for persistent errors |
| `formatProductionDbError` | Production module only | Sales/purchases lack equivalent |

---

## 5. Actionable Technical Blueprint for Refactoring

### Phase 0 — Stabilize (1–2 weeks) · Do Now

| Priority | Task | Files / SQL |
|----------|------|-------------|
| P0.1 | Run full production migration on Supabase: `issued`, `line_cost`, `stage_no`, delivery columns | `types/production-materials-fix.sql`, `types/production-delivery-migration.sql` |
| P0.2 | Fix `submitSale` account balance — after each payment tx, increment `accounts.balance` (or route through RPC) | `src/lib/sales/submitSale.ts` |
| P0.3 | Fix `recordSalePayment` / `recordPurchasePayment` — check all update errors; update document last or use RPC | `src/lib/sales/recordSalePayment.ts`, `src/lib/purchases/recordPurchasePayment.ts` |
| P0.4 | Unify AR on credit sale — on `submitSale`, if `remaining_balance > 0`, increment `customers.balance` | `src/lib/sales/submitSale.ts` |
| P0.5 | Replace `alert()` with toast system in sales, purchases, cash-bank | `src/components/InvoiceForm.tsx`, `src/components/purchases/PurchaseForm.tsx`, `src/app/cash-bank/page.client.tsx` |
| P0.6 | Add UNIQUE on `sales.doc_no` | New migration SQL |

### Phase 1 — Atomic Core (3–5 weeks)

| Priority | Task | Pattern |
|----------|------|---------|
| P1.1 | `create_sale_atomic` RPC | sale + items + stock + transactions + accounts + customer AR + commissions in one TX |
| P1.2 | `record_payment_atomic` RPC | Shared by sales and purchases; document + tx + balances |
| P1.3 | `create_purchase_atomic` RPC | purchase + items + stock + supplier AP + payments |
| P1.4 | `issue_production_material_atomic` RPC | `FOR UPDATE` on product; material issued + reservation consumed |
| P1.5 | Migrate client calls from browser `supabase` to server actions calling RPCs | `src/lib/sales/*`, `src/lib/purchases/*` |

**Target RPC signature:**

```sql
CREATE FUNCTION create_sale_atomic(p_payload JSONB) RETURNS JSONB;
-- Returns: { sale_id, doc_no } or raises with ERRCODE
```

### Phase 2 — Schema Hardening (2–3 weeks)

| Task | Detail |
|------|--------|
| FK enforcement | `sales.customer_id`, `sale_items.product_id`, `transactions.sale_id` |
| Balance guards | Trigger: forbid direct `accounts.balance` UPDATE outside SECURITY DEFINER RPCs |
| Stock guards | `CHECK (stock >= 0)` + row locks in all stock mutators |
| Consolidate `schema.sql` | Full DDL for legacy core tables (currently alter-only) |
| Bidirectional production↔sales | Single canonical link + trigger to keep `sale_id` / `production_order_id` in sync |

### Phase 3 — Module Interconnectivity (3–4 weeks)

| Module | Rule to Implement |
|--------|-------------------|
| Series production Delivered | Auto-create internal transfer/sale or block Delivered until linked retail invoice exists |
| Standard sales COGS | On sale post: journal Məxaric (COGS) / reduce inventory asset |
| Consignment settlement | Route through `create_sale_atomic`; remove `post_sale` legacy path |
| Warehouse slips | Typed FK on `source_document_id`; approve via RPC |
| Inventory audit | `apply_inventory_audit_atomic` |
| Commission accrual | Fail sale RPC if commission insert fails, or queue with explicit flag |

### Phase 4 — UX / Workflow (Ongoing)

| Task | Standard to Match |
|------|-------------------|
| Extend `useToast` with `showSuccess` + deep-link actions | ERPNext: "Sales Invoice SI-001 created → View" |
| Dirty-form registry (`beforeunload` + route guard) | Odoo unsaved changes warning |
| `useTransition` / `isPending` on all submit buttons | Eliminate double-submit (cash-bank today) |
| Inline field validation mirroring server rules | Fail before network round-trip |
| Global `formatDbError()` (generalize `formatProductionDbError`) | AZ/EN localized schema errors |
| Production list: format errors; success toast on status advance | Parity with detail page |

### Phase 5 — Reporting & Reconciliation (Later)

| Deliverable | Purpose |
|-------------|---------|
| AR aging report | `sales.remaining_balance` grouped by customer/date |
| Cash reconciliation | `SUM(transactions WHERE account_id=X)` vs `accounts.balance` |
| Stock valuation | `SUM(stock × buy_price)` vs inventory asset |
| Production COGS bridge | Compare `calcProductionCosting` vs delivery RPC `unit_cogs` |

---

## Appendix: Layer-by-Layer Snapshot

| Layer | Finding |
|-------|---------|
| **Database** | Incremental migrations in `types/`; 4 atomic RPCs; weak FKs on core sales/finance |
| **RLS** | Broad coverage via `security-rls-migration.sql`; finance tables allow balance writes that bypass RPC intent |
| **Server actions** | Production/expenses/payroll solid in `src/lib/actions/`; sales/purchases remain client-lib |
| **Zustand** | **Not used** — local React `useState` only |
| **API routes** | 3 routes (`api/users/invite`, `api/public-config`, `api/users/[id]`) — business logic not in REST API |
| **UI** | Production detail = reference implementation; sales/purchases = legacy `alert()` pattern |

### Key File Reference

| Domain | Primary Files |
|--------|---------------|
| Schema | `types/schema.sql`, `types/finance-mutations.sql`, `types/production-delivery-migration.sql` |
| Sales | `src/lib/sales/submitSale.ts`, `src/lib/sales/recordSalePayment.ts`, `src/components/InvoiceForm.tsx` |
| Purchases | `src/lib/purchases/submitPurchase.ts`, `src/lib/purchases/recordPurchasePayment.ts` |
| Production | `src/lib/actions/production.ts`, `src/lib/production/delivery.ts`, `src/app/production/[id]/page.client.tsx` |
| Finance | `src/lib/actions/finance.ts`, `src/lib/actions/payroll.ts`, `src/app/cash-bank/page.client.tsx` |
| Reports | `src/lib/reports/fetchFinancialReport.ts`, `src/lib/dashboard/fetchDashboard.ts` |
| Error formatting | `src/lib/production/payloads.ts` (`formatProductionDbError`) |

### Immediate Actions for Production Delivery Issues

1. Confirm Supabase has `complete_custom_production_delivery_atomic(UUID, UUID)` deployed.
2. Confirm `production_materials.issued` column exists and all lines show issued before Delivered.
3. Use **Sync Delivery** button on order detail and read the raw `Təhvil xətası:` toast.
4. If status is Delivered without `sale_id`, sync action resets to Ready then re-runs RPC (repair path).

---

*Report generated from codebase audit of Del Groups ERP repository.*  
*Canonical schema reference: `types/schema.sql`*
