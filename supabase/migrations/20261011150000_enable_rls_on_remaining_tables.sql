-- Turn on row level security for every public table that still had it off.
--
-- Verified on production 2026-10-11: these 26 tables had RLS disabled while
-- the authenticated role holds full SELECT/INSERT/UPDATE/DELETE grants, so
-- any signed-in account (including a deactivated one, or one with the "User"
-- role) could read or change them directly with the public anon key:
--   chart_of_accounts, document_expenses, erp_events, expense_categories,
--   financial_categories, inventory_batch_consumptions, inventory_batches,
--   inventory_initial_balance_items, inventory_initial_balances,
--   journal_entries, journal_entry_lines, n8n_chat_histories, partners,
--   payments, polywood_inventory_items, polywood_pieces, product_bom,
--   production_contractors, production_contracts, production_expenses,
--   production_materials, production_outsourcing, purchase_requests,
--   sub_categories, supplier_delivery_ratings, warehouse_stocks.
-- The views gl_accounts, journal_lines and gl_orphaned_document_entries ran
-- with their owner's rights, so they exposed the ledger the same way; they
-- now run as the caller (security_invoker) and follow the new policies.
-- No app code reads those views.
--
-- What keeps working unchanged:
--   * Server actions and /api routes that use the service role bypass RLS.
--   * SECURITY DEFINER functions (owned by postgres, the table owner) bypass
--     RLS, so posting sales, purchases, payments, journals, FIFO and
--     inventory counts is unaffected.
-- What the policies gate: direct reads and writes from the browser client
-- and createSupabaseServerClient(), which run as the signed-in user.
--
-- Style: one policy per command, named <table>_<cmd>, gated by
-- public.require_permission() (active user + permission), as in
-- 20261005190000. Tables written only by SECURITY DEFINER functions get a
-- read policy and no write policy.
--
-- Idempotent: safe to run more than once.

-- 2026-10-12 (prompt 9): the blocks of module-owned tables are wrapped in
-- `IF to_regclass(...) IS NOT NULL`, so a tenant installed without that module can apply
-- this migration. Where the tables exist (production, every full install) the effect is
-- unchanged; production already applied this file, so nothing runs again there.
BEGIN;

-- ════ General ledger: written only by SECURITY DEFINER functions ════

-- ─── journal_entries ───────────────────────────────────────────────────────────

-- Read: finance and financial-report viewers (src/lib/finance/journal.ts,
-- account ledger). The get_gl_* report functions are SECURITY INVOKER and
-- are called with the service role. No write policy: posting, reversing and
-- period work go through create_journal_entry, reverse_journal_entry,
-- post_initial_balance_journal etc. (SECURITY DEFINER).

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_entries_select ON public.journal_entries;
CREATE POLICY journal_entries_select ON public.journal_entries
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_finance')
    OR public.require_permission('can_manage_finance')
    OR public.require_permission('can_view_financial_reports')
  );

DROP POLICY IF EXISTS journal_entries_insert ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_update ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_delete ON public.journal_entries;

-- ─── journal_entry_lines ───────────────────────────────────────────────────────

-- Same as journal_entries.

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_entry_lines_select ON public.journal_entry_lines;
CREATE POLICY journal_entry_lines_select ON public.journal_entry_lines
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_finance')
    OR public.require_permission('can_manage_finance')
    OR public.require_permission('can_view_financial_reports')
  );

DROP POLICY IF EXISTS journal_entry_lines_insert ON public.journal_entry_lines;
DROP POLICY IF EXISTS journal_entry_lines_update ON public.journal_entry_lines;
DROP POLICY IF EXISTS journal_entry_lines_delete ON public.journal_entry_lines;

-- ─── chart_of_accounts ─────────────────────────────────────────────────────────

-- Account list used by payment, expense and ledger pickers: any active user
-- may read it. Changes need can_manage_finance (no screen writes it today).

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chart_of_accounts_select ON public.chart_of_accounts;
CREATE POLICY chart_of_accounts_select ON public.chart_of_accounts
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS chart_of_accounts_insert ON public.chart_of_accounts;
CREATE POLICY chart_of_accounts_insert ON public.chart_of_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_finance'));

DROP POLICY IF EXISTS chart_of_accounts_update ON public.chart_of_accounts;
CREATE POLICY chart_of_accounts_update ON public.chart_of_accounts
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_finance'))
  WITH CHECK (public.require_permission('can_manage_finance'));

DROP POLICY IF EXISTS chart_of_accounts_delete ON public.chart_of_accounts;
CREATE POLICY chart_of_accounts_delete ON public.chart_of_accounts
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_finance'));

-- ─── payments ──────────────────────────────────────────────────────────────────

-- Read by the payments page and the payment modal on invoices and
-- purchases (src/lib/payments/fetchPayments.ts, browser). Written only by
-- record_payment_atomic, create_partner_payment, create_sale_atomic and the
-- other SECURITY DEFINER document functions, so no write policy.

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_finance')
    OR public.require_permission('can_manage_finance')
    OR public.require_permission('can_view_sales')
    OR public.require_permission('can_view_purchases')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_create_purchase')
  );

DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payments_update ON public.payments;
DROP POLICY IF EXISTS payments_delete ON public.payments;

-- ─── partners ──────────────────────────────────────────────────────────────────

-- Unified customer/supplier list, read in the browser by the invoice form,
-- partner pages, payment modal and consignments. Server actions write it with
-- the service role; the write policies below cover any browser write.

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partners_select ON public.partners;
CREATE POLICY partners_select ON public.partners
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_customers')
    OR public.require_permission('can_view_suppliers')
    OR public.require_permission('can_view_sales')
    OR public.require_permission('can_view_purchases')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_view_finance')
    OR public.require_permission('can_manage_finance')
    OR public.require_permission('can_view_consignments')
  );

DROP POLICY IF EXISTS partners_insert ON public.partners;
CREATE POLICY partners_insert ON public.partners
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_customers')
    OR public.require_permission('can_manage_suppliers')
    OR public.require_permission('can_manage_finance')
  );

DROP POLICY IF EXISTS partners_update ON public.partners;
CREATE POLICY partners_update ON public.partners
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_manage_customers')
    OR public.require_permission('can_manage_suppliers')
    OR public.require_permission('can_manage_finance')
  )
  WITH CHECK (
    public.require_permission('can_manage_customers')
    OR public.require_permission('can_manage_suppliers')
    OR public.require_permission('can_manage_finance')
  );

DROP POLICY IF EXISTS partners_delete ON public.partners;
CREATE POLICY partners_delete ON public.partners
  FOR DELETE TO authenticated
  USING (
    public.require_permission('can_manage_customers')
    OR public.require_permission('can_manage_suppliers')
    OR public.require_permission('can_manage_finance')
  );

-- ─── financial_categories ──────────────────────────────────────────────────────

-- Expense/income category pickers: any active user may read.
-- Managing them needs can_manage_expenses or can_manage_finance.

ALTER TABLE public.financial_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_categories_select ON public.financial_categories;
CREATE POLICY financial_categories_select ON public.financial_categories
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS financial_categories_insert ON public.financial_categories;
CREATE POLICY financial_categories_insert ON public.financial_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  );

DROP POLICY IF EXISTS financial_categories_update ON public.financial_categories;
CREATE POLICY financial_categories_update ON public.financial_categories
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  )
  WITH CHECK (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  );

DROP POLICY IF EXISTS financial_categories_delete ON public.financial_categories;
CREATE POLICY financial_categories_delete ON public.financial_categories
  FOR DELETE TO authenticated
  USING (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  );

-- ─── expense_categories ────────────────────────────────────────────────────────

-- Legacy category list, same rules as financial_categories.

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_categories_select ON public.expense_categories;
CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS expense_categories_insert ON public.expense_categories;
CREATE POLICY expense_categories_insert ON public.expense_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  );

DROP POLICY IF EXISTS expense_categories_update ON public.expense_categories;
CREATE POLICY expense_categories_update ON public.expense_categories
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  )
  WITH CHECK (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  );

DROP POLICY IF EXISTS expense_categories_delete ON public.expense_categories;
CREATE POLICY expense_categories_delete ON public.expense_categories
  FOR DELETE TO authenticated
  USING (
    public.require_permission('can_manage_expenses')
    OR public.require_permission('can_manage_finance')
  );

-- ─── document_expenses ─────────────────────────────────────────────────────────

-- Not used by the app today (0 rows). Same rules as expenses.

ALTER TABLE public.document_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_expenses_select ON public.document_expenses;
CREATE POLICY document_expenses_select ON public.document_expenses
  FOR SELECT TO authenticated
  USING (public.require_permission('can_view_expenses'));

DROP POLICY IF EXISTS document_expenses_insert ON public.document_expenses;
CREATE POLICY document_expenses_insert ON public.document_expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_expenses'));

DROP POLICY IF EXISTS document_expenses_update ON public.document_expenses;
CREATE POLICY document_expenses_update ON public.document_expenses
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_expenses'))
  WITH CHECK (public.require_permission('can_manage_expenses'));

DROP POLICY IF EXISTS document_expenses_delete ON public.document_expenses;
CREATE POLICY document_expenses_delete ON public.document_expenses
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_expenses'));

-- ════ Inventory ════

-- ─── warehouse_stocks ──────────────────────────────────────────────────────────

-- Per-warehouse stock, read in the browser by the inventory dashboard and
-- stock pickers. Writes come from SECURITY DEFINER functions and server
-- actions using the service role; the write policies cover browser writes.

ALTER TABLE public.warehouse_stocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_stocks_select ON public.warehouse_stocks;
CREATE POLICY warehouse_stocks_select ON public.warehouse_stocks
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_view_production')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_view_consignments')
  );

DROP POLICY IF EXISTS warehouse_stocks_insert ON public.warehouse_stocks;
CREATE POLICY warehouse_stocks_insert ON public.warehouse_stocks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_warehouses')
    OR public.require_permission('can_manage_products')
  );

DROP POLICY IF EXISTS warehouse_stocks_update ON public.warehouse_stocks;
CREATE POLICY warehouse_stocks_update ON public.warehouse_stocks
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_manage_warehouses')
    OR public.require_permission('can_manage_products')
  )
  WITH CHECK (
    public.require_permission('can_manage_warehouses')
    OR public.require_permission('can_manage_products')
  );

DROP POLICY IF EXISTS warehouse_stocks_delete ON public.warehouse_stocks;
CREATE POLICY warehouse_stocks_delete ON public.warehouse_stocks
  FOR DELETE TO authenticated
  USING (
    public.require_permission('can_manage_warehouses')
    OR public.require_permission('can_manage_products')
  );

-- ─── polywood_pieces ───────────────────────────────────────────────────────────

-- Sheet/offcut pieces. Read by product pickers, barcode lookup, invoice
-- form and production. Cutting a piece while invoicing
-- (src/lib/polywood/executeCut.ts) and metric receipt
-- (src/lib/polywood/inventory.ts) insert, update and delete from the browser,
-- so sellers, buyers, production and warehouse staff may write.

ALTER TABLE public.polywood_pieces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS polywood_pieces_select ON public.polywood_pieces;
CREATE POLICY polywood_pieces_select ON public.polywood_pieces
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_view_production')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_view_consignments')
  );

DROP POLICY IF EXISTS polywood_pieces_insert ON public.polywood_pieces;
CREATE POLICY polywood_pieces_insert ON public.polywood_pieces
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_manage_warehouses')
  );

DROP POLICY IF EXISTS polywood_pieces_update ON public.polywood_pieces;
CREATE POLICY polywood_pieces_update ON public.polywood_pieces
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_manage_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_manage_warehouses')
  )
  WITH CHECK (
    public.require_permission('can_manage_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_manage_warehouses')
  );

DROP POLICY IF EXISTS polywood_pieces_delete ON public.polywood_pieces;
CREATE POLICY polywood_pieces_delete ON public.polywood_pieces
  FOR DELETE TO authenticated
  USING (
    public.require_permission('can_manage_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_manage_warehouses')
  );

-- ─── polywood_inventory_items ──────────────────────────────────────────────────

-- Written by a server action with the service role. Same rules as
-- polywood_pieces.

-- Module table (polywood): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.polywood_inventory_items') IS NOT NULL THEN
    ALTER TABLE public.polywood_inventory_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS polywood_inventory_items_select ON public.polywood_inventory_items;
    CREATE POLICY polywood_inventory_items_select ON public.polywood_inventory_items
      FOR SELECT TO authenticated
      USING (
        public.require_permission('can_view_products')
        OR public.require_permission('can_create_invoice')
        OR public.require_permission('can_create_purchase')
        OR public.require_permission('can_view_production')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_view_consignments')
      );

    DROP POLICY IF EXISTS polywood_inventory_items_insert ON public.polywood_inventory_items;
    CREATE POLICY polywood_inventory_items_insert ON public.polywood_inventory_items
      FOR INSERT TO authenticated
      WITH CHECK (
        public.require_permission('can_manage_products')
        OR public.require_permission('can_create_invoice')
        OR public.require_permission('can_edit_sales')
        OR public.require_permission('can_create_purchase')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_manage_warehouses')
      );

    DROP POLICY IF EXISTS polywood_inventory_items_update ON public.polywood_inventory_items;
    CREATE POLICY polywood_inventory_items_update ON public.polywood_inventory_items
      FOR UPDATE TO authenticated
      USING (
        public.require_permission('can_manage_products')
        OR public.require_permission('can_create_invoice')
        OR public.require_permission('can_edit_sales')
        OR public.require_permission('can_create_purchase')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_manage_warehouses')
      )
      WITH CHECK (
        public.require_permission('can_manage_products')
        OR public.require_permission('can_create_invoice')
        OR public.require_permission('can_edit_sales')
        OR public.require_permission('can_create_purchase')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_manage_warehouses')
      );

    DROP POLICY IF EXISTS polywood_inventory_items_delete ON public.polywood_inventory_items;
    CREATE POLICY polywood_inventory_items_delete ON public.polywood_inventory_items
      FOR DELETE TO authenticated
      USING (
        public.require_permission('can_manage_products')
        OR public.require_permission('can_create_invoice')
        OR public.require_permission('can_edit_sales')
        OR public.require_permission('can_create_purchase')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_manage_warehouses')
      );
  END IF;
END
$guard$;

-- ─── inventory_batches ─────────────────────────────────────────────────────────

-- FIFO cost layers. Created and consumed by SECURITY DEFINER document
-- functions; the initial-balance screen calls create_inventory_batch with the
-- service role.

ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_batches_select ON public.inventory_batches;
CREATE POLICY inventory_batches_select ON public.inventory_batches
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_products')
    OR public.require_permission('can_view_reports')
    OR public.require_permission('can_view_financial_reports')
  );

DROP POLICY IF EXISTS inventory_batches_insert ON public.inventory_batches;
CREATE POLICY inventory_batches_insert ON public.inventory_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS inventory_batches_update ON public.inventory_batches;
CREATE POLICY inventory_batches_update ON public.inventory_batches
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_products'))
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS inventory_batches_delete ON public.inventory_batches;
CREATE POLICY inventory_batches_delete ON public.inventory_batches
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_products'));

-- ─── inventory_batch_consumptions ──────────────────────────────────────────────

-- Same as inventory_batches.

ALTER TABLE public.inventory_batch_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_batch_consumptions_select ON public.inventory_batch_consumptions;
CREATE POLICY inventory_batch_consumptions_select ON public.inventory_batch_consumptions
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_products')
    OR public.require_permission('can_view_reports')
    OR public.require_permission('can_view_financial_reports')
  );

DROP POLICY IF EXISTS inventory_batch_consumptions_insert ON public.inventory_batch_consumptions;
CREATE POLICY inventory_batch_consumptions_insert ON public.inventory_batch_consumptions
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS inventory_batch_consumptions_update ON public.inventory_batch_consumptions;
CREATE POLICY inventory_batch_consumptions_update ON public.inventory_batch_consumptions
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_products'))
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS inventory_batch_consumptions_delete ON public.inventory_batch_consumptions;
CREATE POLICY inventory_batch_consumptions_delete ON public.inventory_batch_consumptions
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_products'));

-- ─── inventory_initial_balances ────────────────────────────────────────────────

-- Opening stock documents (src/lib/initialBalance/actions.ts, service role).

-- Module table (inventory): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.inventory_initial_balances') IS NOT NULL THEN
    ALTER TABLE public.inventory_initial_balances ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS inventory_initial_balances_select ON public.inventory_initial_balances;
    CREATE POLICY inventory_initial_balances_select ON public.inventory_initial_balances
      FOR SELECT TO authenticated
      USING (public.require_permission('can_view_products'));

    DROP POLICY IF EXISTS inventory_initial_balances_insert ON public.inventory_initial_balances;
    CREATE POLICY inventory_initial_balances_insert ON public.inventory_initial_balances
      FOR INSERT TO authenticated
      WITH CHECK (public.require_permission('can_manage_products'));

    DROP POLICY IF EXISTS inventory_initial_balances_update ON public.inventory_initial_balances;
    CREATE POLICY inventory_initial_balances_update ON public.inventory_initial_balances
      FOR UPDATE TO authenticated
      USING (public.require_permission('can_manage_products'))
      WITH CHECK (public.require_permission('can_manage_products'));

    DROP POLICY IF EXISTS inventory_initial_balances_delete ON public.inventory_initial_balances;
    CREATE POLICY inventory_initial_balances_delete ON public.inventory_initial_balances
      FOR DELETE TO authenticated
      USING (public.require_permission('can_manage_products'));
  END IF;
END
$guard$;

-- ─── inventory_initial_balance_items ───────────────────────────────────────────

-- Same as inventory_initial_balances.

-- Module table (inventory): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.inventory_initial_balance_items') IS NOT NULL THEN
    ALTER TABLE public.inventory_initial_balance_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS inventory_initial_balance_items_select ON public.inventory_initial_balance_items;
    CREATE POLICY inventory_initial_balance_items_select ON public.inventory_initial_balance_items
      FOR SELECT TO authenticated
      USING (public.require_permission('can_view_products'));

    DROP POLICY IF EXISTS inventory_initial_balance_items_insert ON public.inventory_initial_balance_items;
    CREATE POLICY inventory_initial_balance_items_insert ON public.inventory_initial_balance_items
      FOR INSERT TO authenticated
      WITH CHECK (public.require_permission('can_manage_products'));

    DROP POLICY IF EXISTS inventory_initial_balance_items_update ON public.inventory_initial_balance_items;
    CREATE POLICY inventory_initial_balance_items_update ON public.inventory_initial_balance_items
      FOR UPDATE TO authenticated
      USING (public.require_permission('can_manage_products'))
      WITH CHECK (public.require_permission('can_manage_products'));

    DROP POLICY IF EXISTS inventory_initial_balance_items_delete ON public.inventory_initial_balance_items;
    CREATE POLICY inventory_initial_balance_items_delete ON public.inventory_initial_balance_items
      FOR DELETE TO authenticated
      USING (public.require_permission('can_manage_products'));
  END IF;
END
$guard$;

-- ─── product_bom ───────────────────────────────────────────────────────────────

-- Bill of materials. Read when selling composite products and in
-- production; written from the product form (src/lib/products/bom.ts).

ALTER TABLE public.product_bom ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_bom_select ON public.product_bom;
CREATE POLICY product_bom_select ON public.product_bom
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_view_production')
    OR public.require_permission('can_manage_production')
  );

DROP POLICY IF EXISTS product_bom_insert ON public.product_bom;
CREATE POLICY product_bom_insert ON public.product_bom
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS product_bom_update ON public.product_bom;
CREATE POLICY product_bom_update ON public.product_bom
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_products'))
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS product_bom_delete ON public.product_bom;
CREATE POLICY product_bom_delete ON public.product_bom
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_products'));

-- ─── sub_categories ────────────────────────────────────────────────────────────

-- Category lookup: any active user may read; product managers write.

ALTER TABLE public.sub_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sub_categories_select ON public.sub_categories;
CREATE POLICY sub_categories_select ON public.sub_categories
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS sub_categories_insert ON public.sub_categories;
CREATE POLICY sub_categories_insert ON public.sub_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS sub_categories_update ON public.sub_categories;
CREATE POLICY sub_categories_update ON public.sub_categories
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_products'))
  WITH CHECK (public.require_permission('can_manage_products'));

DROP POLICY IF EXISTS sub_categories_delete ON public.sub_categories;
CREATE POLICY sub_categories_delete ON public.sub_categories
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_products'));

-- ════ Production: same rules as production_orders (20261005190000) ════

-- ─── production_contractors ────────────────────────────────────────────────────

-- Production actions use the service role; /reports reads it in the browser.

-- Module table (production): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.production_contractors') IS NOT NULL THEN
    ALTER TABLE public.production_contractors ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS production_contractors_select ON public.production_contractors;
    CREATE POLICY production_contractors_select ON public.production_contractors
      FOR SELECT TO authenticated
      USING (
        public.require_permission('can_view_production')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_view_reports')
      );

    DROP POLICY IF EXISTS production_contractors_insert ON public.production_contractors;
    CREATE POLICY production_contractors_insert ON public.production_contractors
      FOR INSERT TO authenticated
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_contractors_update ON public.production_contractors;
    CREATE POLICY production_contractors_update ON public.production_contractors
      FOR UPDATE TO authenticated
      USING (public.require_permission('can_manage_production'))
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_contractors_delete ON public.production_contractors;
    CREATE POLICY production_contractors_delete ON public.production_contractors
      FOR DELETE TO authenticated
      USING (public.require_permission('can_manage_production'));
  END IF;
END
$guard$;

-- ─── production_contracts ──────────────────────────────────────────────────────

-- Production actions use the service role; /reports reads it in the browser.

-- Module table (production): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.production_contracts') IS NOT NULL THEN
    ALTER TABLE public.production_contracts ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS production_contracts_select ON public.production_contracts;
    CREATE POLICY production_contracts_select ON public.production_contracts
      FOR SELECT TO authenticated
      USING (
        public.require_permission('can_view_production')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_view_reports')
      );

    DROP POLICY IF EXISTS production_contracts_insert ON public.production_contracts;
    CREATE POLICY production_contracts_insert ON public.production_contracts
      FOR INSERT TO authenticated
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_contracts_update ON public.production_contracts;
    CREATE POLICY production_contracts_update ON public.production_contracts
      FOR UPDATE TO authenticated
      USING (public.require_permission('can_manage_production'))
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_contracts_delete ON public.production_contracts;
    CREATE POLICY production_contracts_delete ON public.production_contracts
      FOR DELETE TO authenticated
      USING (public.require_permission('can_manage_production'));
  END IF;
END
$guard$;

-- ─── production_expenses ───────────────────────────────────────────────────────

-- Production actions use the service role; /reports reads it in the browser.

-- Module table (production): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.production_expenses') IS NOT NULL THEN
    ALTER TABLE public.production_expenses ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS production_expenses_select ON public.production_expenses;
    CREATE POLICY production_expenses_select ON public.production_expenses
      FOR SELECT TO authenticated
      USING (
        public.require_permission('can_view_production')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_view_reports')
      );

    DROP POLICY IF EXISTS production_expenses_insert ON public.production_expenses;
    CREATE POLICY production_expenses_insert ON public.production_expenses
      FOR INSERT TO authenticated
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_expenses_update ON public.production_expenses;
    CREATE POLICY production_expenses_update ON public.production_expenses
      FOR UPDATE TO authenticated
      USING (public.require_permission('can_manage_production'))
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_expenses_delete ON public.production_expenses;
    CREATE POLICY production_expenses_delete ON public.production_expenses
      FOR DELETE TO authenticated
      USING (public.require_permission('can_manage_production'));
  END IF;
END
$guard$;

-- ─── production_materials ──────────────────────────────────────────────────────

-- Production actions use the service role; /reports reads it in the browser.

-- Module table (production): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.production_materials') IS NOT NULL THEN
    ALTER TABLE public.production_materials ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS production_materials_select ON public.production_materials;
    CREATE POLICY production_materials_select ON public.production_materials
      FOR SELECT TO authenticated
      USING (
        public.require_permission('can_view_production')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_view_reports')
      );

    DROP POLICY IF EXISTS production_materials_insert ON public.production_materials;
    CREATE POLICY production_materials_insert ON public.production_materials
      FOR INSERT TO authenticated
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_materials_update ON public.production_materials;
    CREATE POLICY production_materials_update ON public.production_materials
      FOR UPDATE TO authenticated
      USING (public.require_permission('can_manage_production'))
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_materials_delete ON public.production_materials;
    CREATE POLICY production_materials_delete ON public.production_materials
      FOR DELETE TO authenticated
      USING (public.require_permission('can_manage_production'));
  END IF;
END
$guard$;

-- ─── production_outsourcing ────────────────────────────────────────────────────

-- Production actions use the service role; /reports reads it in the browser.

-- Module table (production): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.production_outsourcing') IS NOT NULL THEN
    ALTER TABLE public.production_outsourcing ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS production_outsourcing_select ON public.production_outsourcing;
    CREATE POLICY production_outsourcing_select ON public.production_outsourcing
      FOR SELECT TO authenticated
      USING (
        public.require_permission('can_view_production')
        OR public.require_permission('can_manage_production')
        OR public.require_permission('can_view_reports')
      );

    DROP POLICY IF EXISTS production_outsourcing_insert ON public.production_outsourcing;
    CREATE POLICY production_outsourcing_insert ON public.production_outsourcing
      FOR INSERT TO authenticated
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_outsourcing_update ON public.production_outsourcing;
    CREATE POLICY production_outsourcing_update ON public.production_outsourcing
      FOR UPDATE TO authenticated
      USING (public.require_permission('can_manage_production'))
      WITH CHECK (public.require_permission('can_manage_production'));

    DROP POLICY IF EXISTS production_outsourcing_delete ON public.production_outsourcing;
    CREATE POLICY production_outsourcing_delete ON public.production_outsourcing
      FOR DELETE TO authenticated
      USING (public.require_permission('can_manage_production'));
  END IF;
END
$guard$;

-- ════ Purchasing ════

-- ─── purchase_requests ─────────────────────────────────────────────────────────

-- Created by production and the safety-stock job; saving a purchase marks
-- the linked requests fulfilled from the browser
-- (src/lib/purchases/fulfillProductionRequests.ts).

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_requests_select ON public.purchase_requests;
CREATE POLICY purchase_requests_select ON public.purchase_requests
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_approve_purchase_requests')
    OR public.require_permission('can_view_production')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_view_reports')
  );

DROP POLICY IF EXISTS purchase_requests_insert ON public.purchase_requests;
CREATE POLICY purchase_requests_insert ON public.purchase_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_production')
    OR public.require_permission('can_create_purchase')
  );

DROP POLICY IF EXISTS purchase_requests_update ON public.purchase_requests;
CREATE POLICY purchase_requests_update ON public.purchase_requests
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_create_purchase')
    OR public.require_permission('can_edit_purchases')
    OR public.require_permission('can_approve_purchase_requests')
    OR public.require_permission('can_manage_production')
  )
  WITH CHECK (
    public.require_permission('can_create_purchase')
    OR public.require_permission('can_edit_purchases')
    OR public.require_permission('can_approve_purchase_requests')
    OR public.require_permission('can_manage_production')
  );

DROP POLICY IF EXISTS purchase_requests_delete ON public.purchase_requests;
CREATE POLICY purchase_requests_delete ON public.purchase_requests
  FOR DELETE TO authenticated
  USING (
    public.require_permission('can_delete_purchases')
    OR public.require_permission('can_manage_production')
  );

-- ─── supplier_delivery_ratings ─────────────────────────────────────────────────

-- Written by rate_supplier_delivery (SECURITY DEFINER), so no write policy.

-- Module table (purchases): only when that module is installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.supplier_delivery_ratings') IS NOT NULL THEN
    ALTER TABLE public.supplier_delivery_ratings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS supplier_delivery_ratings_select ON public.supplier_delivery_ratings;
    CREATE POLICY supplier_delivery_ratings_select ON public.supplier_delivery_ratings
      FOR SELECT TO authenticated
      USING (
        public.require_permission('can_view_suppliers')
        OR public.require_permission('can_view_purchases')
      );

    DROP POLICY IF EXISTS supplier_delivery_ratings_insert ON public.supplier_delivery_ratings;
    DROP POLICY IF EXISTS supplier_delivery_ratings_update ON public.supplier_delivery_ratings;
    DROP POLICY IF EXISTS supplier_delivery_ratings_delete ON public.supplier_delivery_ratings;
  END IF;
END
$guard$;

-- ════ System tables ════

-- ─── erp_events ────────────────────────────────────────────────────────────────

-- Internal event log, written by log_erp_event (SECURITY DEFINER). Only
-- admins may read it from a client.

ALTER TABLE public.erp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_events_select ON public.erp_events;
CREATE POLICY erp_events_select ON public.erp_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS erp_events_insert ON public.erp_events;
DROP POLICY IF EXISTS erp_events_update ON public.erp_events;
DROP POLICY IF EXISTS erp_events_delete ON public.erp_events;

-- ─── n8n_chat_histories ────────────────────────────────────────────────────────

-- Used only by the n8n bridge with the service role. No policy: signed-in
-- users can no longer read other people's chat history.

ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS n8n_chat_histories_select ON public.n8n_chat_histories;
DROP POLICY IF EXISTS n8n_chat_histories_insert ON public.n8n_chat_histories;
DROP POLICY IF EXISTS n8n_chat_histories_update ON public.n8n_chat_histories;
DROP POLICY IF EXISTS n8n_chat_histories_delete ON public.n8n_chat_histories;

-- ════ Views that bypassed RLS ════

ALTER VIEW public.gl_accounts SET (security_invoker = true);
ALTER VIEW public.journal_lines SET (security_invoker = true);
ALTER VIEW public.gl_orphaned_document_entries SET (security_invoker = true);

COMMIT;
