-- ============================================================================
-- Product stock integrity (fix prompt F2, part A).
--
-- Some products were in the product list but missing from inventory counts.
-- Causes found in the code and confirmed on production (2026-10-29):
--
--   1. A whole-warehouse count only listed products with non-zero stock in that
--      warehouse's warehouse_stocks row (inventory_warehouse_product_ids).
--   2. trg_upsert_warehouse_stock_from_product copied products.stock (the total)
--      onto the most recently touched warehouse_stocks row: with rows in two
--      warehouses, any sale or purchase moved the whole quantity onto one of them.
--   3. Rows without a warehouse only count for the default warehouse.
--   5. product_category_paths read subcategory names from categories, but
--      products.sub_category_id points at sub_categories.
--   6. The count form's category list only showed categories with stock.
--
-- Invariant from now on:
--   - non-polywood stockable product: products.stock = SUM(warehouse_stocks.current_stock)
--   - polywood product: each warehouse row = metres of its available pieces
--
-- How the trigger keeps it: when products.stock changes and the writer did not
-- already set the warehouse rows, the change (NEW.stock - OLD.stock) is added
-- to one warehouse row: the warehouse the writer named with
-- public.stock_sync_use_warehouse(id), otherwise the default warehouse.
-- Writers that set the warehouse rows themselves (count posting, transfers,
-- initial balance, consignment) set the transaction-local flag
-- app.skip_stock_sync while they change products.stock. The total is never
-- written onto a single row again.
--
-- Existing bad data is not changed here: Settings > Stock integrity (admins)
-- previews and fixes it through stock_integrity_report() / stock_integrity_fix().
-- Safe to re-run.
-- ============================================================================

-- ─── 1. Category paths read subcategories from sub_categories ──────────────

-- Effective category → subcategory of every product. A linked child category
-- supplies both levels (parent → itself); otherwise the linked category, then
-- the legacy text. Subcategory: linked child category, then sub_categories
-- (products.sub_category_id), then the legacy text column.
CREATE OR REPLACE VIEW public.product_category_paths
WITH (security_invoker = true) AS
SELECT
  p.id AS product_id,
  NULLIF(btrim(COALESCE(
    CASE WHEN lc.parent_id IS NOT NULL THEN pc.name ELSE lc.name END,
    p.category
  )), '') AS category_name,
  NULLIF(btrim(COALESCE(
    CASE WHEN lc.parent_id IS NOT NULL THEN lc.name END,
    sc.name,
    p.subcategory
  )), '') AS subcategory_name
FROM public.products p
LEFT JOIN public.categories lc ON lc.id = p.category_id
LEFT JOIN public.categories pc ON pc.id = lc.parent_id
LEFT JOIN public.sub_categories sc ON sc.id = p.sub_category_id;

GRANT SELECT ON public.product_category_paths TO authenticated, service_role;

-- ─── 2. Stock sync helpers ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.stock_default_warehouse()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.warehouses
  WHERE COALESCE(is_default, FALSE)
  ORDER BY created_at NULLS LAST, id
  LIMIT 1;
$$;

-- A writer that knows its warehouse names it before changing products.stock;
-- the trigger then moves that warehouse's row. Lasts until the transaction ends.
CREATE OR REPLACE FUNCTION public.stock_sync_use_warehouse(p_warehouse_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  SELECT set_config('app.stock_warehouse_id', COALESCE(p_warehouse_id::text, ''), true);
$$;

-- On while a writer that sets warehouse rows itself changes products.stock.
CREATE OR REPLACE FUNCTION public.stock_sync_skip(p_on BOOLEAN)
RETURNS VOID
LANGUAGE sql
AS $$
  SELECT set_config('app.skip_stock_sync', CASE WHEN p_on THEN 'on' ELSE 'off' END, true);
$$;

-- The warehouse_stocks row of a product in a warehouse. The legacy row without
-- a warehouse belongs to the default warehouse. Creates the row when missing.
CREATE OR REPLACE FUNCTION public._stock_row_for(p_product_id UUID, p_warehouse_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id  UUID;
  v_default UUID := public.stock_default_warehouse();
BEGIN
  IF p_warehouse_id IS NOT NULL THEN
    SELECT id INTO v_row_id FROM public.warehouse_stocks
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
    LIMIT 1;
  END IF;

  IF v_row_id IS NULL AND (p_warehouse_id IS NULL OR p_warehouse_id = v_default) THEN
    SELECT id INTO v_row_id FROM public.warehouse_stocks
    WHERE product_id = p_product_id AND warehouse_id IS NULL
    LIMIT 1;
  END IF;

  IF v_row_id IS NULL THEN
    INSERT INTO public.warehouse_stocks (product_id, warehouse_id, current_stock, min_stock_level, updated_at)
    VALUES (p_product_id, COALESCE(p_warehouse_id, v_default), 0, 0, NOW())
    RETURNING id INTO v_row_id;
  END IF;

  RETURN v_row_id;
END;
$$;

-- Polywood rows follow the pieces: each warehouse row = metres of its available
-- pieces. A warehouse-less row stands for the default warehouse when that
-- warehouse has no row of its own.
CREATE OR REPLACE FUNCTION public._stock_sync_polywood_rows(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default UUID := public.stock_default_warehouse();
  r         RECORD;
  v_row_id  UUID;
BEGIN
  FOR r IN
    SELECT w.wh,
           ROUND(COALESCE(SUM(pp.length_m), 0), 3) AS metres,
           COALESCE(jsonb_agg(pp.length_m ORDER BY pp.length_m DESC) FILTER (WHERE pp.id IS NOT NULL), '[]'::jsonb) AS lengths
    FROM (
      SELECT warehouse_id AS wh FROM public.polywood_pieces
      WHERE product_id = p_product_id AND status = 'available'
      UNION
      SELECT COALESCE(warehouse_id, v_default) FROM public.warehouse_stocks
      WHERE product_id = p_product_id
    ) w
    LEFT JOIN public.polywood_pieces pp
      ON pp.product_id = p_product_id AND pp.status = 'available' AND pp.warehouse_id = w.wh
    WHERE w.wh IS NOT NULL
    GROUP BY w.wh
  LOOP
    v_row_id := public._stock_row_for(p_product_id, r.wh);
    UPDATE public.warehouse_stocks
    SET current_stock = r.metres, piece_lengths = r.lengths, updated_at = NOW()
    WHERE id = v_row_id
      AND (current_stock IS DISTINCT FROM r.metres OR piece_lengths IS DISTINCT FROM r.lengths);
  END LOOP;
END;
$$;

-- ─── 3. The products.stock → warehouse_stocks trigger ──────────────────────

CREATE OR REPLACE FUNCTION public.upsert_warehouse_stock_from_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target UUID;
  v_delta  NUMERIC;
  v_sum    NUMERIC;
  v_rows   INTEGER;
  v_row_id UUID;
  v_min    NUMERIC := COALESCE(NEW.min_stock_level, NEW.min_stock, 0);
BEGIN
  IF current_setting('app.skip_stock_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_target := COALESCE(
    NULLIF(current_setting('app.stock_warehouse_id', true), '')::uuid,
    public.stock_default_warehouse()
  );

  IF NEW.inventory_mode = 'polywood' THEN
    PERFORM public._stock_sync_polywood_rows(NEW.id);
  ELSE
    SELECT COALESCE(SUM(current_stock), 0), COUNT(*) INTO v_sum, v_rows
    FROM public.warehouse_stocks WHERE product_id = NEW.id;

    IF v_rows = 0 THEN
      -- No row yet (new product, or one that never had stock): it holds the total.
      IF TG_OP = 'INSERT' OR COALESCE(NEW.stock, 0) <> 0 OR v_min <> 0 THEN
        INSERT INTO public.warehouse_stocks (product_id, warehouse_id, current_stock, min_stock_level, updated_at)
        VALUES (NEW.id, v_target, COALESCE(NEW.stock, 0), v_min, NOW());
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
      -- When the rows already add up to the new total the writer set them itself.
      IF v_delta <> 0 AND abs(v_sum - COALESCE(NEW.stock, 0)) > 0.0005 THEN
        v_row_id := public._stock_row_for(NEW.id, v_target);
        UPDATE public.warehouse_stocks
        SET current_stock = current_stock + v_delta, updated_at = NOW()
        WHERE id = v_row_id;
      END IF;
    END IF;
  END IF;

  -- The minimum belongs to the product; it is kept on its default-warehouse row.
  IF TG_OP = 'UPDATE'
     AND (NEW.min_stock_level IS DISTINCT FROM OLD.min_stock_level OR NEW.min_stock IS DISTINCT FROM OLD.min_stock) THEN
    v_row_id := public._stock_row_for(NEW.id, public.stock_default_warehouse());
    UPDATE public.warehouse_stocks SET min_stock_level = v_min, updated_at = NOW() WHERE id = v_row_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upsert_warehouse_stock_from_product ON public.products;
CREATE TRIGGER trg_upsert_warehouse_stock_from_product
  AFTER INSERT OR UPDATE OF stock, min_stock, min_stock_level ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.upsert_warehouse_stock_from_product();

-- ─── 4. One call for "this warehouse moved by delta" ────────────────────────

-- Moves a product's stock in one warehouse and its total together, in one
-- transaction. Used by the server for transfers, consignment and initial
-- balances (src/lib/inventory/warehouseProductStock.ts). The warehouse row never
-- goes below zero; the total moves by what was actually applied.
CREATE OR REPLACE FUNCTION public.adjust_warehouse_stock(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_delta        NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id  UUID;
  v_current NUMERIC;
  v_next    NUMERIC;
BEGIN
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION '%', 'Məhsul və anbar göstərilməlidir' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.products WHERE id = p_product_id FOR UPDATE;
  v_row_id := public._stock_row_for(p_product_id, p_warehouse_id);
  SELECT current_stock INTO v_current FROM public.warehouse_stocks WHERE id = v_row_id FOR UPDATE;
  v_next := GREATEST(COALESCE(v_current, 0) + COALESCE(p_delta, 0), 0);

  UPDATE public.warehouse_stocks
  SET current_stock = v_next, warehouse_id = p_warehouse_id, updated_at = NOW()
  WHERE id = v_row_id;

  IF v_next <> COALESCE(v_current, 0) THEN
    PERFORM public.stock_sync_skip(true);
    UPDATE public.products
    SET stock = COALESCE(stock, 0) + (v_next - COALESCE(v_current, 0))
    WHERE id = p_product_id;
    PERFORM public.stock_sync_skip(false);
  END IF;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_warehouse_stock(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_warehouse_stock(UUID, UUID, NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public._stock_row_for(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._stock_sync_polywood_rows(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_default_warehouse() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_sync_use_warehouse(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_sync_skip(BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.stock_sync_skip(BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ─── 5. Warehouse-aware writers set the flag ────────────────────────────────

-- Module functions: only where their module is installed (supabase/modules).
DO $guard$
BEGIN
  -- Inventory counts: the count's warehouse row and the product total, together.
  IF to_regclass('public.inventory_counts') IS NOT NULL THEN
    EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public._inventory_count_set_stock(
      p_product_id    UUID,
      p_warehouse_id  UUID,
      p_new_qty       NUMERIC,
      p_delta         NUMERIC,
      p_piece_lengths JSONB DEFAULT NULL
    )
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      v_row_id UUID;
    BEGIN
      v_row_id := public._stock_row_for(p_product_id, p_warehouse_id);

      IF p_delta <> 0 THEN
        PERFORM public.stock_sync_skip(true);
        UPDATE public.products
        SET stock = GREATEST(COALESCE(stock, 0) + p_delta, 0)
        WHERE id = p_product_id;
        PERFORM public.stock_sync_skip(false);
      END IF;

      UPDATE public.warehouse_stocks
      SET current_stock = GREATEST(p_new_qty, 0),
          warehouse_id = p_warehouse_id,
          piece_lengths = COALESCE(p_piece_lengths, piece_lengths),
          updated_at = NOW()
      WHERE id = v_row_id;
    END;
    $body$
    $fn$;
    EXECUTE 'REVOKE ALL ON FUNCTION public._inventory_count_set_stock(UUID, UUID, NUMERIC, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public._inventory_count_set_stock(UUID, UUID, NUMERIC, NUMERIC, JSONB) TO service_role';

    -- Counts reach every stockable product (not a service, not a composite),
    -- stocked or not: a whole-warehouse count lists them all and the category
    -- list (get_warehouse_active_categories) shows every category that has one.
    -- Uncounted lines are never adjusted, so zero-stock lines cost nothing.
    EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.inventory_warehouse_product_ids(p_warehouse_id UUID)
    RETURNS TABLE (product_id UUID)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $body$
      SELECT p.id
      FROM public.products p
      WHERE EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = p_warehouse_id)
        AND NOT COALESCE(p.is_service, FALSE)
        AND NOT COALESCE(p.is_composite, FALSE);
    $body$
    $fn$;
  END IF;

  -- Initial balance unpost: restore the document's warehouse row by the
  -- document's own quantity (it wrote the product total onto it before).
  IF to_regclass('public.inventory_initial_balances') IS NOT NULL
     AND to_regclass('public.inventory_initial_balance_items') IS NOT NULL THEN
    EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.unpost_inventory_initial_balance(p_document_id uuid, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
     RETURNS jsonb
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $body$
    DECLARE
      -- Server actions call through the service role (no auth.uid()) and pass the
      -- already-authorised user in p_actor; a signed-in caller is always itself.
      v_actor      UUID := COALESCE(auth.uid(), p_actor);
      v_doc        RECORD;
      v_ref        TEXT;
      v_label      TEXT;
      r            RECORD;
      v_is_metric  BOOLEAN;
      v_value      NUMERIC;
      v_old_stock  NUMERIC;
      v_old_buy    NUMERIC;
      v_new_stock  NUMERIC;
      v_new_buy    NUMERIC;
      v_row_id     UUID;
      v_moves      INTEGER := 0;
      v_journals   INTEGER := 0;
    BEGIN
      IF auth.uid() IS NOT NULL
         AND NOT (public.user_is_admin() OR public.has_permission('can_unpost_inventory')) THEN
        RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
      END IF;

      IF p_document_id IS NULL THEN
        RAISE EXCEPTION '%', 'Sənəd ID-si göstərilməyib' USING ERRCODE = '22023';
      END IF;

      SELECT * INTO v_doc
      FROM public.inventory_initial_balances
      WHERE id = p_document_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'Sənəd tapılmadı' USING ERRCODE = 'P0002';
      END IF;

      IF v_doc.status <> 'posted' THEN
        RAISE EXCEPTION '%', 'Yalnız təsdiqlənmiş sənəd qaralamaya qaytarıla bilər' USING ERRCODE = '22023';
      END IF;

      IF public.is_accounting_period_closed(v_doc.doc_date) THEN
        RAISE EXCEPTION '%', format(
          'Sənəd tarixi bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
          to_char(v_doc.doc_date, 'YYYY-MM')
        ) USING ERRCODE = '22023';
      END IF;

      v_ref := CASE WHEN v_doc.entry_type = 'receipt' THEN 'stock_receipt' ELSE 'initial_balance' END;
      v_label := v_doc.document_number;

      -- ─── Guards: nothing from this document may have left the warehouse ──────

      IF EXISTS (
        SELECT 1 FROM public.inventory_batches
        WHERE document_id = p_document_id
          AND document_type = v_ref
          AND remaining_qty < initial_qty
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənədlə daxil olan stokun bir hissəsi artıq satılıb və ya istifadə olunub. Qaralamaya qaytarmaq mümkün deyil — silinmə və ya düzəliş sənədi ilə düzəldin.'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.polywood_pieces
        WHERE source_document_id = p_document_id
          AND status <> 'available'
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənədlə daxil olan hissələrin bəziləri artıq satılıb və ya kəsilib. Qaralamaya qaytarmaq mümkün deyil.'
          USING ERRCODE = '22023';
      END IF;

      -- Metric lines posted before pieces were linked to their document cannot be
      -- told apart from other pieces of the same product, so refuse rather than guess.
      IF EXISTS (
        SELECT 1 FROM public.inventory_initial_balance_items i
        WHERE i.document_id = p_document_id
          AND i.is_metric
          AND NOT EXISTS (
            SELECT 1 FROM public.polywood_pieces pp
            WHERE pp.source_document_id = p_document_id
              AND pp.product_id = i.product_id
          )
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənəddəki metrik hissələr köhnə qaydada təsdiqlənib və sənədə bağlı deyil. Avtomatik geri qaytarmaq mümkün deyil — administratorla əlaqə saxlayın.'
          USING ERRCODE = '22023';
      END IF;

      -- ─── Reverse stock, per product and warehouse ────────────────────────────
      -- Net the document's own movements so earlier post/unpost cycles cancel out.

      FOR r IN
        SELECT
          m.product_id,
          m.warehouse_id,
          MIN(m.unit) AS unit,
          SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) AS net_qty
        FROM public.stock_movements m
        WHERE m.reference_id = p_document_id
          AND m.reference_type = v_ref
        GROUP BY m.product_id, m.warehouse_id
        HAVING SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) > 0.0005
      LOOP
        SELECT EXISTS (
          SELECT 1 FROM public.inventory_initial_balance_items i
          WHERE i.document_id = p_document_id AND i.product_id = r.product_id AND i.is_metric
        ) INTO v_is_metric;

        SELECT COALESCE(SUM(
          (CASE WHEN i.is_metric THEN COALESCE(i.metric_total_meters, i.quantity) ELSE i.quantity END) * i.unit_cost
        ), 0)
        INTO v_value
        FROM public.inventory_initial_balance_items i
        WHERE i.document_id = p_document_id AND i.product_id = r.product_id;

        SELECT COALESCE(stock, 0), COALESCE(buy_price, 0)
        INTO v_old_stock, v_old_buy
        FROM public.products
        WHERE id = r.product_id
        FOR UPDATE;

        IF v_is_metric THEN
          DELETE FROM public.polywood_pieces
          WHERE source_document_id = p_document_id
            AND product_id = r.product_id;

          -- Polywood stock = available metres in every warehouse.
          SELECT ROUND(COALESCE(SUM(length_m), 0), 3)
          INTO v_new_stock
          FROM public.polywood_pieces
          WHERE product_id = r.product_id
            AND status = 'available';
        ELSE
          IF v_old_stock + 0.0005 < r.net_qty THEN
            RAISE EXCEPTION '%', format(
              'Məhsulun cari qalığı (%s) bu sənədin daxil etdiyi miqdardan (%s) azdır — stok artıq çıxarılıb. Qaralamaya qaytarmaq mümkün deyil.',
              v_old_stock, r.net_qty
            ) USING ERRCODE = '22023';
          END IF;
          v_new_stock := v_old_stock - r.net_qty;
        END IF;

        -- Undo the weighted-average cost the posting applied.
        v_new_buy := v_old_buy;
        IF v_new_stock > 0 THEN
          v_new_buy := ROUND((v_old_stock * v_old_buy - v_value) / v_new_stock, 2);
          IF v_new_buy < 0 THEN
            v_new_buy := v_old_buy;
          END IF;
        END IF;

        PERFORM public.stock_sync_skip(true);
        UPDATE public.products
        SET stock = v_new_stock, buy_price = v_new_buy
        WHERE id = r.product_id;
        PERFORM public.stock_sync_skip(false);

        IF v_is_metric THEN
          PERFORM public._stock_sync_polywood_rows(r.product_id);
        ELSE
          v_row_id := public._stock_row_for(r.product_id, r.warehouse_id);
          UPDATE public.warehouse_stocks
          SET current_stock = GREATEST(current_stock - r.net_qty, 0), updated_at = NOW()
          WHERE id = v_row_id;
        END IF;

        INSERT INTO public.stock_movements (
          product_id, warehouse_id, movement_type, quantity, unit,
          reference_type, reference_id, description, created_by
        )
        VALUES (
          r.product_id, r.warehouse_id, 'out', r.net_qty, r.unit,
          v_ref, p_document_id, 'STORNO: ' || v_label, v_actor
        );

        v_moves := v_moves + 1;
      END LOOP;

      IF v_moves = 0 AND EXISTS (
        SELECT 1 FROM public.inventory_initial_balance_items WHERE document_id = p_document_id
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənəd üçün anbar hərəkəti tapılmadı. Avtomatik geri qaytarmaq mümkün deyil — administratorla əlaqə saxlayın.'
          USING ERRCODE = '22023';
      END IF;

      -- FIFO layers were verified untouched above; re-posting creates fresh ones.
      DELETE FROM public.inventory_batches
      WHERE document_id = p_document_id
        AND document_type = v_ref;

      -- Ledger is immutable: offset any postings with storno entries.
      v_journals := public.reverse_document_journals(
        p_document_id,
        'Qaralamaya qaytarıldı: ' || v_label || COALESCE(' — ' || NULLIF(trim(p_reason), ''), '')
      );

      UPDATE public.inventory_initial_balances
      SET status = 'draft',
          posted_at = NULL,
          posted_by = NULL,
          unposted_at = NOW(),
          unposted_by = v_actor,
          unpost_reason = NULLIF(trim(p_reason), ''),
          updated_at = NOW()
      WHERE id = p_document_id;

      RETURN jsonb_build_object(
        'document_number', v_label,
        'movements_reversed', v_moves,
        'journals_reversed', v_journals
      );
    END;
    $body$
    $fn$;
  END IF;

  -- Consignment: the dispatch warehouse's row and the product total, together.
  IF to_regclass('public.consignment_dispatches') IS NOT NULL THEN
    EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.consignment_adjust_warehouse_stock(p_product_id uuid, p_warehouse_id uuid, p_delta numeric)
     RETURNS void
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $body$
    BEGIN
      PERFORM public.adjust_warehouse_stock(p_product_id, p_warehouse_id, p_delta);
    END;
    $body$
    $fn$;
  END IF;
END;
$guard$;

-- ─── 6. Settings > Stock integrity (admins) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public._stock_integrity_authorize()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role callers (the admin-only server action) have checked the user.
  IF auth.uid() IS NOT NULL AND NOT public.user_is_admin() THEN
    RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- The checks of supabase/scripts/product_integrity_check.sql, one row per
-- product and issue. fixable = stock_integrity_fix() can correct it safely;
-- stock_before / stock_after show what a fix would write.
CREATE OR REPLACE FUNCTION public.stock_integrity_report()
RETURNS TABLE (
  issue        TEXT,
  product_id   UUID,
  product_code TEXT,
  product_name TEXT,
  details      TEXT,
  fixable      BOOLEAN,
  stock_before NUMERIC,
  stock_after  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._stock_integrity_authorize();

  RETURN QUERY
  WITH
  default_wh AS (SELECT public.stock_default_warehouse() AS id),
  ws AS (
    SELECT
      w.product_id,
      COUNT(*)                                       AS n_rows,
      COUNT(*) FILTER (WHERE w.warehouse_id IS NULL) AS null_rows,
      COALESCE(SUM(w.current_stock), 0)              AS total,
      COALESCE(SUM(w.current_stock) FILTER (WHERE w.warehouse_id IS NULL), 0) AS null_total
    FROM public.warehouse_stocks w
    GROUP BY w.product_id
  ),
  pieces AS (
    SELECT pp.product_id, ROUND(COALESCE(SUM(pp.length_m), 0), 3) AS metres, COUNT(*) AS n
    FROM public.polywood_pieces pp
    WHERE pp.status = 'available'
    GROUP BY pp.product_id
  ),
  p AS (
    SELECT
      pr.id, pr.code, pr.name, pr.stock, pr.category, pr.category_id, pr.subcategory, pr.sub_category_id, pr.barcode,
      COALESCE(pr.is_service, FALSE)   AS svc,
      COALESCE(pr.is_composite, FALSE) AS comp,
      pr.inventory_mode = 'polywood'   AS metric
    FROM public.products pr
  ),
  issues AS (
    SELECT p.id, 'service_or_composite'::text AS issue,
           CASE WHEN p.svc THEN 'service' ELSE 'composite' END AS details,
           FALSE AS fixable, NULL::numeric AS before, NULL::numeric AS after
    FROM p WHERE p.svc OR p.comp

    UNION ALL
    SELECT p.id, 'no_stock_row', 'products.stock = ' || COALESCE(p.stock, 0), FALSE, NULL, NULL
    FROM p LEFT JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric AND ws.product_id IS NULL

    UNION ALL
    SELECT p.id,
           CASE WHEN (SELECT id FROM default_wh) IS NOT NULL THEN 'null_warehouse_row' ELSE 'null_row_no_default' END,
           'stock without warehouse = ' || ws.null_total,
           (SELECT id FROM default_wh) IS NOT NULL, NULL, NULL
    FROM p JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric AND ws.null_rows > 0

    UNION ALL
    SELECT p.id, 'total_mismatch',
           format('products.stock = %s, warehouses sum = %s', COALESCE(p.stock, 0), ws.total),
           TRUE, COALESCE(p.stock, 0), ws.total
    FROM p JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric
      AND abs(COALESCE(p.stock, 0) - ws.total) > 0.0005
      AND EXISTS (SELECT 1 FROM public.warehouse_stocks w WHERE w.product_id = p.id AND COALESCE(w.current_stock, 0) <> 0)

    UNION ALL
    SELECT p.id, 'stock_only_in_list',
           format('products.stock = %s, every warehouse row = 0', p.stock),
           TRUE, COALESCE(p.stock, 0), 0::numeric
    FROM p JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric
      AND COALESCE(p.stock, 0) <> 0
      AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_stocks w
        WHERE w.product_id = p.id AND COALESCE(w.current_stock, 0) <> 0
      )

    UNION ALL
    SELECT p.id, 'polywood_mismatch',
           format('products.stock = %s m, available pieces = %s m', COALESCE(p.stock, 0), COALESCE(pc.metres, 0)),
           FALSE, COALESCE(p.stock, 0), pc.metres
    FROM p LEFT JOIN pieces pc ON pc.product_id = p.id
    WHERE p.metric AND NOT p.svc AND NOT p.comp
      AND COALESCE(pc.n, 0) > 0
      AND abs(COALESCE(p.stock, 0) - pc.metres) > 0.0005

    UNION ALL
    SELECT p.id, 'polywood_no_pieces', format('products.stock = %s m', p.stock), FALSE, NULL, NULL
    FROM p LEFT JOIN pieces pc ON pc.product_id = p.id
    WHERE p.metric AND NOT p.svc AND NOT p.comp
      AND COALESCE(p.stock, 0) <> 0 AND COALESCE(pc.n, 0) = 0

    UNION ALL
    SELECT p.id, 'subcategory_lost', 'sub_categories.name = ' || sc.name, TRUE, NULL, NULL
    FROM p JOIN public.sub_categories sc ON sc.id = p.sub_category_id
    WHERE NULLIF(btrim(COALESCE(p.subcategory, '')), '') IS NULL

    UNION ALL
    SELECT p.id, 'category_text_differs',
           format('category_id → %s, text = %s', COALESCE(pc.name, c.name), COALESCE(p.category, '∅')),
           FALSE, NULL, NULL
    FROM p
    JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.categories pc ON pc.id = c.parent_id
    WHERE lower(btrim(COALESCE(pc.name, c.name))) <> lower(btrim(COALESCE(p.category, '')))

    UNION ALL
    SELECT p.id, 'no_category', '', FALSE, NULL, NULL
    FROM p
    WHERE NOT p.svc AND NOT p.comp
      AND p.category_id IS NULL
      AND NULLIF(btrim(COALESCE(p.category, '')), '') IS NULL

    UNION ALL
    SELECT p.id, 'duplicate_code', 'code = ' || p.code, FALSE, NULL, NULL
    FROM p
    WHERE p.code IS NOT NULL
      AND (SELECT COUNT(*) FROM public.products o WHERE lower(btrim(o.code)) = lower(btrim(p.code))) > 1

    UNION ALL
    SELECT p.id, 'duplicate_barcode', 'barcode = ' || p.barcode, FALSE, NULL, NULL
    FROM p
    WHERE NULLIF(btrim(COALESCE(p.barcode, '')), '') IS NOT NULL
      AND (SELECT COUNT(*) FROM public.products o WHERE btrim(o.barcode) = btrim(p.barcode)) > 1
  )
  SELECT i.issue, i.id, pr.code, pr.name, i.details, i.fixable, i.before, i.after
  FROM issues i
  JOIN public.products pr ON pr.id = i.id
  ORDER BY i.issue, pr.name;
END;
$$;

-- Fixes the safe kinds. p_product_ids NULL = every product with that issue.
--   null_warehouse_row  the row moves onto the default warehouse (merged into
--                       that warehouse's row when one exists)
--   total_mismatch, stock_only_in_list
--                       products.stock := sum of the warehouse rows (the rows are
--                       what was counted); the rows themselves do not change
--   subcategory_lost    products.subcategory := sub_categories.name
-- No ledger entries: these correct cached totals, not value. Every fix is
-- written to audit_logs (action UPDATE, event stock_integrity_fix).
CREATE OR REPLACE FUNCTION public.stock_integrity_fix(
  p_issue       TEXT,
  p_product_ids UUID[] DEFAULT NULL,
  p_actor       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := COALESCE(auth.uid(), p_actor);
  v_default UUID := public.stock_default_warehouse();
  r         RECORD;
  v_target  UUID;
  v_sum     NUMERIC;
  v_fixed   INTEGER := 0;
  v_items   JSONB := '[]'::jsonb;
BEGIN
  PERFORM public._stock_integrity_authorize();

  IF p_issue NOT IN ('null_warehouse_row', 'total_mismatch', 'stock_only_in_list', 'subcategory_lost') THEN
    RAISE EXCEPTION '%', format('Bu növ avtomatik düzəldilmir: %s', COALESCE(p_issue, 'null')) USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT * FROM public.stock_integrity_report() s
    WHERE s.issue = p_issue
      AND s.fixable
      AND (p_product_ids IS NULL OR s.product_id = ANY (p_product_ids))
  LOOP
    PERFORM 1 FROM public.products WHERE id = r.product_id FOR UPDATE;

    IF p_issue = 'null_warehouse_row' THEN
      IF v_default IS NULL THEN
        CONTINUE;
      END IF;
      SELECT id INTO v_target FROM public.warehouse_stocks
      WHERE product_id = r.product_id AND warehouse_id = v_default;

      IF v_target IS NULL THEN
        UPDATE public.warehouse_stocks
        SET warehouse_id = v_default, updated_at = NOW()
        WHERE product_id = r.product_id AND warehouse_id IS NULL;
      ELSE
        UPDATE public.warehouse_stocks t
        SET current_stock = t.current_stock + n.current_stock,
            min_stock_level = GREATEST(t.min_stock_level, n.min_stock_level),
            updated_at = NOW()
        FROM public.warehouse_stocks n
        WHERE t.id = v_target AND n.product_id = r.product_id AND n.warehouse_id IS NULL;
        DELETE FROM public.warehouse_stocks WHERE product_id = r.product_id AND warehouse_id IS NULL;
      END IF;

    ELSIF p_issue IN ('total_mismatch', 'stock_only_in_list') THEN
      SELECT COALESCE(SUM(current_stock), 0) INTO v_sum
      FROM public.warehouse_stocks WHERE product_id = r.product_id;
      PERFORM public.stock_sync_skip(true);
      UPDATE public.products SET stock = v_sum WHERE id = r.product_id;
      PERFORM public.stock_sync_skip(false);

    ELSIF p_issue = 'subcategory_lost' THEN
      UPDATE public.products p
      SET subcategory = sc.name
      FROM public.sub_categories sc
      WHERE p.id = r.product_id AND sc.id = p.sub_category_id;
    END IF;

    INSERT INTO public.audit_logs (id, user_id, action, module, table_name, record_id, old_values_json, new_values_json, created_at)
    VALUES (
      gen_random_uuid(), v_actor, 'UPDATE', 'INVENTORY', 'products', r.product_id,
      jsonb_build_object('event', 'stock_integrity_fix', 'issue', p_issue, 'details', r.details, 'stock', r.stock_before),
      jsonb_build_object('event', 'stock_integrity_fix', 'issue', p_issue, 'stock', r.stock_after),
      NOW()
    );

    v_fixed := v_fixed + 1;
    v_items := v_items || jsonb_build_object(
      'product_id', r.product_id, 'product_code', r.product_code,
      'stock_before', r.stock_before, 'stock_after', r.stock_after
    );
  END LOOP;

  RETURN jsonb_build_object('issue', p_issue, 'fixed', v_fixed, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public._stock_integrity_authorize() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_integrity_report() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_integrity_fix(TEXT, UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._stock_integrity_authorize() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_integrity_report() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_integrity_fix(TEXT, UUID[], UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
