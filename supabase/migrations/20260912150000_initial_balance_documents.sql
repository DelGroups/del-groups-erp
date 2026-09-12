-- 1C-style initial inventory balance documents (Ввод начальных остатков)

CREATE TABLE IF NOT EXISTS public.inventory_initial_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number TEXT NOT NULL UNIQUE,
  doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  warehouse_name TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT,
  posted_at TIMESTAMPTZ,
  posted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_initial_balances_status
  ON public.inventory_initial_balances (status, doc_date DESC);

CREATE TABLE IF NOT EXISTS public.inventory_initial_balance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.inventory_initial_balances(id) ON DELETE CASCADE,
  line_no INT NOT NULL DEFAULT 1,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_code TEXT,
  product_name TEXT NOT NULL,
  unit TEXT DEFAULT 'Ədəd',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  is_metric BOOLEAN NOT NULL DEFAULT FALSE,
  metric_total_meters NUMERIC,
  piece_lengths JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_initial_balance_items_document
  ON public.inventory_initial_balance_items (document_id);

ALTER TABLE public.warehouse_stocks
  ADD COLUMN IF NOT EXISTS piece_lengths JSONB;

CREATE OR REPLACE FUNCTION public.next_initial_balance_doc_no(p_prefix TEXT DEFAULT 'IQ')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_no INT;
  v_prefix TEXT := COALESCE(NULLIF(trim(p_prefix), ''), 'IQ');
BEGIN
  INSERT INTO public.document_number_counters (doc_type, year, last_no)
  VALUES ('initial_balance', v_year, 1)
  ON CONFLICT (doc_type, year)
  DO UPDATE SET last_no = public.document_number_counters.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN v_prefix || '-' || v_year::TEXT || '-' || lpad(v_no::TEXT, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_next_initial_balance_doc_no(p_prefix TEXT DEFAULT 'IQ')
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_no INT;
  v_prefix TEXT := COALESCE(NULLIF(trim(p_prefix), ''), 'IQ');
BEGIN
  SELECT last_no INTO v_no
  FROM public.document_number_counters
  WHERE doc_type = 'initial_balance' AND year = v_year;

  RETURN v_prefix || '-' || v_year::TEXT || '-' || lpad((COALESCE(v_no, 0) + 1)::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_initial_balance_doc_no(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peek_next_initial_balance_doc_no(TEXT) TO authenticated, service_role;
