-- P0-2: create public.production_stock_reservations.
--
-- The table was never created by any migration, yet the app reads and writes
-- it (src/lib/actions/production.ts, src/lib/inventory/fetchWarehouseStockDashboard.ts)
-- and process_production_material_issue_event() runs
--   UPDATE production_stock_reservations SET status = 'consumed' ...
-- for every material it issues, so that function fails in the database until
-- this table exists. Columns mirror exactly what the code reads and writes.
--
-- Policies follow the live pattern (e.g. inventory_counts, products): one policy
-- per command named <table>_<cmd>, each gated by public.require_permission().
-- They are written out instead of calling public._apply_table_rls, which has two
-- overloads in the database whose bodies differ from this repository.
--
-- Idempotent: safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.production_stock_reservations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id     UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  -- One reservation per material line; the app upserts on this column.
  production_material_id  UUID NOT NULL REFERENCES public.production_materials(id) ON DELETE CASCADE,
  product_id              UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id            UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  quantity                NUMERIC NOT NULL CHECK (quantity > 0),
  status                  TEXT NOT NULL DEFAULT 'reserved'
                            CHECK (status IN ('reserved', 'consumed', 'released')),
  consumed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT production_stock_reservations_material_key UNIQUE (production_material_id)
);

-- /inventory sums open reservations per product and warehouse.
CREATE INDEX IF NOT EXISTS idx_production_stock_reservations_open
  ON public.production_stock_reservations (product_id, warehouse_id)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_production_stock_reservations_order
  ON public.production_stock_reservations (production_order_id);

-- Readable by anyone who can see stock; writable only with production rights.
-- Server actions (service_role) and the SECURITY DEFINER issue function bypass RLS.
ALTER TABLE public.production_stock_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_stock_reservations_select ON public.production_stock_reservations;
CREATE POLICY production_stock_reservations_select ON public.production_stock_reservations
  FOR SELECT TO authenticated
  USING (public.require_permission('can_view_products'));

DROP POLICY IF EXISTS production_stock_reservations_insert ON public.production_stock_reservations;
CREATE POLICY production_stock_reservations_insert ON public.production_stock_reservations
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_stock_reservations_update ON public.production_stock_reservations;
CREATE POLICY production_stock_reservations_update ON public.production_stock_reservations
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_production'))
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_stock_reservations_delete ON public.production_stock_reservations;
CREATE POLICY production_stock_reservations_delete ON public.production_stock_reservations
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_production'));

REVOKE ALL ON TABLE public.production_stock_reservations FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
