-- ============================================================================
-- Anbar inventarizasiyası — document-based stocktaking (1C «Инвентаризация
-- товаров», Odoo physical inventory, SAP MI01→MI04→MI07).
--
-- Lifecycle:  draft ─start→ in_progress ─submit→ review ─post→ posted
--                              ↑                   │
--                              └──────reopen───────┘
--
--   draft        header only: warehouse, optional category (cycle count)
--   in_progress  lines generated; the book quantity is frozen per line as
--                expected_qty; counters enter or scan actual quantities
--   review       counting closed; the manager checks variances; lines whose
--                book quantity moved during the count are flagged (drift)
--   posted       stock corrected through stock_movements, FIFO layers and
--                polywood pieces; the variance is booked in the ledger:
--                  surplus   Dt 1300 Anbar          Ct 4950 İnventar artığı
--                  shortage  Dt 6250 İnv. çatışmazl. Ct 1300 Anbar
--
-- Uncounted lines (actual_qty IS NULL) are never adjusted. A count applies
-- the difference (actual − frozen book qty) to the stock at posting time, so
-- sales made after a shelf was counted are not undone.
--
-- Replaces the flat inventory_audits form, which overwrote products.stock
-- with no movements, no warehouse scope and no ledger entries.
-- ============================================================================

-- ─── 0. Retire the flat audit tables (only when they hold no data) ──────────

DO $$
BEGIN
  IF to_regclass('public.inventory_adjustment_vouchers') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inventory_adjustment_vouchers)
     AND NOT EXISTS (SELECT 1 FROM public.inventory_audits) THEN
    DROP TABLE public.inventory_adjustment_vouchers;
    DROP TABLE public.inventory_audit_items;
    DROP TABLE public.inventory_audits;
  END IF;
END;
$$;

-- ─── 1. Ledger accounts for count variances ─────────────────────────────────

INSERT INTO public.chart_of_accounts (code, name, account_type, is_active)
VALUES
  ('4950', 'İnventarizasiya artığı (gəlir)', 'revenue', true),
  ('6250', 'İnventarizasiya çatışmazlığı (xərc)', 'expense', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, account_type = EXCLUDED.account_type, is_active = true;

-- ─── 2. FIFO consumptions can now come from non-sale documents ──────────────

ALTER TABLE public.inventory_batch_consumptions
  ALTER COLUMN sale_id DROP NOT NULL;

ALTER TABLE public.inventory_batch_consumptions
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE INDEX IF NOT EXISTS idx_inventory_batch_consumptions_source
  ON public.inventory_batch_consumptions (source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ─── 3. Documents ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number       TEXT NOT NULL UNIQUE,
  count_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id          UUID NOT NULL REFERENCES public.warehouses(id),
  warehouse_name        TEXT,
  -- Cycle-count scope, matched case-insensitively against product_category_paths.
  category_name         TEXT,
  subcategory_name      TEXT CHECK (subcategory_name IS NULL OR category_name IS NOT NULL),
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'review', 'posted')),
  responsible_name      TEXT,
  notes                 TEXT,
  line_count            INTEGER NOT NULL DEFAULT 0,
  counted_count         INTEGER NOT NULL DEFAULT 0,
  total_surplus_value   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_shortage_value  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_variance_value  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  journal_entry_id      UUID REFERENCES public.journal_entries(id),
  created_by            UUID REFERENCES auth.users(id),
  created_by_name       TEXT,
  started_at            TIMESTAMPTZ,
  submitted_at          TIMESTAMPTZ,
  posted_at             TIMESTAMPTZ,
  posted_by             UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_counts_date
  ON public.inventory_counts (count_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_open
  ON public.inventory_counts (warehouse_id, status)
  WHERE status IN ('in_progress', 'review');

CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id             UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL DEFAULT 0,
  product_id           UUID NOT NULL REFERENCES public.products(id),
  product_code         TEXT,
  product_name         TEXT NOT NULL,
  unit                 TEXT,
  barcode              TEXT,
  -- Polywood / metric products are counted piece by piece.
  is_metric            BOOLEAN NOT NULL DEFAULT FALSE,
  full_sheet_length_m  NUMERIC,
  expected_qty         NUMERIC NOT NULL DEFAULT 0,
  expected_full_sheets INTEGER,
  expected_cut_pieces  JSONB,
  actual_qty           NUMERIC CHECK (actual_qty IS NULL OR actual_qty >= 0),
  actual_full_sheets   INTEGER CHECK (actual_full_sheets IS NULL OR actual_full_sheets >= 0),
  actual_cut_pieces    JSONB,
  scanned_piece_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  unit_cost            NUMERIC(14, 4) NOT NULL DEFAULT 0,
  difference           NUMERIC GENERATED ALWAYS AS (actual_qty - expected_qty) STORED,
  variance_value       NUMERIC GENERATED ALWAYS AS (ROUND((actual_qty - expected_qty) * unit_cost, 2)) STORED,
  -- Book quantity at review minus the frozen expected_qty: stock moved mid-count.
  drift_qty            NUMERIC NOT NULL DEFAULT 0,
  applied_qty          NUMERIC,
  applied_value        NUMERIC(14, 2),
  counted_at           TIMESTAMPTZ,
  counted_by           UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (count_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count
  ON public.inventory_count_items (count_id, line_no);

-- Metric lines derive actual_qty (metres) from the piece breakdown; without
-- a breakdown a metric line is uncounted, never "zero pieces".
CREATE OR REPLACE FUNCTION public.inventory_count_item_derive()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_metric AND NEW.actual_full_sheets IS NULL AND NEW.actual_cut_pieces IS NULL THEN
    NEW.actual_qty := NULL;
  ELSIF NEW.is_metric THEN
    NEW.actual_qty := ROUND(
      COALESCE(NEW.actual_full_sheets, 0) * COALESCE(NEW.full_sheet_length_m, 0)
      + COALESCE((
          SELECT SUM(value::numeric)
          FROM jsonb_array_elements_text(COALESCE(NEW.actual_cut_pieces, '[]'::jsonb))
        ), 0),
      3
    );
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_count_item_derive ON public.inventory_count_items;
CREATE TRIGGER trg_inventory_count_item_derive
  BEFORE INSERT OR UPDATE ON public.inventory_count_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_count_item_derive();

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

SELECT public._apply_table_rls('inventory_counts', 'can_view_products',
  'can_writeoff_inventory', 'can_writeoff_inventory', 'can_writeoff_inventory');
SELECT public._apply_table_rls('inventory_count_items', 'can_view_products',
  'can_writeoff_inventory', 'can_writeoff_inventory', 'can_writeoff_inventory');

-- Header changes (status transitions, posting) land in the audit log.
SELECT public.audit_attach_trigger(
  'inventory_counts',
  'trg_audit_inventory_counts',
  'INSERT OR UPDATE OR DELETE',
  'INVENTORY'
);

-- ─── 4. Helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_inventory_count_doc_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_no   INT;
BEGIN
  INSERT INTO public.document_number_counters (doc_type, year, last_no)
  VALUES ('inventory_count', v_year, 1)
  ON CONFLICT (doc_type, year)
  DO UPDATE SET last_no = public.document_number_counters.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN 'INV-' || v_year::TEXT || '-' || lpad(v_no::TEXT, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public._inventory_count_authorize(p_permission TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role callers (server actions) have already authorised the user.
  IF auth.uid() IS NOT NULL
     AND NOT (public.user_is_admin() OR public.has_permission(p_permission)) THEN
    RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._inventory_count_lock(p_count_id UUID, p_status TEXT[])
RETURNS public.inventory_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.inventory_counts;
BEGIN
  SELECT * INTO v_doc FROM public.inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', 'İnventarizasiya sənədi tapılmadı' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_doc.status = ANY (p_status)) THEN
    RAISE EXCEPTION '%', format('Bu əməliyyat «%s» statusunda mümkün deyil', v_doc.status)
      USING ERRCODE = '22023';
  END IF;
  RETURN v_doc;
END;
$$;

-- Book quantity of a product in a warehouse. Legacy stock rows without a
-- warehouse belong to the default warehouse; polywood stock is its pieces.
CREATE OR REPLACE FUNCTION public.inventory_count_book_qty(p_product_id UUID, p_warehouse_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty NUMERIC;
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND inventory_mode = 'polywood') THEN
    SELECT ROUND(COALESCE(SUM(length_m), 0), 3) INTO v_qty
    FROM public.polywood_pieces
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND status = 'available';
    RETURN v_qty;
  END IF;

  SELECT current_stock INTO v_qty
  FROM public.warehouse_stocks
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
  LIMIT 1;
  IF FOUND THEN
    RETURN COALESCE(v_qty, 0);
  END IF;

  IF EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id AND is_default) THEN
    SELECT current_stock INTO v_qty
    FROM public.warehouse_stocks
    WHERE product_id = p_product_id AND warehouse_id IS NULL
    LIMIT 1;
    RETURN COALESCE(v_qty, 0);
  END IF;

  RETURN 0;
END;
$$;

-- Unit cost used to value variances: weighted buy price; polywood per metre.
CREATE OR REPLACE FUNCTION public.inventory_count_unit_cost(p_product_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(COALESCE(
    CASE WHEN p.inventory_mode = 'polywood'
      THEN COALESCE(NULLIF(p.buy_price_cut, 0), p.buy_price / NULLIF(p.full_sheet_length_m, 0))
      ELSE p.buy_price
    END, 0), 4)
  FROM public.products p
  WHERE p.id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION public.inventory_count_refresh_totals(p_count_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.inventory_counts c
  SET line_count = t.lines,
      counted_count = t.counted,
      total_surplus_value = t.surplus,
      total_shortage_value = t.shortage,
      total_variance_value = t.surplus - t.shortage,
      updated_at = NOW()
  FROM (
    SELECT
      COUNT(*)::int AS lines,
      COUNT(actual_qty)::int AS counted,
      COALESCE(SUM(GREATEST(COALESCE(applied_value, variance_value), 0)), 0) AS surplus,
      COALESCE(SUM(GREATEST(-COALESCE(applied_value, variance_value), 0)), 0) AS shortage
    FROM public.inventory_count_items
    WHERE count_id = p_count_id
  ) t
  WHERE c.id = p_count_id;
$$;

-- Rewrites a warehouse's stock row and moves the product total by p_delta.
-- trg_upsert_warehouse_stock_from_product copies products.stock onto the most
-- recently touched warehouse_stocks row, so this row is touched first and
-- corrected last — otherwise another warehouse's row would be overwritten.
CREATE OR REPLACE FUNCTION public._inventory_count_set_stock(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_new_qty      NUMERIC,
  p_delta        NUMERIC,
  p_piece_lengths JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id UUID;
BEGIN
  SELECT id INTO v_row_id FROM public.warehouse_stocks
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
  LIMIT 1;

  IF v_row_id IS NULL AND EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id AND is_default) THEN
    SELECT id INTO v_row_id FROM public.warehouse_stocks
    WHERE product_id = p_product_id AND warehouse_id IS NULL
    LIMIT 1;
  END IF;

  IF v_row_id IS NULL THEN
    INSERT INTO public.warehouse_stocks (product_id, warehouse_id, current_stock, updated_at)
    VALUES (p_product_id, p_warehouse_id, 0, clock_timestamp())
    RETURNING id INTO v_row_id;
  ELSE
    UPDATE public.warehouse_stocks SET updated_at = clock_timestamp() WHERE id = v_row_id;
  END IF;

  IF p_delta <> 0 THEN
    UPDATE public.products
    SET stock = GREATEST(COALESCE(stock, 0) + p_delta, 0)
    WHERE id = p_product_id;
  END IF;

  UPDATE public.warehouse_stocks
  SET current_stock = GREATEST(p_new_qty, 0),
      piece_lengths = COALESCE(p_piece_lengths, piece_lengths),
      updated_at = clock_timestamp()
  WHERE id = v_row_id;
END;
$$;

-- FIFO consumption for a stock decrease that is not a sale. Falls back to
-- p_fallback_cost when the batch layers do not cover the quantity.
CREATE OR REPLACE FUNCTION public._fifo_consume_for_document(
  p_product_id    UUID,
  p_quantity      NUMERIC,
  p_source_type   TEXT,
  p_source_id     UUID,
  p_fallback_cost NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC := COALESCE(p_quantity, 0);
  v_batch     RECORD;
  v_take      NUMERIC;
  v_cost      NUMERIC := 0;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_batch IN
    SELECT id, remaining_qty, unit_cost
    FROM public.inventory_batches
    WHERE product_id = p_product_id AND remaining_qty > 0
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0.0001;
    v_take := LEAST(v_remaining, v_batch.remaining_qty);

    UPDATE public.inventory_batches SET remaining_qty = remaining_qty - v_take WHERE id = v_batch.id;

    INSERT INTO public.inventory_batch_consumptions (
      batch_id, product_id, quantity, unit_cost, cogs_amount, source_type, source_id
    ) VALUES (
      v_batch.id, p_product_id, v_take, v_batch.unit_cost,
      ROUND(v_take * v_batch.unit_cost, 2), p_source_type, p_source_id
    );

    v_cost := v_cost + ROUND(v_take * v_batch.unit_cost, 2);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0.0001 THEN
    v_cost := v_cost + ROUND(v_remaining * GREATEST(COALESCE(p_fallback_cost, 0), 0), 2);
  END IF;

  RETURN ROUND(v_cost, 2);
END;
$$;

-- ─── 4b. Category scope ─────────────────────────────────────────────────────

-- Effective category → subcategory of every product. Most products carry the
-- legacy text columns only; a linked categories row wins when present, and a
-- linked child category supplies both levels (parent → itself).
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
LEFT JOIN public.categories sc ON sc.id = p.sub_category_id;

GRANT SELECT ON public.product_category_paths TO authenticated, service_role;

-- Stock-tracked products physically present in a warehouse: non-zero stock
-- row (legacy warehouse-less rows count for the default warehouse), or
-- available pieces for polywood. Set-based so it scales with the catalogue.
CREATE OR REPLACE FUNCTION public.inventory_warehouse_product_ids(p_warehouse_id UUID)
RETURNS TABLE (product_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH wh AS (
    SELECT id, COALESCE(is_default, FALSE) AS is_default
    FROM public.warehouses
    WHERE id = p_warehouse_id
  )
  SELECT p.id
  FROM public.products p, wh
  WHERE NOT COALESCE(p.is_service, FALSE)
    AND NOT COALESCE(p.is_composite, FALSE)
    AND CASE
      WHEN p.inventory_mode = 'polywood' THEN EXISTS (
        SELECT 1 FROM public.polywood_pieces pp
        WHERE pp.product_id = p.id AND pp.warehouse_id = wh.id AND pp.status = 'available'
      )
      ELSE EXISTS (
        SELECT 1 FROM public.warehouse_stocks ws
        WHERE ws.product_id = p.id
          AND COALESCE(ws.current_stock, 0) <> 0
          AND (ws.warehouse_id = wh.id OR (ws.warehouse_id IS NULL AND wh.is_default))
      )
    END;
$$;

-- Dropdown source for the count modal: one row per category/subcategory
-- that has stock in the warehouse. Case-insensitive grouping; products
-- without a category are covered by the whole-warehouse option.
CREATE OR REPLACE FUNCTION public.get_warehouse_active_categories(p_warehouse_id UUID)
RETURNS TABLE (category_name TEXT, subcategory_name TEXT, product_count INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._inventory_count_authorize('can_writeoff_inventory');

  RETURN QUERY
  SELECT
    MIN(cp.category_name),
    MIN(cp.subcategory_name),
    COUNT(*)::int
  FROM public.inventory_warehouse_product_ids(p_warehouse_id) w
  JOIN public.product_category_paths cp ON cp.product_id = w.product_id
  WHERE cp.category_name IS NOT NULL
  GROUP BY lower(cp.category_name), lower(cp.subcategory_name)
  ORDER BY 1, 2 NULLS FIRST;
END;
$$;

-- ─── 5. Workflow RPCs ───────────────────────────────────────────────────────

-- draft → in_progress: generate lines and freeze the book quantities.
CREATE OR REPLACE FUNCTION public.inventory_count_start(p_count_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc   public.inventory_counts;
  v_lines INTEGER;
BEGIN
  PERFORM public._inventory_count_authorize('can_writeoff_inventory');
  v_doc := public._inventory_count_lock(p_count_id, ARRAY['draft']);

  -- Two open counts over the same stock would each apply their variance.
  IF EXISTS (
    SELECT 1 FROM public.inventory_counts o
    WHERE o.id <> v_doc.id
      AND o.warehouse_id = v_doc.warehouse_id
      AND o.status IN ('in_progress', 'review')
      AND (
        o.category_name IS NULL OR v_doc.category_name IS NULL
        OR (
          lower(o.category_name) = lower(v_doc.category_name)
          AND (o.subcategory_name IS NULL OR v_doc.subcategory_name IS NULL
               OR lower(o.subcategory_name) = lower(v_doc.subcategory_name))
        )
      )
  ) THEN
    RAISE EXCEPTION '%',
      'Bu anbar (və ya kateqoriya) üzrə artıq açıq inventarizasiya var. Əvvəlcə onu tamamlayın.'
      USING ERRCODE = '22023';
  END IF;

  -- Products present in the warehouse, narrowed to the chosen category path.
  -- Stock found outside this list is added by scanning it.
  WITH candidates AS (
    SELECT
      p.*,
      p.inventory_mode = 'polywood' AS metric,
      public.inventory_count_book_qty(p.id, v_doc.warehouse_id) AS book_qty
    FROM public.inventory_warehouse_product_ids(v_doc.warehouse_id) w
    JOIN public.products p ON p.id = w.product_id
    LEFT JOIN public.product_category_paths cp ON cp.product_id = p.id
    WHERE (v_doc.category_name IS NULL OR lower(cp.category_name) = lower(v_doc.category_name))
      AND (v_doc.subcategory_name IS NULL OR lower(cp.subcategory_name) = lower(v_doc.subcategory_name))
  )
  INSERT INTO public.inventory_count_items (
    count_id, line_no, product_id, product_code, product_name, unit, barcode,
    is_metric, full_sheet_length_m, expected_qty, expected_full_sheets, expected_cut_pieces, unit_cost
  )
  SELECT
    v_doc.id,
    ROW_NUMBER() OVER (ORDER BY c.name, c.code),
    c.id, c.code, c.name,
    CASE WHEN c.metric THEN 'Metr' ELSE COALESCE(c.unit, 'Ədəd') END,
    c.barcode,
    c.metric,
    CASE WHEN c.metric THEN COALESCE(NULLIF(c.full_sheet_length_m, 0), 4) END,
    c.book_qty,
    CASE WHEN c.metric THEN (
      SELECT COUNT(*)::int FROM public.polywood_pieces pp
      WHERE pp.product_id = c.id AND pp.warehouse_id = v_doc.warehouse_id
        AND pp.status = 'available' AND pp.piece_type = 'full'
    ) END,
    CASE WHEN c.metric THEN (
      SELECT COALESCE(jsonb_agg(pp.length_m ORDER BY pp.length_m DESC), '[]'::jsonb)
      FROM public.polywood_pieces pp
      WHERE pp.product_id = c.id AND pp.warehouse_id = v_doc.warehouse_id
        AND pp.status = 'available' AND pp.piece_type = 'cut'
    ) END,
    public.inventory_count_unit_cost(c.id)
  FROM candidates c;

  GET DIAGNOSTICS v_lines = ROW_COUNT;

  UPDATE public.inventory_counts
  SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
  WHERE id = v_doc.id;

  PERFORM public.inventory_count_refresh_totals(v_doc.id);
  RETURN jsonb_build_object('lines', v_lines);
END;
$$;

-- Barcode / product-code scan. Product codes add 1 to the counted quantity;
-- a polywood piece barcode adds that exact piece to the piece breakdown.
CREATE OR REPLACE FUNCTION public.inventory_count_scan(
  p_count_id UUID,
  p_code     TEXT,
  p_actor    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := COALESCE(auth.uid(), p_actor);
  v_doc     public.inventory_counts;
  v_code    TEXT := NULLIF(trim(p_code), '');
  v_piece   public.polywood_pieces;
  v_product public.products;
  v_line    public.inventory_count_items;
  v_metric  BOOLEAN;
BEGIN
  PERFORM public._inventory_count_authorize('can_writeoff_inventory');
  v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress']);

  IF v_code IS NULL THEN
    RAISE EXCEPTION '%', 'Barkod boşdur' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_piece FROM public.polywood_pieces
  WHERE barcode = v_code OR qr_code = v_code
  LIMIT 1;

  IF v_piece.id IS NOT NULL THEN
    SELECT * INTO v_product FROM public.products WHERE id = v_piece.product_id;
  ELSE
    SELECT * INTO v_product FROM public.products
    WHERE barcode = v_code OR qr_code = v_code OR code = v_code
    ORDER BY (barcode = v_code) IS TRUE DESC, (qr_code = v_code) IS TRUE DESC
    LIMIT 1;
  END IF;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION '%', format('Məhsul tapılmadı: %s', v_code) USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_product.is_service, FALSE) OR COALESCE(v_product.is_composite, FALSE) THEN
    RAISE EXCEPTION '%', format('«%s» anbarda sayılmır (xidmət/komplekt)', v_product.name) USING ERRCODE = '22023';
  END IF;

  v_metric := v_product.inventory_mode = 'polywood';
  IF v_metric AND v_piece.id IS NULL THEN
    RAISE EXCEPTION '%',
      format('«%s» hissə-hissə sayılır — hissənin barkodunu oxudun və ya bölgünü əl ilə daxil edin', v_product.name)
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_line FROM public.inventory_count_items
  WHERE count_id = v_doc.id AND product_id = v_product.id
  FOR UPDATE;

  IF v_line.id IS NULL THEN
    -- Found on the shelf but not in the count list: add it with its book qty.
    INSERT INTO public.inventory_count_items (
      count_id, line_no, product_id, product_code, product_name, unit, barcode,
      is_metric, full_sheet_length_m, expected_qty, expected_full_sheets, expected_cut_pieces, unit_cost
    )
    VALUES (
      v_doc.id,
      COALESCE((SELECT MAX(line_no) FROM public.inventory_count_items WHERE count_id = v_doc.id), 0) + 1,
      v_product.id, v_product.code, v_product.name,
      CASE WHEN v_metric THEN 'Metr' ELSE COALESCE(v_product.unit, 'Ədəd') END,
      v_product.barcode, v_metric,
      CASE WHEN v_metric THEN COALESCE(NULLIF(v_product.full_sheet_length_m, 0), 4) END,
      public.inventory_count_book_qty(v_product.id, v_doc.warehouse_id),
      NULL, NULL,
      public.inventory_count_unit_cost(v_product.id)
    )
    RETURNING * INTO v_line;
  END IF;

  IF v_piece.id IS NOT NULL THEN
    IF v_line.scanned_piece_ids ? v_piece.id::text THEN
      RAISE EXCEPTION '%', format('Bu hissə artıq sayılıb (%s m)', v_piece.length_m) USING ERRCODE = '22023';
    END IF;
    UPDATE public.inventory_count_items
    SET scanned_piece_ids = scanned_piece_ids || to_jsonb(v_piece.id::text),
        actual_full_sheets = COALESCE(actual_full_sheets, 0)
          + CASE WHEN v_piece.piece_type = 'full' THEN 1 ELSE 0 END,
        actual_cut_pieces = CASE WHEN v_piece.piece_type = 'cut'
          THEN COALESCE(actual_cut_pieces, '[]'::jsonb) || to_jsonb(v_piece.length_m)
          ELSE COALESCE(actual_cut_pieces, '[]'::jsonb) END,
        counted_at = NOW(), counted_by = v_actor
    WHERE id = v_line.id
    RETURNING * INTO v_line;
  ELSE
    UPDATE public.inventory_count_items
    SET actual_qty = COALESCE(actual_qty, 0) + 1,
        counted_at = NOW(), counted_by = v_actor
    WHERE id = v_line.id
    RETURNING * INTO v_line;
  END IF;

  PERFORM public.inventory_count_refresh_totals(v_doc.id);

  RETURN jsonb_build_object(
    'line_id', v_line.id,
    'product_name', v_line.product_name,
    'actual_qty', v_line.actual_qty,
    'unit', v_line.unit,
    'piece_length', v_piece.length_m
  );
END;
$$;

-- Re-reads book quantities (and costs) into expected_qty. Used when stock
-- moved during the count and the manager decides to count against it.
CREATE OR REPLACE FUNCTION public.inventory_count_resync_book(p_count_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.inventory_counts;
BEGIN
  PERFORM public._inventory_count_authorize('can_writeoff_inventory');
  v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress', 'review']);

  UPDATE public.inventory_count_items i
  SET expected_qty = public.inventory_count_book_qty(i.product_id, v_doc.warehouse_id),
      unit_cost = public.inventory_count_unit_cost(i.product_id),
      drift_qty = 0
  WHERE i.count_id = v_doc.id;

  PERFORM public.inventory_count_refresh_totals(v_doc.id);
END;
$$;

-- in_progress → review: close counting, flag lines whose book qty moved.
CREATE OR REPLACE FUNCTION public.inventory_count_submit(p_count_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc     public.inventory_counts;
  v_counted INTEGER;
  v_drift   INTEGER;
BEGIN
  PERFORM public._inventory_count_authorize('can_writeoff_inventory');
  v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress']);

  SELECT COUNT(*) INTO v_counted FROM public.inventory_count_items
  WHERE count_id = v_doc.id AND actual_qty IS NOT NULL;
  IF v_counted = 0 THEN
    RAISE EXCEPTION '%', 'Heç bir məhsul sayılmayıb' USING ERRCODE = '22023';
  END IF;

  UPDATE public.inventory_count_items i
  SET drift_qty = ROUND(public.inventory_count_book_qty(i.product_id, v_doc.warehouse_id) - i.expected_qty, 3)
  WHERE i.count_id = v_doc.id;

  SELECT COUNT(*) INTO v_drift FROM public.inventory_count_items
  WHERE count_id = v_doc.id AND actual_qty IS NOT NULL AND abs(drift_qty) > 0.0005;

  UPDATE public.inventory_counts
  SET status = 'review', submitted_at = NOW(), updated_at = NOW()
  WHERE id = v_doc.id;

  PERFORM public.inventory_count_refresh_totals(v_doc.id);
  RETURN jsonb_build_object('counted', v_counted, 'drift_lines', v_drift);
END;
$$;

-- review → in_progress: send back for recounting.
CREATE OR REPLACE FUNCTION public.inventory_count_reopen(p_count_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.inventory_counts;
BEGIN
  PERFORM public._inventory_count_authorize('can_writeoff_inventory');
  v_doc := public._inventory_count_lock(p_count_id, ARRAY['review']);
  UPDATE public.inventory_counts
  SET status = 'in_progress', submitted_at = NULL, updated_at = NOW()
  WHERE id = v_doc.id;
END;
$$;

-- review → posted: correct the stock and book the variance. One transaction.
CREATE OR REPLACE FUNCTION public.inventory_count_post(p_count_id UUID, p_actor UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     UUID := COALESCE(auth.uid(), p_actor);
  v_doc       public.inventory_counts;
  v_line      public.inventory_count_items;
  v_ref       CONSTANT TEXT := 'inventory_adjustment';
  v_book      NUMERIC;
  v_delta     NUMERIC;
  v_new_qty   NUMERIC;
  v_value     NUMERIC;
  v_surplus   NUMERIC := 0;
  v_shortage  NUMERIC := 0;
  v_moves     INTEGER := 0;
  v_journal   UUID;
  v_lines     JSONB;
  -- polywood piece reconciliation
  v_targets   NUMERIC[];
  v_target    NUMERIC;
  v_matched   UUID[];
  v_scanned   UUID[];
  v_piece_id  UUID;
  v_lengths   JSONB;
BEGIN
  PERFORM public._inventory_count_authorize('can_post_inventory_count');
  v_doc := public._inventory_count_lock(p_count_id, ARRAY['review']);

  IF public.is_accounting_period_closed(v_doc.count_date) THEN
    RAISE EXCEPTION '%', format(
      'Sənəd tarixi bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
      to_char(v_doc.count_date, 'YYYY-MM')
    ) USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT * FROM public.inventory_count_items
    WHERE count_id = v_doc.id AND actual_qty IS NOT NULL
    ORDER BY line_no
    FOR UPDATE
  LOOP
    PERFORM 1 FROM public.products WHERE id = v_line.product_id FOR UPDATE;
    v_book := public.inventory_count_book_qty(v_line.product_id, v_doc.warehouse_id);

    IF v_line.is_metric THEN
      -- Pieces are physical identities: make the available set equal the
      -- counted set, keeping existing pieces (and their barcodes) wherever a
      -- counted length matches, scanned pieces first.
      SELECT COALESCE(array_agg(value::uuid), '{}') INTO v_scanned
      FROM jsonb_array_elements_text(v_line.scanned_piece_ids);

      SELECT COALESCE(array_agg(len ORDER BY len DESC), '{}') INTO v_targets
      FROM (
        SELECT v_line.full_sheet_length_m AS len
        FROM generate_series(1, COALESCE(v_line.actual_full_sheets, 0))
        UNION ALL
        SELECT value::numeric FROM jsonb_array_elements_text(COALESCE(v_line.actual_cut_pieces, '[]'::jsonb))
      ) t;

      v_matched := '{}';
      FOREACH v_target IN ARRAY v_targets LOOP
        SELECT pp.id INTO v_piece_id
        FROM public.polywood_pieces pp
        WHERE pp.product_id = v_line.product_id
          AND pp.warehouse_id = v_doc.warehouse_id
          AND pp.status = 'available'
          AND abs(pp.length_m - v_target) < 0.0005
          AND NOT (pp.id = ANY (v_matched))
        ORDER BY (pp.id = ANY (v_scanned)) DESC, pp.created_at
        LIMIT 1;

        IF v_piece_id IS NOT NULL THEN
          v_matched := v_matched || v_piece_id;
        ELSE
          INSERT INTO public.polywood_pieces (
            product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at
          ) VALUES (
            v_line.product_id, v_doc.warehouse_id, v_target,
            CASE WHEN abs(v_target - v_line.full_sheet_length_m) < 0.0005 THEN 'full' ELSE 'cut' END,
            'available', 'İnventarizasiya artığı — ' || v_doc.document_number, v_doc.id, NOW()
          )
          RETURNING id INTO v_piece_id;
          v_matched := v_matched || v_piece_id;
        END IF;
      END LOOP;

      UPDATE public.polywood_pieces
      SET status = 'consumed',
          notes = 'İnventarizasiya çatışmazlığı — ' || v_doc.document_number,
          updated_at = NOW()
      WHERE product_id = v_line.product_id
        AND warehouse_id = v_doc.warehouse_id
        AND status = 'available'
        AND NOT (id = ANY (v_matched));

      SELECT ROUND(COALESCE(SUM(length_m), 0), 3),
             COALESCE(jsonb_agg(length_m ORDER BY length_m DESC), '[]'::jsonb)
      INTO v_new_qty, v_lengths
      FROM public.polywood_pieces
      WHERE product_id = v_line.product_id AND warehouse_id = v_doc.warehouse_id AND status = 'available';

      v_delta := ROUND(v_new_qty - v_book, 3);
      PERFORM public._inventory_count_set_stock(v_line.product_id, v_doc.warehouse_id, v_new_qty, v_delta, v_lengths);
      v_value := ROUND(v_delta * v_line.unit_cost, 2);
    ELSE
      -- Apply the counted difference to today's stock (sales made after the
      -- shelf was counted stay booked).
      v_delta := ROUND(v_line.actual_qty - v_line.expected_qty, 4);
      v_new_qty := GREATEST(v_book + v_delta, 0);
      v_delta := v_new_qty - v_book;

      IF abs(v_delta) > 0.00005 THEN
        PERFORM public._inventory_count_set_stock(v_line.product_id, v_doc.warehouse_id, v_new_qty, v_delta);
      END IF;

      IF v_delta > 0 THEN
        PERFORM public.create_inventory_batch(v_line.product_id, v_doc.id, v_ref, v_line.unit_cost, v_delta);
        v_value := ROUND(v_delta * v_line.unit_cost, 2);
      ELSIF v_delta < 0 THEN
        v_value := -public._fifo_consume_for_document(
          v_line.product_id, -v_delta, v_ref, v_doc.id, v_line.unit_cost
        );
      ELSE
        v_value := 0;
      END IF;
    END IF;

    IF abs(v_delta) > 0.00005 THEN
      INSERT INTO public.stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit,
        reference_type, reference_id, source_line_id, description, created_by
      ) VALUES (
        v_line.product_id, v_doc.warehouse_id,
        CASE WHEN v_delta > 0 THEN 'in' ELSE 'out' END,
        abs(v_delta), v_line.unit, v_ref, v_doc.id, v_line.id,
        'İnventarizasiya — ' || v_doc.document_number, v_actor
      );
      v_moves := v_moves + 1;
    END IF;

    IF v_value > 0 THEN
      v_surplus := v_surplus + v_value;
    ELSE
      v_shortage := v_shortage - v_value;
    END IF;

    UPDATE public.inventory_count_items
    SET applied_qty = v_delta, applied_value = v_value
    WHERE id = v_line.id;
  END LOOP;

  v_lines := '[]'::jsonb;
  IF v_surplus > 0 THEN
    v_lines := v_lines
      || jsonb_build_object('account_code', '1300', 'debit', v_surplus, 'credit', 0, 'line_memo', 'İnventarizasiya artığı — anbar')
      || jsonb_build_object('account_code', '4950', 'debit', 0, 'credit', v_surplus, 'line_memo', 'İnventarizasiya artığı');
  END IF;
  IF v_shortage > 0 THEN
    v_lines := v_lines
      || jsonb_build_object('account_code', '6250', 'debit', v_shortage, 'credit', 0, 'line_memo', 'İnventarizasiya çatışmazlığı')
      || jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_shortage, 'line_memo', 'İnventarizasiya çatışmazlığı — anbar');
  END IF;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_journal := public.create_journal_entry(jsonb_build_object(
      'document_type', 'inventory_count',
      'document_id', v_doc.id,
      'source_type', 'inventory_count',
      'source_id', v_doc.id,
      'idempotency_key', 'inventory_count:' || v_doc.id::text,
      'entry_date', v_doc.count_date,
      'description', format('İnventarizasiya — %s (%s)', v_doc.document_number, COALESCE(v_doc.warehouse_name, '')),
      'lines', v_lines
    ));
  END IF;

  UPDATE public.inventory_counts
  SET status = 'posted',
      posted_at = NOW(),
      posted_by = v_actor,
      journal_entry_id = v_journal,
      updated_at = NOW()
  WHERE id = v_doc.id;

  PERFORM public.inventory_count_refresh_totals(v_doc.id);

  RETURN jsonb_build_object(
    'document_number', v_doc.document_number,
    'movements', v_moves,
    'surplus_value', v_surplus,
    'shortage_value', v_shortage,
    'journal_entry_id', v_journal
  );
END;
$$;

-- ─── 6. Grants ──────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.inventory_count_start(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_count_scan(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_count_resync_book(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_count_submit(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_count_reopen(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_count_post(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._inventory_count_set_stock(UUID, UUID, NUMERIC, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fifo_consume_for_document(UUID, NUMERIC, TEXT, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inventory_count_lock(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_count_refresh_totals(UUID) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.get_warehouse_active_categories(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_warehouse_active_categories(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_warehouse_product_ids(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_inventory_count_doc_no() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_book_qty(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_unit_cost(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_refresh_totals(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_start(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_scan(UUID, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_resync_book(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_submit(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_reopen(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_count_post(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._inventory_count_set_stock(UUID, UUID, NUMERIC, NUMERIC, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public._fifo_consume_for_document(UUID, NUMERIC, TEXT, UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public._inventory_count_lock(UUID, TEXT[]) TO service_role;

NOTIFY pgrst, 'reload schema';
