-- ============================================================================
-- Dimensional Inventory / Category / Mixed-Sale Overhaul
-- ============================================================================
-- 1. Ports the legacy Polywood columns/table from types/schema.sql into a real
--    migration (they were only ever added to the canonical schema file, never
--    pushed to the live DB — this is the root cause of the
--    "column products.inventory_mode does not exist" crash on /polywood).
-- 2. Adds generic dimensional-product fields (category_id, base_length,
--    base_width, is_dimensional) so the same engine covers Polywood (4m),
--    Sinelik (3.6m) and any future sheet/roll product, not just "polywood".
-- 3. Seeds default categories (Polywood, Sinelik, Accessories, Services).
-- 4. Adds a sync trigger so legacy code (inventory_mode/full_sheet_length_m)
--    and the new generic fields (is_dimensional/base_length) always agree,
--    regardless of which side wrote the row.
-- 5. Adds process_mixed_dimensional_sale() — an atomic RPC that deducts stock
--    for dimensional (full-sheet or by-the-meter with auto-cut + remnant),
--    accessory, and service invoice lines.
-- ============================================================================

-- ─── 1. Legacy Polywood columns/table (previously canonical-only) ──────────
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS warehouse_type TEXT NOT NULL DEFAULT 'general';
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE products ADD COLUMN IF NOT EXISTS full_sheet_length_m NUMERIC NOT NULL DEFAULT 4;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_sale_mode TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_length_m NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_cut_details JSONB;

CREATE TABLE IF NOT EXISTS polywood_pieces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  length_m NUMERIC NOT NULL CHECK (length_m > 0),
  piece_type TEXT NOT NULL DEFAULT 'full' CHECK (piece_type IN ('full', 'cut')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'consumed')),
  sale_item_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polywood_pieces_product_available
  ON polywood_pieces (product_id, warehouse_id)
  WHERE status = 'available';

-- ─── 2. Generic dimensional-product fields on products ─────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_length NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_width NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_dimensional BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_dimensional ON products (is_dimensional) WHERE is_dimensional = TRUE;

-- Backfill: any product already flagged inventory_mode='polywood' is dimensional.
UPDATE products
SET is_dimensional = TRUE,
    base_length = COALESCE(base_length, full_sheet_length_m)
WHERE inventory_mode = 'polywood' AND is_dimensional IS NOT TRUE;

-- ─── 3. Seed default categories (idempotent) ────────────────────────────────
INSERT INTO categories (name, parent_id)
SELECT v.name, NULL
FROM (VALUES ('Polywood'), ('Sinelik'), ('Accessories'), ('Services')) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.name = v.name AND c.parent_id IS NULL
);

-- Backfill category_id from the existing free-text `category` column, where a
-- top-level category with a matching name exists.
UPDATE products p
SET category_id = c.id
FROM categories c
WHERE p.category_id IS NULL
  AND c.parent_id IS NULL
  AND lower(trim(p.category)) = lower(trim(c.name));

-- ─── 4. Keep legacy + generic dimensional fields in sync ──────────────────
CREATE OR REPLACE FUNCTION sync_dimensional_product_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_dimensional IS TRUE THEN
    IF NEW.inventory_mode IS NULL OR NEW.inventory_mode = 'standard' THEN
      NEW.inventory_mode := 'polywood';
    END IF;
    IF NEW.base_length IS NOT NULL THEN
      NEW.full_sheet_length_m := NEW.base_length;
    ELSIF NEW.full_sheet_length_m IS NOT NULL THEN
      NEW.base_length := NEW.full_sheet_length_m;
    END IF;
  ELSIF NEW.inventory_mode = 'polywood' THEN
    NEW.is_dimensional := TRUE;
    IF NEW.base_length IS NULL THEN
      NEW.base_length := COALESCE(NEW.full_sheet_length_m, 4);
    END IF;
    IF NEW.full_sheet_length_m IS NULL THEN
      NEW.full_sheet_length_m := NEW.base_length;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_dimensional_product_fields ON products;
CREATE TRIGGER trg_sync_dimensional_product_fields
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION sync_dimensional_product_fields();

-- ─── 5. Mixed-invoice-grid metadata on sale_items ──────────────────────────
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS sale_item_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_sale_item_type_check;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_sale_item_type_check
  CHECK (sale_item_type IN ('standard', 'dimensional', 'accessory', 'service'));
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS piece_count INTEGER NOT NULL DEFAULT 1;

-- ─── 6. Auto-cut engine ──────────────────────────────────────────────────
-- Processes ONE invoice line atomically:
--   item_type = 'service'     -> no inventory effect (cutting fee etc.)
--   item_type = 'accessory'   -> plain products.stock deduction
--   item_type = 'dimensional' -> sale_mode 'full_sheet' deducts N whole sheets
--                                 (piece_length = product.base_length);
--                                 sale_mode 'meter'/'linear_m' deducts p_amount
--                                 metres x p_piece_count, exact-length pieces
--                                 first, else the smallest larger piece
--                                 (off-cuts preferred over full sheets),
--                                 inserting the remnant as a new available
--                                 off-cut in the same warehouse.
CREATE OR REPLACE FUNCTION process_mixed_dimensional_sale(
  p_product_id UUID,
  p_warehouse_id UUID,
  p_item_type TEXT,
  p_sale_mode TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT 0,
  p_piece_count INTEGER DEFAULT 1,
  p_sale_item_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_base_length NUMERIC;
  v_remaining NUMERIC;
  v_target INTEGER;
  v_piece RECORD;
  v_new_piece_id UUID;
  v_leftover NUMERIC;
  v_steps JSONB := '[]'::jsonb;
  v_scrap JSONB := '[]'::jsonb;
  v_i INTEGER;
BEGIN
  IF p_item_type IS NULL THEN
    RAISE EXCEPTION 'item_type is required';
  END IF;

  IF p_item_type = 'service' THEN
    RETURN jsonb_build_object('ok', true, 'item_type', 'service', 'steps', v_steps);
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id is required';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF p_item_type = 'accessory' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'Accessory quantity must be positive';
    END IF;
    IF COALESCE(v_product.stock, 0) < p_amount THEN
      RAISE EXCEPTION 'Insufficient stock for "%": have %, need %', v_product.name, v_product.stock, p_amount;
    END IF;
    UPDATE products SET stock = stock - p_amount WHERE id = p_product_id;
    RETURN jsonb_build_object('ok', true, 'item_type', 'accessory', 'deducted', p_amount);
  END IF;

  IF p_item_type <> 'dimensional' THEN
    RAISE EXCEPTION 'Unknown item_type %', p_item_type;
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'warehouse_id is required for dimensional items';
  END IF;

  v_base_length := COALESCE(v_product.base_length, v_product.full_sheet_length_m, 4);

  IF p_sale_mode = 'full_sheet' THEN
    v_target := ROUND(COALESCE(p_amount, 0))::INTEGER;
    IF v_target <= 0 THEN
      RAISE EXCEPTION 'Full sheet quantity must be positive';
    END IF;

    FOR v_piece IN
      SELECT * FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND piece_type = 'full'
        AND ABS(length_m - v_base_length) < 0.001
      ORDER BY created_at ASC
      LIMIT v_target
      FOR UPDATE
    LOOP
      UPDATE polywood_pieces
      SET status = 'sold', sale_item_id = p_sale_item_id, updated_at = NOW()
      WHERE id = v_piece.id;
      v_steps := v_steps || jsonb_build_object(
        'piece_id', v_piece.id, 'action', 'consume', 'used_length', v_base_length
      );
      v_target := v_target - 1;
    END LOOP;

    IF v_target > 0 THEN
      RAISE EXCEPTION 'Insufficient full sheets for "%": missing % sheet(s)', v_product.name, v_target;
    END IF;

  ELSIF p_sale_mode IN ('meter', 'linear_m') THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'Length must be positive';
    END IF;

    FOR v_i IN 1..GREATEST(COALESCE(p_piece_count, 1), 1) LOOP
      v_remaining := ROUND(p_amount, 3);

      -- 1) Exact-length piece first (prefer an off-cut over a full sheet).
      SELECT * INTO v_piece FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND ABS(length_m - v_remaining) < 0.001
      ORDER BY (piece_type = 'cut') DESC, created_at ASC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        UPDATE polywood_pieces
        SET status = 'sold', sale_item_id = p_sale_item_id, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'consume', 'used_length', v_remaining
        );
        CONTINUE;
      END IF;

      -- 2) Smallest larger off-cut, else smallest larger full sheet.
      SELECT * INTO v_piece FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND piece_type = 'cut'
        AND length_m > v_remaining + 0.001
      ORDER BY length_m ASC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        SELECT * INTO v_piece FROM polywood_pieces
        WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
          AND status = 'available' AND piece_type = 'full'
          AND length_m > v_remaining + 0.001
        ORDER BY length_m ASC
        LIMIT 1
        FOR UPDATE;
      END IF;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient material for "%" (need %m more)', v_product.name, v_remaining;
      END IF;

      v_leftover := ROUND(v_piece.length_m - v_remaining, 3);

      IF v_piece.piece_type = 'full' THEN
        -- Full sheet is consumed as raw material; remnant becomes a new off-cut.
        UPDATE polywood_pieces
        SET status = 'consumed', sale_item_id = p_sale_item_id, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'split_full',
          'used_length', v_remaining, 'scrap_length', v_leftover
        );

        IF v_leftover > 0.001 THEN
          INSERT INTO polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes)
          VALUES (
            p_product_id, p_warehouse_id, v_leftover, 'cut', 'available',
            'Auto remnant from sale item ' || COALESCE(p_sale_item_id::text, 'n/a')
          )
          RETURNING id INTO v_new_piece_id;
          v_scrap := v_scrap || jsonb_build_object('piece_id', v_new_piece_id, 'length_m', v_leftover);
        END IF;
      ELSE
        -- Off-cut: shrink the existing piece in place, no new row needed.
        UPDATE polywood_pieces
        SET length_m = v_leftover, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'partial',
          'used_length', v_remaining, 'remaining_on_piece', v_leftover
        );
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown sale_mode % for dimensional item', p_sale_mode;
  END IF;

  IF p_sale_item_id IS NOT NULL THEN
    UPDATE sale_items
    SET polywood_cut_details = jsonb_build_object('steps', v_steps, 'scrap_created', v_scrap)
    WHERE id = p_sale_item_id;
  END IF;

  -- Keep products.stock in sync as "total metres currently in stock" for dimensional items.
  UPDATE products
  SET stock = (
    SELECT COALESCE(SUM(length_m), 0)
    FROM polywood_pieces
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND status = 'available'
  )
  WHERE id = p_product_id;

  RETURN jsonb_build_object('ok', true, 'item_type', 'dimensional', 'steps', v_steps, 'scrap_created', v_scrap);
END;
$$;

GRANT EXECUTE ON FUNCTION process_mixed_dimensional_sale(UUID, UUID, TEXT, TEXT, NUMERIC, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION process_mixed_dimensional_sale(UUID, UUID, TEXT, TEXT, NUMERIC, INTEGER, UUID) TO service_role;

-- ─── 7. Rollback helper (used when a sale is voided) ───────────────────────
CREATE OR REPLACE FUNCTION rollback_mixed_dimensional_sale(p_sale_item_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_details JSONB;
  v_step JSONB;
  v_scrap_id TEXT;
BEGIN
  SELECT polywood_cut_details INTO v_details FROM sale_items WHERE id = p_sale_item_id;
  IF v_details IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  FOR v_scrap_id IN SELECT jsonb_array_elements(v_details -> 'scrap_created') ->> 'piece_id'
  LOOP
    DELETE FROM polywood_pieces WHERE id = v_scrap_id::uuid;
  END LOOP;

  FOR v_step IN SELECT * FROM jsonb_array_elements(v_details -> 'steps')
  LOOP
    IF v_step ->> 'action' IN ('consume', 'split_full') THEN
      UPDATE polywood_pieces
      SET status = 'available', sale_item_id = NULL, updated_at = NOW()
      WHERE id = (v_step ->> 'piece_id')::uuid;
    ELSIF v_step ->> 'action' = 'partial' THEN
      UPDATE polywood_pieces
      SET length_m = length_m + COALESCE((v_step ->> 'used_length')::numeric, 0),
          updated_at = NOW()
      WHERE id = (v_step ->> 'piece_id')::uuid;
    END IF;
  END LOOP;

  UPDATE sale_items SET polywood_cut_details = NULL WHERE id = p_sale_item_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION rollback_mixed_dimensional_sale(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rollback_mixed_dimensional_sale(UUID) TO service_role;
