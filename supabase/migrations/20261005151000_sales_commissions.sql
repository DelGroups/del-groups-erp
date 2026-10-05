-- Create public.employee_commission_rules and public.sales_commissions.
--
-- Neither table was ever created by a migration (they only exist in the
-- hand-run types/schema.sql), yet:
--   * every sale records commissions into sales_commissions
--     (src/lib/commissions/recordSaleCommissions.ts, called from submitSale.ts),
--     reading the seller's per-category rates from employee_commission_rules;
--   * the employee page reads and edits both (src/lib/commissions/api.ts);
--   * calculate_monthly_payroll_drafts() and pay_payroll_run_atomic()
--     (20260909220000_ledger_payroll_integrity) SELECT and UPDATE
--     sales_commissions, so monthly payroll fails in the database until this
--     table exists.
-- Columns mirror exactly what the code and those functions read and write.
--
-- Policies follow the live pattern (see 20261003100000_production_stock_reservations).
-- recordSaleCommissions runs in the browser as the user who saves the sale, so
-- inserting a commission row is also allowed with sale-editing rights; reading,
-- changing and deleting need the commission permissions.
--
-- Idempotent: safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_commission_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  category_name    TEXT NOT NULL,
  commission_rate  NUMERIC NOT NULL DEFAULT 0 CHECK (commission_rate >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- upsertEmployeeCommissionRule matches on employee + category, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_commission_rules_employee_category
  ON public.employee_commission_rules (employee_id, lower(category_name));

CREATE TABLE IF NOT EXISTS public.sales_commissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id            UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  employee_id        UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  seller_name        TEXT,
  sale_doc_no        TEXT,
  product_category   TEXT,
  product_name       TEXT,
  sale_amount        NUMERIC NOT NULL DEFAULT 0,
  commission_rate    NUMERIC NOT NULL DEFAULT 0,
  commission_amount  NUMERIC NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  -- Set by pay_payroll_run_atomic() to the salary_payments row that paid it.
  payroll_id         UUID REFERENCES public.salary_payments(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payroll sums pending commissions per employee.
CREATE INDEX IF NOT EXISTS idx_sales_commissions_employee_status
  ON public.sales_commissions (employee_id, status);

CREATE INDEX IF NOT EXISTS idx_sales_commissions_sale_id
  ON public.sales_commissions (sale_id);

ALTER TABLE public.employee_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_commission_rules_select ON public.employee_commission_rules;
CREATE POLICY employee_commission_rules_select ON public.employee_commission_rules
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_commissions')
    OR public.require_permission('can_edit_sales')
  );

DROP POLICY IF EXISTS employee_commission_rules_insert ON public.employee_commission_rules;
CREATE POLICY employee_commission_rules_insert ON public.employee_commission_rules
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_commissions'));

DROP POLICY IF EXISTS employee_commission_rules_update ON public.employee_commission_rules;
CREATE POLICY employee_commission_rules_update ON public.employee_commission_rules
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_commissions'))
  WITH CHECK (public.require_permission('can_manage_commissions'));

DROP POLICY IF EXISTS employee_commission_rules_delete ON public.employee_commission_rules;
CREATE POLICY employee_commission_rules_delete ON public.employee_commission_rules
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_commissions'));

DROP POLICY IF EXISTS sales_commissions_select ON public.sales_commissions;
CREATE POLICY sales_commissions_select ON public.sales_commissions
  FOR SELECT TO authenticated
  USING (public.require_permission('can_view_commissions'));

DROP POLICY IF EXISTS sales_commissions_insert ON public.sales_commissions;
CREATE POLICY sales_commissions_insert ON public.sales_commissions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_commissions')
    OR (public.require_permission('can_edit_sales') AND status = 'pending' AND payroll_id IS NULL)
  );

DROP POLICY IF EXISTS sales_commissions_update ON public.sales_commissions;
CREATE POLICY sales_commissions_update ON public.sales_commissions
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_commissions'))
  WITH CHECK (public.require_permission('can_manage_commissions'));

DROP POLICY IF EXISTS sales_commissions_delete ON public.sales_commissions;
CREATE POLICY sales_commissions_delete ON public.sales_commissions
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_commissions'));

REVOKE ALL ON TABLE public.employee_commission_rules FROM anon;
REVOKE ALL ON TABLE public.sales_commissions FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
