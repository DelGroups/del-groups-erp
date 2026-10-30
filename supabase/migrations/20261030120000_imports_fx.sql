-- ============================================================================
-- Imports module ("İdxal"), IMP-3: exchange differences and supplier prepayments.
--
-- Builds on 20261030110000_imports_posting.sql (IMP-2).
--
-- Paying a foreign-currency payable: the user enters the amount in the payable's currency and
-- the payment-date rate (CBAR or typed). The money leaves the accounts in AZN at that rate; the
-- payable is relieved at its booking value; the difference is an exchange difference:
--     Dr 2100  booking value of the settled foreign amount
--     Cr 1100  AZN paid (one line per account)
--     Dr 6260  loss  (paid more AZN than booked)   or   Cr 4960  gain (paid less)
-- Partial payments keep a running foreign-currency balance (paid_fc); each one relieves its
-- share of the open AZN balance, the last one exactly what is left, so 2100 ends at zero.
--
-- Supplier prepayments before the invoice: prepay_import_supplier, while the shipment is a
-- draft, debits 2100 (a debit balance on the supplier) at the prepayment rate. On confirm the
-- prepaid part of the goods is valued at the prepayment rate and the rest at the invoice rate
-- (IAS 21 / IFRIC 22): no exchange difference on the prepaid part; the prepayments settle the
-- goods payable. The effective goods rate (import_shipments.goods_rate_azn) carries the value
-- into the landed cost and the receipts, so 1360 still ends at zero.
--
-- pay_import_payable gets two arguments (amount in the currency, payment rate); the IMP-2
-- signature is replaced. Safe to re-run.
-- ============================================================================

-- ─── 1. Columns and the prepayment table ────────────────────────────────────

ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS goods_rate_azn NUMERIC(18,6) CHECK (goods_rate_azn IS NULL OR goods_rate_azn > 0);
COMMENT ON COLUMN public.import_shipments.goods_rate_azn IS
  'IMP-3: AZN per unit of the shipment currency for the goods once confirmed with prepayments (prepaid part at the prepayment rate, the rest at the invoice rate). NULL = invoice_rate.';

ALTER TABLE public.import_payables ADD COLUMN IF NOT EXISTS paid_fc NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (paid_fc >= 0);
-- Payables paid before IMP-3 (AZN only): their foreign-currency side at the booking rate.
UPDATE public.import_payables
SET paid_fc = LEAST(amount_fc, round(paid_azn / booking_rate, 2))
WHERE paid_fc = 0 AND paid_azn > 0;

ALTER TABLE public.import_payments ADD COLUMN IF NOT EXISTS currency_code TEXT REFERENCES public.currencies (code);
ALTER TABLE public.import_payments ADD COLUMN IF NOT EXISTS amount_fc NUMERIC(18,2);
ALTER TABLE public.import_payments ADD COLUMN IF NOT EXISTS payment_rate NUMERIC(18,6);
ALTER TABLE public.import_payments ADD COLUMN IF NOT EXISTS settled_azn NUMERIC(18,2);
ALTER TABLE public.import_payments ADD COLUMN IF NOT EXISTS fx_difference_azn NUMERIC(18,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.import_payments.fx_difference_azn IS
  'IMP-3: AZN paid − booking value settled. Positive = loss (6260), negative = gain (4960).';

CREATE TABLE IF NOT EXISTS public.import_prepayments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      UUID NOT NULL REFERENCES public.import_shipments (id) ON DELETE CASCADE,
  partner_id       UUID NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  payment_date     DATE NOT NULL,
  note             TEXT CHECK (note IS NULL OR length(note) <= 500),
  currency_code    TEXT NOT NULL REFERENCES public.currencies (code),
  amount_fc        NUMERIC(18,2) NOT NULL CHECK (amount_fc > 0),
  rate             NUMERIC(18,6) NOT NULL CHECK (rate > 0),
  amount_azn       NUMERIC(18,2) NOT NULL CHECK (amount_azn > 0),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'cancelled')),
  payable_id       UUID REFERENCES public.import_payables (id) ON DELETE SET NULL,
  journal_entry_id UUID REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  created_by       UUID DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_prepayments_shipment_idx ON public.import_prepayments (shipment_id, status);

ALTER TABLE public.import_prepayments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_prepayments_select ON public.import_prepayments;
CREATE POLICY import_prepayments_select ON public.import_prepayments FOR SELECT TO authenticated USING ((SELECT public.imports_can_read()));
GRANT SELECT ON public.import_prepayments TO authenticated;
GRANT ALL ON public.import_prepayments TO service_role;

-- ─── 2. Goods value at the effective rate ───────────────────────────────────

CREATE OR REPLACE FUNCTION public._imports_line_landed(p_line_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(l.qty_purchase_unit * l.unit_price_fc * COALESCE(s.goods_rate_azn, s.invoice_rate), 2)
       + COALESCE((SELECT SUM(a.amount_azn) FROM public.import_cost_allocations a WHERE a.shipment_line_id = l.id), 0)
  FROM public.import_shipment_lines l
  JOIN public.import_shipments s ON s.id = l.shipment_id
  WHERE l.id = p_line_id;
$$;

-- ─── 3. Confirm applies the prepayments ─────────────────────────────────────

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
  v_prep_fc  NUMERIC;
  v_prep_azn NUMERIC;
  v_rate_eff NUMERIC;
  v_payable  UUID;
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
  v_goods_fc := round(v_goods_fc, 2);

  -- Supplier prepayments (IMP-3): the prepaid part of the goods is valued at the prepayment
  -- rate, the rest at the invoice rate (IAS 21 / IFRIC 22). One effective goods rate carries it
  -- into every line, the landed cost and the receipts; the prepayments settle the payable.
  SELECT COALESCE(SUM(amount_fc), 0), COALESCE(SUM(amount_azn), 0) INTO v_prep_fc, v_prep_azn
  FROM public.import_prepayments WHERE shipment_id = p_id AND status = 'open';
  IF v_prep_fc > v_goods_fc + 0.005 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
      'imports_prepayment_exceeds: Avans (%s %s) malın dəyərindən (%s %s) çoxdur', v_prep_fc, v_s.currency_code, v_goods_fc, v_s.currency_code);
  END IF;
  IF v_prep_fc > 0 AND v_goods_fc > 0 THEN
    v_rate_eff := round((v_prep_azn + (v_goods_fc - v_prep_fc) * v_s.invoice_rate) / v_goods_fc, 6);
    UPDATE public.import_shipments SET goods_rate_azn = v_rate_eff WHERE id = p_id;
    SELECT COALESCE(SUM(round(qty_purchase_unit * unit_price_fc * v_rate_eff, 2)), 0) INTO v_goods
    FROM public.import_shipment_lines WHERE shipment_id = p_id;
  END IF;

  -- Goods: Dr 1360 / Cr 2100 supplier, and the supplier's payable.
  v_partner := public.resolve_unified_partner_id(NULL, v_s.supplier_id);
  IF v_goods > 0 THEN
    v_lines := v_lines
      || public._imports_line('1360', v_goods, 'Yolda olan mallar — ' || v_s.number)
      || public._imports_line('2100', -v_goods, 'Təchizatçı — ' || v_s.number || COALESCE(' / ' || v_s.invoice_no, ''), v_partner);
    INSERT INTO public.import_payables (shipment_id, partner_id, source, document_date, currency_code, amount_fc, booking_rate, amount_azn, paid_fc, paid_azn, status)
    VALUES (p_id, v_s.supplier_id, 'goods', v_date, v_s.currency_code, v_goods_fc, v_s.invoice_rate, v_goods,
            v_prep_fc, LEAST(v_prep_azn, v_goods),
            CASE WHEN v_prep_fc > 0 AND v_prep_fc >= v_goods_fc - 0.005 THEN 'paid' ELSE 'open' END)
    RETURNING id INTO v_payable;
    UPDATE public.import_prepayments SET status = 'applied', payable_id = v_payable WHERE shipment_id = p_id AND status = 'open';
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

-- ─── 4. Pay with exchange differences ───────────────────────────────────────

DROP FUNCTION IF EXISTS public.pay_import_payable(UUID, DATE, TEXT, JSONB, TEXT);

-- p_splits [{account_id, amount}] in AZN. For a payable in another currency p_amount_fc (in its
-- currency) and p_rate (AZN per unit on the payment date) are required and the splits must add
-- up to amount_fc × rate. One entry: Dr 2100 booking value / Cr each account / 6260 or 4960.
CREATE OR REPLACE FUNCTION public.pay_import_payable(
  p_payable_id      UUID,
  p_payment_date    DATE,
  p_note            TEXT,
  p_splits          JSONB,
  p_idempotency_key TEXT DEFAULT NULL,
  p_amount_fc       NUMERIC DEFAULT NULL,
  p_rate            NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done     JSONB := public._imports_op_get(p_idempotency_key);
  v_p        public.import_payables;
  v_s        public.import_shipments;
  v_split    JSONB;
  v_amount   NUMERIC;
  v_total    NUMERIC := 0;
  v_open_fc  NUMERIC;
  v_open_azn NUMERIC;
  v_fc       NUMERIC;
  v_rate     NUMERIC;
  v_settle   NUMERIC;
  v_diff     NUMERIC;
  v_pay      UUID;
  v_tx       UUID;
  v_lines    JSONB := '[]'::jsonb;
  v_journal  UUID;
  v_partner  UUID;
  v_label    TEXT;
  v_account  RECORD;
  v_payment_ids UUID[] := '{}';
  v_tx_ids   UUID[] := '{}';
  v_date     DATE := COALESCE(p_payment_date, public.document_today());
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

  v_open_fc := v_p.amount_fc - v_p.paid_fc;
  v_open_azn := v_p.amount_azn - v_p.paid_azn;

  IF v_p.currency_code = 'AZN' THEN
    v_fc := v_total;
    v_rate := 1;
    IF v_total > v_open_azn + 0.005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_overpay: Ödəniş (%s) qalıq borcdan (%s) çoxdur', v_total, v_open_azn);
    END IF;
    v_settle := v_total;
  ELSE
    v_fc := round(COALESCE(p_amount_fc, 0), 2);
    v_rate := COALESCE(p_rate, 0);
    IF v_fc <= 0 OR v_rate <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_fx_required: %s borcu üçün valyuta məbləği və ödəniş günü məzənnəsi lazımdır', v_p.currency_code);
    END IF;
    IF v_fc > v_open_fc + 0.005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_overpay: Ödəniş (%s %s) qalıq borcdan (%s %s) çoxdur', v_fc, v_p.currency_code, v_open_fc, v_p.currency_code);
    END IF;
    IF abs(v_total - round(v_fc * v_rate, 2)) > 0.011 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_splits_mismatch: Hesablardan çıxan (%s AZN) %s %s × %s = %s AZN-ə bərabər deyil',
          v_total, v_fc, v_p.currency_code, v_rate, round(v_fc * v_rate, 2));
    END IF;
    -- The booking value of what is settled; the last payment takes exactly what is left.
    v_settle := CASE WHEN v_fc >= v_open_fc - 0.005 THEN v_open_azn
                     ELSE round(v_open_azn * v_fc / NULLIF(v_open_fc, 0), 2) END;
  END IF;
  v_diff := round(v_total - v_settle, 2);

  PERFORM public.use_document_date(v_date);
  v_label := format('%s — %s', v_s.number, COALESCE(NULLIF(btrim(p_note), ''), 'İdxal ödənişi'));
  v_partner := public.resolve_unified_partner_id(NULL, v_p.partner_id);

  INSERT INTO public.import_payments (payable_id, shipment_id, payment_date, note, amount_azn, currency_code, amount_fc, payment_rate, settled_azn, fx_difference_azn)
  VALUES (p_payable_id, v_s.id, v_date, NULLIF(btrim(p_note), ''), v_total, v_p.currency_code, v_fc, v_rate, v_settle, v_diff)
  RETURNING id INTO v_pay;

  v_lines := v_lines || public._imports_line('2100', v_settle, 'Kreditor ödənişi — ' || v_label, v_partner);
  IF v_diff > 0 THEN
    v_lines := v_lines || public._imports_line('6260', v_diff, format('Məzənnə fərqi (zərər) — %s: %s %s, %s → %s', v_label, v_fc, v_p.currency_code, round(v_settle / NULLIF(v_fc, 0), 6), v_rate));
  ELSIF v_diff < 0 THEN
    v_lines := v_lines || public._imports_line('4960', v_diff, format('Məzənnə fərqi (gəlir) — %s: %s %s, %s → %s', v_label, v_fc, v_p.currency_code, round(v_settle / NULLIF(v_fc, 0), 6), v_rate));
  END IF;

  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round((v_split->>'amount')::numeric, 2);
    v_tx := public._imports_cash_out((v_split->>'account_id')::uuid, v_amount, 'İdxal ödənişi — ' || v_label, v_s.id, 'import_payment', v_pay);
    v_tx_ids := v_tx_ids || v_tx;
    INSERT INTO public.import_payment_splits (payment_id, account_id, amount_azn, transaction_id)
    VALUES (v_pay, (v_split->>'account_id')::uuid, v_amount, v_tx);
    v_lines := v_lines || public._imports_line(public._imports_cash_coa((v_split->>'account_id')::uuid), -v_amount, v_label, NULL, (v_split->>'account_id')::uuid);
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
    'description', format('İdxal %s: ödəniş%s', v_s.number,
      CASE WHEN v_p.currency_code <> 'AZN' THEN format(' %s %s × %s', v_fc, v_p.currency_code, v_rate) ELSE '' END),
    'lines', v_lines
  ));
  UPDATE public.import_payments SET journal_entry_id = v_journal WHERE id = v_pay;
  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = ANY (v_tx_ids);
  UPDATE public.payments SET journal_entry_id = v_journal WHERE id = ANY (v_payment_ids);
  UPDATE public.import_payables
  SET paid_azn = round(paid_azn + v_settle, 2),
      paid_fc = round(paid_fc + v_fc, 2),
      status = CASE WHEN round(paid_fc + v_fc, 2) >= amount_fc - 0.005 THEN 'paid' ELSE 'open' END
  WHERE id = p_payable_id;
  PERFORM public.use_document_date(NULL);
  PERFORM public.refresh_supplier_ap_balance(v_p.partner_id);

  RETURN public._imports_op_put(p_idempotency_key, 'pay', v_s.id, jsonb_build_object(
    'success', true, 'payment_id', v_pay, 'journal_entry_id', v_journal, 'amount_azn', v_total,
    'amount_fc', v_fc, 'settled_azn', v_settle, 'fx_difference_azn', v_diff,
    'remaining_fc', round(v_open_fc - v_fc, 2), 'remaining_azn', round(v_open_azn - v_settle, 2)));
END;
$$;

-- ─── 5. Supplier prepayment before the invoice ──────────────────────────────

-- While the shipment is a draft: p_amount_fc in the shipment currency at p_rate (AZN per unit
-- on the payment date; 1 for AZN), paid from p_splits [{account_id, amount}] adding up to
-- amount_fc × rate. Dr 2100 supplier (a debit balance until the invoice is confirmed).
CREATE OR REPLACE FUNCTION public.prepay_import_supplier(
  p_shipment_id     UUID,
  p_payment_date    DATE,
  p_note            TEXT,
  p_amount_fc       NUMERIC,
  p_rate            NUMERIC,
  p_splits          JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_s       public.import_shipments;
  v_fc      NUMERIC := round(COALESCE(p_amount_fc, 0), 2);
  v_rate    NUMERIC;
  v_azn     NUMERIC;
  v_total   NUMERIC := 0;
  v_split   JSONB;
  v_amount  NUMERIC;
  v_prep    UUID;
  v_tx      UUID;
  v_tx_ids  UUID[] := '{}';
  v_payment_ids UUID[] := '{}';
  v_lines   JSONB := '[]'::jsonb;
  v_journal UUID;
  v_partner UUID;
  v_label   TEXT;
  v_account RECORD;
  v_date    DATE := COALESCE(p_payment_date, public.document_today());
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_prepay_draft_only: Avans yalnız faktura təsdiqlənməzdən əvvəl (qaralamada) verilir';
  END IF;
  IF v_s.supplier_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_supplier_required: Təchizatçı seçilməyib';
  END IF;
  v_rate := CASE WHEN v_s.currency_code = 'AZN' THEN 1 ELSE COALESCE(p_rate, 0) END;
  IF v_fc <= 0 OR v_rate <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_fx_required: Avansın məbləği və məzənnəsi lazımdır';
  END IF;
  v_azn := round(v_fc * v_rate, 2);
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
  IF abs(v_total - v_azn) > 0.011 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_splits_mismatch: Hesablardan çıxan (%s AZN) avansa (%s AZN) bərabər deyil', v_total, v_azn);
  END IF;

  PERFORM public.use_document_date(v_date);
  v_label := format('%s — %s', v_s.number, COALESCE(NULLIF(btrim(p_note), ''), 'Təchizatçıya avans'));
  v_partner := public.resolve_unified_partner_id(NULL, v_s.supplier_id);

  INSERT INTO public.import_prepayments (shipment_id, partner_id, payment_date, note, currency_code, amount_fc, rate, amount_azn)
  VALUES (p_shipment_id, v_s.supplier_id, v_date, NULLIF(btrim(p_note), ''), v_s.currency_code, v_fc, v_rate, v_total)
  RETURNING id INTO v_prep;

  v_lines := v_lines || public._imports_line('2100', v_total, 'Təchizatçıya avans — ' || v_label, v_partner);
  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round((v_split->>'amount')::numeric, 2);
    v_tx := public._imports_cash_out((v_split->>'account_id')::uuid, v_amount, 'Təchizatçıya avans — ' || v_label, v_s.id, 'import_prepayment', v_prep);
    v_tx_ids := v_tx_ids || v_tx;
    v_lines := v_lines || public._imports_line(public._imports_cash_coa((v_split->>'account_id')::uuid), -v_amount, v_label, NULL, (v_split->>'account_id')::uuid);
    IF v_partner IS NOT NULL THEN
      SELECT type INTO v_account FROM public.accounts WHERE id = (v_split->>'account_id')::uuid;
      INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, transaction_id, idempotency_key, created_by)
      VALUES (COALESCE(public.document_timestamp(), NOW()), v_partner, v_amount, 'out',
              CASE WHEN COALESCE(v_account.type, '') ILIKE '%bank%' THEN 'bank' ELSE 'cash' END,
              'Təchizatçıya avans — ' || v_label, (v_split->>'account_id')::uuid, v_tx,
              'import_prepayment:' || v_prep::text || ':' || v_tx::text, auth.uid())
      RETURNING id INTO v_tx;
      v_payment_ids := v_payment_ids || v_tx;
    END IF;
  END LOOP;

  v_journal := public.create_journal_entry(jsonb_build_object(
    'document_type', 'import_prepayment',
    'document_id', p_shipment_id,
    'idempotency_key', 'import_prepayment:' || v_prep::text,
    'entry_date', v_date,
    'description', format('İdxal %s: təchizatçıya avans %s %s × %s', v_s.number, v_fc, v_s.currency_code, v_rate),
    'lines', v_lines
  ));
  UPDATE public.import_prepayments SET journal_entry_id = v_journal WHERE id = v_prep;
  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = ANY (v_tx_ids);
  UPDATE public.payments SET journal_entry_id = v_journal WHERE id = ANY (v_payment_ids);
  PERFORM public.use_document_date(NULL);

  RETURN public._imports_op_put(p_idempotency_key, 'prepay', p_shipment_id, jsonb_build_object(
    'success', true, 'prepayment_id', v_prep, 'journal_entry_id', v_journal, 'amount_azn', v_total, 'amount_fc', v_fc));
END;
$$;

-- A cancelled shipment's prepayments are reversed with its cash (reverse_document_cash_transactions
-- in cancel_import_shipment); mark them so they are not applied again.
CREATE OR REPLACE FUNCTION public._imports_prepayments_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.import_prepayments SET status = 'cancelled' WHERE shipment_id = NEW.id AND status <> 'cancelled';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_import_shipments_prepayments_cancel ON public.import_shipments;
CREATE TRIGGER trg_import_shipments_prepayments_cancel AFTER UPDATE OF status ON public.import_shipments
  FOR EACH ROW EXECUTE FUNCTION public._imports_prepayments_cancel();

-- ─── 6. Grants ──────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._imports_line_landed(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_prepayments_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_import_shipment(UUID, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_import_payable(UUID, DATE, TEXT, JSONB, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepay_import_supplier(UUID, DATE, TEXT, NUMERIC, NUMERIC, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_import_shipment(UUID, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pay_import_payable(UUID, DATE, TEXT, JSONB, TEXT, NUMERIC, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepay_import_supplier(UUID, DATE, TEXT, NUMERIC, NUMERIC, JSONB, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
