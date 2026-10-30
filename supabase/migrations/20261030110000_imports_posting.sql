-- ============================================================================
-- Imports module ("İdxal"), IMP-2: confirm, receive, pay, late costs, close and cancel.
--
-- Builds on 20261030100000_imports_core.sql (IMP-1). Every posting goes through the existing
-- machinery: create_journal_entry (idempotent per key, balanced), the period guard and
-- use_document_date (closed periods are refused, records carry the document date),
-- reverse_journal_entry and reverse_document_cash_transactions (storno), stock_move (per
-- warehouse), Polywood pieces, stock_movements and create_inventory_batch (FIFO).
--
-- Accounts (added below when free): 1360 goods in transit (import), 4960 / 6260 exchange
-- difference income / expense (used by IMP-3). Existing: 1100 cash/bank (each account's own
-- chart_of_accounts row when it has one), 1300 inventory, 1410 recoverable VAT, 2100 payables,
-- 5100 cost of goods sold, 6190 other expenses (a cost that is not part of the product cost).
--
--   confirm_import_shipment      Dr 1360 goods / Cr 2100 supplier; each cost Dr 1360 (capitalized)
--                                or 6190, Dr 1410 VAT / Cr 2100 its partner, or the cash account
--                                when paid now; customs VAT Dr 1410. Payables are opened.
--   receive_import_shipment      partial or full, several warehouses per call; stock at the
--                                latest landed unit cost per stock unit; Dr 1300 / Cr 1360.
--   add_import_cost              any status but closed / cancelled; posts like confirm once the
--                                shipment is confirmed, then trues up received stock.
--   finalize_import_cost         an estimate becomes the actual amount; the difference posts the
--                                same way (payable adjusted, received stock trued up).
--   apply_late_import_cost       received stock follows the latest allocation: the share still
--                                in stock raises (or lowers) the remaining FIFO layers (1300),
--                                the share already sold goes to 5100; Cr / Dr 1360.
--   pay_import_payable           one payment split over several cash / bank accounts, one journal
--                                entry, one cash transaction (and payments row) per account.
--   close_import_shipment        every cost actual and the shipment's 1360 balance 0.
--   reopen_import_shipment       admins: closed → received.
--   cancel_import_shipment       reverses every entry, cash movement and receipt; refused once
--                                any received stock has been sold or used.
--
-- Each RPC takes an idempotency key (a repeat returns the first result), checks imports.approve
-- (confirm, receive, close, cancel) or imports.manage (costs, payments) itself, and runs as one
-- transaction. Direct writes to lines and costs are now allowed only while a shipment is a draft.
-- Safe to re-run.
-- ============================================================================

-- ─── 1. Accounts ────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
  v_type TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('1360', 'Yolda olan mallar (idxal)', 'asset'),
      ('4960', 'Məzənnə fərqi gəliri', 'revenue'),
      ('6260', 'Məzənnə fərqi xərci', 'expense')
    ) AS t(code, name, account_type)
  LOOP
    SELECT account_type INTO v_type FROM public.chart_of_accounts WHERE code = r.code;
    IF FOUND THEN
      -- A code already used for something else must not be taken over silently.
      IF v_type IS DISTINCT FROM r.account_type THEN
        RAISE EXCEPTION 'Hesab kodu % artıq "%" növü ilə istifadə olunur; idxal üçün başqa kod seçin', r.code, v_type;
      END IF;
      UPDATE public.chart_of_accounts SET is_active = true WHERE code = r.code;
    ELSE
      INSERT INTO public.chart_of_accounts (code, name, account_type, is_active) VALUES (r.code, r.name, r.account_type, true);
    END IF;
  END LOOP;
END $$;

-- ─── 2. Tables ──────────────────────────────────────────────────────────────

ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS confirm_date DATE;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- What is owed to whom for a shipment: the goods to the supplier, each cost to its partner.
-- amount_fc + booking_rate keep the original currency for IMP-3's exchange differences.
CREATE TABLE IF NOT EXISTS public.import_payables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id    UUID NOT NULL REFERENCES public.import_shipments (id) ON DELETE CASCADE,
  partner_id     UUID NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  source         TEXT NOT NULL CHECK (source IN ('goods', 'cost')),
  cost_line_id   UUID REFERENCES public.import_cost_lines (id) ON DELETE SET NULL,
  document_date  DATE NOT NULL,
  currency_code  TEXT NOT NULL REFERENCES public.currencies (code),
  amount_fc      NUMERIC(18,2) NOT NULL CHECK (amount_fc >= 0),
  booking_rate   NUMERIC(18,6) NOT NULL CHECK (booking_rate > 0),
  amount_azn     NUMERIC(18,2) NOT NULL CHECK (amount_azn >= 0),
  paid_azn       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (paid_azn >= 0),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  journal_entry_id UUID REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (paid_azn <= amount_azn + 0.005),
  CHECK (source <> 'cost' OR cost_line_id IS NOT NULL OR status = 'cancelled')
);
CREATE INDEX IF NOT EXISTS import_payables_shipment_idx ON public.import_payables (shipment_id);
CREATE INDEX IF NOT EXISTS import_payables_partner_idx ON public.import_payables (partner_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS import_payables_cost_idx ON public.import_payables (cost_line_id) WHERE cost_line_id IS NOT NULL AND status <> 'cancelled';

CREATE TABLE IF NOT EXISTS public.import_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id       UUID NOT NULL REFERENCES public.import_payables (id) ON DELETE CASCADE,
  shipment_id      UUID NOT NULL REFERENCES public.import_shipments (id) ON DELETE CASCADE,
  payment_date     DATE NOT NULL,
  note             TEXT CHECK (note IS NULL OR length(note) <= 500),
  amount_azn       NUMERIC(18,2) NOT NULL CHECK (amount_azn > 0),
  journal_entry_id UUID REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  created_by       UUID DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_payments_payable_idx ON public.import_payments (payable_id);

CREATE TABLE IF NOT EXISTS public.import_payment_splits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     UUID NOT NULL REFERENCES public.import_payments (id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.accounts (id) ON DELETE RESTRICT,
  amount_azn     NUMERIC(18,2) NOT NULL CHECK (amount_azn > 0),
  transaction_id UUID REFERENCES public.transactions (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS import_payment_splits_payment_idx ON public.import_payment_splits (payment_id);

CREATE TABLE IF NOT EXISTS public.import_receipts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      UUID NOT NULL REFERENCES public.import_shipments (id) ON DELETE CASCADE,
  number           TEXT NOT NULL UNIQUE,
  receipt_date     DATE NOT NULL,
  note             TEXT CHECK (note IS NULL OR length(note) <= 1000),
  journal_entry_id UUID REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  created_by       UUID DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_receipts_shipment_idx ON public.import_receipts (shipment_id);

CREATE TABLE IF NOT EXISTS public.import_receipt_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id       UUID NOT NULL REFERENCES public.import_receipts (id) ON DELETE CASCADE,
  shipment_line_id UUID NOT NULL REFERENCES public.import_shipment_lines (id) ON DELETE RESTRICT,
  warehouse_id     UUID NOT NULL REFERENCES public.warehouses (id) ON DELETE RESTRICT,
  -- What the keeper counted (stock unit: metres for sheet products) and what was expected.
  qty_stock_unit   NUMERIC(14,3) NOT NULL CHECK (qty_stock_unit > 0),
  expected_qty_stock_unit NUMERIC(14,3),
  unit_cost_azn    NUMERIC(14,4) NOT NULL CHECK (unit_cost_azn >= 0),
  value_azn        NUMERIC(18,2) NOT NULL CHECK (value_azn >= 0),
  batch_id         UUID REFERENCES public.inventory_batches (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS import_receipt_lines_receipt_idx ON public.import_receipt_lines (receipt_id);
CREATE INDEX IF NOT EXISTS import_receipt_lines_line_idx ON public.import_receipt_lines (shipment_line_id);

-- Value moved into stock (1300) or cost of sales (5100) after receipt, when costs changed.
CREATE TABLE IF NOT EXISTS public.import_late_postings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      UUID NOT NULL REFERENCES public.import_shipments (id) ON DELETE CASCADE,
  shipment_line_id UUID NOT NULL REFERENCES public.import_shipment_lines (id) ON DELETE RESTRICT,
  cost_line_id     UUID REFERENCES public.import_cost_lines (id) ON DELETE SET NULL,
  to_stock_azn     NUMERIC(18,2) NOT NULL,
  to_cogs_azn      NUMERIC(18,2) NOT NULL,
  journal_entry_id UUID REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_late_postings_line_idx ON public.import_late_postings (shipment_line_id);

-- Idempotency: the first result of every key.
CREATE TABLE IF NOT EXISTS public.import_operations (
  idempotency_key TEXT PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  kind            TEXT NOT NULL,
  shipment_id     UUID REFERENCES public.import_shipments (id) ON DELETE CASCADE,
  result          JSONB NOT NULL,
  created_by      UUID DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Row level security ──────────────────────────────────────────────────

-- Read with imports.view and financial figures; every write goes through the functions below.
ALTER TABLE public.import_payables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_payables_select ON public.import_payables;
CREATE POLICY import_payables_select ON public.import_payables FOR SELECT TO authenticated USING ((SELECT public.imports_can_read()));

ALTER TABLE public.import_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_payments_select ON public.import_payments;
CREATE POLICY import_payments_select ON public.import_payments FOR SELECT TO authenticated USING ((SELECT public.imports_can_read()));

ALTER TABLE public.import_payment_splits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_payment_splits_select ON public.import_payment_splits;
CREATE POLICY import_payment_splits_select ON public.import_payment_splits FOR SELECT TO authenticated USING ((SELECT public.imports_can_read()));

ALTER TABLE public.import_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_receipts_select ON public.import_receipts;
CREATE POLICY import_receipts_select ON public.import_receipts FOR SELECT TO authenticated USING ((SELECT public.imports_can_read()));

ALTER TABLE public.import_receipt_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_receipt_lines_select ON public.import_receipt_lines;
CREATE POLICY import_receipt_lines_select ON public.import_receipt_lines FOR SELECT TO authenticated USING ((SELECT public.imports_can_read()));

ALTER TABLE public.import_late_postings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_late_postings_select ON public.import_late_postings;
CREATE POLICY import_late_postings_select ON public.import_late_postings FOR SELECT TO authenticated USING ((SELECT public.imports_can_read()));

-- Only the functions read and write it.
ALTER TABLE public.import_operations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.import_payables, public.import_payments, public.import_payment_splits,
  public.import_receipts, public.import_receipt_lines, public.import_late_postings TO authenticated;
GRANT ALL ON public.import_payables, public.import_payments, public.import_payment_splits, public.import_receipts,
  public.import_receipt_lines, public.import_late_postings, public.import_operations TO service_role;

-- IMP-1 let managers write lines and costs of any open shipment directly. Once a shipment is
-- confirmed its numbers are posted, so from now on only a draft is changed directly; later
-- costs go through add_import_cost / finalize_import_cost.
CREATE OR REPLACE FUNCTION public.import_shipment_is_draft(p_shipment UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.import_shipments s WHERE s.id = p_shipment AND s.status = 'draft');
$$;
REVOKE ALL ON FUNCTION public.import_shipment_is_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_shipment_is_draft(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS import_shipments_update ON public.import_shipments;
CREATE POLICY import_shipments_update ON public.import_shipments FOR UPDATE TO authenticated
  USING ((SELECT public.imports_can('manage')) AND status = 'draft')
  WITH CHECK ((SELECT public.imports_can('manage')) AND status = 'draft');

DROP POLICY IF EXISTS import_shipment_lines_write ON public.import_shipment_lines;
CREATE POLICY import_shipment_lines_write ON public.import_shipment_lines FOR ALL TO authenticated
  USING ((SELECT public.imports_can('manage')) AND public.import_shipment_is_draft(shipment_id))
  WITH CHECK ((SELECT public.imports_can('manage')) AND public.import_shipment_is_draft(shipment_id));

DROP POLICY IF EXISTS import_cost_lines_write ON public.import_cost_lines;
CREATE POLICY import_cost_lines_write ON public.import_cost_lines FOR ALL TO authenticated
  USING ((SELECT public.imports_can('manage')) AND public.import_shipment_is_draft(shipment_id))
  WITH CHECK ((SELECT public.imports_can('manage')) AND public.import_shipment_is_draft(shipment_id));

DROP POLICY IF EXISTS import_cost_allocations_write ON public.import_cost_allocations;
CREATE POLICY import_cost_allocations_write ON public.import_cost_allocations FOR ALL TO authenticated
  USING (
    (SELECT public.imports_can('manage'))
    AND EXISTS (SELECT 1 FROM public.import_cost_lines c WHERE c.id = cost_line_id AND public.import_shipment_is_draft(c.shipment_id))
  )
  WITH CHECK (
    (SELECT public.imports_can('manage'))
    AND EXISTS (SELECT 1 FROM public.import_cost_lines c WHERE c.id = cost_line_id AND public.import_shipment_is_draft(c.shipment_id))
  );

-- ─── 4. Helpers (internal) ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._imports_require(p_action TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.imports_can(p_action) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'imports_forbidden: İdxal əməliyyatı üçün icazəniz yoxdur';
  END IF;
END;
$$;

-- The first result of an idempotency key, or NULL.
CREATE OR REPLACE FUNCTION public._imports_op_get(p_key TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT result || jsonb_build_object('idempotent', true) FROM public.import_operations WHERE idempotency_key = p_key;
$$;

CREATE OR REPLACE FUNCTION public._imports_op_put(p_key TEXT, p_kind TEXT, p_shipment UUID, p_result JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_key IS NOT NULL THEN
    INSERT INTO public.import_operations (idempotency_key, kind, shipment_id, result)
    VALUES (p_key, p_kind, p_shipment, p_result)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN p_result;
END;
$$;

-- Chart-of-accounts code of a cash / bank account (its own row when it has one, else 1100).
CREATE OR REPLACE FUNCTION public._imports_cash_coa(p_account_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT c.code FROM public.accounts a JOIN public.chart_of_accounts c ON c.id = a.coa_id WHERE a.id = p_account_id AND c.is_active), '1100');
$$;

-- Money out of one cash / bank account for a shipment: the balance check, the transaction and
-- the new balance. The caller's journal entry is linked afterwards (transactions.journal_entry_id).
CREATE OR REPLACE FUNCTION public._imports_cash_out(p_account_id UUID, p_amount NUMERIC, p_note TEXT, p_shipment_id UUID, p_reference_type TEXT, p_reference_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_name    TEXT;
  v_tx      UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_invalid_amount: Məbləğ sıfırdan böyük olmalıdır';
  END IF;
  SELECT balance, name INTO v_balance, v_name FROM public.accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_account_not_found: Kassa/bank hesabı tapılmadı';
  END IF;
  IF COALESCE(v_balance, 0) + 0.0001 < p_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_insufficient_balance: %s hesabında kifayət qədər vəsait yoxdur (lazım: %s, mövcud: %s)',
        v_name, trim(to_char(p_amount, 'FM999999990.00')), trim(to_char(COALESCE(v_balance, 0), 'FM999999990.00')));
  END IF;

  INSERT INTO public.transactions (
    account_id, type, unified_type, amount, category, notes, description,
    source_type, source_id, reference_type, reference_id, created_by
  ) VALUES (
    p_account_id, 'Məxaric', 'EXPENSE', p_amount, 'İdxal ödənişi', p_note, p_note,
    'import_shipment', p_shipment_id, p_reference_type, p_reference_id, auth.uid()
  ) RETURNING id INTO v_tx;

  UPDATE public.accounts SET balance = COALESCE(balance, 0) - p_amount WHERE id = p_account_id;
  RETURN v_tx;
END;
$$;

-- Journal line helpers (signed amounts: positive = debit, negative = credit).
CREATE OR REPLACE FUNCTION public._imports_line(p_code TEXT, p_amount NUMERIC, p_memo TEXT, p_partner UUID DEFAULT NULL, p_cash_account UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'account_code', p_code,
    'debit', CASE WHEN p_amount > 0 THEN round(p_amount, 2) ELSE 0 END,
    'credit', CASE WHEN p_amount < 0 THEN round(-p_amount, 2) ELSE 0 END,
    'partner_type', CASE WHEN p_partner IS NOT NULL THEN 'partner' END,
    'partner_id', p_partner,
    'cash_account_id', p_cash_account,
    'line_memo', p_memo
  ));
$$;

-- Landed value of a shipment line: goods at the invoice rate + every allocation on it.
CREATE OR REPLACE FUNCTION public._imports_line_landed(p_line_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(l.qty_purchase_unit * l.unit_price_fc * s.invoice_rate, 2)
       + COALESCE((SELECT SUM(a.amount_azn) FROM public.import_cost_allocations a WHERE a.shipment_line_id = l.id), 0)
  FROM public.import_shipment_lines l
  JOIN public.import_shipments s ON s.id = l.shipment_id
  WHERE l.id = p_line_id;
$$;

-- Quantity received and the value moved out of 1360 for a line (receipts + late postings).
CREATE OR REPLACE FUNCTION public._imports_line_received(p_line_id UUID, OUT qty NUMERIC, OUT value NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT SUM(rl.qty_stock_unit) FROM public.import_receipt_lines rl WHERE rl.shipment_line_id = p_line_id), 0),
         COALESCE((SELECT SUM(rl.value_azn) FROM public.import_receipt_lines rl WHERE rl.shipment_line_id = p_line_id), 0)
       + COALESCE((SELECT SUM(lp.to_stock_azn + lp.to_cogs_azn) FROM public.import_late_postings lp WHERE lp.shipment_line_id = p_line_id), 0);
$$;

-- Balance of 1360 for a shipment (every entry of a shipment carries its id as document_id).
CREATE OR REPLACE FUNCTION public.import_shipment_transit_balance(p_shipment_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(jl.debit - jl.credit), 0)
  FROM public.journal_entry_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  JOIN public.chart_of_accounts c ON c.id = jl.coa_id
  WHERE je.document_id = p_shipment_id AND je.document_type LIKE 'import_%' AND c.code = '1360';
$$;

-- Journal lines and payable of one cost line (confirm, a cost added later, an estimate settled).
-- p_amount / p_vat are AZN and may be negative (an estimate settled lower). p_splits pays it at
-- once ([{account_id, amount}]); otherwise the partner's payable grows (or a new one opens).
CREATE OR REPLACE FUNCTION public._imports_cost_lines(
  p_cost        public.import_cost_lines,
  p_shipment    public.import_shipments,
  p_amount      NUMERIC,
  p_vat         NUMERIC,
  p_splits      JSONB,
  p_date        DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines   JSONB := '[]'::jsonb;
  v_total   NUMERIC := round(COALESCE(p_amount, 0) + COALESCE(p_vat, 0), 2);
  v_label   TEXT := format('%s — %s', p_shipment.number, COALESCE(NULLIF(p_cost.description, ''), p_cost.cost_type));
  v_partner UUID;
  v_split   JSONB;
  v_sum     NUMERIC := 0;
  v_tx      UUID;
  v_txs     UUID[] := '{}';
  v_payable public.import_payables%ROWTYPE;
  v_rate    NUMERIC := CASE WHEN p_cost.currency_code = 'AZN' THEN 1 ELSE p_cost.rate_to_azn END;
BEGIN
  IF v_total = 0 THEN
    RETURN jsonb_build_object('lines', v_lines, 'transactions', '[]'::jsonb);
  END IF;

  -- Debit side.
  IF p_cost.cost_type = 'customs_vat' THEN
    v_lines := v_lines || public._imports_line('1410', v_total, 'Gömrük ƏDV-si — ' || v_label);
  ELSE
    IF COALESCE(p_amount, 0) <> 0 THEN
      v_lines := v_lines || public._imports_line(CASE WHEN p_cost.is_capitalized THEN '1360' ELSE '6190' END, p_amount, v_label);
    END IF;
    IF COALESCE(p_vat, 0) <> 0 THEN
      v_lines := v_lines || public._imports_line('1410', p_vat, 'ƏDV — ' || v_label);
    END IF;
  END IF;

  -- Credit side: cash now, or the partner's payable.
  IF p_splits IS NOT NULL AND jsonb_typeof(p_splits) = 'array' AND jsonb_array_length(p_splits) > 0 THEN
    IF v_total < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'imports_refund_not_supported: Azalan xərc nağd qaytarıla bilməz';
    END IF;
    FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
      v_sum := v_sum + round(COALESCE((v_split->>'amount')::numeric, 0), 2);
    END LOOP;
    IF abs(v_sum - v_total) > 0.005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_splits_mismatch: Ödəniş hissələri (%s) xərcə (%s) bərabər deyil', v_sum, v_total);
    END IF;
    FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
      v_tx := public._imports_cash_out((v_split->>'account_id')::uuid, round((v_split->>'amount')::numeric, 2), 'İdxal xərci — ' || v_label,
                                       p_shipment.id, 'import_cost', p_cost.id);
      v_txs := v_txs || v_tx;
      v_lines := v_lines || public._imports_line(public._imports_cash_coa((v_split->>'account_id')::uuid), -round((v_split->>'amount')::numeric, 2),
                                                 v_label, NULL, (v_split->>'account_id')::uuid);
    END LOOP;
  ELSE
    IF p_cost.partner_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_cost_partner_required: «%s» üçün tərəf (kimə borcludur) seçin və ya indi ödəyin', v_label);
    END IF;
    v_partner := public.resolve_unified_partner_id(NULL, p_cost.partner_id);
    v_lines := v_lines || public._imports_line('2100', -v_total, 'Kreditor — ' || v_label, v_partner);

    SELECT * INTO v_payable FROM public.import_payables WHERE cost_line_id = p_cost.id AND status <> 'cancelled' FOR UPDATE;
    IF FOUND THEN
      IF v_payable.amount_azn + v_total < v_payable.paid_azn - 0.005 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'imports_below_paid: Xərc artıq ödənilmiş məbləğdən az ola bilməz';
      END IF;
      UPDATE public.import_payables
      SET amount_azn = round(amount_azn + v_total, 2),
          amount_fc = round((amount_azn + v_total) / v_rate, 2),
          status = CASE WHEN paid_azn >= round(amount_azn + v_total, 2) - 0.005 THEN 'paid' ELSE 'open' END
      WHERE id = v_payable.id;
    ELSE
      IF v_total < 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'imports_refund_not_supported: Azalan xərc üçün açıq borc yoxdur';
      END IF;
      INSERT INTO public.import_payables (shipment_id, partner_id, source, cost_line_id, document_date, currency_code, amount_fc, booking_rate, amount_azn)
      VALUES (p_shipment.id, p_cost.partner_id, 'cost', p_cost.id, p_date, p_cost.currency_code, round(v_total / v_rate, 2), v_rate, v_total);
    END IF;
  END IF;

  RETURN jsonb_build_object('lines', v_lines, 'transactions', to_jsonb(v_txs));
END;
$$;

-- Received stock follows the latest allocation. For every line with stock received:
-- target = landed value × received / ordered (exactly the landed value once fully received);
-- the difference to what was moved so far goes to the remaining FIFO layers of that line
-- (1300, unit cost changed) and, for the part already sold or used, to 5100; 1360 the other way.
CREATE OR REPLACE FUNCTION public._imports_true_up(p_shipment_id UUID, p_cost_line_id UUID, p_key TEXT, p_memo TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          RECORD;
  v_received RECORD;
  v_landed   NUMERIC;
  v_target   NUMERIC;
  v_delta    NUMERIC;
  v_initial  NUMERIC;
  v_remain   NUMERIC;
  v_stock    NUMERIC;
  v_cogs     NUMERIC;
  v_tot_stock NUMERIC := 0;
  v_tot_cogs  NUMERIC := 0;
  v_postings JSONB := '[]'::jsonb;
  v_lines    JSONB := '[]'::jsonb;
  v_journal  UUID;
  v_number   TEXT := (SELECT number FROM public.import_shipments WHERE id = p_shipment_id);
BEGIN
  FOR r IN SELECT l.* FROM public.import_shipment_lines l WHERE l.shipment_id = p_shipment_id ORDER BY l.position LOOP
    SELECT * INTO v_received FROM public._imports_line_received(r.id);
    IF v_received.qty <= 0 THEN
      CONTINUE;
    END IF;
    v_landed := public._imports_line_landed(r.id);
    v_target := CASE WHEN v_received.qty >= r.qty_stock_unit - 0.0005 THEN round(v_landed, 2)
                     ELSE round(v_landed * v_received.qty / r.qty_stock_unit, 2) END;
    v_delta := v_target - v_received.value;
    IF abs(v_delta) < 0.005 THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(b.initial_qty), 0), COALESCE(SUM(b.remaining_qty), 0) INTO v_initial, v_remain
    FROM public.import_receipt_lines rl JOIN public.inventory_batches b ON b.id = rl.batch_id
    WHERE rl.shipment_line_id = r.id;

    v_stock := CASE WHEN v_initial > 0 THEN round(v_delta * v_remain / v_initial, 2) ELSE 0 END;
    v_cogs := v_delta - v_stock;

    IF v_stock <> 0 AND v_remain > 0 THEN
      UPDATE public.inventory_batches b
      SET unit_cost = GREATEST(b.unit_cost + v_stock / v_remain, 0)
      FROM public.import_receipt_lines rl
      WHERE rl.shipment_line_id = r.id AND b.id = rl.batch_id AND b.remaining_qty > 0;
    END IF;

    v_tot_stock := v_tot_stock + v_stock;
    v_tot_cogs := v_tot_cogs + v_cogs;
    v_postings := v_postings || jsonb_build_object('line', r.id, 'stock', v_stock, 'cogs', v_cogs);
  END LOOP;

  IF jsonb_array_length(v_postings) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_tot_stock <> 0 THEN
    v_lines := v_lines || public._imports_line('1300', v_tot_stock, 'Anbar dəyəri — ' || v_number || ' — ' || p_memo);
  END IF;
  IF v_tot_cogs <> 0 THEN
    v_lines := v_lines || public._imports_line('5100', v_tot_cogs, 'Satılmış hissə — ' || v_number || ' — ' || p_memo);
  END IF;
  v_lines := v_lines || public._imports_line('1360', -(v_tot_stock + v_tot_cogs), 'Yolda olan mallar — ' || v_number);

  v_journal := public.create_journal_entry(jsonb_build_object(
    'document_type', 'import_late_cost',
    'document_id', p_shipment_id,
    'idempotency_key', p_key,
    'description', format('İdxal %s: gecikmiş xərc — %s', v_number, p_memo),
    'lines', v_lines
  ));

  INSERT INTO public.import_late_postings (shipment_id, shipment_line_id, cost_line_id, to_stock_azn, to_cogs_azn, journal_entry_id)
  SELECT p_shipment_id, (p->>'line')::uuid, p_cost_line_id, (p->>'stock')::numeric, (p->>'cogs')::numeric, v_journal
  FROM jsonb_array_elements(v_postings) p;

  RETURN v_journal;
END;
$$;

-- Stores a cost line's split from the server ([{shipment_line_id, amount_azn}]), checked to add
-- up to the cost (src/lib/imports/landedCost.ts computes it; the database never splits).
CREATE OR REPLACE FUNCTION public._imports_set_allocations(p_cost public.import_cost_lines, p_allocations JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount NUMERIC := round(p_cost.amount * (CASE WHEN p_cost.currency_code = 'AZN' THEN 1 ELSE p_cost.rate_to_azn END), 2);
  v_sum    NUMERIC;
BEGIN
  DELETE FROM public.import_cost_allocations WHERE cost_line_id = p_cost.id;
  IF NOT p_cost.is_capitalized OR p_cost.cost_type = 'customs_vat' OR NOT EXISTS (SELECT 1 FROM public.import_shipment_lines WHERE shipment_id = p_cost.shipment_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.import_cost_allocations (cost_line_id, shipment_line_id, amount_azn)
  SELECT p_cost.id, l.id, round((a->>'amount_azn')::numeric, 2)
  FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) a
  JOIN public.import_shipment_lines l ON l.id = (a->>'shipment_line_id')::uuid AND l.shipment_id = p_cost.shipment_id;
  SELECT COALESCE(SUM(amount_azn), 0) INTO v_sum FROM public.import_cost_allocations WHERE cost_line_id = p_cost.id;
  IF abs(v_sum - v_amount) > 0.005 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_allocation_mismatch: Bölgü (%s) xərcə (%s) bərabər deyil', v_sum, v_amount);
  END IF;
END;
$$;

-- A cost line from the client ({cost_type, partner_id, description, amount, currency_code,
-- rate_to_azn, vat_amount_azn, is_capitalized, split_method, is_estimate}).
CREATE OR REPLACE FUNCTION public._imports_cost_from_json(p_shipment_id UUID, p_cost JSONB, p_status TEXT)
RETURNS public.import_cost_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.import_cost_lines;
BEGIN
  INSERT INTO public.import_cost_lines (
    shipment_id, position, cost_type, partner_id, description, amount, currency_code, rate_to_azn,
    vat_amount_azn, is_capitalized, split_method, is_estimate, added_at_status, paid_now, created_by)
  VALUES (
    p_shipment_id,
    COALESCE((SELECT MAX(position) + 1 FROM public.import_cost_lines WHERE shipment_id = p_shipment_id), 0),
    p_cost->>'cost_type',
    NULLIF(p_cost->>'partner_id', '')::uuid,
    NULLIF(btrim(p_cost->>'description'), ''),
    round(COALESCE((p_cost->>'amount')::numeric, 0), 2),
    COALESCE(NULLIF(p_cost->>'currency_code', ''), 'AZN'),
    CASE WHEN COALESCE(NULLIF(p_cost->>'currency_code', ''), 'AZN') = 'AZN' THEN 1 ELSE COALESCE((p_cost->>'rate_to_azn')::numeric, 0) END,
    round(COALESCE((p_cost->>'vat_amount_azn')::numeric, 0), 2),
    CASE WHEN p_cost->>'cost_type' = 'customs_vat' THEN false ELSE COALESCE((p_cost->>'is_capitalized')::boolean, true) END,
    COALESCE(NULLIF(p_cost->>'split_method', ''), 'by_value'),
    COALESCE((p_cost->>'is_estimate')::boolean, false),
    p_status,
    false,
    auth.uid()
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public._imports_require(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_op_get(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_op_put(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_cash_coa(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_cash_out(UUID, NUMERIC, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_line_landed(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_line_received(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_cost_lines(public.import_cost_lines, public.import_shipments, NUMERIC, NUMERIC, JSONB, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_true_up(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_set_allocations(public.import_cost_lines, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_cost_from_json(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_shipment_transit_balance(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_shipment_transit_balance(UUID) TO authenticated, service_role;

-- ─── 5. Confirm ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_import_shipment(p_id UUID, p_date DATE DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done     JSONB := public._imports_op_get(p_idempotency_key);
  v_s        public.import_shipments;
  v_cost     public.import_cost_lines;
  v_date     DATE;
  v_goods    NUMERIC;
  v_goods_fc NUMERIC;
  v_amount   NUMERIC;
  v_part     JSONB;
  v_lines    JSONB := '[]'::jsonb;
  v_txs      JSONB := '[]'::jsonb;
  v_journal  UUID;
  v_partner  UUID;
  v_alloc    NUMERIC;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');

  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_not_draft: Yalnız qaralama təsdiqlənə bilər';
  END IF;
  IF v_s.supplier_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_supplier_required: Təchizatçı seçilməyib';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_shipment_lines WHERE shipment_id = p_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_no_lines: Məhsul əlavə edilməyib';
  END IF;

  v_date := COALESCE(p_date, v_s.invoice_date, public.document_today());
  PERFORM public.use_document_date(v_date);

  SELECT COALESCE(SUM(round(qty_purchase_unit * unit_price_fc * v_s.invoice_rate, 2)), 0),
         COALESCE(SUM(qty_purchase_unit * unit_price_fc), 0)
  INTO v_goods, v_goods_fc
  FROM public.import_shipment_lines WHERE shipment_id = p_id;

  -- Goods: Dr 1360 / Cr 2100 supplier, and the supplier's payable.
  v_partner := public.resolve_unified_partner_id(NULL, v_s.supplier_id);
  IF v_goods > 0 THEN
    v_lines := v_lines
      || public._imports_line('1360', v_goods, 'Yolda olan mallar — ' || v_s.number)
      || public._imports_line('2100', -v_goods, 'Təchizatçı — ' || v_s.number || COALESCE(' / ' || v_s.invoice_no, ''), v_partner);
    INSERT INTO public.import_payables (shipment_id, partner_id, source, document_date, currency_code, amount_fc, booking_rate, amount_azn)
    VALUES (p_id, v_s.supplier_id, 'goods', v_date, v_s.currency_code, round(v_goods_fc, 2), v_s.invoice_rate, v_goods);
  END IF;

  -- Every cost line: its split must still add up (the split is saved with the draft).
  FOR v_cost IN SELECT * FROM public.import_cost_lines WHERE shipment_id = p_id ORDER BY position LOOP
    v_amount := round(v_cost.amount * (CASE WHEN v_cost.currency_code = 'AZN' THEN 1 ELSE v_cost.rate_to_azn END), 2);
    IF v_cost.is_capitalized AND v_cost.cost_type <> 'customs_vat' THEN
      SELECT COALESCE(SUM(amount_azn), 0) INTO v_alloc FROM public.import_cost_allocations WHERE cost_line_id = v_cost.id;
      IF abs(v_alloc - v_amount) > 0.005 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'imports_allocation_stale: Xərc bölgüsü köhnədir, qaralamanı yenidən saxlayın';
      END IF;
    END IF;
    IF v_cost.paid_now AND v_cost.cash_account_id IS NOT NULL THEN
      v_part := public._imports_cost_lines(v_cost, v_s, v_amount, v_cost.vat_amount_azn,
        jsonb_build_array(jsonb_build_object('account_id', v_cost.cash_account_id, 'amount', v_amount + v_cost.vat_amount_azn)), v_date);
    ELSE
      v_part := public._imports_cost_lines(v_cost, v_s, v_amount, v_cost.vat_amount_azn, NULL, v_date);
    END IF;
    v_lines := v_lines || (v_part->'lines');
    v_txs := v_txs || (v_part->'transactions');
  END LOOP;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_journal := public.create_journal_entry(jsonb_build_object(
      'document_type', 'import_confirm',
      'document_id', p_id,
      'idempotency_key', 'import_confirm:' || p_id::text,
      'entry_date', v_date,
      'description', format('İdxal %s təsdiqi%s', v_s.number, COALESCE(' — ' || v_s.invoice_no, '')),
      'lines', v_lines
    ));
    UPDATE public.transactions SET journal_entry_id = v_journal
    WHERE id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_txs) x);
    UPDATE public.import_payables SET journal_entry_id = v_journal WHERE shipment_id = p_id AND journal_entry_id IS NULL;
  END IF;

  UPDATE public.import_shipments SET status = 'confirmed', confirmed_at = NOW(), confirm_date = v_date WHERE id = p_id;
  PERFORM public.use_document_date(NULL);
  PERFORM public.refresh_supplier_ap_balance(v_s.supplier_id);

  RETURN public._imports_op_put(p_idempotency_key, 'confirm', p_id,
    jsonb_build_object('success', true, 'shipment_id', p_id, 'status', 'confirmed', 'journal_entry_id', v_journal));
END;
$$;

-- ─── 6. Receive ─────────────────────────────────────────────────────────────

-- p_lines: [{shipment_line_id, warehouse_id, qty_stock_unit, expected_qty_stock_unit}]: one
-- line may appear several times (one per warehouse). Quantities are in the stock unit (metres
-- for sheet products: whole sheets only).
CREATE OR REPLACE FUNCTION public.receive_import_shipment(p_id UUID, p_lines JSONB, p_date DATE DEFAULT NULL, p_note TEXT DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_s       public.import_shipments;
  v_entry   JSONB;
  v_line    RECORD;
  v_qty     NUMERIC;
  v_wh      UUID;
  v_landed  NUMERIC;
  v_rec     RECORD;
  v_value   NUMERIC;
  v_unit    NUMERIC;
  v_sheets  NUMERIC;
  v_receipt UUID;
  v_number  TEXT;
  v_year    INT;
  v_no      INT;
  v_total   NUMERIC := 0;
  v_rl      UUID;
  v_batch   UUID;
  v_journal UUID;
  v_date    DATE;
  v_status  TEXT;
  i         INT;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');

  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status NOT IN ('confirmed', 'cleared', 'partially_received') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_cannot_receive: Yalnız təsdiqlənmiş idxal anbara qəbul edilə bilər';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_receipt_empty: Qəbul ediləcək sətir yoxdur';
  END IF;

  v_date := COALESCE(p_date, public.document_today());
  IF v_date < COALESCE(v_s.confirm_date, v_date) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_date_before_confirm: Qəbul tarixi təsdiq tarixindən əvvəl ola bilməz';
  END IF;
  PERFORM public.use_document_date(v_date);

  v_year := EXTRACT(YEAR FROM v_date)::int;
  INSERT INTO public.document_number_counters (doc_type, year, last_no) VALUES ('import_receipt', v_year, 1)
  ON CONFLICT (doc_type, year) DO UPDATE SET last_no = public.document_number_counters.last_no + 1
  RETURNING last_no INTO v_no;
  v_number := 'IMR-' || v_year::text || '-' || lpad(v_no::text, 4, '0');

  INSERT INTO public.import_receipts (shipment_id, number, receipt_date, note)
  VALUES (p_id, v_number, v_date, NULLIF(btrim(p_note), '')) RETURNING id INTO v_receipt;

  FOR i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
    v_entry := p_lines -> i;
    v_qty := round(COALESCE((v_entry->>'qty_stock_unit')::numeric, 0), 3);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT l.*, p.inventory_mode, p.full_sheet_length_m, p.name AS product_name, p.unit AS product_unit
    INTO v_line
    FROM public.import_shipment_lines l JOIN public.products p ON p.id = l.product_id
    WHERE l.id = (v_entry->>'shipment_line_id')::uuid AND l.shipment_id = p_id
    FOR UPDATE OF l;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_line_not_found: Sətir bu idxala aid deyil';
    END IF;

    SELECT * INTO v_rec FROM public._imports_line_received(v_line.id);
    IF v_rec.qty + v_qty > v_line.qty_stock_unit + 0.0005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_over_receipt: %s: qəbul (%s) gözləniləndən (%s) çoxdur',
          v_line.product_name, v_rec.qty + v_qty, v_line.qty_stock_unit);
    END IF;

    v_wh := COALESCE(NULLIF(v_entry->>'warehouse_id', '')::uuid, v_line.warehouse_id, v_s.default_warehouse_id, public.stock_default_warehouse());
    IF v_wh IS NULL OR NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_wh) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_warehouse_required: Anbar seçilməyib';
    END IF;

    -- The latest allocation; the last receipt of a line takes exactly what is left.
    v_landed := public._imports_line_landed(v_line.id);
    IF v_rec.qty + v_qty >= v_line.qty_stock_unit - 0.0005 THEN
      v_value := round(v_landed, 2) - v_rec.value;
    ELSE
      v_value := round(v_landed * v_qty / v_line.qty_stock_unit, 2);
    END IF;
    v_value := GREATEST(v_value, 0);
    v_unit := round(v_value / v_qty, 4);

    IF v_line.inventory_mode = 'polywood' THEN
      v_sheets := v_qty / NULLIF(v_line.full_sheet_length_m, 0);
      IF v_sheets IS NULL OR abs(v_sheets - round(v_sheets)) > 0.001 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('imports_whole_sheets: %s yalnız tam vərəqlə qəbul edilir (%s m)', v_line.product_name, v_line.full_sheet_length_m);
      END IF;
      INSERT INTO public.polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at)
      SELECT v_line.product_id, v_wh, v_line.full_sheet_length_m, 'full', 'available', 'İdxal — ' || v_number, v_receipt, NOW()
      FROM generate_series(1, round(v_sheets)::int);
      PERFORM public.stock_sync_use_warehouse(v_wh);
      UPDATE public.products SET stock = COALESCE(stock, 0) + v_qty WHERE id = v_line.product_id;
    ELSE
      PERFORM public.stock_move(v_line.product_id, v_wh, v_qty, false);
    END IF;

    INSERT INTO public.import_receipt_lines (receipt_id, shipment_line_id, warehouse_id, qty_stock_unit, expected_qty_stock_unit, unit_cost_azn, value_azn)
    VALUES (v_receipt, v_line.id, v_wh, v_qty, NULLIF(v_entry->>'expected_qty_stock_unit', '')::numeric, v_unit, v_value)
    RETURNING id INTO v_rl;

    INSERT INTO public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, source_line_id, description, created_by)
    VALUES (v_line.product_id, v_wh, 'in', v_qty, CASE WHEN v_line.inventory_mode = 'polywood' THEN 'm' ELSE v_line.product_unit END,
            'import', v_receipt, v_rl, 'İdxal qəbulu — ' || v_number || ' (' || v_s.number || ')', auth.uid());

    v_batch := public.create_inventory_batch(v_line.product_id, v_receipt, 'import', v_unit, v_qty);
    UPDATE public.import_receipt_lines SET batch_id = v_batch WHERE id = v_rl;
    v_total := v_total + v_value;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.import_receipt_lines WHERE receipt_id = v_receipt) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_receipt_empty: Qəbul ediləcək sətir yoxdur';
  END IF;

  IF v_total > 0 THEN
    v_journal := public.create_journal_entry(jsonb_build_object(
      'document_type', 'import_receipt',
      'document_id', p_id,
      'idempotency_key', 'import_receipt:' || v_receipt::text,
      'entry_date', v_date,
      'description', format('İdxal %s: anbara qəbul %s', v_s.number, v_number),
      'lines', jsonb_build_array(
        public._imports_line('1300', v_total, 'Anbara qəbul — ' || v_number),
        public._imports_line('1360', -v_total, 'Yolda olan mallar — ' || v_s.number)
      )
    ));
    UPDATE public.import_receipts SET journal_entry_id = v_journal WHERE id = v_receipt;
  END IF;

  v_status := CASE WHEN EXISTS (
      SELECT 1 FROM public.import_shipment_lines l
      WHERE l.shipment_id = p_id
        AND l.qty_stock_unit - COALESCE((SELECT SUM(rl.qty_stock_unit) FROM public.import_receipt_lines rl WHERE rl.shipment_line_id = l.id), 0) > 0.0005
    ) THEN 'partially_received' ELSE 'received' END;
  UPDATE public.import_shipments SET status = v_status WHERE id = p_id;
  PERFORM public.stock_sync_use_warehouse(NULL);
  PERFORM public.use_document_date(NULL);

  RETURN public._imports_op_put(p_idempotency_key, 'receive', p_id, jsonb_build_object(
    'success', true, 'shipment_id', p_id, 'receipt_id', v_receipt, 'receipt_number', v_number,
    'status', v_status, 'value_azn', v_total, 'journal_entry_id', v_journal));
END;
$$;

-- ─── 7. Costs after confirmation ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_late_import_cost(p_cost_line_id UUID, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_cost    public.import_cost_lines;
  v_s       public.import_shipments;
  v_journal UUID;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');
  SELECT * INTO v_cost FROM public.import_cost_lines WHERE id = p_cost_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: Xərc tapılmadı';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = v_cost.shipment_id FOR UPDATE;
  IF v_s.status IN ('draft', 'closed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_cannot_post: Bu statusda xərc yerləşdirilmir';
  END IF;
  PERFORM public.use_document_date(public.document_today());
  v_journal := public._imports_true_up(v_s.id, v_cost.id,
    'import_late:' || v_cost.id::text || ':' || COALESCE(p_idempotency_key, gen_random_uuid()::text),
    COALESCE(NULLIF(v_cost.description, ''), v_cost.cost_type));
  PERFORM public.use_document_date(NULL);
  RETURN public._imports_op_put(p_idempotency_key, 'late_cost', v_s.id,
    jsonb_build_object('success', true, 'shipment_id', v_s.id, 'cost_line_id', v_cost.id, 'journal_entry_id', v_journal));
END;
$$;

-- p_cost as in _imports_cost_from_json plus allocations [{shipment_line_id, amount_azn}];
-- p_splits [{account_id, amount}] pays it at once (AZN, cost + VAT), otherwise it is owed to
-- its partner. Draft: only saved (the draft form's split). Confirmed or later: posted, then
-- received stock is trued up.
CREATE OR REPLACE FUNCTION public.add_import_cost(p_shipment_id UUID, p_cost JSONB, p_splits JSONB DEFAULT NULL, p_date DATE DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_s       public.import_shipments;
  v_cost    public.import_cost_lines;
  v_amount  NUMERIC;
  v_part    JSONB;
  v_journal UUID;
  v_late    UUID;
  v_date    DATE;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_closed: Bağlanmış və ya ləğv edilmiş idxala xərc əlavə edilmir';
  END IF;

  v_date := COALESCE(p_date, public.document_today());
  IF v_s.status <> 'draft' AND v_date < COALESCE(v_s.confirm_date, v_date) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_date_before_confirm: Tarix təsdiq tarixindən əvvəl ola bilməz';
  END IF;
  PERFORM public.use_document_date(CASE WHEN v_s.status = 'draft' THEN NULL ELSE v_date END);

  v_cost := public._imports_cost_from_json(p_shipment_id, p_cost, v_s.status);
  PERFORM public._imports_set_allocations(v_cost, p_cost->'allocations');

  IF v_s.status <> 'draft' THEN
    v_amount := round(v_cost.amount * (CASE WHEN v_cost.currency_code = 'AZN' THEN 1 ELSE v_cost.rate_to_azn END), 2);
    v_part := public._imports_cost_lines(v_cost, v_s, v_amount, v_cost.vat_amount_azn, p_splits, v_date);
    IF jsonb_array_length(v_part->'lines') > 0 THEN
      v_journal := public.create_journal_entry(jsonb_build_object(
        'document_type', 'import_cost',
        'document_id', p_shipment_id,
        'idempotency_key', 'import_cost:' || v_cost.id::text,
        'entry_date', v_date,
        'description', format('İdxal %s: əlavə xərc — %s', v_s.number, COALESCE(v_cost.description, v_cost.cost_type)),
        'lines', v_part->'lines'
      ));
      UPDATE public.transactions SET journal_entry_id = v_journal
      WHERE id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_part->'transactions') x);
      UPDATE public.import_payables SET journal_entry_id = v_journal WHERE cost_line_id = v_cost.id AND journal_entry_id IS NULL;
      IF p_splits IS NOT NULL AND jsonb_typeof(p_splits) = 'array' AND jsonb_array_length(p_splits) > 0 THEN
        UPDATE public.import_cost_lines SET paid_now = true, cash_account_id = ((p_splits->0)->>'account_id')::uuid WHERE id = v_cost.id;
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.import_receipts WHERE shipment_id = p_shipment_id) THEN
      v_late := public._imports_true_up(p_shipment_id, v_cost.id, 'import_late:' || v_cost.id::text || ':add',
        COALESCE(NULLIF(v_cost.description, ''), v_cost.cost_type));
    END IF;
    IF v_cost.partner_id IS NOT NULL THEN PERFORM public.refresh_supplier_ap_balance(v_cost.partner_id); END IF;
  END IF;
  PERFORM public.use_document_date(NULL);

  RETURN public._imports_op_put(p_idempotency_key, 'add_cost', p_shipment_id, jsonb_build_object(
    'success', true, 'shipment_id', p_shipment_id, 'cost_line_id', v_cost.id,
    'journal_entry_id', v_journal, 'late_journal_entry_id', v_late));
END;
$$;

-- An estimate becomes the actual cost: p_actual {amount, currency_code, rate_to_azn,
-- vat_amount_azn, allocations}. The difference posts like a new cost (payable adjusted) and
-- received stock is trued up through apply_late_import_cost's path.
CREATE OR REPLACE FUNCTION public.finalize_import_cost(p_cost_line_id UUID, p_actual JSONB, p_date DATE DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_old     public.import_cost_lines;
  v_new     public.import_cost_lines;
  v_s       public.import_shipments;
  v_old_amt NUMERIC;
  v_new_amt NUMERIC;
  v_part    JSONB;
  v_journal UUID;
  v_late    UUID;
  v_date    DATE;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');
  SELECT * INTO v_old FROM public.import_cost_lines WHERE id = p_cost_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: Xərc tapılmadı';
  END IF;
  IF NOT v_old.is_estimate THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_not_estimate: Bu xərc artıq faktikidir';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = v_old.shipment_id FOR UPDATE;
  IF v_s.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_closed: Bağlanmış və ya ləğv edilmiş idxal dəyişdirilmir';
  END IF;
  v_date := COALESCE(p_date, public.document_today());
  PERFORM public.use_document_date(CASE WHEN v_s.status = 'draft' THEN NULL ELSE v_date END);

  v_old_amt := round(v_old.amount * (CASE WHEN v_old.currency_code = 'AZN' THEN 1 ELSE v_old.rate_to_azn END), 2);
  UPDATE public.import_cost_lines SET
    amount = round(COALESCE((p_actual->>'amount')::numeric, amount), 2),
    currency_code = COALESCE(NULLIF(p_actual->>'currency_code', ''), currency_code),
    rate_to_azn = CASE WHEN COALESCE(NULLIF(p_actual->>'currency_code', ''), currency_code) = 'AZN' THEN 1
                       ELSE COALESCE((p_actual->>'rate_to_azn')::numeric, rate_to_azn) END,
    vat_amount_azn = round(COALESCE((p_actual->>'vat_amount_azn')::numeric, vat_amount_azn), 2),
    is_estimate = false
  WHERE id = p_cost_line_id
  RETURNING * INTO v_new;
  PERFORM public._imports_set_allocations(v_new, p_actual->'allocations');

  IF v_s.status <> 'draft' THEN
    v_new_amt := round(v_new.amount * (CASE WHEN v_new.currency_code = 'AZN' THEN 1 ELSE v_new.rate_to_azn END), 2);
    v_part := public._imports_cost_lines(v_new, v_s, v_new_amt - v_old_amt, v_new.vat_amount_azn - v_old.vat_amount_azn, NULL, v_date);
    IF jsonb_array_length(v_part->'lines') > 0 THEN
      v_journal := public.create_journal_entry(jsonb_build_object(
        'document_type', 'import_cost',
        'document_id', v_s.id,
        'idempotency_key', 'import_cost_final:' || v_new.id::text,
        'entry_date', v_date,
        'description', format('İdxal %s: təxmini xərc faktiki oldu — %s', v_s.number, COALESCE(v_new.description, v_new.cost_type)),
        'lines', v_part->'lines'
      ));
    END IF;
    IF EXISTS (SELECT 1 FROM public.import_receipts WHERE shipment_id = v_s.id) THEN
      v_late := public._imports_true_up(v_s.id, v_new.id, 'import_late:' || v_new.id::text || ':final',
        COALESCE(NULLIF(v_new.description, ''), v_new.cost_type));
    END IF;
    IF v_new.partner_id IS NOT NULL THEN PERFORM public.refresh_supplier_ap_balance(v_new.partner_id); END IF;
  END IF;
  PERFORM public.use_document_date(NULL);

  RETURN public._imports_op_put(p_idempotency_key, 'finalize_cost', v_s.id, jsonb_build_object(
    'success', true, 'shipment_id', v_s.id, 'cost_line_id', v_new.id, 'journal_entry_id', v_journal, 'late_journal_entry_id', v_late));
END;
$$;

-- ─── 8. Pay ─────────────────────────────────────────────────────────────────

-- p_splits: [{account_id, amount}] in AZN. One entry Dr 2100 partner / Cr each account's COA;
-- one cash transaction (and payments row, when the supplier has a partner record) per account.
CREATE OR REPLACE FUNCTION public.pay_import_payable(p_payable_id UUID, p_payment_date DATE, p_note TEXT, p_splits JSONB, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_p       public.import_payables;
  v_s       public.import_shipments;
  v_split   JSONB;
  v_amount  NUMERIC;
  v_total   NUMERIC := 0;
  v_open    NUMERIC;
  v_pay     UUID;
  v_tx      UUID;
  v_lines   JSONB := '[]'::jsonb;
  v_journal UUID;
  v_partner UUID;
  v_label   TEXT;
  v_account RECORD;
  v_payment_ids UUID[] := '{}';
  v_tx_ids  UUID[] := '{}';
  v_date    DATE := COALESCE(p_payment_date, public.document_today());
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');

  SELECT * INTO v_p FROM public.import_payables WHERE id = p_payable_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: Borc tapılmadı';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = v_p.shipment_id;
  IF v_s.status IN ('closed', 'cancelled') OR v_p.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_cannot_pay: Bu borc ödənilə bilməz (bağlı idxal və ya ödənilib)';
  END IF;
  IF v_date < v_p.document_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_payment_before_document: Ödəniş tarixi (%s) borcun tarixindən (%s) əvvəl ola bilməz',
        to_char(v_date, 'DD.MM.YYYY'), to_char(v_p.document_date, 'DD.MM.YYYY'));
  END IF;
  IF p_splits IS NULL OR jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_splits_required: Ən azı bir hesab seçin';
  END IF;

  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round(COALESCE((v_split->>'amount')::numeric, 0), 2);
    IF v_amount <= 0 OR NULLIF(v_split->>'account_id', '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_invalid_split: Hər hissədə hesab və müsbət məbləğ olmalıdır';
    END IF;
    v_total := v_total + v_amount;
  END LOOP;
  v_open := v_p.amount_azn - v_p.paid_azn;
  IF v_total > v_open + 0.005 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_overpay: Ödəniş (%s) qalıq borcdan (%s) çoxdur', v_total, v_open);
  END IF;

  PERFORM public.use_document_date(v_date);
  v_label := format('%s — %s', v_s.number, COALESCE(NULLIF(btrim(p_note), ''), 'İdxal ödənişi'));
  v_partner := public.resolve_unified_partner_id(NULL, v_p.partner_id);

  INSERT INTO public.import_payments (payable_id, shipment_id, payment_date, note, amount_azn)
  VALUES (p_payable_id, v_s.id, v_date, NULLIF(btrim(p_note), ''), v_total) RETURNING id INTO v_pay;

  v_lines := v_lines || public._imports_line('2100', v_total, 'Kreditor ödənişi — ' || v_label, v_partner);
  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round((v_split->>'amount')::numeric, 2);
    v_tx := public._imports_cash_out((v_split->>'account_id')::uuid, v_amount, 'İdxal ödənişi — ' || v_label, v_s.id, 'import_payment', v_pay);
    v_tx_ids := v_tx_ids || v_tx;
    INSERT INTO public.import_payment_splits (payment_id, account_id, amount_azn, transaction_id)
    VALUES (v_pay, (v_split->>'account_id')::uuid, v_amount, v_tx);
    v_lines := v_lines || public._imports_line(public._imports_cash_coa((v_split->>'account_id')::uuid), -v_amount, v_label, NULL, (v_split->>'account_id')::uuid);

    -- The partner's payment history (payments list, partner ledger) where the supplier has a partner record.
    IF v_partner IS NOT NULL THEN
      SELECT type INTO v_account FROM public.accounts WHERE id = (v_split->>'account_id')::uuid;
      INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, transaction_id, idempotency_key, created_by)
      VALUES (COALESCE(public.document_timestamp(), NOW()), v_partner, v_amount, 'out',
              CASE WHEN COALESCE(v_account.type, '') ILIKE '%bank%' THEN 'bank' ELSE 'cash' END,
              'İdxal ödənişi — ' || v_label, (v_split->>'account_id')::uuid, v_tx,
              'import_payment:' || v_pay::text || ':' || v_tx::text, auth.uid())
      RETURNING id INTO v_tx;
      v_payment_ids := v_payment_ids || v_tx;
    END IF;
  END LOOP;

  v_journal := public.create_journal_entry(jsonb_build_object(
    'document_type', 'import_payment',
    'document_id', v_s.id,
    'idempotency_key', 'import_payment:' || v_pay::text,
    'entry_date', v_date,
    'description', format('İdxal %s: ödəniş', v_s.number),
    'lines', v_lines
  ));
  UPDATE public.import_payments SET journal_entry_id = v_journal WHERE id = v_pay;
  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = ANY (v_tx_ids);
  UPDATE public.payments SET journal_entry_id = v_journal WHERE id = ANY (v_payment_ids);
  UPDATE public.import_payables
  SET paid_azn = round(paid_azn + v_total, 2),
      status = CASE WHEN round(paid_azn + v_total, 2) >= amount_azn - 0.005 THEN 'paid' ELSE 'open' END
  WHERE id = p_payable_id;
  PERFORM public.use_document_date(NULL);
  PERFORM public.refresh_supplier_ap_balance(v_p.partner_id);

  RETURN public._imports_op_put(p_idempotency_key, 'pay', v_s.id, jsonb_build_object(
    'success', true, 'payment_id', v_pay, 'journal_entry_id', v_journal, 'amount_azn', v_total,
    'remaining_azn', round(v_open - v_total, 2)));
END;
$$;

-- ─── 9. Close, reopen, cancel ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_import_shipment(p_id UUID, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_s       public.import_shipments;
  v_balance NUMERIC;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status <> 'received' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_cannot_close: Yalnız tam qəbul edilmiş idxal bağlana bilər';
  END IF;
  IF EXISTS (SELECT 1 FROM public.import_cost_lines WHERE shipment_id = p_id AND is_estimate) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_estimates_open: Təxmini xərcləri əvvəlcə faktiki edin';
  END IF;
  v_balance := public.import_shipment_transit_balance(p_id);
  IF abs(v_balance) > 0.005 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_transit_not_zero: 1360 hesabında qalıq var (%s)', v_balance);
  END IF;
  UPDATE public.import_shipments SET status = 'closed', closed_at = NOW() WHERE id = p_id;
  RETURN public._imports_op_put(p_idempotency_key, 'close', p_id, jsonb_build_object('success', true, 'shipment_id', p_id, 'status', 'closed'));
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_import_shipment(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.user_is_admin(), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'imports_forbidden: Yalnız administrator bağlı idxalı aça bilər';
  END IF;
  UPDATE public.import_shipments SET status = 'received', closed_at = NULL WHERE id = p_id AND status = 'closed';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_not_closed: İdxal bağlı deyil';
  END IF;
  RETURN jsonb_build_object('success', true, 'shipment_id', p_id, 'status', 'received');
END;
$$;

-- Everything the shipment posted is reversed (storno): cash first (balances back, their
-- entries reversed), then every remaining entry, then the received stock. Refused once any
-- received stock has been sold or used.
CREATE OR REPLACE FUNCTION public.cancel_import_shipment(p_id UUID, p_reason TEXT, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done   JSONB := public._imports_op_get(p_idempotency_key);
  v_s      public.import_shipments;
  v_reason TEXT := NULLIF(btrim(p_reason), '');
  r        RECORD;
  v_count  INT := 0;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_reason_required: Ləğv səbəbini yazın';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_cannot_cancel: Bağlı və ya ləğv edilmiş idxal ləğv edilə bilməz';
  END IF;

  -- Received stock must still be all there.
  IF EXISTS (
    SELECT 1 FROM public.import_receipt_lines rl
    JOIN public.import_receipts rc ON rc.id = rl.receipt_id
    JOIN public.inventory_batches b ON b.id = rl.batch_id
    WHERE rc.shipment_id = p_id AND b.remaining_qty < b.initial_qty - 0.0005
  ) OR EXISTS (
    SELECT 1 FROM public.polywood_pieces pp JOIN public.import_receipts rc ON rc.id = pp.source_document_id
    WHERE rc.shipment_id = p_id AND pp.status <> 'available'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_stock_consumed: Qəbul edilmiş malın bir hissəsi artıq satılıb və ya istifadə olunub; idxal ləğv edilə bilməz';
  END IF;

  -- Stock back out of each warehouse.
  FOR r IN
    SELECT rl.*, rc.number AS receipt_number, p.inventory_mode, p.unit AS product_unit, l.product_id
    FROM public.import_receipt_lines rl
    JOIN public.import_receipts rc ON rc.id = rl.receipt_id
    JOIN public.import_shipment_lines l ON l.id = rl.shipment_line_id
    JOIN public.products p ON p.id = l.product_id
    WHERE rc.shipment_id = p_id
  LOOP
    IF r.inventory_mode = 'polywood' THEN
      DELETE FROM public.polywood_pieces WHERE source_document_id = r.receipt_id AND product_id = r.product_id AND warehouse_id = r.warehouse_id AND status = 'available';
      PERFORM public.stock_sync_use_warehouse(r.warehouse_id);
      UPDATE public.products SET stock = GREATEST(COALESCE(stock, 0) - r.qty_stock_unit, 0) WHERE id = r.product_id;
    ELSE
      PERFORM public.stock_move(r.product_id, r.warehouse_id, -r.qty_stock_unit, true);
    END IF;
    INSERT INTO public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, source_line_id, description, created_by)
    VALUES (r.product_id, r.warehouse_id, 'out', r.qty_stock_unit, CASE WHEN r.inventory_mode = 'polywood' THEN 'm' ELSE r.product_unit END,
            'import', r.receipt_id, r.id, 'İdxal ləğvi — ' || r.receipt_number || ' (' || v_s.number || ')', auth.uid());
    UPDATE public.import_receipt_lines SET batch_id = NULL WHERE id = r.id;
    DELETE FROM public.inventory_batches WHERE id = r.batch_id;
  END LOOP;
  PERFORM public.stock_sync_use_warehouse(NULL);

  -- Cash back (each transaction's entry is reversed with it), then every other entry.
  PERFORM public.reverse_document_cash_transactions('import_shipment', p_id, v_s.number, 'İdxal ləğvi: ' || v_reason);
  FOR r IN
    SELECT id FROM public.journal_entries
    WHERE document_id = p_id AND document_type LIKE 'import_%' AND reversal_of IS NULL AND reversed_by IS NULL
    ORDER BY posted_at
  LOOP
    PERFORM public.reverse_journal_entry(r.id, 'İdxal ləğvi: ' || v_reason);
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.import_payables SET status = 'cancelled' WHERE shipment_id = p_id;
  UPDATE public.import_shipments SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = v_reason WHERE id = p_id;
  PERFORM public.refresh_supplier_ap_balance(v_s.supplier_id);

  RETURN public._imports_op_put(p_idempotency_key, 'cancel', p_id, jsonb_build_object('success', true, 'shipment_id', p_id, 'status', 'cancelled', 'reversed_entries', v_count));
END;
$$;

-- ─── 10. Grants ─────────────────────────────────────────────────────────────

-- Called with the user's session: each checks imports.approve / imports.manage itself.
REVOKE ALL ON FUNCTION public.confirm_import_shipment(UUID, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_import_shipment(UUID, JSONB, DATE, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_late_import_cost(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_import_cost(UUID, JSONB, JSONB, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_import_cost(UUID, JSONB, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_import_payable(UUID, DATE, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_import_shipment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_import_shipment(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_import_shipment(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_import_shipment(UUID, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_import_shipment(UUID, JSONB, DATE, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_late_import_cost(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_import_cost(UUID, JSONB, JSONB, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_import_cost(UUID, JSONB, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pay_import_payable(UUID, DATE, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_import_shipment(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_import_shipment(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_import_shipment(UUID, TEXT, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
