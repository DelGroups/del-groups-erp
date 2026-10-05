-- Create public.production_boms and public.production_bom_items.
--
-- Neither table was ever created by a migration (they only exist in the
-- hand-run types/production-migration.sql), yet the production module reads
-- and writes both (src/lib/actions/production.ts: BOM list on the production
-- page, saveProductionBomAction, deleteProductionBomAction). Without them the
-- BOM list is always empty and saving a BOM fails. Columns mirror exactly what
-- the code selects and inserts (BOM_FIELDS / BOM_ITEM_FIELDS).
--
-- Policies follow the live pattern (see 20261003100000_production_stock_reservations):
-- one policy per command named <table>_<cmd>, gated by public.require_permission().
-- Server actions use the service role and bypass RLS.
--
-- Idempotent: safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.production_boms (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One BOM per finished product; saveProductionBomAction looks it up with maybeSingle().
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_boms_finished_product
  ON public.production_boms (finished_product_id);

CREATE TABLE IF NOT EXISTS public.production_bom_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id          UUID NOT NULL REFERENCES public.production_boms(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES public.products(id),
  product_code    TEXT,
  product_name    TEXT NOT NULL,
  warehouse_id    UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name  TEXT,
  quantity        NUMERIC NOT NULL CHECK (quantity > 0),
  unit            TEXT DEFAULT 'Ədəd',
  unit_cost       NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_bom_items_bom_id
  ON public.production_bom_items (bom_id);

ALTER TABLE public.production_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_bom_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_boms_select ON public.production_boms;
CREATE POLICY production_boms_select ON public.production_boms
  FOR SELECT TO authenticated
  USING (public.require_permission('can_view_production'));

DROP POLICY IF EXISTS production_boms_insert ON public.production_boms;
CREATE POLICY production_boms_insert ON public.production_boms
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_boms_update ON public.production_boms;
CREATE POLICY production_boms_update ON public.production_boms
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_production'))
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_boms_delete ON public.production_boms;
CREATE POLICY production_boms_delete ON public.production_boms
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_bom_items_select ON public.production_bom_items;
CREATE POLICY production_bom_items_select ON public.production_bom_items
  FOR SELECT TO authenticated
  USING (public.require_permission('can_view_production'));

DROP POLICY IF EXISTS production_bom_items_insert ON public.production_bom_items;
CREATE POLICY production_bom_items_insert ON public.production_bom_items
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_bom_items_update ON public.production_bom_items;
CREATE POLICY production_bom_items_update ON public.production_bom_items
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_production'))
  WITH CHECK (public.require_permission('can_manage_production'));

DROP POLICY IF EXISTS production_bom_items_delete ON public.production_bom_items;
CREATE POLICY production_bom_items_delete ON public.production_bom_items
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_production'));

REVOKE ALL ON TABLE public.production_boms FROM anon;
REVOKE ALL ON TABLE public.production_bom_items FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
