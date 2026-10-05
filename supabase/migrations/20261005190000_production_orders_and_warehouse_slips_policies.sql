-- production_orders and warehouse_slips have RLS on but no policy.
--
-- Verified on production 2026-10-05: both tables have row level security
-- enabled and zero policies, so for every signed-in user (anything but the
-- service role) reads return no rows and writes are rejected.
--   production_orders: 20260908180000 gave it a FOR ALL USING (true) policy,
--     20260909230000 dropped that policy and never added a replacement.
--     Browser reads that now come back empty: the executive dashboard's
--     production figures and project profitability (/reports), and the AI
--     assistant's production tools, which run as the user.
--   warehouse_slips: inventory write-off (src/lib/inventory/writeoff.ts)
--     creates its slip from the browser, which is rejected.
-- Server actions use the service role and are unaffected.
--
-- Fix: one policy per command, named <table>_<cmd> and gated by
-- public.require_permission(), as on the other production tables
-- (see 20261003100000_production_stock_reservations).
--
-- consignments, consignment_items, monthly_commissions,
-- monthly_commission_details (locked on purpose in 20261005100000) and
-- document_number_counters (only touched by SECURITY DEFINER functions) also
-- have no policy and are left locked.
--
-- Idempotent: safe to run more than once.

BEGIN;

-- ─── production_orders ───────────────────────────────────────────────────────

ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_orders_select ON public.production_orders;
CREATE POLICY production_orders_select ON public.production_orders
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_production')
    OR public.require_permission('can_manage_production')
    OR public.require_permission('can_view_reports')
  );

DROP POLICY IF EXISTS production_orders_insert ON public.production_orders;
CREATE POLICY production_orders_insert ON public.production_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_orders_update ON public.production_orders;
CREATE POLICY production_orders_update ON public.production_orders
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_production'))
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_orders_delete ON public.production_orders;
CREATE POLICY production_orders_delete ON public.production_orders
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_production'));

-- ─── warehouse_slips ─────────────────────────────────────────────────────────

ALTER TABLE public.warehouse_slips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_slips_select ON public.warehouse_slips;
CREATE POLICY warehouse_slips_select ON public.warehouse_slips
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_warehouse_slips')
    OR public.require_permission('can_approve_warehouse_slips')
    OR public.require_permission('can_manage_warehouses')
  );

-- Users who send documents to the warehouse or write stock off create slips,
-- but only as pending: approving is a separate right.
DROP POLICY IF EXISTS warehouse_slips_insert ON public.warehouse_slips;
CREATE POLICY warehouse_slips_insert ON public.warehouse_slips
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND (
      public.require_permission('can_send_to_warehouse')
      OR public.require_permission('can_writeoff_inventory')
      OR public.require_permission('can_manage_warehouses')
    )
  );

DROP POLICY IF EXISTS warehouse_slips_update ON public.warehouse_slips;
CREATE POLICY warehouse_slips_update ON public.warehouse_slips
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_approve_warehouse_slips')
    OR public.require_permission('can_manage_warehouses')
  )
  WITH CHECK (
    public.require_permission('can_approve_warehouse_slips')
    OR public.require_permission('can_manage_warehouses')
  );

DROP POLICY IF EXISTS warehouse_slips_delete ON public.warehouse_slips;
CREATE POLICY warehouse_slips_delete ON public.warehouse_slips
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_warehouses'));

REVOKE ALL ON TABLE public.production_orders FROM anon;
REVOKE ALL ON TABLE public.warehouse_slips FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
