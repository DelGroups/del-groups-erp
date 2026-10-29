-- ============================================================================
-- Inventory counts: backdated counts and admin edits (fix prompt F2, parts B, C).
--
-- B. Backdated counts, admins only.
--    - count_date may never be in the future (Asia/Baku). A past date needs an
--      admin; the rule is a trigger, so the UI and direct API calls both obey it.
--      Service-role calls (server actions) are allowed: they check the user.
--    - inventory_counts.book_as_of: NULL for a normal count, the end of
--      count_date (Asia/Baku) for a backdated one. Book quantities then come from
--      inventory_count_book_qty_at(): today's book quantity minus the stock
--      movements recorded after that moment.
--    - Posting is unchanged: it applies (actual − expected) to today's stock, so
--      sales after the count date stay booked; the journal entry is dated
--      count_date and closed periods are refused.
--    - Polywood in a backdated count: pieces cannot be rebuilt for a past date,
--      so these lines are counted in metres (is_metric = false). On posting, a
--      surplus becomes one cut piece of that length; a shortage consumes
--      available pieces shortest first and splits the last one if needed.
--
-- C. Admins edit any count in any status.
--    - review: admins save line quantities (save_count_progress) and change the
--      header (inventory_count_update_header) without reopening.
--    - posted: inventory_count_unpost(id, reason) reverses every effect of
--      posting (stock movements, warehouse rows and products.stock, FIFO layers,
--      polywood pieces, journal) and returns the count to review. Re-posting
--      uses the idempotency key inventory_count:<id>:<revision>.
--    - A posted count can never be deleted (unpost first).
--
-- Module tables (inventory): only where the module is installed. Safe to re-run.
-- ============================================================================

-- Pieces a count consumed, so unposting can put exactly those back (core table).
ALTER TABLE public.polywood_pieces ADD COLUMN IF NOT EXISTS consumed_by_document_id UUID;
CREATE INDEX IF NOT EXISTS idx_polywood_pieces_consumed_by
  ON public.polywood_pieces (consumed_by_document_id)
  WHERE consumed_by_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_polywood_pieces_source_document
  ON public.polywood_pieces (source_document_id)
  WHERE source_document_id IS NOT NULL;

-- Today in the company's time zone: the boundary between a normal and a backdated count.
CREATE OR REPLACE FUNCTION public.inventory_count_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Baku')::date;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_count_today() TO authenticated, service_role;

DO $guard$
BEGIN
  IF to_regclass('public.inventory_counts') IS NULL OR to_regclass('public.inventory_count_items') IS NULL THEN
    RETURN;
  END IF;

  -- ─── Columns ──────────────────────────────────────────────────────────────

  ALTER TABLE public.inventory_counts
    ADD COLUMN IF NOT EXISTS book_as_of    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS unposted_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS unposted_by   UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS unpost_reason TEXT,
    ADD COLUMN IF NOT EXISTS post_revision INTEGER NOT NULL DEFAULT 0;

  -- The server's CURRENT_DATE is UTC; "today" for a count is Baku's date.
  ALTER TABLE public.inventory_counts ALTER COLUMN count_date SET DEFAULT public.inventory_count_today();

  -- Counts posted before consumed_by_document_id existed marked their pieces in the notes.
  UPDATE public.polywood_pieces pp
  SET consumed_by_document_id = c.id
  FROM public.inventory_counts c
  WHERE pp.consumed_by_document_id IS NULL
    AND pp.status = 'consumed'
    AND pp.notes = 'İnventarizasiya çatışmazlığı — ' || c.document_number;

  -- ─── Who is acting ────────────────────────────────────────────────────────

  -- Admin check for the RPCs: the signed-in user, or (service role) the user the
  -- server action passes in p_actor.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public._inventory_count_actor_is_admin(p_actor UUID)
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $body$
    SELECT CASE
      WHEN auth.uid() IS NOT NULL THEN public.user_is_admin()
      ELSE EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.roles r ON r.id = p.role_id
        WHERE p.id = p_actor AND COALESCE(p.is_active, TRUE) AND lower(r.name) = 'admin'
      )
    END;
  $body$
  $fn$;

  -- A line in the count's chatter (when the chatter tables exist) and in audit_logs.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public._inventory_count_log(
    p_count_id UUID,
    p_action   TEXT,
    p_body     TEXT,
    p_actor    UUID,
    p_details  JSONB DEFAULT NULL
  )
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  BEGIN
    INSERT INTO public.audit_logs (id, user_id, action, module, table_name, record_id, new_values_json, created_at)
    -- audit_logs.action only allows CREATE/UPDATE/DELETE/READ: the event goes in the values.
    VALUES (gen_random_uuid(), p_actor, 'UPDATE', 'INVENTORY', 'inventory_counts', p_count_id,
            COALESCE(p_details, '{}'::jsonb) || jsonb_build_object('event', p_action, 'message', p_body), NOW());

    IF to_regclass('public.mail_messages') IS NOT NULL THEN
      EXECUTE
        'INSERT INTO public.mail_messages (res_model, res_id, kind, body, author_id, author_name)
         VALUES ($1, $2, ''log'', $3, $4, (SELECT full_name FROM public.profiles WHERE id = $4))'
      USING 'inventory_counts', p_count_id, p_body, p_actor;
    END IF;
  END;
  $body$
  $fn$;

  -- ─── Date rules ───────────────────────────────────────────────────────────

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_date_rules()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_today DATE := public.inventory_count_today();
    v_user  BOOLEAN := auth.uid() IS NOT NULL;
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.count_date IS NOT DISTINCT FROM OLD.count_date THEN
      RETURN NEW;
    END IF;

    IF NEW.count_date IS NULL THEN
      NEW.count_date := v_today;
    END IF;
    IF NEW.count_date > v_today THEN
      RAISE EXCEPTION '%', 'İnventarizasiya tarixi gələcəkdə ola bilməz' USING ERRCODE = '22023';
    END IF;
    IF NEW.count_date < v_today AND v_user AND NOT public.user_is_admin() THEN
      RAISE EXCEPTION '%', 'Keçmiş tarixli inventarizasiyanı yalnız administrator yarada bilər' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'posted' THEN
        RAISE EXCEPTION '%', 'Təsdiqlənmiş inventarizasiyanın tarixi dəyişdirilə bilməz — əvvəlcə geri alın' USING ERRCODE = '22023';
      END IF;
      IF OLD.status <> 'draft' AND v_user AND NOT public.user_is_admin() THEN
        RAISE EXCEPTION '%', 'Tarixi yalnız qaralamada dəyişmək olar' USING ERRCODE = '42501';
      END IF;
      -- Polywood lines are counted by pieces today and in metres for a past date:
      -- switching between the two after the lines exist would mix both.
      IF OLD.status <> 'draft'
         AND (NEW.count_date < v_today) IS DISTINCT FROM (OLD.book_as_of IS NOT NULL)
         AND EXISTS (SELECT 1 FROM public.inventory_count_items i JOIN public.products p ON p.id = i.product_id
                     WHERE i.count_id = NEW.id AND p.inventory_mode = 'polywood') THEN
        RAISE EXCEPTION '%', 'Polywood sətirləri olan sayımda bugünkü və keçmiş tarix arasında keçid mümkün deyil — yeni sənəd yaradın' USING ERRCODE = '22023';
      END IF;
    END IF;

    NEW.book_as_of := CASE
      WHEN NEW.count_date < v_today
        THEN ((NEW.count_date + 1)::timestamp AT TIME ZONE 'Asia/Baku') - INTERVAL '1 microsecond'
    END;
    RETURN NEW;
  END;
  $body$
  $fn$;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_inventory_count_date_rules ON public.inventory_counts';
  EXECUTE 'CREATE TRIGGER trg_inventory_count_date_rules
             BEFORE INSERT OR UPDATE OF count_date ON public.inventory_counts
             FOR EACH ROW EXECUTE FUNCTION public.inventory_count_date_rules()';

  -- A posted count is undone with inventory_count_unpost, never deleted.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_block_posted_delete()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $body$
  BEGIN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION '%', 'Təsdiqlənmiş inventarizasiya silinə bilməz — əvvəlcə geri alın' USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END;
  $body$
  $fn$;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_inventory_count_block_posted_delete ON public.inventory_counts';
  EXECUTE 'CREATE TRIGGER trg_inventory_count_block_posted_delete
             BEFORE DELETE ON public.inventory_counts
             FOR EACH ROW EXECUTE FUNCTION public.inventory_count_block_posted_delete()';

  -- ─── Book quantity at a moment ────────────────────────────────────────────

  -- Today's book quantity minus the net stock movements recorded after p_as_of
  -- (in adds, out subtracts). Movements without a warehouse belong to the default
  -- warehouse, as in inventory_count_book_qty. Movements recorded before the
  -- movement log existed are not known.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_book_qty_at(
    p_product_id   UUID,
    p_warehouse_id UUID,
    p_as_of        TIMESTAMPTZ
  )
  RETURNS NUMERIC
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $body$
    SELECT ROUND(
      public.inventory_count_book_qty(p_product_id, p_warehouse_id)
      - COALESCE((
          SELECT SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END)
          FROM public.stock_movements m
          WHERE m.product_id = p_product_id
            AND m.created_at > p_as_of
            AND (m.warehouse_id = p_warehouse_id
                 OR (m.warehouse_id IS NULL AND p_warehouse_id = public.stock_default_warehouse()))
        ), 0),
      4);
  $body$
  $fn$;

  -- The quantity a line expects: today's book quantity, or the one at book_as_of.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_expected_qty(
    p_product_id   UUID,
    p_warehouse_id UUID,
    p_as_of        TIMESTAMPTZ
  )
  RETURNS NUMERIC
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $body$
    SELECT CASE
      WHEN p_as_of IS NULL THEN public.inventory_count_book_qty(p_product_id, p_warehouse_id)
      ELSE public.inventory_count_book_qty_at(p_product_id, p_warehouse_id, p_as_of)
    END;
  $body$
  $fn$;

  -- A new count date while lines exist: expected quantities follow it.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_date_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  BEGIN
    IF NEW.count_date IS DISTINCT FROM OLD.count_date AND NEW.status IN ('in_progress', 'review') THEN
      UPDATE public.inventory_count_items i
      SET expected_qty = public.inventory_count_expected_qty(i.product_id, NEW.warehouse_id, NEW.book_as_of),
          drift_qty = 0
      WHERE i.count_id = NEW.id;
      PERFORM public.inventory_count_refresh_totals(NEW.id);
    END IF;
    RETURN NEW;
  END;
  $body$
  $fn$;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_inventory_count_date_changed ON public.inventory_counts';
  EXECUTE 'CREATE TRIGGER trg_inventory_count_date_changed
             AFTER UPDATE OF count_date ON public.inventory_counts
             FOR EACH ROW EXECUTE FUNCTION public.inventory_count_date_changed()';

  -- ─── Workflow RPCs that read the book quantity ────────────────────────────

  -- draft → in_progress. Category count: every stockable product of the path;
  -- whole-warehouse count: every stockable product (inventory_warehouse_product_ids).
  -- Polywood is counted by pieces, or in metres when the count is backdated.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_start(p_count_id UUID)
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
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

    WITH scope AS (
      SELECT p.id AS product_id
      FROM public.products p
      JOIN public.product_category_paths cp ON cp.product_id = p.id
      WHERE v_doc.category_name IS NOT NULL
        AND NOT COALESCE(p.is_service, FALSE)
        AND NOT COALESCE(p.is_composite, FALSE)
        AND lower(cp.category_name) = lower(v_doc.category_name)
        AND (v_doc.subcategory_name IS NULL OR lower(cp.subcategory_name) = lower(v_doc.subcategory_name))
      UNION ALL
      SELECT w.product_id
      FROM public.inventory_warehouse_product_ids(v_doc.warehouse_id) w
      WHERE v_doc.category_name IS NULL
    ),
    candidates AS (
      SELECT
        p.*,
        p.inventory_mode = 'polywood' AS polywood,
        p.inventory_mode = 'polywood' AND v_doc.book_as_of IS NULL AS metric,
        public.inventory_count_expected_qty(p.id, v_doc.warehouse_id, v_doc.book_as_of) AS book_qty
      FROM scope s
      JOIN public.products p ON p.id = s.product_id
    )
    INSERT INTO public.inventory_count_items (
      count_id, line_no, product_id, product_code, product_name, unit, barcode,
      is_metric, full_sheet_length_m, expected_qty, expected_full_sheets, expected_cut_pieces, unit_cost
    )
    SELECT
      v_doc.id,
      ROW_NUMBER() OVER (ORDER BY c.name, c.code),
      c.id, c.code, c.name,
      CASE WHEN c.polywood THEN 'Metr' ELSE COALESCE(c.unit, 'Ədəd') END,
      c.barcode,
      c.metric,
      CASE WHEN c.polywood THEN COALESCE(NULLIF(c.full_sheet_length_m, 0), 4) END,
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
  $body$
  $fn$;

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_add_product(
    p_count_id   UUID,
    p_product_id UUID
  )
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_doc      public.inventory_counts;
    v_product  public.products;
    v_line_id  UUID;
    v_polywood BOOLEAN;
    v_metric   BOOLEAN;
  BEGIN
    PERFORM public._inventory_count_authorize('can_writeoff_inventory');
    v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress']);

    SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION '%', 'Məhsul tapılmadı' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_product.is_service, FALSE) OR COALESCE(v_product.is_composite, FALSE) THEN
      RAISE EXCEPTION '%', format('«%s» anbarda sayılmır (xidmət/komplekt)', v_product.name) USING ERRCODE = '22023';
    END IF;

    -- Already in the list: return the existing line instead of a duplicate.
    SELECT id INTO v_line_id FROM public.inventory_count_items
    WHERE count_id = v_doc.id AND product_id = v_product.id;
    IF v_line_id IS NOT NULL THEN
      RETURN jsonb_build_object('line_id', v_line_id, 'added', FALSE);
    END IF;

    v_polywood := v_product.inventory_mode = 'polywood';
    v_metric := v_polywood AND v_doc.book_as_of IS NULL;

    INSERT INTO public.inventory_count_items (
      count_id, line_no, product_id, product_code, product_name, unit, barcode,
      is_metric, full_sheet_length_m, expected_qty, expected_full_sheets, expected_cut_pieces, unit_cost
    )
    VALUES (
      v_doc.id,
      COALESCE((SELECT MAX(line_no) FROM public.inventory_count_items WHERE count_id = v_doc.id), 0) + 1,
      v_product.id, v_product.code, v_product.name,
      CASE WHEN v_polywood THEN 'Metr' ELSE COALESCE(v_product.unit, 'Ədəd') END,
      v_product.barcode, v_metric,
      CASE WHEN v_polywood THEN COALESCE(NULLIF(v_product.full_sheet_length_m, 0), 4) END,
      public.inventory_count_expected_qty(v_product.id, v_doc.warehouse_id, v_doc.book_as_of),
      CASE WHEN v_metric THEN (
        SELECT COUNT(*)::int FROM public.polywood_pieces pp
        WHERE pp.product_id = v_product.id AND pp.warehouse_id = v_doc.warehouse_id
          AND pp.status = 'available' AND pp.piece_type = 'full'
      ) END,
      CASE WHEN v_metric THEN (
        SELECT COALESCE(jsonb_agg(pp.length_m ORDER BY pp.length_m DESC), '[]'::jsonb)
        FROM public.polywood_pieces pp
        WHERE pp.product_id = v_product.id AND pp.warehouse_id = v_doc.warehouse_id
          AND pp.status = 'available' AND pp.piece_type = 'cut'
      ) END,
      public.inventory_count_unit_cost(v_product.id)
    )
    RETURNING id INTO v_line_id;

    PERFORM public.inventory_count_refresh_totals(v_doc.id);
    RETURN jsonb_build_object('line_id', v_line_id, 'added', TRUE);
  END;
  $body$
  $fn$;

  -- Barcode / product-code scan. A product code adds 1; a polywood piece barcode
  -- adds that piece to the breakdown, or its metres on a backdated (metre) line.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_scan(
    p_count_id UUID,
    p_code     TEXT,
    p_actor    UUID DEFAULT NULL
  )
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_actor    UUID := COALESCE(auth.uid(), p_actor);
    v_doc      public.inventory_counts;
    v_code     TEXT := NULLIF(trim(p_code), '');
    v_piece    public.polywood_pieces;
    v_product  public.products;
    v_line     public.inventory_count_items;
    v_polywood BOOLEAN;
    v_metric   BOOLEAN;
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

    v_polywood := v_product.inventory_mode = 'polywood';
    v_metric := v_polywood AND v_doc.book_as_of IS NULL;
    IF v_polywood AND v_piece.id IS NULL THEN
      RAISE EXCEPTION '%',
        CASE WHEN v_metric
          THEN format('«%s» hissə-hissə sayılır — hissənin barkodunu oxudun və ya bölgünü əl ilə daxil edin', v_product.name)
          ELSE format('«%s» metrlə sayılır — hissənin barkodunu oxudun və ya metri əl ilə daxil edin', v_product.name)
        END
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
        CASE WHEN v_polywood THEN 'Metr' ELSE COALESCE(v_product.unit, 'Ədəd') END,
        v_product.barcode, v_metric,
        CASE WHEN v_polywood THEN COALESCE(NULLIF(v_product.full_sheet_length_m, 0), 4) END,
        public.inventory_count_expected_qty(v_product.id, v_doc.warehouse_id, v_doc.book_as_of),
        NULL, NULL,
        public.inventory_count_unit_cost(v_product.id)
      )
      RETURNING * INTO v_line;
    END IF;

    IF v_piece.id IS NOT NULL THEN
      IF v_line.scanned_piece_ids ? v_piece.id::text THEN
        RAISE EXCEPTION '%', format('Bu hissə artıq sayılıb (%s m)', v_piece.length_m) USING ERRCODE = '22023';
      END IF;
      IF v_line.is_metric THEN
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
        SET scanned_piece_ids = scanned_piece_ids || to_jsonb(v_piece.id::text),
            actual_qty = ROUND(COALESCE(actual_qty, 0) + v_piece.length_m, 3),
            counted_at = NOW(), counted_by = v_actor
        WHERE id = v_line.id
        RETURNING * INTO v_line;
      END IF;
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
  $body$
  $fn$;

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_resync_book(p_count_id UUID)
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_doc public.inventory_counts;
  BEGIN
    PERFORM public._inventory_count_authorize('can_writeoff_inventory');
    v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress', 'review']);

    UPDATE public.inventory_count_items i
    SET expected_qty = public.inventory_count_expected_qty(i.product_id, v_doc.warehouse_id, v_doc.book_as_of),
        unit_cost = public.inventory_count_unit_cost(i.product_id),
        drift_qty = 0
    WHERE i.count_id = v_doc.id;

    PERFORM public.inventory_count_refresh_totals(v_doc.id);
  END;
  $body$
  $fn$;

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_submit(p_count_id UUID)
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
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
    SET drift_qty = ROUND(public.inventory_count_expected_qty(i.product_id, v_doc.warehouse_id, v_doc.book_as_of) - i.expected_qty, 3)
    WHERE i.count_id = v_doc.id;

    SELECT COUNT(*) INTO v_drift FROM public.inventory_count_items
    WHERE count_id = v_doc.id AND actual_qty IS NOT NULL AND abs(drift_qty) > 0.0005;

    UPDATE public.inventory_counts
    SET status = 'review', submitted_at = NOW(), updated_at = NOW()
    WHERE id = v_doc.id;

    PERFORM public.inventory_count_refresh_totals(v_doc.id);
    RETURN jsonb_build_object('counted', v_counted, 'drift_lines', v_drift);
  END;
  $body$
  $fn$;

  -- ─── Saving quantities: in_progress, and review for admins ────────────────

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.save_count_progress(p_count_id uuid, p_lines jsonb, p_actor uuid DEFAULT NULL::uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $body$
  DECLARE
    v_actor   UUID := COALESCE(auth.uid(), p_actor);
    v_doc     public.inventory_counts;
    v_item    JSONB;
    v_line_id UUID;
    v_kind    TEXT;
    v_qty     NUMERIC;
    v_full    INTEGER;
    v_cuts    JSONB;
    v_cleared BOOLEAN;
    v_rows    INTEGER;
    v_ids     UUID[] := '{}';
  BEGIN
    PERFORM public._inventory_count_authorize('can_writeoff_inventory');
    v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress', 'review']);

    IF v_doc.status = 'review' AND NOT public._inventory_count_actor_is_admin(p_actor) THEN
      RAISE EXCEPTION '%', 'Yoxlamadakı sayımı yalnız administrator dəyişə bilər' USING ERRCODE = '42501';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
      RAISE EXCEPTION '%', 'Sətirlər massiv olmalıdır' USING ERRCODE = '22023';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      v_line_id := NULLIF(v_item->>'line_id', '')::uuid;
      v_kind := v_item->>'kind';

      IF v_kind = 'qty' THEN
        v_qty := NULLIF(v_item->>'actual_qty', '')::numeric;
        IF v_qty IS NOT NULL AND v_qty < 0 THEN
          RAISE EXCEPTION '%', 'Miqdar mənfi ola bilməz' USING ERRCODE = '22023';
        END IF;

        UPDATE public.inventory_count_items
        SET actual_qty = v_qty,
            counted_at = CASE WHEN v_qty IS NULL THEN NULL ELSE NOW() END,
            counted_by = CASE WHEN v_qty IS NULL THEN NULL ELSE v_actor END
        WHERE id = v_line_id AND count_id = v_doc.id AND NOT is_metric;

      ELSIF v_kind = 'pieces' THEN
        v_full := NULLIF(v_item->>'full_sheets', '')::integer;
        IF v_full IS NOT NULL AND v_full < 0 THEN
          RAISE EXCEPTION '%', 'Tam vərəq sayı mənfi ola bilməz' USING ERRCODE = '22023';
        END IF;

        SELECT COALESCE(jsonb_agg(ROUND(value::numeric, 3) ORDER BY ordinality), '[]'::jsonb)
        INTO v_cuts
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_item->'cut_pieces') = 'array' THEN v_item->'cut_pieces' ELSE '[]'::jsonb END
        ) WITH ORDINALITY
        WHERE value::numeric > 0;

        v_cleared := v_full IS NULL AND jsonb_array_length(v_cuts) = 0;

        UPDATE public.inventory_count_items
        SET actual_full_sheets = CASE WHEN v_cleared THEN NULL ELSE COALESCE(v_full, 0) END,
            actual_cut_pieces  = CASE WHEN v_cleared THEN NULL ELSE v_cuts END,
            scanned_piece_ids  = CASE WHEN v_cleared THEN '[]'::jsonb ELSE scanned_piece_ids END,
            counted_at = CASE WHEN v_cleared THEN NULL ELSE NOW() END,
            counted_by = CASE WHEN v_cleared THEN NULL ELSE v_actor END
        WHERE id = v_line_id AND count_id = v_doc.id AND is_metric;

      ELSE
        RAISE EXCEPTION '%', format('Naməlum sətir növü: %s', COALESCE(v_kind, 'null')) USING ERRCODE = '22023';
      END IF;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION '%', 'Sayım sətri tapılmadı' USING ERRCODE = 'P0002';
      END IF;
      v_ids := v_ids || v_line_id;
    END LOOP;

    PERFORM public.inventory_count_refresh_totals(v_doc.id);

    IF v_doc.status = 'review' THEN
      PERFORM public._inventory_count_log(
        v_doc.id, 'INVENTORY_COUNT_ADMIN_EDIT',
        format('Administrator yoxlamada %s sətri dəyişdi', array_length(v_ids, 1)),
        v_actor, jsonb_build_object('lines', p_lines)
      );
    END IF;

    RETURN COALESCE(
      (SELECT jsonb_agg(to_jsonb(i)) FROM public.inventory_count_items i WHERE i.id = ANY (v_ids)),
      '[]'::jsonb
    );
  END;
  $body$
  $fn$;

  -- ─── Header: date, responsible, notes ─────────────────────────────────────

  -- Draft: anyone who may count (a past date only for admins, see the trigger).
  -- in_progress and review: admins only. Posted: never (unpost first).
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_update_header(
    p_count_id    UUID,
    p_count_date  DATE,
    p_responsible TEXT,
    p_notes       TEXT,
    p_actor       UUID DEFAULT NULL
  )
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_actor UUID := COALESCE(auth.uid(), p_actor);
    v_admin BOOLEAN := public._inventory_count_actor_is_admin(p_actor);
    v_doc   public.inventory_counts;
  BEGIN
    PERFORM public._inventory_count_authorize('can_writeoff_inventory');
    v_doc := public._inventory_count_lock(p_count_id, ARRAY['draft', 'in_progress', 'review']);

    IF v_doc.status <> 'draft' AND NOT v_admin THEN
      RAISE EXCEPTION '%', 'Başlanmış sayımın başlığını yalnız administrator dəyişə bilər' USING ERRCODE = '42501';
    END IF;
    IF p_count_date IS NOT NULL AND p_count_date IS DISTINCT FROM v_doc.count_date
       AND p_count_date < public.inventory_count_today() AND NOT v_admin THEN
      RAISE EXCEPTION '%', 'Keçmiş tarixli inventarizasiyanı yalnız administrator yarada bilər' USING ERRCODE = '42501';
    END IF;

    UPDATE public.inventory_counts
    SET count_date = COALESCE(p_count_date, count_date),
        responsible_name = NULLIF(trim(p_responsible), ''),
        notes = NULLIF(trim(p_notes), ''),
        updated_at = NOW()
    WHERE id = v_doc.id;

    IF v_doc.status <> 'draft' THEN
      PERFORM public._inventory_count_log(
        v_doc.id, 'INVENTORY_COUNT_ADMIN_EDIT',
        format('Administrator başlığı dəyişdi (tarix %s → %s)', v_doc.count_date, COALESCE(p_count_date, v_doc.count_date)),
        v_actor,
        jsonb_build_object('count_date', p_count_date, 'responsible_name', p_responsible, 'notes', p_notes)
      );
    END IF;
  END;
  $body$
  $fn$;

  -- ─── Posting ──────────────────────────────────────────────────────────────

  -- review → posted: correct the stock and book the variance. One transaction.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_post(p_count_id uuid, p_actor uuid DEFAULT NULL::uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $body$
  DECLARE
    v_actor     UUID := COALESCE(auth.uid(), p_actor);
    v_doc       public.inventory_counts;
    v_line      public.inventory_count_items;
    v_ref       CONSTANT TEXT := 'inventory_adjustment';
    v_polywood  BOOLEAN;
    v_book      NUMERIC;
    v_delta     NUMERIC;
    v_new_qty   NUMERIC;
    v_value     NUMERIC;
    v_surplus   NUMERIC := 0;
    v_shortage  NUMERIC := 0;
    v_moves     INTEGER := 0;
    v_journal   UUID;
    v_lines     JSONB;
    v_key       TEXT;
    -- polywood piece reconciliation
    v_targets   NUMERIC[];
    v_target    NUMERIC;
    v_matched   UUID[];
    v_scanned   UUID[];
    v_piece_id  UUID;
    v_piece     RECORD;
    v_need      NUMERIC;
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
      SELECT inventory_mode = 'polywood' INTO v_polywood
      FROM public.products WHERE id = v_line.product_id FOR UPDATE;
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
            consumed_by_document_id = v_doc.id,
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

      ELSIF v_polywood THEN
        -- Backdated polywood line counted in metres: a surplus becomes one cut
        -- piece; a shortage consumes available pieces shortest first and splits
        -- the last one.
        v_delta := ROUND(v_line.actual_qty - v_line.expected_qty, 3);
        IF v_delta > 0.0005 THEN
          INSERT INTO public.polywood_pieces (
            product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at
          ) VALUES (
            v_line.product_id, v_doc.warehouse_id, v_delta, 'cut', 'available',
            'İnventarizasiya artığı — ' || v_doc.document_number, v_doc.id, NOW()
          );
        ELSIF v_delta < -0.0005 THEN
          v_need := -v_delta;
          FOR v_piece IN
            SELECT id, length_m FROM public.polywood_pieces
            WHERE product_id = v_line.product_id AND warehouse_id = v_doc.warehouse_id AND status = 'available'
            ORDER BY length_m ASC, created_at ASC
            FOR UPDATE
          LOOP
            EXIT WHEN v_need <= 0.0005;
            UPDATE public.polywood_pieces
            SET status = 'consumed',
                consumed_by_document_id = v_doc.id,
                notes = 'İnventarizasiya çatışmazlığı — ' || v_doc.document_number,
                updated_at = NOW()
            WHERE id = v_piece.id;
            IF v_piece.length_m > v_need + 0.0005 THEN
              INSERT INTO public.polywood_pieces (
                product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at
              ) VALUES (
                v_line.product_id, v_doc.warehouse_id, ROUND(v_piece.length_m - v_need, 3), 'cut', 'available',
                'İnventarizasiya qalığı — ' || v_doc.document_number, v_doc.id, NOW()
              );
              v_need := 0;
            ELSE
              v_need := v_need - v_piece.length_m;
            END IF;
          END LOOP;
        END IF;

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

    -- A re-post after an unpost gets its own key, or the old (reversed) entry would come back.
    v_key := 'inventory_count:' || v_doc.id::text
      || CASE WHEN v_doc.post_revision > 0 THEN ':' || v_doc.post_revision::text ELSE '' END;

    IF jsonb_array_length(v_lines) > 0 THEN
      v_journal := public.create_journal_entry(jsonb_build_object(
        'document_type', 'inventory_count',
        'document_id', v_doc.id,
        'source_type', 'inventory_count',
        'source_id', v_doc.id,
        'idempotency_key', v_key,
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

    IF v_doc.post_revision > 0 THEN
      PERFORM public._inventory_count_log(
        v_doc.id, 'INVENTORY_COUNT_REPOST',
        format('Yenidən təsdiqləndi (versiya %s)', v_doc.post_revision),
        v_actor, jsonb_build_object('revision', v_doc.post_revision, 'journal_entry_id', v_journal)
      );
    END IF;

    RETURN jsonb_build_object(
      'document_number', v_doc.document_number,
      'movements', v_moves,
      'surplus_value', v_surplus,
      'shortage_value', v_shortage,
      'journal_entry_id', v_journal
    );
  END;
  $body$
  $fn$;

  -- ─── Unposting (admins) ───────────────────────────────────────────────────

  -- posted → review. Reverses every effect of inventory_count_post in one
  -- transaction, like unpost_inventory_initial_balance:
  --   stock_movements      offsetting rows ('inventory_adjustment_reversal'), originals kept
  --   warehouse row/total  moved back by -applied_qty through _inventory_count_set_stock
  --   FIFO                 surplus layers removed (only while unconsumed); shortage
  --                        consumptions returned to their layers
  --   polywood             pieces the count created removed (only while available);
  --                        pieces it consumed made available again
  --   journal              reverse_document_journals
  -- Refused when a surplus was already sold or cut, or count_date is in a closed period.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_unpost(
    p_count_id UUID,
    p_reason   TEXT,
    p_actor    UUID DEFAULT NULL
  )
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_actor    UUID := COALESCE(auth.uid(), p_actor);
    v_doc      public.inventory_counts;
    v_ref      CONSTANT TEXT := 'inventory_adjustment';
    v_reason   TEXT := NULLIF(trim(p_reason), '');
    v_blocked  TEXT;
    v_line     RECORD;
    r          RECORD;
    v_book     NUMERIC;
    v_new_qty  NUMERIC;
    v_lengths  JSONB;
    v_moves    INTEGER := 0;
    v_journals INTEGER := 0;
  BEGIN
    IF NOT public._inventory_count_actor_is_admin(p_actor) THEN
      RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION '%', 'Geri alma səbəbi göstərilməlidir' USING ERRCODE = '22023';
    END IF;

    v_doc := public._inventory_count_lock(p_count_id, ARRAY['posted']);

    IF public.is_accounting_period_closed(v_doc.count_date) THEN
      RAISE EXCEPTION '%', format(
        'Sənəd tarixi bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
        to_char(v_doc.count_date, 'YYYY-MM')
      ) USING ERRCODE = '22023';
    END IF;

    -- What the count added must still be on the shelf.
    SELECT string_agg(DISTINCT COALESCE(p.code || ' ', '') || p.name, ', ') INTO v_blocked
    FROM (
      SELECT b.product_id FROM public.inventory_batches b
      WHERE b.document_id = v_doc.id AND b.document_type = v_ref AND b.remaining_qty < b.initial_qty - 0.00005
      UNION
      SELECT pp.product_id FROM public.polywood_pieces pp
      WHERE pp.source_document_id = v_doc.id AND pp.status <> 'available'
      UNION
      SELECT i.product_id FROM public.inventory_count_items i
      JOIN public.products pr ON pr.id = i.product_id
      WHERE i.count_id = v_doc.id AND COALESCE(i.applied_qty, 0) > 0.00005
        AND pr.inventory_mode IS DISTINCT FROM 'polywood'
        AND public.inventory_count_book_qty(i.product_id, v_doc.warehouse_id) + 0.00005 < i.applied_qty
    ) x
    JOIN public.products p ON p.id = x.product_id;

    IF v_blocked IS NOT NULL THEN
      RAISE EXCEPTION '%', format(
        'Bu sayımın artığı artıq satılıb və ya kəsilib, geri almaq mümkün deyil: %s. Düzəliş üçün yeni inventarizasiya aparın.',
        v_blocked
      ) USING ERRCODE = '22023';
    END IF;

    -- Polywood: put back what the count consumed, remove what it created.
    UPDATE public.polywood_pieces
    SET status = 'available', consumed_by_document_id = NULL,
        notes = 'Geri alındı — ' || v_doc.document_number, updated_at = NOW()
    WHERE consumed_by_document_id = v_doc.id AND status = 'consumed';
    DELETE FROM public.polywood_pieces WHERE source_document_id = v_doc.id;

    -- FIFO: shortage consumptions back into their layers; surplus layers removed.
    FOR r IN
      SELECT id, batch_id, quantity FROM public.inventory_batch_consumptions
      WHERE source_type = v_ref AND source_id = v_doc.id
    LOOP
      IF r.batch_id IS NOT NULL THEN
        UPDATE public.inventory_batches SET remaining_qty = remaining_qty + r.quantity WHERE id = r.batch_id;
      END IF;
      DELETE FROM public.inventory_batch_consumptions WHERE id = r.id;
    END LOOP;
    DELETE FROM public.inventory_batches WHERE document_id = v_doc.id AND document_type = v_ref;

    -- Stock: each line moves back by what posting applied.
    FOR v_line IN
      SELECT i.*, p.inventory_mode = 'polywood' AS polywood
      FROM public.inventory_count_items i
      JOIN public.products p ON p.id = i.product_id
      WHERE i.count_id = v_doc.id AND abs(COALESCE(i.applied_qty, 0)) > 0.00005
      ORDER BY i.line_no
    LOOP
      PERFORM 1 FROM public.products WHERE id = v_line.product_id FOR UPDATE;
      IF v_line.polywood THEN
        SELECT ROUND(COALESCE(SUM(length_m), 0), 3),
               COALESCE(jsonb_agg(length_m ORDER BY length_m DESC), '[]'::jsonb)
        INTO v_new_qty, v_lengths
        FROM public.polywood_pieces
        WHERE product_id = v_line.product_id AND warehouse_id = v_doc.warehouse_id AND status = 'available';
      ELSE
        v_book := public.inventory_count_book_qty(v_line.product_id, v_doc.warehouse_id);
        v_new_qty := v_book - v_line.applied_qty;
        v_lengths := NULL;
      END IF;
      PERFORM public._inventory_count_set_stock(v_line.product_id, v_doc.warehouse_id, v_new_qty, -v_line.applied_qty, v_lengths);
    END LOOP;

    -- Movements: offset the net of this count's postings (earlier cycles cancel out).
    FOR r IN
      SELECT m.product_id, m.warehouse_id, MIN(m.unit) AS unit, MIN(m.source_line_id::text)::uuid AS line_id,
             SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) AS net_in
      FROM public.stock_movements m
      WHERE m.reference_id = v_doc.id
        AND m.reference_type IN (v_ref, 'inventory_adjustment_reversal')
      GROUP BY m.product_id, m.warehouse_id
      HAVING abs(SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END)) > 0.00005
    LOOP
      INSERT INTO public.stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit,
        reference_type, reference_id, source_line_id, description, created_by
      ) VALUES (
        r.product_id, r.warehouse_id,
        CASE WHEN r.net_in > 0 THEN 'out' ELSE 'in' END,
        abs(r.net_in), r.unit, 'inventory_adjustment_reversal', v_doc.id, r.line_id,
        'STORNO: İnventarizasiya — ' || v_doc.document_number, v_actor
      );
      v_moves := v_moves + 1;
    END LOOP;

    v_journals := public.reverse_document_journals(
      v_doc.id,
      'İnventarizasiya geri alındı: ' || v_doc.document_number || ' — ' || v_reason
    );

    UPDATE public.inventory_count_items
    SET applied_qty = NULL, applied_value = NULL
    WHERE count_id = v_doc.id;

    UPDATE public.inventory_counts
    SET status = 'review',
        posted_at = NULL,
        posted_by = NULL,
        journal_entry_id = NULL,
        unposted_at = NOW(),
        unposted_by = v_actor,
        unpost_reason = v_reason,
        post_revision = post_revision + 1,
        updated_at = NOW()
    WHERE id = v_doc.id;

    PERFORM public.inventory_count_refresh_totals(v_doc.id);

    PERFORM public._inventory_count_log(
      v_doc.id, 'INVENTORY_COUNT_UNPOST',
      'Təsdiq geri alındı: ' || v_reason,
      v_actor,
      jsonb_build_object('reason', v_reason, 'movements_reversed', v_moves, 'journals_reversed', v_journals)
    );

    RETURN jsonb_build_object(
      'document_number', v_doc.document_number,
      'movements_reversed', v_moves,
      'journals_reversed', v_journals
    );
  END;
  $body$
  $fn$;

  -- ─── Grants ───────────────────────────────────────────────────────────────

  EXECUTE 'REVOKE ALL ON FUNCTION public._inventory_count_actor_is_admin(UUID) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._inventory_count_actor_is_admin(UUID) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public._inventory_count_log(UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._inventory_count_log(UUID, TEXT, TEXT, UUID, JSONB) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_book_qty_at(UUID, UUID, TIMESTAMPTZ) TO authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_expected_qty(UUID, UUID, TIMESTAMPTZ) TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_count_update_header(UUID, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_update_header(UUID, DATE, TEXT, TEXT, UUID) TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_count_unpost(UUID, TEXT, UUID) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_unpost(UUID, TEXT, UUID) TO authenticated, service_role';
END;
$guard$;

NOTIFY pgrst, 'reload schema';
