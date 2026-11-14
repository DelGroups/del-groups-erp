-- ============================================================================
-- Accounting Guard, product data and stock rules (GUARD-2). Needs GUARD-1
-- (20261120100000_accounting_guard_core.sql). Plan: docs/accounting-guard-plan.md.
--
-- Same hard rule as GUARD-1: the guard NEVER posts, edits, reverses or deletes business
-- data. These rules only READ products, stock, purchases and inventory counts and report
-- what they find in guard_findings. No merge, no delete, no trigger.
--
-- Rules (seeded in guard_rules; scan scopes 'products' and 'stock', or the rule codes):
--   products  F1 the exact same name on several products     (reuses stock_integrity_report)
--             F2 similar names: spaces, punctuation, case, ə ı ö ü ş ç ğ, Cyrillic look-alikes,
--                or pg_trgm similarity >= params.threshold; one finding per cluster
--             F3 name in the code column / code in the name column, stray spaces
--             F4 no category (stock_integrity_report), no unit, zero sale / buy price
--             F5 duplicate code or barcode                    (reuses stock_integrity_report)
--   stock     E1 every other stock_integrity_report() kind
--             E2 negative stock in a warehouse (or in total)
--             E3 a sale that took the product below zero on its document date
--             E4 zero unit cost in stock, or a purchase price above the previous one by params.pct
--             E5 inventory count line with a variance above params.pct
--
-- Also here: guard_normalize_name(text) (IMMUTABLE), a trigram index on it, and a change to
-- _guard_details_hash so that the product cards of a cluster (stock, last movement) are not
-- part of what makes a "not an error" decision lapse; a cluster that gains or loses a product
-- still does (product_ids).
-- pg_trgm is enabled when the database allows it. Without it F2 finds only equal normalised
-- names (no similarity). Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.guard_findings') IS NULL OR to_regprocedure('public.guard_scan(text[], text, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261120100000_accounting_guard_core.sql (GUARD-1) before 20261120110000_accounting_guard_products.sql';
  END IF;
END
$$;

-- ─── 1. pg_trgm ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_trgm could not be enabled (%): rule F2 will compare normalised names only', SQLERRM;
    END;
  END IF;
END
$$;

-- ─── 2. The normalised name ─────────────────────────────────────────────────

-- Lower case, Azerbaijani letters and Cyrillic look-alikes to Latin, punctuation to a space,
-- spaces collapsed and trimmed. "Ağac", "AGAC" and "agac" are the same; so are "Kаbel" with a
-- Cyrillic а and "Kabel". Letters that only look alike in capitals (В, Н, Т, М, К) are mapped
-- too, as every Cyrillic capital and small letter of the look-alike set goes to its Latin twin.
CREATE OR REPLACE FUNCTION public.guard_normalize_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             lower(translate(
               translate(COALESCE(p_name, ''),
                         'İIıƏəÖöÜüŞşÇçĞğ',
                         'iiieeoouussccgg'),
               'АаВвЕеЁёІіЈјКкМмНнОоРрСсТтУуХхЅѕ',
               'aabbeeeeiijjkkmmhhooppccttyyxxss')),
             '[].,;:!?"`´()/_+*#%&@=|~^<>{}[''-]', ' ', 'g'),
           '[[:space:]]+', ' ', 'g'));
$$;

GRANT EXECUTE ON FUNCTION public.guard_normalize_name(TEXT) TO authenticated, service_role;

-- A trigram index on it keeps F2 fast on tens of thousands of products. Created only when
-- pg_trgm is there, in whichever schema it lives.
DO $$
DECLARE
  v_schema TEXT;
BEGIN
  SELECT n.nspname INTO v_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';
  IF v_schema IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_products_guard_name_trgm ON public.products USING gin (public.guard_normalize_name(name) %I.gin_trgm_ops)',
      v_schema);
  END IF;
END
$$;

-- ─── 3. Helpers ─────────────────────────────────────────────────────────────

-- A cluster's "volatile" display data (stock, last movement) must not decide whether a
-- finding changed materially: the guard keeps product_ids, not the cards.
CREATE OR REPLACE FUNCTION public._guard_details_hash(p_amount NUMERIC, p_details JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(COALESCE(round(p_amount, 2)::text, '') || '|' ||
             COALESCE((COALESCE(p_details, '{}'::jsonb) - 'age_days' - 'as_of' - 'products')::text, ''));
$$;

-- The cards of a cluster: id, code, name, unit, category, stock and the date of the last
-- stock movement, for the findings drawer.
CREATE OR REPLACE FUNCTION public._guard_product_cards(p_ids UUID[])
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'code', p.code,
           'name', p.name,
           'unit', p.unit,
           'category', cp.category_name,
           'stock', p.stock,
           'last_movement', (SELECT max(m.created_at) FROM public.stock_movements m WHERE m.product_id = p.id)
         ) ORDER BY lower(p.name), p.code, p.id), '[]'::jsonb)
  FROM public.products p
  LEFT JOIN public.product_category_paths cp ON cp.product_id = p.id
  WHERE p.id = ANY (p_ids);
$$;

-- ─── 4. Rules: F, product data ──────────────────────────────────────────────

-- F1 the exact same name (lower case, trimmed) on several stockable products: the
-- duplicate_name kind of stock_integrity_report(), one finding per name.
CREATE OR REPLACE FUNCTION public.guard_check_f1(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT s.product_id, substr(s.details, 8) AS name_key
    FROM public.stock_integrity_report() s
    WHERE s.issue = 'duplicate_name'
  ),
  g AS (
    SELECT r.name_key, array_agg(r.product_id ORDER BY r.product_id) AS ids, min(r.product_id::text)::uuid AS first_id
    FROM r GROUP BY r.name_key
  )
  SELECT 'F1:' || g.name_key, NULL::text, 'product', g.first_id, g.name_key, NULL::date, NULL::text, NULL::uuid, NULL::numeric,
         jsonb_build_object('kind', 'same_name', 'name_key', g.name_key, 'product_ids', to_jsonb(g.ids),
                            'products', public._guard_product_cards(g.ids))
  FROM g;
$$;

-- F2 similar names. Pairs of stockable products whose normalised names are equal, or whose
-- trigram similarity is at least params.threshold (default 0.85), leaving out pairs with the
-- same raw name (F1 has them). Pairs are joined into clusters; one finding per cluster,
-- fingerprinted by the smallest product id in it.
-- Dynamic SQL: the `%` operator and similarity() exist only when pg_trgm does.
CREATE OR REPLACE FUNCTION public.guard_check_f2(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_threshold NUMERIC := LEAST(GREATEST(public._guard_num(p_params, 'threshold', 0.85), 0.3), 1);
  v_trgm      BOOLEAN := to_regprocedure('similarity(text, text)') IS NOT NULL;
  v_match     TEXT;
  v_prev      TEXT;
BEGIN
  IF v_trgm THEN
    v_prev := current_setting('pg_trgm.similarity_threshold', true);
    PERFORM set_config('pg_trgm.similarity_threshold', v_threshold::text, true);
    -- The index serves `%` (threshold above); similarity() makes the cut exact.
    v_match := 'public.guard_normalize_name(b.name) % public.guard_normalize_name(a.name) '
            || 'AND similarity(public.guard_normalize_name(a.name), public.guard_normalize_name(b.name)) >= $1';
  ELSE
    v_match := 'public.guard_normalize_name(b.name) = public.guard_normalize_name(a.name)';
  END IF;

  RETURN QUERY EXECUTE
    'WITH RECURSIVE pairs AS (
       SELECT a.id AS a_id, b.id AS b_id
       FROM public.products a
       JOIN public.products b ON a.id < b.id AND ' || v_match || '
       WHERE NOT COALESCE(a.is_service, FALSE) AND NOT COALESCE(a.is_composite, FALSE)
         AND NOT COALESCE(b.is_service, FALSE) AND NOT COALESCE(b.is_composite, FALSE)
         AND public.guard_normalize_name(a.name) <> ''''
         AND lower(btrim(a.name)) <> lower(btrim(b.name))
     ),
     e AS (SELECT a_id AS x, b_id AS y FROM pairs UNION SELECT b_id, a_id FROM pairs),
     reach(root, member) AS (
       SELECT x, x FROM e GROUP BY x
       UNION
       SELECT r.root, e.y FROM reach r JOIN e ON e.x = r.member
     ),
     comp AS (SELECT member AS id, min(root::text)::uuid AS cid FROM reach GROUP BY member),
     cl AS (SELECT cid, array_agg(id ORDER BY id) AS ids FROM comp GROUP BY cid)
     SELECT ''F2:'' || cl.cid, NULL::text, ''product'', cl.cid,
            (SELECT p.name FROM public.products p WHERE p.id = cl.cid), NULL::date, NULL::text, NULL::uuid, NULL::numeric,
            jsonb_build_object(''kind'', ''similar_name'', ''threshold'', $1, ''similarity'', $2,
                               ''product_ids'', to_jsonb(cl.ids), ''products'', public._guard_product_cards(cl.ids))
     FROM cl'
    USING v_threshold, v_trgm;

  IF v_trgm THEN
    PERFORM set_config('pg_trgm.similarity_threshold', COALESCE(v_prev, '0.3'), true);
  END IF;
END;
$$;

-- F3 a name that looks like a code or a code that looks like a name, and stray spaces:
--   name_spaces / code_spaces   leading, trailing or doubled spaces
--   code_is_name                the code column holds the name (code = name, ignoring case)
--   code_has_space              a code with a space in it (a name typed into the code column)
--   name_is_a_code              the name equals some product's code
CREATE OR REPLACE FUNCTION public.guard_check_f3(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH p AS (
    SELECT pr.id, pr.code, pr.name
    FROM public.products pr
    WHERE NOT COALESCE(pr.is_service, FALSE) AND NOT COALESCE(pr.is_composite, FALSE)
  ),
  k AS (
    SELECT p.id, p.code, p.name, 'name_spaces' AS kind
    FROM p WHERE p.name IS DISTINCT FROM btrim(regexp_replace(COALESCE(p.name, ''), '[[:space:]]+', ' ', 'g')) AND btrim(COALESCE(p.name, '')) <> ''
    UNION ALL
    SELECT p.id, p.code, p.name, 'code_spaces'
    FROM p WHERE p.code IS DISTINCT FROM btrim(regexp_replace(COALESCE(p.code, ''), '[[:space:]]+', ' ', 'g')) AND btrim(COALESCE(p.code, '')) <> ''
    UNION ALL
    SELECT p.id, p.code, p.name, 'code_is_name'
    FROM p WHERE btrim(COALESCE(p.code, '')) <> '' AND lower(btrim(p.code)) = lower(btrim(p.name))
    UNION ALL
    SELECT p.id, p.code, p.name, 'code_has_space'
    FROM p WHERE btrim(COALESCE(p.code, '')) ~ '[[:space:]]'
      AND lower(btrim(p.code)) <> lower(btrim(p.name))
    UNION ALL
    SELECT p.id, p.code, p.name, 'name_is_a_code'
    FROM p WHERE btrim(COALESCE(p.name, '')) <> '' AND lower(btrim(p.code)) <> lower(btrim(p.name))
      AND EXISTS (SELECT 1 FROM public.products o WHERE o.id <> p.id AND lower(btrim(o.code)) = lower(btrim(p.name)))
  )
  SELECT 'F3:' || k.kind || ':' || k.id, NULL::text, 'product', k.id, k.code, NULL::date, NULL::text, NULL::uuid, NULL::numeric,
         jsonb_build_object('kind', k.kind, 'code', k.code, 'name', k.name, 'product_ids', jsonb_build_array(k.id),
                            'products', public._guard_product_cards(ARRAY[k.id]))
  FROM k;
$$;

-- F4 missing category (the no_category kind of stock_integrity_report), no unit, a zero or
-- empty sale price, a zero or empty buy price, on stockable products.
CREATE OR REPLACE FUNCTION public.guard_check_f4(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH p AS (
    SELECT pr.id, pr.code, pr.name, pr.unit, pr.sell_price, pr.buy_price
    FROM public.products pr
    WHERE NOT COALESCE(pr.is_service, FALSE) AND NOT COALESCE(pr.is_composite, FALSE)
  ),
  k AS (
    SELECT s.product_id AS id, 'no_category' AS kind FROM public.stock_integrity_report() s WHERE s.issue = 'no_category'
    UNION ALL
    SELECT p.id, 'no_unit' FROM p WHERE NULLIF(btrim(COALESCE(p.unit, '')), '') IS NULL
    UNION ALL
    SELECT p.id, 'zero_sell_price' FROM p WHERE COALESCE(p.sell_price, 0) = 0
    UNION ALL
    SELECT p.id, 'zero_buy_price' FROM p WHERE COALESCE(p.buy_price, 0) = 0
  )
  SELECT 'F4:' || k.kind || ':' || k.id, NULL::text, 'product', k.id, pr.code, NULL::date, NULL::text, NULL::uuid, NULL::numeric,
         jsonb_build_object('kind', k.kind, 'name', pr.name, 'product_ids', jsonb_build_array(k.id),
                            'products', public._guard_product_cards(ARRAY[k.id]))
  FROM k JOIN public.products pr ON pr.id = k.id;
$$;

-- F5 duplicate code or barcode: the duplicate_code / duplicate_barcode kinds of
-- stock_integrity_report(), one finding per code or barcode.
CREATE OR REPLACE FUNCTION public.guard_check_f5(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT CASE s.issue WHEN 'duplicate_code' THEN 'code' ELSE 'barcode' END AS field,
           lower(btrim(CASE s.issue WHEN 'duplicate_code' THEN substr(s.details, 8) ELSE substr(s.details, 11) END)) AS value,
           s.product_id
    FROM public.stock_integrity_report() s
    WHERE s.issue IN ('duplicate_code', 'duplicate_barcode')
  ),
  g AS (
    SELECT r.field, r.value, array_agg(r.product_id ORDER BY r.product_id) AS ids, min(r.product_id::text)::uuid AS first_id
    FROM r GROUP BY r.field, r.value
  )
  SELECT 'F5:' || g.field || ':' || g.value, NULL::text, 'product', g.first_id, g.value, NULL::date, NULL::text, NULL::uuid, NULL::numeric,
         jsonb_build_object('kind', 'duplicate_' || g.field, 'value', g.value, 'product_ids', to_jsonb(g.ids),
                            'products', public._guard_product_cards(g.ids))
  FROM g;
$$;

-- ─── 5. Rules: E, stock ─────────────────────────────────────────────────────

-- E1 every other kind of stock_integrity_report(): the product's own warehouse rows, totals
-- and Polywood pieces disagree, a lost subcategory, and so on. The kinds F1, F4 and F5 own
-- are left out, and so are params.ignore_kinds (default: service_or_composite, which only
-- says what a product is). A total or Polywood mismatch is "high".
CREATE OR REPLACE FUNCTION public.guard_check_e1(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'E1:' || s.issue || ':' || s.product_id,
         CASE WHEN s.issue IN ('total_mismatch', 'polywood_mismatch') THEN 'high' END,
         'product', s.product_id, s.product_code, NULL::date, NULL::text, NULL::uuid,
         CASE WHEN s.stock_before IS NOT NULL AND s.stock_after IS NOT NULL THEN abs(s.stock_before - s.stock_after) END,
         jsonb_build_object('kind', s.issue, 'detail', s.details, 'fixable', s.fixable, 'product_name', s.product_name,
                            'stock_before', s.stock_before, 'stock_after', s.stock_after,
                            'product_ids', jsonb_build_array(s.product_id))
  FROM public.stock_integrity_report() s
  WHERE s.issue <> ALL (
    COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_params -> 'ignore_kinds') x), ARRAY['service_or_composite'])
    || ARRAY['duplicate_name', 'no_category', 'duplicate_code', 'duplicate_barcode']
  );
$$;

-- E2 negative stock: a warehouse row below zero, or a product whose total is below zero
-- while no warehouse row is.
CREATE OR REPLACE FUNCTION public.guard_check_e2(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'E2:' || p.id || ':' || COALESCE(w.warehouse_id::text, 'none'), NULL::text, 'product', p.id, p.code, NULL::date, NULL::text, NULL::uuid,
         -round(w.current_stock, 3),
         jsonb_build_object('kind', 'negative_warehouse_stock', 'product_name', p.name, 'warehouse_id', w.warehouse_id,
                            'warehouse_name', wh.name, 'stock', round(w.current_stock, 3), 'product_ids', jsonb_build_array(p.id))
  FROM public.warehouse_stocks w
  JOIN public.products p ON p.id = w.product_id
  LEFT JOIN public.warehouses wh ON wh.id = w.warehouse_id
  WHERE NOT COALESCE(p.is_service, FALSE) AND NOT COALESCE(p.is_composite, FALSE)
    AND w.current_stock < -public._guard_num(p_params, 'tolerance', 0.0005)
  UNION ALL
  SELECT 'E2:' || p.id || ':total', NULL::text, 'product', p.id, p.code, NULL::date, NULL::text, NULL::uuid,
         -round(p.stock, 3),
         jsonb_build_object('kind', 'negative_total_stock', 'product_name', p.name, 'stock', round(p.stock, 3),
                            'product_ids', jsonb_build_array(p.id))
  FROM public.products p
  WHERE NOT COALESCE(p.is_service, FALSE) AND NOT COALESCE(p.is_composite, FALSE)
    AND p.stock < -public._guard_num(p_params, 'tolerance', 0.0005)
    AND NOT EXISTS (SELECT 1 FROM public.warehouse_stocks w WHERE w.product_id = p.id AND w.current_stock < -public._guard_num(p_params, 'tolerance', 0.0005));
$$;

-- E3 a sale that took the product below zero on its document date. The balance after each
-- stock movement is today's total stock minus every later movement (the movement log of the
-- sale carries the document date); a posted sale whose movement leaves the balance below zero
-- sold more than there was. Polywood products (metres against pieces) are left out; movements
-- from before the log existed are not known. p_since limits it to sales changed since then.
CREATE OR REPLACE FUNCTION public.guard_check_e3(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH sold AS (
    SELECT DISTINCT m.product_id FROM public.stock_movements m WHERE m.reference_type = 'sale'
  ),
  mv AS (
    SELECT m.id, m.product_id, m.created_at, m.reference_type, m.reference_id, m.quantity,
           CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END AS signed
    FROM public.stock_movements m
    WHERE m.product_id IN (SELECT product_id FROM sold)
  ),
  bal AS (
    SELECT mv.*, p.stock - COALESCE(sum(mv.signed) OVER (
             PARTITION BY mv.product_id ORDER BY mv.created_at, mv.id ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING), 0) AS after_qty
    FROM mv
    JOIN public.products p ON p.id = mv.product_id
    WHERE NOT COALESCE(p.is_service, FALSE) AND NOT COALESCE(p.is_composite, FALSE)
      AND p.inventory_mode IS DISTINCT FROM 'polywood'
  )
  SELECT 'E3:' || b.id, NULL::text, 'sale', s.id, COALESCE(s.doc_no, s.invoice_number), s.doc_date, 'partner', s.partner_id,
         round(-b.after_qty, 3),
         jsonb_build_object('kind', 'sold_without_stock', 'product_id', b.product_id, 'product_name', p.name, 'product_code', p.code,
                            'quantity', b.quantity, 'balance_after', round(b.after_qty, 3), 'movement_at', b.created_at)
  FROM bal b
  JOIN public.sales s ON s.id = b.reference_id AND b.reference_type = 'sale'
  JOIN public.products p ON p.id = b.product_id
  WHERE s.status = 'posted'
    AND b.after_qty < -public._guard_num(p_params, 'tolerance', 0.0005)
    AND (p_since IS NULL OR s.created_at >= p_since OR s.updated_at >= p_since OR s.posted_at >= p_since);
$$;

-- E4 a cost that is zero or a purchase price that jumped.
--   zero_cost  stock still on a batch (FIFO layer) whose unit cost is zero or empty: one finding per product
--   jump       a posted purchase line priced above the previous purchase of the product by more than
--              params.pct (default 50), both in AZN (price x exchange rate)
-- The purchase lines belong to the purchases module: read only where it is installed.
CREATE OR REPLACE FUNCTION public.guard_check_e4(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 'E4:zero_cost:' || b.product_id, NULL::text, 'product'::text, b.product_id, p.code, NULL::date, NULL::text, NULL::uuid,
         round(sum(b.remaining_qty), 3),
         jsonb_build_object('kind', 'zero_cost', 'product_name', p.name, 'batches', count(*),
                            'remaining_qty', round(sum(b.remaining_qty), 3), 'product_ids', jsonb_build_array(b.product_id))
  FROM public.inventory_batches b
  JOIN public.products p ON p.id = b.product_id
  WHERE COALESCE(b.unit_cost, 0) = 0 AND COALESCE(b.initial_qty, 0) > 0 AND COALESCE(b.remaining_qty, 0) > 0
    AND NOT COALESCE(p.is_service, FALSE) AND NOT COALESCE(p.is_composite, FALSE)
  GROUP BY b.product_id, p.code, p.name;

  IF to_regclass('public.purchase_items') IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'WITH items AS (
         SELECT pi.id, pi.product_id, pi.unit_price * COALESCE(NULLIF(pi.exchange_rate, 0), 1) AS price,
                pu.invoice_number, pu.doc_date, pu.created_at, pu.updated_at, pu.partner_id
         FROM public.purchase_items pi
         JOIN public.purchases pu ON pu.id = pi.purchase_id
         WHERE pu.status = ''posted'' AND pi.product_id IS NOT NULL AND COALESCE(pi.unit_price, 0) > 0
       ),
       seq AS (
         SELECT i.*, lag(i.price) OVER (PARTITION BY i.product_id ORDER BY i.doc_date, i.created_at, i.id) AS prev_price
         FROM items i
       )
       SELECT ''E4:jump:'' || s.id, NULL::text, ''purchase'', s.id, s.invoice_number, s.doc_date, ''partner'', s.partner_id,
              round(s.price - s.prev_price, 2),
              jsonb_build_object(''kind'', ''price_jump'', ''product_id'', s.product_id, ''product_name'', p.name,
                                 ''price'', round(s.price, 4), ''previous_price'', round(s.prev_price, 4),
                                 ''change_pct'', round((s.price / s.prev_price - 1) * 100, 1), ''pct'', $1)
       FROM seq s
       JOIN public.products p ON p.id = s.product_id
       WHERE s.prev_price > 0 AND s.price > s.prev_price * (1 + $1 / 100)
         AND ($2 IS NULL OR s.created_at >= $2 OR s.updated_at >= $2)'
      USING public._guard_num(p_params, 'pct', 50), p_since;
  END IF;
END;
$$;

-- E5 an inventory count line whose counted quantity differs from the book quantity by more
-- than params.pct (default 20 %), or whose book quantity was zero and something was found;
-- only posted counts, and only variances worth at least params.min_value (default 0).
-- The counts belong to the inventory module: read only where it is installed.
CREATE OR REPLACE FUNCTION public.guard_check_e5(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.inventory_counts') IS NULL OR to_regclass('public.inventory_count_items') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE
    'SELECT ''E5:'' || i.id, NULL::text, ''inventory_count'', c.id, c.document_number, c.count_date, NULL::text, NULL::uuid,
            abs(COALESCE(i.variance_value, 0)),
            jsonb_build_object(''kind'', ''count_variance'', ''product_id'', i.product_id, ''product_name'', i.product_name,
                               ''expected'', i.expected_qty, ''actual'', i.actual_qty,
                               ''difference'', round(i.actual_qty - COALESCE(i.expected_qty, 0), 3),
                               ''variance_pct'', round(abs(i.actual_qty - COALESCE(i.expected_qty, 0)) / NULLIF(i.expected_qty, 0) * 100, 1),
                               ''variance_value'', i.variance_value, ''pct'', $1)
     FROM public.inventory_count_items i
     JOIN public.inventory_counts c ON c.id = i.count_id
     WHERE c.status = ''posted'' AND i.actual_qty IS NOT NULL
       AND abs(i.actual_qty - COALESCE(i.expected_qty, 0)) > 0.0005
       AND (COALESCE(i.expected_qty, 0) = 0
            OR abs(i.actual_qty - i.expected_qty) / i.expected_qty * 100 > $1)
       AND abs(COALESCE(i.variance_value, 0)) >= $2
       AND ($3 IS NULL OR c.posted_at >= $3)'
    USING public._guard_num(p_params, 'pct', 20), public._guard_num(p_params, 'min_value', 0), p_since;
END;
$$;

-- Rule functions are internal: only guard_scan (as the owner) calls them.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname LIKE 'guard\_check\_%' OR p.proname = '_guard_product_cards')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END;
$$;

-- ─── 6. Seed the rules ──────────────────────────────────────────────────────
-- A re-run updates category, severity and description key but keeps enabled / params.

INSERT INTO public.guard_rules (code, category, default_severity, enabled, params, description_key) VALUES
  ('F1', 'products', 'medium', TRUE, '{}', 'guard.rule.F1'),
  ('F2', 'products', 'medium', TRUE, '{"threshold": 0.85}', 'guard.rule.F2'),
  ('F3', 'products', 'low',    TRUE, '{}', 'guard.rule.F3'),
  ('F4', 'products', 'low',    TRUE, '{}', 'guard.rule.F4'),
  ('F5', 'products', 'high',   TRUE, '{}', 'guard.rule.F5'),
  ('E1', 'stock',    'medium', TRUE, '{"ignore_kinds": ["service_or_composite"]}', 'guard.rule.E1'),
  ('E2', 'stock',    'high',   TRUE, '{"tolerance": 0.0005}', 'guard.rule.E2'),
  ('E3', 'stock',    'high',   TRUE, '{"tolerance": 0.0005}', 'guard.rule.E3'),
  ('E4', 'stock',    'medium', TRUE, '{"pct": 50}', 'guard.rule.E4'),
  ('E5', 'stock',    'medium', TRUE, '{"pct": 20, "min_value": 0}', 'guard.rule.E5')
ON CONFLICT (code) DO UPDATE
SET category = EXCLUDED.category,
    default_severity = EXCLUDED.default_severity,
    description_key = EXCLUDED.description_key;

NOTIFY pgrst, 'reload schema';
