-- ============================================================================
-- LOT-1: lot / batch tracking, database core (plan: docs/lot-tracking/LOT-plan.md, 1-4, 11, 14).
--
-- Every stock change is attributed to lots automatically:
--   * warehouse_stocks: an AFTER trigger hands each row delta to _lot_apply (services, kits and
--     Polywood are skipped). NULL warehouse_id = stock_default_warehouse().
--   * polywood_pieces: the lot sits on the piece (lot_id); an available piece in / out / moved /
--     cut is an in / out / transfer of its length. Offcuts inherit the cut piece's lot and get
--     parent_piece_id (BEFORE INSERT trigger), so no cutting function changes.
--   * A document tells the triggers which document / line / lots a change belongs to with
--     lot_ctx_begin(...) / lot_ctx_end() (transaction-local). LOT-2 / LOT-3 add the calls.
--     Without a context: in = the product's 'unassigned' lot + an alert; out = FEFO, marked
--     pick_mode 'no_context'. A stock change is NEVER blocked: an unexpected error writes an
--     audit_alerts row 'lot_error' and the stock change goes through.
--
-- Tables: stock_lots, stock_lot_balances, stock_lot_movements (append-only ledger),
-- stock_lot_events (permanent lot history). RLS: read with lots_can('view'); no write policies.
-- Backfill of today's stock (import receipts and purchases with FIFO stock left, then one opening
-- lot per product x warehouse; Polywood pieces by receipt), checked: lots = stock everywhere.
-- Integrity: lot_integrity_report() / lot_integrity_fix(). Lot header: lot_update / lot_set_status.
-- Date changes (DATE-1..3): lot movements and received dates move with their document, and a
-- lot balance may not go negative at any date (blocker lot_negative).
--
-- No accounting, COGS or FIFO cost logic changes (inventory_batches only gets a lot_id link).
-- Needs 20261110152000 (DATE-3). Safe to re-run: the backfill runs once.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public._date_change_extra_warnings(text, uuid, date, date)') IS NULL THEN
    RAISE EXCEPTION 'Run 20261110152000_document_date_change_inventory.sql (DATE-3) before 20261115100000_lot_core.sql';
  END IF;
END
$$;

-- ─── 1. Tables and columns ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stock_lots (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_no                 TEXT NOT NULL,
  product_id             UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_batch_no      TEXT,
  origin_type            TEXT NOT NULL DEFAULT 'manual'
                         CHECK (origin_type IN ('import', 'purchase', 'opening', 'production', 'count_surplus', 'return', 'manual', 'unassigned')),
  origin_doc_type        TEXT,
  origin_doc_id          UUID,
  origin_line_id         UUID,
  origin_doc_no          TEXT,
  supplier_id            UUID,
  import_shipment_id     UUID,
  customs_declaration_no TEXT,
  mfg_date               DATE,
  exp_date               DATE,
  received_date          DATE,
  qty_received           NUMERIC NOT NULL DEFAULT 0,
  inventory_batch_id     UUID,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quarantine', 'closed')),
  notes                  TEXT,
  custom_fields          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by             UUID DEFAULT auth.uid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_lots_lot_no_key UNIQUE (lot_no),
  CONSTRAINT stock_lots_lot_no_check CHECK (length(btrim(lot_no)) > 0)
);
-- One 'unassigned' lot per product.
CREATE UNIQUE INDEX IF NOT EXISTS stock_lots_unassigned_uq ON public.stock_lots (product_id) WHERE origin_type = 'unassigned';
-- FEFO / FIFO picking.
CREATE INDEX IF NOT EXISTS stock_lots_pick_idx ON public.stock_lots (product_id, status, exp_date NULLS LAST, received_date, lot_no);
CREATE INDEX IF NOT EXISTS stock_lots_origin_idx ON public.stock_lots (origin_doc_type, origin_doc_id, origin_line_id);
CREATE INDEX IF NOT EXISTS stock_lots_batch_idx ON public.stock_lots (inventory_batch_id) WHERE inventory_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_lots_supplier_batch_idx ON public.stock_lots (supplier_batch_no) WHERE supplier_batch_no IS NOT NULL;

-- Balance per lot and warehouse. product_id and is_unassigned are copied from the lot so FEFO
-- reads one table and the "never negative" rule is a plain CHECK (the unassigned lot may go
-- negative: it carries shortages until an admin fixes them).
CREATE TABLE IF NOT EXISTS public.stock_lot_balances (
  lot_id        UUID NOT NULL REFERENCES public.stock_lots(id) ON DELETE CASCADE,
  warehouse_id  UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL,
  is_unassigned BOOLEAN NOT NULL DEFAULT false,
  qty           NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lot_id, warehouse_id),
  CONSTRAINT stock_lot_balances_qty_check CHECK (qty >= -0.0000005 OR is_unassigned)
);
CREATE INDEX IF NOT EXISTS stock_lot_balances_wh_idx ON public.stock_lot_balances (warehouse_id, lot_id) WHERE qty <> 0;
CREATE INDEX IF NOT EXISTS stock_lot_balances_pick_idx ON public.stock_lot_balances (product_id, warehouse_id) WHERE qty <> 0;
-- Foreign key (a deleted warehouse cascades).
CREATE INDEX IF NOT EXISTS stock_lot_balances_warehouse_fk_idx ON public.stock_lot_balances (warehouse_id);

-- The ledger: append-only (a correction is a new row).
CREATE TABLE IF NOT EXISTS public.stock_lot_movements (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id               UUID NOT NULL REFERENCES public.stock_lots(id) ON DELETE CASCADE,
  product_id           UUID NOT NULL,
  warehouse_id         UUID NOT NULL,
  qty_delta            NUMERIC NOT NULL CHECK (qty_delta <> 0),
  balance_after        NUMERIC NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('in', 'out', 'transfer_in', 'transfer_out', 'reverse_in', 'reverse_out', 'correction')),
  doc_type             TEXT,
  doc_id               UUID,
  doc_line_id          UUID,
  doc_no               TEXT,
  counterparty_type    TEXT NOT NULL DEFAULT 'none'
                       CHECK (counterparty_type IN ('customer', 'supplier', 'partner', 'employee', 'warehouse', 'none')),
  counterparty_id      UUID,
  pick_mode            TEXT NOT NULL
                       CHECK (pick_mode IN ('manual', 'fefo', 'fifo', 'reverse', 'mirror', 'new_lot', 'unassigned', 'backfill', 'no_context')),
  reverses_movement_id UUID REFERENCES public.stock_lot_movements(id) ON DELETE SET NULL,
  movement_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           UUID DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS stock_lot_movements_product_idx ON public.stock_lot_movements (product_id, movement_date);
CREATE INDEX IF NOT EXISTS stock_lot_movements_lot_idx ON public.stock_lot_movements (lot_id, movement_date);
CREATE INDEX IF NOT EXISTS stock_lot_movements_doc_idx ON public.stock_lot_movements (doc_type, doc_id, doc_line_id);
CREATE INDEX IF NOT EXISTS stock_lot_movements_reverses_idx ON public.stock_lot_movements (reverses_movement_id) WHERE reverses_movement_id IS NOT NULL;

-- The lot's own history: permanent (audit_logs is purged by the retention setting).
CREATE TABLE IF NOT EXISTS public.stock_lot_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id     UUID NOT NULL REFERENCES public.stock_lots(id) ON DELETE CASCADE,
  event      TEXT NOT NULL CHECK (event IN ('created', 'renamed', 'dates_changed', 'status_changed', 'note', 'corrected')),
  old_values JSONB,
  new_values JSONB,
  reason     TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_lot_events_lot_idx ON public.stock_lot_events (lot_id, created_at);

ALTER TABLE public.polywood_pieces ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES public.stock_lots(id) ON DELETE SET NULL;
ALTER TABLE public.polywood_pieces ADD COLUMN IF NOT EXISTS parent_piece_id UUID REFERENCES public.polywood_pieces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS polywood_pieces_lot_idx ON public.polywood_pieces (lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS polywood_pieces_parent_idx ON public.polywood_pieces (parent_piece_id) WHERE parent_piece_id IS NOT NULL;
ALTER TABLE public.inventory_batches ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES public.stock_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inventory_batches_lot_idx ON public.inventory_batches (lot_id) WHERE lot_id IS NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS lot_policy TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_lot_policy_check' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_lot_policy_check CHECK (lot_policy IN ('auto', 'manual_required'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_shelf_life_days_check' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_shelf_life_days_check CHECK (shelf_life_days IS NULL OR shelf_life_days > 0);
  END IF;
END
$$;

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('lot_tracking', '{"number_format": "LOT-{YYYY}-{NNNNN}", "pick": "fefo"}'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Permissions and numbering ────────────────────────────────────────────

-- lots.view / lots.manage, like imports_can: admin, role permission can_<action>_lots, the user's
-- overrides, or the permission matrix (group 'inventory', keys view_lots / manage_lots).
CREATE OR REPLACE FUNCTION public.lots_can(p_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.user_is_admin(), false) OR COALESCE((
    SELECT COALESCE((r.permissions ->> ('can_' || p_action || '_lots'))::boolean, false)
        OR COALESCE((p.permission_overrides ->> ('can_' || p_action || '_lots'))::boolean, false)
        OR COALESCE(
             (p.permission_overrides -> '_matrix' -> 'inventory' ->> (p_action || '_lots'))::boolean,
             (r.permissions -> '_matrix' -> 'inventory' ->> (p_action || '_lots'))::boolean,
             false)
      FROM public.profiles p
      LEFT JOIN public.roles r ON r.id = p.role_id
     WHERE p.id = auth.uid() AND COALESCE(p.is_active, true)
  ), false);
$$;

-- The next lot number: document_number_counters ('lot', yearly) in the format of the setting
-- lot_tracking.number_format ({YYYY}, {YY}, {N...} = the number padded to that many digits).
CREATE OR REPLACE FUNCTION public.next_lot_no(p_date DATE DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date   DATE := COALESCE(p_date, public.document_today());
  v_year   INTEGER := EXTRACT(YEAR FROM v_date)::int;
  v_format TEXT;
  v_no     INTEGER;
  v_text   TEXT;
  v_digits INTEGER;
  i        INTEGER := 0;
BEGIN
  SELECT COALESCE(NULLIF(btrim(value ->> 'number_format'), ''), 'LOT-{YYYY}-{NNNNN}') INTO v_format
  FROM public.system_settings WHERE key = 'lot_tracking';
  v_format := COALESCE(v_format, 'LOT-{YYYY}-{NNNNN}');
  v_digits := COALESCE(length(substring(v_format FROM '\{(N+)\}')), 5);
  LOOP
    INSERT INTO public.document_number_counters (doc_type, year, last_no) VALUES ('lot', v_year, 1)
    ON CONFLICT (doc_type, year) DO UPDATE SET last_no = public.document_number_counters.last_no + 1
    RETURNING last_no INTO v_no;
    v_text := replace(replace(v_format, '{YYYY}', v_year::text), '{YY}', right(v_year::text, 2));
    v_text := regexp_replace(v_text, '\{N+\}', lpad(v_no::text, v_digits, '0'));
    IF v_text !~ lpad(v_no::text, v_digits, '0') THEN
      v_text := v_text || '-' || lpad(v_no::text, v_digits, '0');
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.stock_lots WHERE lot_no = v_text);
    i := i + 1;
    IF i > 1000 THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Lot nömrəsi tapılmadı: sayğac 1000 dəfə dolu nömrəyə düşdü';
    END IF;
  END LOOP;
  RETURN v_text;
END;
$$;

-- ─── 3. The lot context (transaction-local) ──────────────────────────────────
-- p: {doc_type, doc_id, doc_line_id, doc_no, product_id, counterparty_type, counterparty_id,
--     mode: normal | reverse | mirror, reverse_of: {doc_type, doc_id, doc_line_id},
--     mirror_of: {doc_type, doc_id, doc_line_id}, lots: [{lot_id | lot_no, qty}],
--     new_lot: {lot_no, supplier_batch_no, mfg_date, exp_date, origin_type, supplier_id,
--               import_shipment_id, customs_declaration_no, inventory_batch_id}}
-- doc_type uses the date-change document types where one exists ('sale', 'purchase',
-- 'import_receipt', 'inventory_count', ...), so lot rows move with a document's date.

CREATE OR REPLACE FUNCTION public.lot_ctx_begin(p JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('erp.lot_ctx', COALESCE(p, '{}'::jsonb)::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.lot_ctx_end()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('erp.lot_ctx', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public._lot_ctx()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('erp.lot_ctx', true), '')::jsonb;
$$;

-- The context for a product: NULL when there is none, or it names another product.
CREATE OR REPLACE FUNCTION public._lot_ctx_for(p_product UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v JSONB := public._lot_ctx();
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN
    RETURN NULL;
  END IF;
  IF NULLIF(v ->> 'product_id', '') IS NOT NULL AND (v ->> 'product_id')::uuid IS DISTINCT FROM p_product THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

-- ─── 4. Internal helpers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._lot_wh(p_warehouse UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_warehouse, public.stock_default_warehouse());
$$;

CREATE OR REPLACE FUNCTION public._lot_uuid(p TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p IS NULL OR p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN p::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public._lot_date(p TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN NULL;
  END IF;
  RETURN left(p, 10)::date;
END;
$$;

-- An alert in audit_alerts; never raises.
CREATE OR REPLACE FUNCTION public._lot_alert(p_code TEXT, p_message TEXT, p_lot UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.audit_alerts (module, table_name, record_id, user_id, message)
    VALUES ('INVENTORY', 'stock_lots', p_lot, auth.uid(), left(p_code || ': ' || COALESCE(p_message, ''), 2000));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

-- A new lot (and its 'created' event). p: the stock_lots columns as JSON.
CREATE OR REPLACE FUNCTION public._lot_create(p_product UUID, p JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_received DATE := COALESCE(public._lot_date(p ->> 'received_date'), public.document_today());
  v_mfg      DATE := public._lot_date(p ->> 'mfg_date');
  v_exp      DATE := public._lot_date(p ->> 'exp_date');
  v_life     INTEGER;
  v_no       TEXT := NULLIF(btrim(p ->> 'lot_no'), '');
  v_origin   TEXT := COALESCE(NULLIF(p ->> 'origin_type', ''), 'manual');
BEGIN
  IF v_exp IS NULL THEN
    SELECT shelf_life_days INTO v_life FROM public.products WHERE id = p_product;
    IF v_life IS NOT NULL THEN
      v_exp := COALESCE(v_mfg, v_received) + v_life;
    END IF;
  END IF;
  IF v_no IS NOT NULL AND EXISTS (SELECT 1 FROM public.stock_lots WHERE lot_no = v_no) THEN
    PERFORM public._lot_alert('lot_no_taken', format('Lot nömrəsi artıq var: %s; yeni nömrə verildi', v_no));
    v_no := NULL;
  END IF;
  INSERT INTO public.stock_lots (
    lot_no, product_id, supplier_batch_no, origin_type, origin_doc_type, origin_doc_id, origin_line_id, origin_doc_no,
    supplier_id, import_shipment_id, customs_declaration_no, mfg_date, exp_date, received_date, qty_received,
    inventory_batch_id, notes)
  VALUES (
    COALESCE(v_no, public.next_lot_no(v_received)), p_product, NULLIF(btrim(p ->> 'supplier_batch_no'), ''),
    CASE WHEN v_origin IN ('import', 'purchase', 'opening', 'production', 'count_surplus', 'return', 'manual') THEN v_origin ELSE 'manual' END,
    NULLIF(p ->> 'origin_doc_type', ''), public._lot_uuid(p ->> 'origin_doc_id'), public._lot_uuid(p ->> 'origin_line_id'),
    NULLIF(p ->> 'origin_doc_no', ''), public._lot_uuid(p ->> 'supplier_id'), public._lot_uuid(p ->> 'import_shipment_id'),
    NULLIF(p ->> 'customs_declaration_no', ''), v_mfg, v_exp, v_received, COALESCE((p ->> 'qty_received')::numeric, 0),
    public._lot_uuid(p ->> 'inventory_batch_id'), NULLIF(p ->> 'notes', ''))
  RETURNING id INTO v_id;
  INSERT INTO public.stock_lot_events (lot_id, event, new_values)
  SELECT v_id, 'created', to_jsonb(l) - 'custom_fields' FROM public.stock_lots l WHERE l.id = v_id;
  IF public._lot_uuid(p ->> 'inventory_batch_id') IS NOT NULL THEN
    UPDATE public.inventory_batches SET lot_id = v_id WHERE id = (p ->> 'inventory_batch_id')::uuid AND lot_id IS NULL;
  END IF;
  RETURN v_id;
END;
$$;

-- The product's 'unassigned' lot (created on first use).
CREATE OR REPLACE FUNCTION public._lot_unassigned(p_product UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.stock_lots WHERE product_id = p_product AND origin_type = 'unassigned';
  IF v_id IS NULL THEN
    INSERT INTO public.stock_lots (lot_no, product_id, origin_type, notes)
    VALUES ('UNASSIGNED-' || p_product::text, p_product, 'unassigned', 'Sistem lotu: lotu bilinməyən miqdar')
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_id FROM public.stock_lots WHERE product_id = p_product AND origin_type = 'unassigned';
  END IF;
  RETURN v_id;
END;
$$;

-- The origin of a new lot made by a document.
CREATE OR REPLACE FUNCTION public._lot_origin_for(p_doc_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_doc_type IS NULL THEN 'manual'
    WHEN p_doc_type IN ('import_receipt', 'import') THEN 'import'
    WHEN p_doc_type = 'purchase' THEN 'purchase'
    WHEN p_doc_type IN ('inventory_initial_balance', 'initial_balance', 'stock_receipt', 'opening') THEN 'opening'
    WHEN p_doc_type LIKE 'production%' THEN 'production'
    WHEN p_doc_type IN ('inventory_count', 'inventory_adjustment') THEN 'count_surplus'
    WHEN p_doc_type ~ '(return|void|cancel)' THEN 'return'
    ELSE 'manual'
  END;
$$;

-- A new lot for an incoming document line, or the one this line already made (one import line
-- = one lot even when received into several warehouses).
CREATE OR REPLACE FUNCTION public._lot_new(p_product UUID, p_ctx JSONB, p_qty NUMERIC)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nl   JSONB := COALESCE(p_ctx -> 'new_lot', '{}'::jsonb);
  v_doc  UUID := public._lot_uuid(p_ctx ->> 'doc_id');
  v_line UUID := public._lot_uuid(p_ctx ->> 'doc_line_id');
  v_no   TEXT := NULLIF(btrim(v_nl ->> 'lot_no'), '');
  v_id   UUID;
BEGIN
  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_id FROM public.stock_lots
    WHERE product_id = p_product AND origin_type <> 'unassigned'
      AND origin_doc_type IS NOT DISTINCT FROM NULLIF(p_ctx ->> 'doc_type', '')
      AND origin_doc_id = v_doc AND origin_line_id IS NOT DISTINCT FROM v_line
      AND (v_no IS NULL OR lot_no = v_no)
    ORDER BY created_at
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      UPDATE public.stock_lots SET qty_received = qty_received + p_qty, updated_at = NOW() WHERE id = v_id;
      RETURN v_id;
    END IF;
  END IF;
  RETURN public._lot_create(p_product, v_nl || jsonb_build_object(
    'origin_type', COALESCE(NULLIF(v_nl ->> 'origin_type', ''), public._lot_origin_for(NULLIF(p_ctx ->> 'doc_type', ''))),
    'origin_doc_type', p_ctx ->> 'doc_type', 'origin_doc_id', v_doc, 'origin_line_id', v_line,
    'origin_doc_no', p_ctx ->> 'doc_no',
    'received_date', (COALESCE(public.document_timestamp(), NOW()) AT TIME ZONE 'Asia/Baku')::date,
    'qty_received', p_qty));
END;
$$;

-- One ledger row and the balance after it. p_ctx gives the document fields.
CREATE OR REPLACE FUNCTION public._lot_post(
  p_lot UUID, p_product UUID, p_wh UUID, p_delta NUMERIC, p_kind TEXT, p_pick TEXT, p_ctx JSONB,
  p_reverses UUID DEFAULT NULL, p_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after NUMERIC;
  v_cpt   TEXT := COALESCE(NULLIF(p_ctx ->> 'counterparty_type', ''), 'none');
BEGIN
  IF p_delta IS NULL OR abs(p_delta) < 0.0000005 THEN
    RETURN NULL;
  END IF;
  -- Update first: an INSERT ... ON CONFLICT checks the CHECK on the proposed (negative) row.
  UPDATE public.stock_lot_balances SET qty = qty + p_delta, updated_at = NOW()
  WHERE lot_id = p_lot AND warehouse_id = p_wh
  RETURNING qty INTO v_after;
  IF NOT FOUND THEN
    INSERT INTO public.stock_lot_balances (lot_id, warehouse_id, product_id, is_unassigned, qty, updated_at)
    SELECT p_lot, p_wh, p_product, l.origin_type = 'unassigned', p_delta, NOW() FROM public.stock_lots l WHERE l.id = p_lot
    ON CONFLICT (lot_id, warehouse_id) DO UPDATE SET qty = public.stock_lot_balances.qty + EXCLUDED.qty, updated_at = NOW()
    RETURNING qty INTO v_after;
  END IF;
  INSERT INTO public.stock_lot_movements (
    lot_id, product_id, warehouse_id, qty_delta, balance_after, kind, doc_type, doc_id, doc_line_id, doc_no,
    counterparty_type, counterparty_id, pick_mode, reverses_movement_id, movement_date, recorded_at)
  VALUES (
    p_lot, p_product, p_wh, p_delta, v_after, p_kind, NULLIF(p_ctx ->> 'doc_type', ''), public._lot_uuid(p_ctx ->> 'doc_id'),
    public._lot_uuid(p_ctx ->> 'doc_line_id'), NULLIF(p_ctx ->> 'doc_no', ''),
    CASE WHEN v_cpt IN ('customer', 'supplier', 'partner', 'employee', 'warehouse', 'none') THEN v_cpt ELSE 'none' END,
    public._lot_uuid(p_ctx ->> 'counterparty_id'), p_pick, p_reverses,
    COALESCE(p_date, public.document_timestamp(), NOW()), clock_timestamp());
  RETURN v_after;
END;
$$;

-- Open quantities of a document's movements, for a reversal or a mirror: the movements of
-- p_ref = {doc_type, doc_id, doc_line_id?} for this product with the given sign and kinds, minus
-- what later movements of p_link_kinds already took back (reverses_movement_id). Latest first
-- (a reversal), or in their own order (a mirror).
CREATE OR REPLACE FUNCTION public._lot_doc_open(p_product UUID, p_ref JSONB, p_sign INTEGER, p_kinds TEXT[], p_link_kinds TEXT[], p_latest_first BOOLEAN DEFAULT true)
RETURNS TABLE (movement_id UUID, lot_id UUID, warehouse_id UUID, open_qty NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.lot_id, m.warehouse_id,
         abs(m.qty_delta) - COALESCE((SELECT SUM(abs(x.qty_delta)) FROM public.stock_lot_movements x
                                      WHERE x.reverses_movement_id = m.id AND x.kind = ANY (p_link_kinds)), 0)
  FROM public.stock_lot_movements m
  WHERE m.product_id = p_product
    AND m.doc_type IS NOT DISTINCT FROM NULLIF(p_ref ->> 'doc_type', '')
    AND m.doc_id = public._lot_uuid(p_ref ->> 'doc_id')
    AND (public._lot_uuid(p_ref ->> 'doc_line_id') IS NULL OR m.doc_line_id = public._lot_uuid(p_ref ->> 'doc_line_id'))
    AND sign(m.qty_delta) = p_sign
    AND m.kind = ANY (p_kinds)
    AND abs(m.qty_delta) - COALESCE((SELECT SUM(abs(x.qty_delta)) FROM public.stock_lot_movements x
                                     WHERE x.reverses_movement_id = m.id AND x.kind = ANY (p_link_kinds)), 0) > 0.0000005
  ORDER BY CASE WHEN p_latest_first THEN m.recorded_at END DESC, CASE WHEN NOT p_latest_first THEN m.recorded_at END ASC, m.id;
$$;

-- ─── 5. Attribution of one stock change: _lot_apply ──────────────────────────
-- Returns the allocations [{lot_id, qty}] (absolute quantities). p_lot: the lot is known (a
-- Polywood piece). Rules (plan section 4):
--   in : reverse -> the lots the original document took (latest first); mirror -> the mirrored
--        out movements' lots; chosen lots; a document -> a new lot (or this line's lot);
--        no context -> the unassigned lot + alert.
--   out: chosen lots (remainder FEFO + alert); reverse -> the lots the original document put
--        in; FEFO (exp_date, received_date, lot_no) over active lots in that warehouse, then a
--        positive unassigned balance; shortage -> unassigned (negative) + alert lot_shortage.
CREATE OR REPLACE FUNCTION public._lot_apply(
  p_product UUID, p_wh UUID, p_delta NUMERIC, p_lot UUID DEFAULT NULL, p_pick TEXT DEFAULT NULL, p_kind TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eps      CONSTANT NUMERIC := 0.0000005;
  v_ctx    JSONB := public._lot_ctx_for(p_product);
  v_mode   TEXT;
  v_left   NUMERIC := abs(COALESCE(p_delta, 0));
  v_out    JSONB := '[]'::jsonb;
  v_kind   TEXT;
  v_take   NUMERIC;
  v_lot    UUID;
  v_bal    NUMERIC;
  v_chosen BOOLEAN := false;
  r        RECORD;
BEGIN
  IF p_product IS NULL OR p_wh IS NULL OR v_left < eps THEN
    RETURN v_out;
  END IF;
  v_mode := COALESCE(NULLIF(v_ctx ->> 'mode', ''), 'normal');

  IF p_delta > 0 THEN
    v_kind := COALESCE(p_kind, CASE v_mode WHEN 'reverse' THEN 'reverse_in' WHEN 'mirror' THEN 'transfer_in' ELSE 'in' END);
    IF p_lot IS NOT NULL THEN
      PERFORM public._lot_post(p_lot, p_product, p_wh, v_left, v_kind,
                               COALESCE(p_pick, CASE WHEN v_ctx IS NULL THEN 'no_context' ELSE 'manual' END), v_ctx);
      RETURN jsonb_build_array(jsonb_build_object('lot_id', p_lot, 'qty', v_left));
    END IF;

    IF v_mode = 'reverse' AND jsonb_typeof(v_ctx -> 'reverse_of') = 'object' THEN
      FOR r IN SELECT * FROM public._lot_doc_open(p_product, v_ctx -> 'reverse_of', -1, ARRAY['out', 'transfer_out'], ARRAY['reverse_in']) LOOP
        EXIT WHEN v_left < eps;
        v_take := LEAST(v_left, r.open_qty);
        PERFORM public._lot_post(r.lot_id, p_product, p_wh, v_take, 'reverse_in', 'reverse', v_ctx, r.movement_id);
        v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'qty', v_take);
        v_left := v_left - v_take;
      END LOOP;
    ELSIF v_mode = 'mirror' AND jsonb_typeof(v_ctx -> 'mirror_of') = 'object' THEN
      FOR r IN SELECT * FROM public._lot_doc_open(p_product, v_ctx -> 'mirror_of', -1, ARRAY['out', 'transfer_out'], ARRAY['transfer_in'], false) LOOP
        EXIT WHEN v_left < eps;
        v_take := LEAST(v_left, r.open_qty);
        PERFORM public._lot_post(r.lot_id, p_product, p_wh, v_take, 'transfer_in', 'mirror', v_ctx, r.movement_id);
        v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'qty', v_take);
        v_left := v_left - v_take;
      END LOOP;
    END IF;

    IF v_left >= eps AND jsonb_typeof(v_ctx -> 'lots') = 'array' THEN
      FOR r IN
        SELECT l.id AS lot_id, COALESCE(NULLIF(x ->> 'qty', '')::numeric, v_left) AS qty
        FROM jsonb_array_elements(v_ctx -> 'lots') x
        JOIN public.stock_lots l ON l.product_id = p_product AND l.origin_type <> 'unassigned'
         AND (l.id = public._lot_uuid(x ->> 'lot_id') OR l.lot_no = NULLIF(x ->> 'lot_no', ''))
      LOOP
        EXIT WHEN v_left < eps;
        v_take := LEAST(v_left, GREATEST(r.qty, 0));
        CONTINUE WHEN v_take < eps;
        PERFORM public._lot_post(r.lot_id, p_product, p_wh, v_take, v_kind, 'manual', v_ctx);
        v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'qty', v_take);
        v_left := v_left - v_take;
      END LOOP;
    END IF;

    IF v_left >= eps AND v_ctx IS NOT NULL
       AND (jsonb_typeof(v_ctx -> 'new_lot') = 'object' OR NULLIF(v_ctx ->> 'doc_type', '') IS NOT NULL) THEN
      v_lot := public._lot_new(p_product, v_ctx, v_left);
      PERFORM public._lot_post(v_lot, p_product, p_wh, v_left, v_kind, 'new_lot', v_ctx);
      v_out := v_out || jsonb_build_object('lot_id', v_lot, 'qty', v_left);
      v_left := 0;
    END IF;

    IF v_left >= eps THEN
      v_lot := public._lot_unassigned(p_product);
      PERFORM public._lot_post(v_lot, p_product, p_wh, v_left, v_kind, CASE WHEN v_ctx IS NULL THEN 'no_context' ELSE 'unassigned' END, v_ctx);
      PERFORM public._lot_alert('lot_unassigned_in', format('Lotsuz giriş: məhsul %s, anbar %s, miqdar %s', p_product, p_wh, v_left), v_lot);
      v_out := v_out || jsonb_build_object('lot_id', v_lot, 'qty', v_left);
    END IF;
    RETURN v_out;
  END IF;

  -- Out.
  v_kind := COALESCE(p_kind, CASE WHEN v_mode = 'reverse' THEN 'reverse_out'
                                  WHEN v_ctx ->> 'counterparty_type' = 'warehouse' THEN 'transfer_out'
                                  ELSE 'out' END);

  IF p_lot IS NOT NULL THEN
    SELECT b.qty, l.origin_type = 'unassigned' INTO v_bal, v_chosen
    FROM public.stock_lots l LEFT JOIN public.stock_lot_balances b ON b.lot_id = l.id AND b.warehouse_id = p_wh
    WHERE l.id = p_lot;
    v_take := CASE WHEN v_chosen THEN v_left ELSE LEAST(v_left, GREATEST(COALESCE(v_bal, 0), 0)) END;
    IF v_take >= eps THEN
      PERFORM public._lot_post(p_lot, p_product, p_wh, -v_take, v_kind,
                               COALESCE(p_pick, CASE WHEN v_ctx IS NULL THEN 'no_context' ELSE 'manual' END), v_ctx);
      v_out := v_out || jsonb_build_object('lot_id', p_lot, 'qty', v_take);
      v_left := v_left - v_take;
    END IF;
    v_chosen := false;
  END IF;

  IF v_left >= eps AND p_lot IS NULL AND jsonb_typeof(v_ctx -> 'lots') = 'array' AND jsonb_array_length(v_ctx -> 'lots') > 0 THEN
    v_chosen := true;
    FOR r IN
      SELECT l.id AS lot_id, COALESCE(NULLIF(x ->> 'qty', '')::numeric, v_left) AS qty, COALESCE(b.qty, 0) AS bal
      FROM jsonb_array_elements(v_ctx -> 'lots') x
      JOIN public.stock_lots l ON l.product_id = p_product AND l.origin_type <> 'unassigned'
       AND (l.id = public._lot_uuid(x ->> 'lot_id') OR l.lot_no = NULLIF(x ->> 'lot_no', ''))
      LEFT JOIN public.stock_lot_balances b ON b.lot_id = l.id AND b.warehouse_id = p_wh
    LOOP
      EXIT WHEN v_left < eps;
      v_take := LEAST(v_left, GREATEST(r.qty, 0), GREATEST(r.bal, 0));
      CONTINUE WHEN v_take < eps;
      PERFORM public._lot_post(r.lot_id, p_product, p_wh, -v_take, v_kind, 'manual', v_ctx);
      v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'qty', v_take);
      v_left := v_left - v_take;
    END LOOP;
    IF v_left >= eps THEN
      PERFORM public._lot_alert('lot_choice_short', format('Seçilmiş lotlar kifayət etmədi: məhsul %s, anbar %s, qalan %s', p_product, p_wh, v_left));
    END IF;
  END IF;

  IF v_left >= eps AND p_lot IS NULL AND v_mode = 'reverse' AND jsonb_typeof(v_ctx -> 'reverse_of') = 'object' THEN
    FOR r IN
      SELECT o.*, COALESCE(b.qty, 0) AS bal
      FROM public._lot_doc_open(p_product, v_ctx -> 'reverse_of', 1, ARRAY['in', 'transfer_in'], ARRAY['reverse_out']) o
      LEFT JOIN public.stock_lot_balances b ON b.lot_id = o.lot_id AND b.warehouse_id = p_wh
      WHERE o.warehouse_id = p_wh
    LOOP
      EXIT WHEN v_left < eps;
      v_take := LEAST(v_left, r.open_qty, GREATEST(r.bal, 0));
      CONTINUE WHEN v_take < eps;
      PERFORM public._lot_post(r.lot_id, p_product, p_wh, -v_take, 'reverse_out', 'reverse', v_ctx, r.movement_id);
      v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'qty', v_take);
      v_left := v_left - v_take;
    END LOOP;
  END IF;

  -- A piece's own lot short: the rest is a shortage, not other lots' metres.
  IF v_left >= eps AND p_lot IS NULL THEN
    FOR r IN
      SELECT b.lot_id, b.qty, l.exp_date
      FROM public.stock_lot_balances b
      JOIN public.stock_lots l ON l.id = b.lot_id
      WHERE b.product_id = p_product AND b.warehouse_id = p_wh AND b.qty > eps
        AND NOT b.is_unassigned AND l.status = 'active'
      ORDER BY l.exp_date NULLS LAST, l.received_date NULLS LAST, l.lot_no
      FOR UPDATE OF b
    LOOP
      EXIT WHEN v_left < eps;
      v_take := LEAST(v_left, r.qty);
      PERFORM public._lot_post(r.lot_id, p_product, p_wh, -v_take, v_kind,
                               CASE WHEN v_ctx IS NULL THEN 'no_context' WHEN r.exp_date IS NOT NULL THEN 'fefo' ELSE 'fifo' END, v_ctx);
      v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'qty', v_take);
      v_left := v_left - v_take;
    END LOOP;
  END IF;

  IF v_left >= eps THEN
    v_lot := public._lot_unassigned(p_product);
    SELECT qty INTO v_bal FROM public.stock_lot_balances WHERE lot_id = v_lot AND warehouse_id = p_wh;
    PERFORM public._lot_post(v_lot, p_product, p_wh, -v_left, v_kind, CASE WHEN v_ctx IS NULL THEN 'no_context' ELSE 'unassigned' END, v_ctx);
    IF COALESCE(v_bal, 0) - v_left < -eps THEN
      PERFORM public._lot_alert('lot_shortage', format('Lot qalığı kifayət etmədi: məhsul %s, anbar %s, çatışmayan %s',
                                                       p_product, p_wh, v_left - GREATEST(COALESCE(v_bal, 0), 0)), v_lot);
    END IF;
    v_out := v_out || jsonb_build_object('lot_id', v_lot, 'qty', v_left);
  END IF;
  RETURN v_out;
END;
$$;

-- ─── 6. The warehouse_stocks trigger (never blocks a stock change) ───────────

CREATE OR REPLACE FUNCTION public._lot_trg_warehouse_stocks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid    UUID := COALESCE(NEW.product_id, OLD.product_id);
  v_skip   BOOLEAN;
  v_old_wh UUID;
  v_new_wh UUID;
  v_alloc  JSONB;
  v_moved  NUMERIC := 0;
  a        JSONB;
BEGIN
  IF COALESCE(current_setting('erp.lot_backfill', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT COALESCE(p.is_service, false) OR COALESCE(p.is_composite, false) OR COALESCE(p.inventory_mode, '') = 'polywood'
    INTO v_skip FROM public.products p WHERE p.id = v_pid;
    IF v_skip IS DISTINCT FROM false THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
      PERFORM public._lot_apply(v_pid, public._lot_wh(NEW.warehouse_id), NEW.current_stock);
    ELSIF TG_OP = 'DELETE' THEN
      PERFORM public._lot_apply(v_pid, public._lot_wh(OLD.warehouse_id), -OLD.current_stock);
    ELSE
      v_old_wh := public._lot_wh(OLD.warehouse_id);
      v_new_wh := public._lot_wh(NEW.warehouse_id);
      IF v_old_wh IS NOT DISTINCT FROM v_new_wh THEN
        PERFORM public._lot_apply(v_pid, v_new_wh, NEW.current_stock - OLD.current_stock);
      ELSE
        -- The row moved to another warehouse: its lots go along.
        v_alloc := public._lot_apply(v_pid, v_old_wh, -OLD.current_stock, NULL, NULL, 'transfer_out');
        FOR a IN SELECT value FROM jsonb_array_elements(v_alloc) LOOP
          PERFORM public._lot_post((a ->> 'lot_id')::uuid, v_pid, v_new_wh, (a ->> 'qty')::numeric, 'transfer_in', 'mirror',
                                   public._lot_ctx_for(v_pid));
          v_moved := v_moved + (a ->> 'qty')::numeric;
        END LOOP;
        PERFORM public._lot_apply(v_pid, v_new_wh, NEW.current_stock - v_moved);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._lot_alert('lot_error', format('%s (%s): məhsul %s; stok dəyişikliyi lotsuz keçdi', SQLERRM, SQLSTATE, v_pid));
  END;
  RETURN NULL;
END;
$$;

-- ─── 7. Polywood pieces ─────────────────────────────────────────────────────

-- BEFORE INSERT: the piece's lot. Its own lot_id, else its parent's (an offcut: the parent is
-- found when not given: the piece of the same product and warehouse that just left 'available'
-- in this transaction, else in the last 10 minutes), else the context, else unassigned.
CREATE OR REPLACE FUNCTION public._lot_trg_pieces_before()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last JSONB;
  v_ctx  JSONB;
  v_pid  UUID;
  v_lot  UUID;
BEGIN
  IF COALESCE(current_setting('erp.lot_backfill', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF NEW.parent_piece_id IS NULL AND NEW.piece_type = 'cut' AND NEW.lot_id IS NULL THEN
      v_last := NULLIF(current_setting('erp.lot_last_piece', true), '')::jsonb;
      IF v_last IS NOT NULL AND (v_last ->> 'product_id')::uuid = NEW.product_id
         AND (v_last ->> 'warehouse_id')::uuid IS NOT DISTINCT FROM NEW.warehouse_id
         AND COALESCE((v_last ->> 'length_m')::numeric, 0) >= NEW.length_m - 0.0005 THEN
        -- The remainder of the piece cut in this transaction (sale cut, count shortage).
        NEW.parent_piece_id := (v_last ->> 'piece_id')::uuid;
      ELSIF NEW.source_document_id IS NULL THEN
        -- The app's cut paths (src/lib/polywood/executeCut.ts, production) write the remainder in a
        -- separate request: the piece of this product and warehouse that just left 'available'.
        SELECT pp.id INTO v_pid FROM public.polywood_pieces pp
        WHERE pp.product_id = NEW.product_id AND pp.warehouse_id = NEW.warehouse_id
          AND pp.status <> 'available' AND pp.length_m >= NEW.length_m - 0.0005
          AND pp.updated_at > NOW() - INTERVAL '10 minutes'
        ORDER BY pp.updated_at DESC
        LIMIT 1;
        NEW.parent_piece_id := v_pid;
      END IF;
      PERFORM set_config('erp.lot_last_piece', '', true);
    END IF;
    IF NEW.lot_id IS NULL AND NEW.parent_piece_id IS NOT NULL THEN
      SELECT lot_id INTO NEW.lot_id FROM public.polywood_pieces WHERE id = NEW.parent_piece_id;
    END IF;
    IF NEW.lot_id IS NULL AND NEW.status = 'available' THEN
      v_ctx := public._lot_ctx_for(NEW.product_id);
      IF v_ctx IS NOT NULL THEN
        IF jsonb_typeof(v_ctx -> 'lots') = 'array' AND jsonb_array_length(v_ctx -> 'lots') > 0 THEN
          SELECT l.id INTO v_lot FROM public.stock_lots l
          WHERE l.product_id = NEW.product_id AND l.origin_type <> 'unassigned'
            AND (l.id = public._lot_uuid(v_ctx -> 'lots' -> 0 ->> 'lot_id') OR l.lot_no = NULLIF(v_ctx -> 'lots' -> 0 ->> 'lot_no', ''));
          NEW.lot_id := v_lot;
        END IF;
        IF NEW.lot_id IS NULL AND (jsonb_typeof(v_ctx -> 'new_lot') = 'object' OR NULLIF(v_ctx ->> 'doc_type', '') IS NOT NULL) THEN
          NEW.lot_id := public._lot_new(NEW.product_id, v_ctx, NEW.length_m);
        END IF;
      END IF;
    END IF;
    IF NEW.lot_id IS NULL AND NEW.status = 'available' THEN
      NEW.lot_id := public._lot_unassigned(NEW.product_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._lot_alert('lot_error', format('%s (%s): Polywood hissəsi; lot təyin edilmədi', SQLERRM, SQLSTATE));
  END;
  RETURN NEW;
END;
$$;

-- AFTER: the piece's length in / out / between warehouses on its lot.
CREATE OR REPLACE FUNCTION public._lot_trg_pieces_after()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was   BOOLEAN;
  v_is    BOOLEAN;
  v_old   UUID;
  v_new   UUID;
  v_ctx   JSONB;
  v_pick  TEXT;
  v_un    BOOLEAN;
BEGIN
  IF COALESCE(current_setting('erp.lot_backfill', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'available' AND NEW.length_m > 0 THEN
        v_new := COALESCE(NEW.lot_id, public._lot_unassigned(NEW.product_id));
        v_ctx := public._lot_ctx_for(NEW.product_id);
        SELECT origin_type = 'unassigned', CASE WHEN v_ctx IS NOT NULL AND origin_doc_id = public._lot_uuid(v_ctx ->> 'doc_id') THEN 'new_lot' END
        INTO v_un, v_pick FROM public.stock_lots WHERE id = v_new;
        v_pick := CASE WHEN NEW.parent_piece_id IS NOT NULL THEN 'mirror'
                       WHEN v_un THEN CASE WHEN v_ctx IS NULL THEN 'no_context' ELSE 'unassigned' END
                       ELSE COALESCE(v_pick, 'manual') END;
        PERFORM public._lot_apply(NEW.product_id, NEW.warehouse_id, NEW.length_m, v_new, v_pick);
        IF v_un THEN
          PERFORM public._lot_alert('lot_unassigned_in', format('Lotsuz Polywood hissəsi: %s (%s m)', NEW.id, NEW.length_m), v_new);
        END IF;
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.status = 'available' AND OLD.length_m > 0 THEN
        PERFORM public._lot_apply(OLD.product_id, OLD.warehouse_id, -OLD.length_m, COALESCE(OLD.lot_id, public._lot_unassigned(OLD.product_id)));
      END IF;
    ELSE
      v_was := OLD.status = 'available';
      v_is := NEW.status = 'available';
      v_old := COALESCE(OLD.lot_id, public._lot_unassigned(OLD.product_id));
      v_new := COALESCE(NEW.lot_id, public._lot_unassigned(NEW.product_id));
      IF v_was AND v_is THEN
        IF OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id OR v_old IS DISTINCT FROM v_new THEN
          PERFORM public._lot_apply(OLD.product_id, OLD.warehouse_id, -OLD.length_m, v_old, NULL,
                                    CASE WHEN v_old IS DISTINCT FROM v_new THEN 'correction' ELSE 'transfer_out' END);
          PERFORM public._lot_apply(NEW.product_id, NEW.warehouse_id, NEW.length_m, v_new, 'mirror',
                                    CASE WHEN v_old IS DISTINCT FROM v_new THEN 'correction' ELSE 'transfer_in' END);
        ELSIF NEW.length_m IS DISTINCT FROM OLD.length_m THEN
          PERFORM public._lot_apply(NEW.product_id, NEW.warehouse_id, NEW.length_m - OLD.length_m, v_new);
        END IF;
      ELSIF v_was AND NOT v_is THEN
        PERFORM public._lot_apply(OLD.product_id, OLD.warehouse_id, -OLD.length_m, v_old);
        -- An offcut inserted next in this transaction is cut from this piece.
        PERFORM set_config('erp.lot_last_piece', jsonb_build_object('piece_id', OLD.id, 'product_id', OLD.product_id,
                                                                    'warehouse_id', OLD.warehouse_id, 'length_m', OLD.length_m)::text, true);
      ELSIF v_is AND NOT v_was AND NEW.length_m > 0 THEN
        PERFORM public._lot_apply(NEW.product_id, NEW.warehouse_id, NEW.length_m, v_new);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._lot_alert('lot_error', format('%s (%s): Polywood hissəsi %s; lotsuz keçdi', SQLERRM, SQLSTATE, COALESCE(NEW.id, OLD.id)));
  END;
  RETURN NULL;
END;
$$;

-- ─── 8. The ledger is append-only ────────────────────────────────────────────
-- Only the date-change engine may move a movement's movement_date (erp.lot_ledger_write).
-- A cascade from a deleted product removes its rows.

CREATE OR REPLACE FUNCTION public._lot_trg_ledger_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.stock_lots WHERE id = OLD.lot_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format('%s yalnız əlavə olunur: silinə bilməz', TG_TABLE_NAME);
  END IF;
  IF TG_TABLE_NAME = 'stock_lot_movements'
     AND COALESCE(current_setting('erp.lot_ledger_write', true), '') = 'on'
     AND (to_jsonb(NEW) - 'movement_date') = (to_jsonb(OLD) - 'movement_date') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format('%s yalnız əlavə olunur: dəyişdirilə bilməz', TG_TABLE_NAME);
END;
$$;

-- ─── 9. Integrity ───────────────────────────────────────────────────────────

-- Per product x warehouse: the stock (warehouse_stocks; Polywood: available piece length) and the
-- sum of its lot balances, where they differ.
CREATE OR REPLACE FUNCTION public._lot_mismatches()
RETURNS TABLE (product_id UUID, warehouse_id UUID, stock_qty NUMERIC, lot_qty NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH def AS (SELECT public.stock_default_warehouse() AS wid),
  stock AS (
    SELECT ws.product_id AS pid, COALESCE(ws.warehouse_id, def.wid) AS wid, SUM(ws.current_stock) AS q
    FROM public.warehouse_stocks ws
    JOIN public.products p ON p.id = ws.product_id, def
    WHERE NOT COALESCE(p.is_service, false) AND NOT COALESCE(p.is_composite, false)
      AND COALESCE(p.inventory_mode, '') <> 'polywood'
      AND COALESCE(ws.warehouse_id, def.wid) IS NOT NULL
    GROUP BY 1, 2
    UNION ALL
    SELECT pp.product_id, pp.warehouse_id, SUM(pp.length_m)
    FROM public.polywood_pieces pp
    WHERE pp.status = 'available'
    GROUP BY 1, 2
  ),
  lots AS (
    SELECT b.product_id AS pid, b.warehouse_id AS wid, SUM(b.qty) AS q
    FROM public.stock_lot_balances b
    GROUP BY 1, 2
  )
  SELECT COALESCE(s.pid, l.pid), COALESCE(s.wid, l.wid), COALESCE(s.q, 0), COALESCE(l.q, 0)
  FROM stock s
  FULL JOIN lots l ON l.pid = s.pid AND l.wid = s.wid
  WHERE abs(COALESCE(s.q, 0) - COALESCE(l.q, 0)) > 0.0005;
$$;

-- The lot integrity checks (lots.view). p_days: how far back to look for movements without context.
CREATE OR REPLACE FUNCTION public.lot_integrity_report(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  check_code TEXT, product_id UUID, product_name TEXT, warehouse_id UUID, warehouse_name TEXT,
  lot_id UUID, lot_no TEXT, expected NUMERIC, actual NUMERIC, detail TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.lots_can('view') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lotları görmək üçün icazəniz yoxdur';
  END IF;
  RETURN QUERY
  SELECT 'sum_mismatch'::text, m.product_id, p.name::text, m.warehouse_id, w.name::text, NULL::uuid, NULL::text,
         m.stock_qty, m.lot_qty, 'Lotların cəmi anbar qalığına bərabər deyil'::text
  FROM public._lot_mismatches() m
  JOIN public.products p ON p.id = m.product_id
  LEFT JOIN public.warehouses w ON w.id = m.warehouse_id
  UNION ALL
  SELECT 'unassigned_nonzero', b.product_id, p.name, b.warehouse_id, w.name, l.id, l.lot_no, 0::numeric, b.qty,
         'Lotu bilinməyən miqdar var'
  FROM public.stock_lot_balances b
  JOIN public.stock_lots l ON l.id = b.lot_id
  JOIN public.products p ON p.id = b.product_id
  LEFT JOIN public.warehouses w ON w.id = b.warehouse_id
  WHERE b.is_unassigned AND abs(b.qty) > 0.0005
  UNION ALL
  SELECT 'negative_balance', b.product_id, p.name, b.warehouse_id, w.name, l.id, l.lot_no, 0::numeric, b.qty,
         'Lot qalığı mənfidir'
  FROM public.stock_lot_balances b
  JOIN public.stock_lots l ON l.id = b.lot_id
  JOIN public.products p ON p.id = b.product_id
  LEFT JOIN public.warehouses w ON w.id = b.warehouse_id
  WHERE NOT b.is_unassigned AND b.qty < -0.0005
  UNION ALL
  SELECT 'no_context', m.product_id, p.name, m.warehouse_id, w.name, NULL::uuid, NULL::text, 0::numeric, count(*)::numeric,
         format('Son %s gündə sənədsiz %s lot hərəkəti', p_days, count(*))
  FROM public.stock_lot_movements m
  JOIN public.products p ON p.id = m.product_id
  LEFT JOIN public.warehouses w ON w.id = m.warehouse_id
  WHERE m.pick_mode = 'no_context' AND m.recorded_at > NOW() - make_interval(days => GREATEST(COALESCE(p_days, 30), 1))
  GROUP BY m.product_id, p.name, m.warehouse_id, w.name
  UNION ALL
  SELECT 'expired_with_stock', b.product_id, p.name, b.warehouse_id, w.name, l.id, l.lot_no, 0::numeric, b.qty,
         format('Son istifadə tarixi keçib: %s', to_char(l.exp_date, 'DD.MM.YYYY'))
  FROM public.stock_lot_balances b
  JOIN public.stock_lots l ON l.id = b.lot_id
  JOIN public.products p ON p.id = b.product_id
  LEFT JOIN public.warehouses w ON w.id = b.warehouse_id
  WHERE l.exp_date < public.document_today() AND b.qty > 0.0005;
END;
$$;

-- Admins: make the lots of one product x warehouse match the stock again. The difference goes
-- through the product's unassigned lot as a 'correction' movement (then the unassigned quantity
-- is visible in the report until it is moved to real lots).
CREATE OR REPLACE FUNCTION public.lot_integrity_fix(p_product UUID, p_warehouse UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_wh     UUID := public._lot_wh(p_warehouse);
  v_m      RECORD;
  v_lot    UUID;
  v_diff   NUMERIC;
BEGIN
  IF NOT public.user_is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lot uyğunsuzluğunu yalnız administrator düzəldə bilər';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Düzəlişin səbəbini yazın';
  END IF;
  PERFORM 1 FROM public.warehouse_stocks
  WHERE product_id = p_product AND COALESCE(warehouse_id, public.stock_default_warehouse()) = v_wh FOR UPDATE;
  SELECT * INTO v_m FROM public._lot_mismatches() m WHERE m.product_id = p_product AND m.warehouse_id = v_wh;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'difference', 0);
  END IF;
  v_diff := v_m.stock_qty - v_m.lot_qty;
  v_lot := public._lot_unassigned(p_product);
  PERFORM public._lot_post(v_lot, p_product, v_wh, v_diff, 'correction', 'unassigned',
                           jsonb_build_object('doc_type', 'lot_integrity_fix', 'doc_no', left(v_reason, 200)));
  INSERT INTO public.stock_lot_events (lot_id, event, old_values, new_values, reason)
  VALUES (v_lot, 'corrected', jsonb_build_object('warehouse_id', v_wh, 'stock_qty', v_m.stock_qty, 'lot_qty', v_m.lot_qty),
          jsonb_build_object('warehouse_id', v_wh, 'difference', v_diff), v_reason);
  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (auth.uid(), 'UPDATE', 'INVENTORY', 'stock_lots', v_lot,
          jsonb_build_object('product_id', p_product, 'warehouse_id', v_wh, 'lot_qty', v_m.lot_qty),
          jsonb_build_object('operation', 'lot_integrity_fix', 'stock_qty', v_m.stock_qty, 'difference', v_diff, 'reason', v_reason));
  RETURN jsonb_build_object('ok', true, 'difference', v_diff, 'lot_id', v_lot);
END;
$$;

-- ─── 10. Lot header ─────────────────────────────────────────────────────────

-- lots.manage: supplier_batch_no, mfg_date, exp_date, notes, custom_fields; lot_no while the lot
-- has no out movement (afterwards admins only, with a reason). Every change: stock_lot_events +
-- audit_logs.
CREATE OR REPLACE FUNCTION public.lot_update(p_lot_id UUID, p_fields JSONB, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot    public.stock_lots%ROWTYPE;
  v_new    public.stock_lots%ROWTYPE;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_f      JSONB := COALESCE(p_fields, '{}'::jsonb);
  v_no     TEXT;
BEGIN
  IF NOT public.lots_can('manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lotu dəyişmək üçün icazəniz yoxdur';
  END IF;
  SELECT * INTO v_lot FROM public.stock_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Lot tapılmadı';
  END IF;
  IF v_lot.origin_type = 'unassigned' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Sistem lotu dəyişdirilmir';
  END IF;
  v_new := v_lot;
  IF v_f ? 'lot_no' THEN
    v_no := NULLIF(btrim(v_f ->> 'lot_no'), '');
    IF v_no IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Lot nömrəsi boş ola bilməz';
    END IF;
    IF v_no <> v_lot.lot_no THEN
      IF EXISTS (SELECT 1 FROM public.stock_lot_movements WHERE lot_id = p_lot_id AND qty_delta < 0)
         AND NOT (public.user_is_admin() AND v_reason IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = 'Çıxışı olan lotun nömrəsini yalnız administrator səbəb yazaraq dəyişə bilər';
      END IF;
      IF EXISTS (SELECT 1 FROM public.stock_lots WHERE lot_no = v_no AND id <> p_lot_id) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = format('Bu lot nömrəsi artıq var: %s', v_no);
      END IF;
      v_new.lot_no := v_no;
    END IF;
  END IF;
  IF v_f ? 'supplier_batch_no' THEN v_new.supplier_batch_no := NULLIF(btrim(v_f ->> 'supplier_batch_no'), ''); END IF;
  IF v_f ? 'mfg_date' THEN v_new.mfg_date := public._lot_date(v_f ->> 'mfg_date'); END IF;
  IF v_f ? 'exp_date' THEN v_new.exp_date := public._lot_date(v_f ->> 'exp_date'); END IF;
  IF v_f ? 'notes' THEN v_new.notes := NULLIF(v_f ->> 'notes', ''); END IF;
  IF v_f ? 'custom_fields' AND jsonb_typeof(v_f -> 'custom_fields') = 'object' THEN v_new.custom_fields := v_f -> 'custom_fields'; END IF;
  IF v_new.mfg_date IS NOT NULL AND v_new.exp_date IS NOT NULL AND v_new.exp_date < v_new.mfg_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Son istifadə tarixi istehsal tarixindən əvvəl ola bilməz';
  END IF;

  UPDATE public.stock_lots
  SET lot_no = v_new.lot_no, supplier_batch_no = v_new.supplier_batch_no, mfg_date = v_new.mfg_date,
      exp_date = v_new.exp_date, notes = v_new.notes, custom_fields = v_new.custom_fields, updated_at = NOW()
  WHERE id = p_lot_id;

  IF v_new.lot_no IS DISTINCT FROM v_lot.lot_no THEN
    INSERT INTO public.stock_lot_events (lot_id, event, old_values, new_values, reason)
    VALUES (p_lot_id, 'renamed', jsonb_build_object('lot_no', v_lot.lot_no), jsonb_build_object('lot_no', v_new.lot_no), v_reason);
  END IF;
  IF (v_new.mfg_date, v_new.exp_date) IS DISTINCT FROM (v_lot.mfg_date, v_lot.exp_date) THEN
    INSERT INTO public.stock_lot_events (lot_id, event, old_values, new_values, reason)
    VALUES (p_lot_id, 'dates_changed', jsonb_build_object('mfg_date', v_lot.mfg_date, 'exp_date', v_lot.exp_date),
            jsonb_build_object('mfg_date', v_new.mfg_date, 'exp_date', v_new.exp_date), v_reason);
  END IF;
  IF v_new.notes IS DISTINCT FROM v_lot.notes THEN
    INSERT INTO public.stock_lot_events (lot_id, event, old_values, new_values, reason)
    VALUES (p_lot_id, 'note', jsonb_build_object('notes', v_lot.notes), jsonb_build_object('notes', v_new.notes), v_reason);
  END IF;
  IF (v_new.supplier_batch_no, v_new.custom_fields) IS DISTINCT FROM (v_lot.supplier_batch_no, v_lot.custom_fields) THEN
    INSERT INTO public.stock_lot_events (lot_id, event, old_values, new_values, reason)
    VALUES (p_lot_id, 'corrected', jsonb_build_object('supplier_batch_no', v_lot.supplier_batch_no, 'custom_fields', v_lot.custom_fields),
            jsonb_build_object('supplier_batch_no', v_new.supplier_batch_no, 'custom_fields', v_new.custom_fields), v_reason);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (auth.uid(), 'UPDATE', 'INVENTORY', 'stock_lots', p_lot_id, to_jsonb(v_lot),
          to_jsonb(v_new) || jsonb_build_object('operation', 'lot_update', 'reason', v_reason));
  RETURN jsonb_build_object('ok', true, 'lot_id', p_lot_id, 'lot_no', v_new.lot_no);
END;
$$;

CREATE OR REPLACE FUNCTION public.lot_set_status(p_lot_id UUID, p_status TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.stock_lots%ROWTYPE;
BEGIN
  IF NOT public.lots_can('manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lotu dəyişmək üçün icazəniz yoxdur';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'quarantine', 'closed') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Lot statusu: active, quarantine və ya closed';
  END IF;
  SELECT * INTO v_lot FROM public.stock_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Lot tapılmadı';
  END IF;
  IF v_lot.origin_type = 'unassigned' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Sistem lotu dəyişdirilmir';
  END IF;
  IF v_lot.status = p_status THEN
    RETURN jsonb_build_object('ok', true, 'lot_id', p_lot_id, 'status', p_status, 'unchanged', true);
  END IF;
  UPDATE public.stock_lots SET status = p_status, updated_at = NOW() WHERE id = p_lot_id;
  INSERT INTO public.stock_lot_events (lot_id, event, old_values, new_values, reason)
  VALUES (p_lot_id, 'status_changed', jsonb_build_object('status', v_lot.status), jsonb_build_object('status', p_status),
          NULLIF(btrim(COALESCE(p_reason, '')), ''));
  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (auth.uid(), 'UPDATE', 'INVENTORY', 'stock_lots', p_lot_id, jsonb_build_object('status', v_lot.status),
          jsonb_build_object('operation', 'lot_set_status', 'status', p_status, 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
  RETURN jsonb_build_object('ok', true, 'lot_id', p_lot_id, 'status', p_status);
END;
$$;

-- ─── 11. Backfill of today's stock ──────────────────────────────────────────
-- Covers only stock that no lot covers yet (so it can run again without doubling): import
-- receipt lines and purchases whose FIFO layer still has stock (oldest first, up to what is still
-- uncovered in that warehouse), then one 'opening' lot per product x warehouse for the rest (a
-- negative remainder goes to the unassigned lot). Polywood: pieces without a lot; pieces of an
-- import receipt get that receipt's lot, the rest an opening lot per product x warehouse.
CREATE OR REPLACE FUNCTION public._lot_backfill()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eps       CONSTANT NUMERIC := 0.0000005;
  v_def     UUID := public.stock_default_warehouse();
  v_today   DATE := public.document_today();
  r         RECORD;
  v_left    NUMERIC;
  v_take    NUMERIC;
  v_lot     UUID;
  v_docs    INTEGER := 0;
  v_opening INTEGER := 0;
  v_unassig INTEGER := 0;
  v_pieces  INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  PERFORM set_config('erp.lot_backfill', 'on', true);
  DROP TABLE IF EXISTS pg_temp._lot_left;
  CREATE TEMP TABLE _lot_left ON COMMIT DROP AS
  SELECT s.pid AS product_id, s.wid AS warehouse_id,
         s.q - COALESCE((SELECT SUM(b.qty) FROM public.stock_lot_balances b WHERE b.product_id = s.pid AND b.warehouse_id = s.wid), 0) AS qty
  FROM (
    SELECT ws.product_id AS pid, COALESCE(ws.warehouse_id, v_def) AS wid, SUM(ws.current_stock) AS q
    FROM public.warehouse_stocks ws
    JOIN public.products p ON p.id = ws.product_id
    WHERE NOT COALESCE(p.is_service, false) AND NOT COALESCE(p.is_composite, false)
      AND COALESCE(p.inventory_mode, '') <> 'polywood'
      AND COALESCE(ws.warehouse_id, v_def) IS NOT NULL
    GROUP BY 1, 2
  ) s;
  SELECT count(*) INTO v_skipped FROM public.warehouse_stocks WHERE warehouse_id IS NULL AND v_def IS NULL AND current_stock <> 0;

  -- Documents whose FIFO layer still has stock, oldest first: import receipt lines, and purchases
  -- where the purchases module is installed.
  DROP TABLE IF EXISTS pg_temp._lot_cand;
  CREATE TEMP TABLE _lot_cand ON COMMIT DROP AS
  SELECT 'import'::text AS origin, 'import_receipt'::text AS doc_type, ir.id AS doc_id, rl.id AS line_id, ir.number::text AS doc_no,
         sl.product_id, COALESCE(rl.warehouse_id, v_def) AS wh, b.id AS batch_id, b.remaining_qty, s.supplier_id,
         s.id AS shipment_id, s.customs_declaration_no::text AS customs_no, ir.receipt_date AS rdate, rl.qty_stock_unit AS qty_rec,
         b.created_at AS bts
  FROM public.import_receipt_lines rl
  JOIN public.import_receipts ir ON ir.id = rl.receipt_id
  JOIN public.import_shipments s ON s.id = ir.shipment_id
  JOIN public.import_shipment_lines sl ON sl.id = rl.shipment_line_id
  JOIN public.inventory_batches b ON b.id = rl.batch_id
  WHERE b.remaining_qty > eps;
  IF to_regclass('public.purchases') IS NOT NULL AND to_regclass('public.purchase_items') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO _lot_cand
      SELECT 'purchase', 'purchase', pu.id,
             (SELECT pi.id FROM public.purchase_items pi WHERE pi.purchase_id = pu.id AND pi.product_id = b.product_id ORDER BY pi.id LIMIT 1),
             pu.invoice_number::text, b.product_id, COALESCE(pu.warehouse_id, $1), b.id, b.remaining_qty, pu.supplier_id,
             NULL::uuid, NULL::text, COALESCE(pu.doc_date, (pu.created_at AT TIME ZONE 'Asia/Baku')::date), b.initial_qty, b.created_at
      FROM public.inventory_batches b
      JOIN public.purchases pu ON pu.id = b.document_id
      WHERE b.document_type = 'purchase' AND b.remaining_qty > $2
    $q$ USING v_def, eps;
  END IF;
  FOR r IN
    SELECT c.* FROM _lot_cand c
    JOIN public.products p ON p.id = c.product_id
    WHERE NOT COALESCE(p.is_service, false) AND NOT COALESCE(p.is_composite, false)
      AND COALESCE(p.inventory_mode, '') <> 'polywood'
      AND c.wh IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_lots l WHERE l.inventory_batch_id = c.batch_id)
    ORDER BY c.rdate, c.bts, c.batch_id
  LOOP
    SELECT qty INTO v_left FROM _lot_left WHERE product_id = r.product_id AND warehouse_id = r.wh;
    v_take := LEAST(r.remaining_qty, COALESCE(v_left, 0));
    CONTINUE WHEN v_take < eps;
    v_lot := public._lot_create(r.product_id, jsonb_build_object(
      'origin_type', r.origin, 'origin_doc_type', r.doc_type, 'origin_doc_id', r.doc_id, 'origin_line_id', r.line_id,
      'origin_doc_no', r.doc_no, 'supplier_id', r.supplier_id, 'import_shipment_id', r.shipment_id,
      'customs_declaration_no', r.customs_no, 'received_date', r.rdate, 'qty_received', r.qty_rec,
      'inventory_batch_id', r.batch_id));
    PERFORM public._lot_post(v_lot, r.product_id, r.wh, v_take, 'in', 'backfill',
      jsonb_build_object('doc_type', r.doc_type, 'doc_id', r.doc_id, 'doc_line_id', r.line_id, 'doc_no', r.doc_no,
                         'counterparty_type', CASE WHEN r.supplier_id IS NOT NULL THEN 'supplier' ELSE 'none' END,
                         'counterparty_id', r.supplier_id),
      NULL, r.bts);
    UPDATE _lot_left SET qty = qty - v_take WHERE product_id = r.product_id AND warehouse_id = r.wh;
    v_docs := v_docs + 1;
  END LOOP;

  -- The rest: one opening lot per product x warehouse; a negative remainder to unassigned.
  FOR r IN SELECT * FROM _lot_left WHERE abs(qty) >= eps ORDER BY product_id, warehouse_id LOOP
    IF r.qty > 0 THEN
      v_lot := public._lot_create(r.product_id, jsonb_build_object('origin_type', 'opening', 'received_date', v_today,
                                                                   'qty_received', r.qty, 'notes', 'Backfill: mövcud qalıq'));
      PERFORM public._lot_post(v_lot, r.product_id, r.warehouse_id, r.qty, 'in', 'backfill', jsonb_build_object('doc_type', 'lot_backfill'));
      v_opening := v_opening + 1;
    ELSE
      v_lot := public._lot_unassigned(r.product_id);
      PERFORM public._lot_post(v_lot, r.product_id, r.warehouse_id, r.qty, 'correction', 'backfill', jsonb_build_object('doc_type', 'lot_backfill'));
      v_unassig := v_unassig + 1;
    END IF;
  END LOOP;

  -- Polywood: pieces of an import receipt line get that line's lot.
  FOR r IN
    SELECT pp.product_id, ir.id AS doc_id, ir.number::text AS doc_no, ir.receipt_date AS rdate, s.supplier_id, s.id AS shipment_id,
           s.customs_declaration_no::text AS customs_no,
           (SELECT rl.id FROM public.import_receipt_lines rl JOIN public.import_shipment_lines sl ON sl.id = rl.shipment_line_id
            WHERE rl.receipt_id = ir.id AND sl.product_id = pp.product_id ORDER BY rl.id LIMIT 1) AS line_id,
           SUM(pp.length_m) AS metres
    FROM public.polywood_pieces pp
    JOIN public.import_receipts ir ON ir.id = pp.source_document_id
    JOIN public.import_shipments s ON s.id = ir.shipment_id
    WHERE pp.status = 'available' AND pp.lot_id IS NULL
    GROUP BY pp.product_id, ir.id, ir.number, ir.receipt_date, s.supplier_id, s.id, s.customs_declaration_no
  LOOP
    SELECT id INTO v_lot FROM public.stock_lots
    WHERE product_id = r.product_id AND origin_doc_type = 'import_receipt' AND origin_doc_id = r.doc_id
      AND origin_line_id IS NOT DISTINCT FROM r.line_id
    LIMIT 1;
    IF v_lot IS NULL THEN
      v_lot := public._lot_create(r.product_id, jsonb_build_object(
        'origin_type', 'import', 'origin_doc_type', 'import_receipt', 'origin_doc_id', r.doc_id, 'origin_line_id', r.line_id,
        'origin_doc_no', r.doc_no, 'supplier_id', r.supplier_id, 'import_shipment_id', r.shipment_id,
        'customs_declaration_no', r.customs_no, 'received_date', r.rdate, 'qty_received', r.metres));
    END IF;
    UPDATE public.polywood_pieces SET lot_id = v_lot
    WHERE product_id = r.product_id AND source_document_id = r.doc_id AND status = 'available' AND lot_id IS NULL;
    v_pieces := v_pieces + 1;
  END LOOP;
  -- The other pieces: an opening lot per product x warehouse.
  FOR r IN
    SELECT pp.product_id, pp.warehouse_id, SUM(pp.length_m) AS metres
    FROM public.polywood_pieces pp
    WHERE pp.status = 'available' AND pp.lot_id IS NULL
    GROUP BY 1, 2
  LOOP
    v_lot := public._lot_create(r.product_id, jsonb_build_object('origin_type', 'opening', 'received_date', v_today,
                                                                 'qty_received', r.metres, 'notes', 'Backfill: mövcud Polywood hissələri'));
    UPDATE public.polywood_pieces SET lot_id = v_lot
    WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id AND status = 'available' AND lot_id IS NULL;
    v_pieces := v_pieces + 1;
  END LOOP;
  -- Polywood balances: what the pieces hold minus what the lots already show.
  FOR r IN
    SELECT pp.lot_id, pp.product_id, pp.warehouse_id,
           SUM(pp.length_m) - COALESCE((SELECT b.qty FROM public.stock_lot_balances b WHERE b.lot_id = pp.lot_id AND b.warehouse_id = pp.warehouse_id), 0) AS diff
    FROM public.polywood_pieces pp
    WHERE pp.status = 'available' AND pp.lot_id IS NOT NULL
    GROUP BY pp.lot_id, pp.product_id, pp.warehouse_id
  LOOP
    CONTINUE WHEN abs(r.diff) < eps;
    PERFORM public._lot_post(r.lot_id, r.product_id, r.warehouse_id, r.diff, CASE WHEN r.diff > 0 THEN 'in' ELSE 'correction' END,
                             'backfill', (SELECT jsonb_build_object('doc_type', COALESCE(origin_doc_type, 'lot_backfill'), 'doc_id', origin_doc_id,
                                                                    'doc_line_id', origin_line_id, 'doc_no', origin_doc_no)
                                          FROM public.stock_lots WHERE id = r.lot_id));
  END LOOP;

  PERFORM set_config('erp.lot_backfill', '', true);
  RETURN jsonb_build_object('document_lots', v_docs, 'opening_lots', v_opening, 'negative_to_unassigned', v_unassig,
                            'polywood_groups', v_pieces, 'rows_without_warehouse', v_skipped);
END;
$$;


-- ─── 12. Date changes (DATE-1..3): lot rows move with their document ─────────
-- A document's lot movements (doc_type / doc_id = the date-change document type and id; not its
-- reversals) on the old day move to the new day keeping the time of day (DATE-3 documents: all of
-- them, as the engine moves all their rows), and the lots it created get the new received date.

CREATE OR REPLACE FUNCTION public._lot_date_change_rows(p_doc_type TEXT, p_doc_id UUID, p_old DATE, p_new DATE)
RETURNS TABLE (tbl TEXT, row_id UUID, col TEXT, old_ts TIMESTAMPTZ, new_ts TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'stock_lot_movements'::text, m.id, 'movement_date'::text, m.movement_date, public._date_change_ts(m.movement_date, p_new)
  FROM public.stock_lot_movements m
  WHERE m.doc_type = p_doc_type AND m.doc_id = p_doc_id
    AND m.kind NOT IN ('reverse_in', 'reverse_out')
    AND (p_doc_type IN ('stock_transfer', 'inventory_writeoff', 'inventory_initial_balance', 'inventory_count', 'import_receipt', 'import_payment')
         OR public._baku_day(m.movement_date) = p_old)
  UNION ALL
  SELECT 'stock_lots', l.id, 'received_date', (l.received_date::timestamp AT TIME ZONE 'Asia/Baku'),
         (p_new::timestamp AT TIME ZONE 'Asia/Baku')
  FROM public.stock_lots l
  WHERE l.origin_doc_type = p_doc_type AND l.origin_doc_id = p_doc_id AND l.received_date = p_old;
$$;

-- Runs inside apply_document_date_change when it writes its history row: moves the lot rows and
-- lists them in moved_rows (group 'lot').
CREATE OR REPLACE FUNCTION public._lot_trg_date_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      RECORD;
  v_rows JSONB := '[]'::jsonb;
BEGIN
  PERFORM set_config('erp.lot_ledger_write', 'on', true);
  FOR r IN SELECT * FROM public._lot_date_change_rows(NEW.document_type, NEW.document_id, NEW.old_date, NEW.new_date) LOOP
    IF r.tbl = 'stock_lot_movements' THEN
      UPDATE public.stock_lot_movements SET movement_date = r.new_ts WHERE id = r.row_id;
    ELSE
      UPDATE public.stock_lots SET received_date = NEW.new_date, updated_at = NOW() WHERE id = r.row_id;
    END IF;
    v_rows := v_rows || jsonb_build_object('table', r.tbl, 'id', r.row_id, 'column', r.col, 'old', r.old_ts, 'new', r.new_ts, 'group', 'lot');
  END LOOP;
  PERFORM set_config('erp.lot_ledger_write', '', true);
  NEW.moved_rows := COALESCE(NEW.moved_rows, '[]'::jsonb) || v_rows;
  RETURN NEW;
END;
$$;

-- No lot balance (real lots; the unassigned lot may be negative) goes below zero at any moment
-- after the change, unless it already did before (as _stock_timeline_violations).
CREATE OR REPLACE FUNCTION public._lot_timeline_violations(p_doc_type TEXT, p_doc_id UUID, p_old DATE, p_new DATE)
RETURNS TABLE (lot_id UUID, warehouse_id UUID, at TIMESTAMPTZ, balance NUMERIC, shortfall NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mv AS (
    SELECT m.id, m.lot_id, m.warehouse_id, m.qty_delta AS q, r.old_ts AS o, r.new_ts AS n
    FROM public._lot_date_change_rows(p_doc_type, p_doc_id, p_old, p_new) r
    JOIN public.stock_lot_movements m ON r.tbl = 'stock_lot_movements' AND m.id = r.row_id
    JOIN public.stock_lots l ON l.id = m.lot_id AND l.origin_type <> 'unassigned'
  ),
  pairs AS (
    SELECT mv.lot_id, mv.warehouse_id, MIN(LEAST(mv.o, mv.n)) AS from_ts FROM mv GROUP BY 1, 2
  ),
  cur AS (
    SELECT b.lot_id, b.warehouse_id, b.qty FROM public.stock_lot_balances b JOIN pairs p USING (lot_id, warehouse_id)
  ),
  other AS (
    SELECT e.lot_id, e.warehouse_id, e.id, e.movement_date AS ts, e.qty_delta AS q
    FROM pairs p
    JOIN public.stock_lot_movements e ON e.lot_id = p.lot_id AND e.warehouse_id = p.warehouse_id
    WHERE e.movement_date >= p.from_ts AND NOT EXISTS (SELECT 1 FROM mv WHERE mv.id = e.id)
  ),
  before_set AS (
    SELECT lot_id, warehouse_id, id, ts, q FROM other UNION ALL SELECT lot_id, warehouse_id, id, o, q FROM mv
  ),
  after_set AS (
    SELECT lot_id, warehouse_id, id, ts, q FROM other UNION ALL SELECT lot_id, warehouse_id, id, n, q FROM mv
  ),
  after_points AS (
    SELECT a.lot_id, a.warehouse_id, a.ts, a.id,
           COALESCE(c.qty, 0) - COALESCE(SUM(a.q) OVER (PARTITION BY a.lot_id, a.warehouse_id ORDER BY a.ts DESC, a.id DESC
                                                       ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS bal
    FROM after_set a LEFT JOIN cur c USING (lot_id, warehouse_id)
  )
  SELECT ap.lot_id, ap.warehouse_id, ap.ts, round(ap.bal, 4), round(-ap.bal, 4)
  FROM after_points ap
  JOIN pairs p ON p.lot_id = ap.lot_id AND p.warehouse_id = ap.warehouse_id
  WHERE ap.ts >= p.from_ts
    AND ap.bal < -0.0005
    AND ap.bal < (
      COALESCE((SELECT c.qty FROM cur c WHERE c.lot_id = ap.lot_id AND c.warehouse_id = ap.warehouse_id), 0)
      - COALESCE((SELECT SUM(b.q) FROM before_set b
                  WHERE b.lot_id = ap.lot_id AND b.warehouse_id = ap.warehouse_id AND (b.ts, b.id) > (ap.ts, ap.id)), 0)
    ) - 0.0005
  ORDER BY ap.lot_id, ap.warehouse_id, ap.ts;
$$;


-- ─── 13. The date-change blockers (DATE-3's function, unchanged, plus the lot check) ───

CREATE OR REPLACE FUNCTION public._date_change_extra_blockers(
  p_document_type TEXT, p_document_id UUID, p_old DATE, p_new DATE, p_options JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out       JSONB := '[]'::jsonb;
  v_move_pays BOOLEAN := COALESCE((p_options->>'move_same_day_payments')::boolean, false);
  v_tx        public.transactions%ROWTYPE;
  v_inv_date  DATE;
  v_label     TEXT;
  v_reimb     UUID;
  v_reimb_day DATE;
  v_list      JSONB;
BEGIN
  IF p_document_type = 'invoice_payment' THEN
    -- R7: a payment is not before its invoice (assert_payment_not_before_document).
    SELECT * INTO v_tx FROM public.transactions WHERE id = p_document_id;
    SELECT h.doc_date, h.label INTO v_inv_date, v_label FROM public._date_change_header(v_tx.source_type, v_tx.source_id) h;
    IF v_inv_date IS NOT NULL AND p_new < v_inv_date THEN
      v_out := v_out || jsonb_build_object('code', 'payment_before_its_invoice',
        'message', 'Ödəniş fakturadan əvvələ düşür',
        'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('doc_no', v_label, 'date', v_inv_date))));
    END IF;
  ELSIF p_document_type = 'expense' AND to_regclass('public.expenses') IS NOT NULL THEN
    -- R7: not before its source document (the production order it is booked on).
    IF to_regclass('public.production_orders') IS NOT NULL THEN
      EXECUTE 'SELECT COALESCE(po.start_date, (po.created_at AT TIME ZONE ''Asia/Baku'')::date), po.id::text
               FROM public.expenses e JOIN public.production_orders po ON po.id = e.production_order_id
               WHERE e.id = $1'
      INTO v_inv_date, v_label USING p_document_id;
      IF v_inv_date IS NOT NULL AND p_new < v_inv_date THEN
        v_out := v_out || jsonb_build_object('code', 'expense_before_source',
          'message', 'Xərc əsas sənəddən (istehsal sifarişi) əvvələ düşür',
          'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('document_id', v_label, 'date', v_inv_date))));
      END IF;
    END IF;
    -- R7: the reimbursement of an employee-paid expense is not before the expense.
    EXECUTE 'SELECT reimbursement_journal_id FROM public.expenses WHERE id = $1' INTO v_reimb USING p_document_id;
    IF v_reimb IS NOT NULL THEN
      SELECT public._baku_day(COALESCE(je.date, je.entry_date::timestamptz)) INTO v_reimb_day
      FROM public.journal_entries je WHERE je.id = v_reimb AND je.reversal_of IS NULL AND je.reversed_by IS NULL;
      IF v_reimb_day IS NOT NULL AND v_reimb_day < p_new AND NOT (v_move_pays AND v_reimb_day = p_old) THEN
        v_out := v_out || jsonb_build_object('code', 'reimbursement_before_expense',
          'message', 'Kompensasiya xərcdən əvvələ düşür',
          'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('date', v_reimb_day)),
                                        'same_day', v_reimb_day = p_old));
      END IF;
    END IF;
  END IF;

  IF p_document_type IN ('stock_transfer', 'inventory_writeoff', 'inventory_initial_balance', 'inventory_count', 'import_receipt') THEN
    -- Initial balances and counts unposted and posted again: refused.
    IF (p_document_type = 'inventory_initial_balance' AND to_regclass('public.inventory_initial_balances') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.inventory_initial_balances WHERE id = p_document_id AND unposted_at IS NOT NULL))
       OR (p_document_type = 'inventory_count' AND to_regclass('public.inventory_counts') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.inventory_counts WHERE id = p_document_id AND (unposted_at IS NOT NULL OR post_revision > 0))) THEN
      v_out := v_out || jsonb_build_object('code', 'reposted_document',
        'message', 'Sənəd geri alınıb yenidən təsdiqlənib: tarixini dəyişmək üçün geri alın, tarixi dəyişin və yenidən təsdiqləyin',
        'details', '{}'::jsonb);
    END IF;

    -- A count with Polywood lines cannot switch between today and a past date (F2 rule).
    IF p_document_type = 'inventory_count' AND to_regclass('public.inventory_count_items') IS NOT NULL
       AND (p_new < public.document_today()) IS DISTINCT FROM (p_old < public.document_today())
       AND EXISTS (SELECT 1 FROM public.inventory_count_items i JOIN public.products p ON p.id = i.product_id
                   WHERE i.count_id = p_document_id AND p.inventory_mode = 'polywood') THEN
      v_out := v_out || jsonb_build_object('code', 'count_polywood_switch',
        'message', 'Polywood sətirləri olan sayımda bugünkü və keçmiş tarix arasında keçid mümkün deyil',
        'details', '{}'::jsonb);
    END IF;

    -- R4: the FIFO layers it made are not used before they exist; the layers it used exist first.
    SELECT jsonb_agg(DISTINCT jsonb_build_object('doc_no', COALESCE(s.doc_no, c.source_type), 'date', public._baku_day(c.created_at)))
    INTO v_list
    FROM public.inventory_batches b
    JOIN public.inventory_batch_consumptions c ON c.batch_id = b.id
    LEFT JOIN public.sales s ON s.id = c.sale_id
    WHERE b.document_id = p_document_id
      AND p_document_type IN ('inventory_initial_balance', 'inventory_count', 'import_receipt')
      AND c.source_id IS DISTINCT FROM p_document_id
      AND c.created_at < public._date_change_ts(b.created_at, p_new);
    IF v_list IS NULL THEN
      SELECT jsonb_agg(DISTINCT jsonb_build_object('document_type', b.document_type, 'date', public._baku_day(b.created_at)))
      INTO v_list
      FROM public.inventory_batch_consumptions c
      JOIN public.inventory_batches b ON b.id = c.batch_id
      WHERE p_document_type = 'inventory_count' AND c.source_id = p_document_id AND c.sale_id IS NULL
        AND b.document_id IS DISTINCT FROM p_document_id
        AND public._date_change_ts(c.created_at, p_new) < b.created_at;
    END IF;
    IF v_list IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('code', 'fifo_order',
        'message', 'Mal alınmazdan əvvəl satılmış olardı (FIFO qaydası)', 'details', jsonb_build_object('items', v_list));
    END IF;

    -- R5: Polywood pieces it brought are not sold before it.
    SELECT jsonb_agg(DISTINCT jsonb_build_object('sale_id', s.id, 'doc_no', s.doc_no, 'date', s.doc_date))
    INTO v_list
    FROM public.polywood_pieces pc
    JOIN public.sale_items si ON si.id = pc.sale_item_id
    JOIN public.sales s ON s.id = si.sale_id
    WHERE p_document_type IN ('inventory_initial_balance', 'import_receipt')
      AND pc.source_document_id = p_document_id
      AND s.doc_date < p_new;
    IF v_list IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('code', 'polywood_order',
        'message', 'Polywood parçaları alışdan əvvəl satılmış olardı', 'details', jsonb_build_object('items', v_list));
    END IF;

    -- R8: another posted count of the same product and warehouse between the two dates.
    IF to_regclass('public.inventory_counts') IS NOT NULL AND to_regclass('public.inventory_count_items') IS NOT NULL THEN
      SELECT jsonb_agg(DISTINCT jsonb_build_object('count_id', ic.id, 'document_number', ic.document_number, 'date', ic.count_date))
      INTO v_list
      FROM public.inventory_counts ic
      JOIN public.inventory_count_items it ON it.count_id = ic.id
      WHERE ic.status = 'posted'
        AND ic.id <> p_document_id
        AND ic.count_date BETWEEN LEAST(p_old, p_new) AND GREATEST(p_old, p_new)
        AND (it.product_id, ic.warehouse_id) IN (
          SELECT (m->>'product_id')::uuid, (m->>'warehouse_id')::uuid
          FROM jsonb_array_elements(public._date_change_stock_moves(p_document_type, p_document_id, p_new)) m);
      IF v_list IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('code', 'inventory_count_between',
          'message', 'İki tarix arasında bu mal üçün təsdiqlənmiş inventarizasiya var', 'details', jsonb_build_object('items', v_list));
      END IF;
    END IF;
  END IF;

  -- R7 (imports): a receipt is not before the shipment's confirmation; a payment not before its payable.
  IF p_document_type = 'import_receipt' THEN
    SELECT s.confirm_date, s.number INTO v_inv_date, v_label
    FROM public.import_receipts ir JOIN public.import_shipments s ON s.id = ir.shipment_id WHERE ir.id = p_document_id;
    IF v_inv_date IS NOT NULL AND p_new < v_inv_date THEN
      v_out := v_out || jsonb_build_object('code', 'import_before_confirm',
        'message', 'Qəbul tarixi idxalın təsdiq tarixindən əvvəl ola bilməz',
        'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('doc_no', v_label, 'date', v_inv_date))));
    END IF;
  ELSIF p_document_type = 'import_payment' THEN
    SELECT pb.document_date, s.number INTO v_inv_date, v_label
    FROM public.import_payments ip
    JOIN public.import_payables pb ON pb.id = ip.payable_id
    JOIN public.import_shipments s ON s.id = ip.shipment_id
    WHERE ip.id = p_document_id;
    IF v_inv_date IS NOT NULL AND p_new < v_inv_date THEN
      v_out := v_out || jsonb_build_object('code', 'import_payment_before_payable',
        'message', 'Ödəniş borcun yarandığı tarixdən əvvələ düşür',
        'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('doc_no', v_label, 'date', v_inv_date))));
    END IF;
  END IF;

  -- LOT-1: no lot balance goes below zero at any moment after the change.
  SELECT jsonb_agg(jsonb_build_object('lot_no', l.lot_no, 'warehouse', w.name, 'date', public._baku_day(v.at), 'shortfall', v.shortfall)
                   ORDER BY v.at)
  INTO v_list
  FROM (SELECT DISTINCT ON (x.lot_id, x.warehouse_id) x.*
        FROM public._lot_timeline_violations(p_document_type, p_document_id, p_old, p_new) x
        ORDER BY x.lot_id, x.warehouse_id, x.at) v
  JOIN public.stock_lots l ON l.id = v.lot_id
  LEFT JOIN public.warehouses w ON w.id = v.warehouse_id;
  IF v_list IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('code', 'lot_negative',
      'message', 'Bu tarixlə lot qalığı mənfiyə düşür', 'details', jsonb_build_object('items', v_list));
  END IF;
  RETURN v_out;
END;
$$;


-- ─── 14. Backfill (once), then the triggers ──────────────────────────────────

DO $$
DECLARE
  v_result JSONB;
  v_bad    INTEGER;
  v_list   TEXT;
BEGIN
  -- Once: a re-run must not quietly cover later differences (lot_integrity_report shows them).
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'lot_tracking' AND value ? 'backfilled_at')
     OR EXISTS (SELECT 1 FROM public.stock_lot_movements WHERE pick_mode = 'backfill') THEN
    RAISE NOTICE 'LOT-1 backfill: already done';
    RETURN;
  END IF;
  v_result := public._lot_backfill();
  RAISE NOTICE 'LOT-1 backfill: %', v_result;
  SELECT count(*), string_agg(format('%s / %s: stock %s, lots %s', m.product_id, m.warehouse_id, m.stock_qty, m.lot_qty), '; ')
  INTO v_bad, v_list
  FROM (SELECT * FROM public._lot_mismatches() LIMIT 10) m;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'LOT-1 backfill: lots do not match the stock (first %): %', v_bad, v_list;
  END IF;
  UPDATE public.system_settings
  SET value = value || jsonb_build_object('backfilled_at', NOW(), 'backfill', v_result), updated_at = NOW()
  WHERE key = 'lot_tracking';
END
$$;

DROP TRIGGER IF EXISTS trg_lot_warehouse_stocks ON public.warehouse_stocks;
CREATE TRIGGER trg_lot_warehouse_stocks
  AFTER INSERT OR DELETE OR UPDATE OF current_stock, warehouse_id ON public.warehouse_stocks
  FOR EACH ROW EXECUTE FUNCTION public._lot_trg_warehouse_stocks();

DROP TRIGGER IF EXISTS trg_lot_pieces_before ON public.polywood_pieces;
CREATE TRIGGER trg_lot_pieces_before
  BEFORE INSERT ON public.polywood_pieces
  FOR EACH ROW EXECUTE FUNCTION public._lot_trg_pieces_before();

DROP TRIGGER IF EXISTS trg_lot_pieces_after ON public.polywood_pieces;
CREATE TRIGGER trg_lot_pieces_after
  AFTER INSERT OR DELETE OR UPDATE OF status, length_m, warehouse_id, lot_id ON public.polywood_pieces
  FOR EACH ROW EXECUTE FUNCTION public._lot_trg_pieces_after();

DROP TRIGGER IF EXISTS trg_lot_ledger_guard ON public.stock_lot_movements;
CREATE TRIGGER trg_lot_ledger_guard
  BEFORE UPDATE OR DELETE ON public.stock_lot_movements
  FOR EACH ROW EXECUTE FUNCTION public._lot_trg_ledger_guard();

DROP TRIGGER IF EXISTS trg_lot_events_guard ON public.stock_lot_events;
CREATE TRIGGER trg_lot_events_guard
  BEFORE UPDATE OR DELETE ON public.stock_lot_events
  FOR EACH ROW EXECUTE FUNCTION public._lot_trg_ledger_guard();

DROP TRIGGER IF EXISTS trg_lot_date_change ON public.document_date_changes;
CREATE TRIGGER trg_lot_date_change
  BEFORE INSERT ON public.document_date_changes
  FOR EACH ROW EXECUTE FUNCTION public._lot_trg_date_change();

-- ─── 15. RLS and grants ─────────────────────────────────────────────────────
-- Read with lots.view; no write policies: every write goes through the functions above.

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lot_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lot_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lot_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_lots_select ON public.stock_lots;
CREATE POLICY stock_lots_select ON public.stock_lots FOR SELECT TO authenticated USING ((SELECT public.lots_can('view')));
DROP POLICY IF EXISTS stock_lot_balances_select ON public.stock_lot_balances;
CREATE POLICY stock_lot_balances_select ON public.stock_lot_balances FOR SELECT TO authenticated USING ((SELECT public.lots_can('view')));
DROP POLICY IF EXISTS stock_lot_movements_select ON public.stock_lot_movements;
CREATE POLICY stock_lot_movements_select ON public.stock_lot_movements FOR SELECT TO authenticated USING ((SELECT public.lots_can('view')));
DROP POLICY IF EXISTS stock_lot_events_select ON public.stock_lot_events;
CREATE POLICY stock_lot_events_select ON public.stock_lot_events FOR SELECT TO authenticated USING ((SELECT public.lots_can('view')));

REVOKE ALL ON TABLE public.stock_lots, public.stock_lot_balances, public.stock_lot_movements, public.stock_lot_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stock_lots, public.stock_lot_balances, public.stock_lot_movements, public.stock_lot_events TO authenticated;
GRANT ALL ON TABLE public.stock_lots, public.stock_lot_balances, public.stock_lot_movements, public.stock_lot_events TO service_role;

-- Checked by themselves: open to signed-in users.
REVOKE ALL ON FUNCTION public.lots_can(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lot_integrity_report(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lot_integrity_fix(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lot_update(UUID, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lot_set_status(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lots_can(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lot_integrity_report(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lot_integrity_fix(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lot_update(UUID, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lot_set_status(UUID, TEXT, TEXT) TO authenticated, service_role;

-- Used by document functions (SECURITY DEFINER) and the server: not by browsers.
REVOKE ALL ON FUNCTION public.lot_ctx_begin(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lot_ctx_end() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_lot_no(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lot_ctx_begin(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.lot_ctx_end() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_lot_no(DATE) TO service_role;

-- Internal.
REVOKE ALL ON FUNCTION public._lot_ctx() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_ctx_for(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_wh(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_uuid(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_date(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_alert(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_create(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_unassigned(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_origin_for(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_new(UUID, JSONB, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_post(UUID, UUID, UUID, NUMERIC, TEXT, TEXT, JSONB, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_doc_open(UUID, JSONB, INTEGER, TEXT[], TEXT[], BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_apply(UUID, UUID, NUMERIC, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_trg_warehouse_stocks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_trg_pieces_before() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_trg_pieces_after() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_trg_ledger_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_trg_date_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_mismatches() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_backfill() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_date_change_rows(TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_timeline_violations(TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_extra_blockers(TEXT, UUID, DATE, DATE, JSONB) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
