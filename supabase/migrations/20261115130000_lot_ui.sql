-- ============================================================================
-- LOT-4: reads of the lot screens (plan docs/lot-tracking/LOT-plan.md, section 9).
--
-- Read-only. The lot list reads stock_lots / stock_lot_balances directly (RLS: lots.view); the
-- lot card uses three functions so a lot with thousands of movements stays fast:
--   * lot_card_summary(lot)        received, on hand, sold, written off, at consignment
--                                  partners, in production, counts and dates (one pass);
--   * lot_movements_page(lot, ..)  one page of the movements, newest first, with the running
--                                  balance of the lot and the total count;
--   * lot_trace_forward(lot)       where the lot went: customers and consignment partners per
--                                  document, net of returns.
-- All are SECURITY INVOKER (RLS applies) and refuse without lots.view. They use the index
-- stock_lot_movements (lot_id, movement_date) of LOT-1.
-- Lots also carry chatter: stock_lots joins chatter_models().
-- Needs 20261115100000 (LOT-1). Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.stock_lot_movements') IS NULL THEN
    RAISE EXCEPTION 'Run 20261115100000_lot_core.sql (LOT-1) before 20261115130000_lot_ui.sql';
  END IF;
END
$$;

-- ─── Chatter on lots ────────────────────────────────────────────────────────

create or replace function public.chatter_models()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'accounts', 'contracts', 'customers', 'deals', 'employee_advances', 'employee_leaves', 'employees',
    'expenses', 'import_shipments', 'inventory_counts', 'inventory_initial_balances', 'inventory_writeoffs', 'payments',
    'payrolls', 'production_orders', 'products', 'purchases', 'sales', 'sales_commissions', 'stock_lots', 'suppliers',
    'todo_tasks', 'transactions', 'warehouse_slips'
  ]::text[];
$$;

-- ─── Lot card: key figures ──────────────────────────────────────────────────
-- Net figures: a reversal (cancel, void, return) counts against what it reverses.
--   received        in-movements that brought the lot in (kind 'in'), less their reversals
--                   (a cancelled receipt); transfers and returns are not receipts
--   sold            net out to customers (sales and production deliveries)
--   written_off     net out on write-offs
--   at_partners     sent to consignment partners and not returned
--   in_production   issued to production orders as material, less returns
CREATE OR REPLACE FUNCTION public.lot_card_summary(p_lot UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT public.lots_can('view') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lotları görmək üçün icazəniz yoxdur';
  END IF;
  SELECT jsonb_build_object(
    'received', COALESCE(SUM(m.qty_delta) FILTER (WHERE m.kind = 'in' OR (m.kind = 'reverse_out' AND r.kind = 'in')), 0),
    'sold', COALESCE(-SUM(m.qty_delta) FILTER (WHERE m.counterparty_type = 'customer'), 0),
    'written_off', COALESCE(-SUM(m.qty_delta) FILTER (WHERE m.doc_type = 'inventory_writeoff'), 0),
    'at_partners', COALESCE(-SUM(m.qty_delta) FILTER (WHERE m.doc_type IN ('consignment_dispatch', 'consignment_settlement')), 0),
    'in_production', COALESCE(-SUM(m.qty_delta) FILTER (WHERE m.doc_type = 'production_order' AND m.kind IN ('out', 'reverse_in')), 0),
    'movement_count', COUNT(*),
    'first_movement', MIN(m.movement_date),
    'last_movement', MAX(m.movement_date)
  )
  INTO v
  FROM public.stock_lot_movements m
  LEFT JOIN public.stock_lot_movements r ON r.id = m.reverses_movement_id
  WHERE m.lot_id = p_lot;
  RETURN v || jsonb_build_object(
    'on_hand', COALESCE((SELECT SUM(b.qty) FROM public.stock_lot_balances b WHERE b.lot_id = p_lot), 0));
END;
$$;

-- ─── Lot card: movements, one page ──────────────────────────────────────────
-- Newest first; running_balance is the lot's balance (all warehouses) after the movement.
CREATE OR REPLACE FUNCTION public.lot_movements_page(p_lot UUID, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0)
RETURNS TABLE (
  id UUID, movement_date TIMESTAMPTZ, recorded_at TIMESTAMPTZ, warehouse_id UUID, qty_delta NUMERIC,
  running_balance NUMERIC, kind TEXT, doc_type TEXT, doc_id UUID, doc_line_id UUID, doc_no TEXT,
  counterparty_type TEXT, counterparty_id UUID, pick_mode TEXT, reverses_movement_id UUID,
  created_by UUID, total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.lots_can('view') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lotları görmək üçün icazəniz yoxdur';
  END IF;
  RETURN QUERY
  WITH ordered AS (
    SELECT m.*, SUM(m.qty_delta) OVER (ORDER BY m.movement_date, m.recorded_at, m.id) AS running,
           COUNT(*) OVER () AS total
    FROM public.stock_lot_movements m
    WHERE m.lot_id = p_lot
  )
  SELECT o.id, o.movement_date, o.recorded_at, o.warehouse_id, o.qty_delta, o.running, o.kind, o.doc_type, o.doc_id,
         o.doc_line_id, o.doc_no, o.counterparty_type, o.counterparty_id, o.pick_mode, o.reverses_movement_id,
         o.created_by, o.total
  FROM ordered o
  ORDER BY o.movement_date DESC, o.recorded_at DESC, o.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

-- ─── Lot card: forward trace ────────────────────────────────────────────────
-- Customers per document (sale, production delivery), net of cancels and returns; consignment
-- partners per partner (what was dispatched and not returned), with the dispatch numbers.
CREATE OR REPLACE FUNCTION public.lot_trace_forward(p_lot UUID)
RETURNS TABLE (
  counterparty_type TEXT, counterparty_id UUID, doc_type TEXT, doc_id UUID, doc_no TEXT,
  qty NUMERIC, first_date TIMESTAMPTZ, last_date TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.lots_can('view') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lotları görmək üçün icazəniz yoxdur';
  END IF;
  RETURN QUERY
  SELECT m.counterparty_type, m.counterparty_id,
         CASE WHEN m.counterparty_type = 'partner' THEN 'consignment' ELSE m.doc_type END,
         CASE WHEN m.counterparty_type = 'partner' THEN NULL ELSE m.doc_id END,
         string_agg(DISTINCT m.doc_no, ', ') FILTER (WHERE m.qty_delta < 0),
         -SUM(m.qty_delta), MIN(m.movement_date), MAX(m.movement_date)
  FROM public.stock_lot_movements m
  WHERE m.lot_id = p_lot AND m.counterparty_type IN ('customer', 'partner')
  GROUP BY 1, 2, 3, 4
  HAVING -SUM(m.qty_delta) > 0.0000005
  ORDER BY MIN(m.movement_date);
END;
$$;

REVOKE ALL ON FUNCTION public.lot_card_summary(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lot_movements_page(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lot_trace_forward(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lot_card_summary(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lot_movements_page(UUID, INTEGER, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lot_trace_forward(UUID) TO authenticated, service_role;
