-- ============================================================================
-- Backdated invoices and payments; admin edit of posted invoices (fix F1).
--
-- 1. Document date. A posting function calls public.use_document_date(doc_date) once;
--    until the transaction ends (or it is cleared) every journal entry, cash transaction,
--    stock movement and FIFO layer/consumption created gets that date, with the current
--    time of day (Asia/Baku) so ordering within the day stays stable. A document dated
--    today changes nothing: document_timestamp() is NULL and the columns keep their
--    defaults. One helper, applied by BEFORE INSERT triggers, instead of passing a date
--    through every function.
-- 2. Sales and purchase posting (post_*_invoice_draft, process_sales_invoice_event,
--    process_purchase_receipt_event) set it. Payments entered inside the invoice form use
--    their own date (default: the invoice date, never earlier, never in the future).
-- 3. process_invoice_payment_event (three-dot menu payment) refuses a date before the
--    invoice date.
-- 4. amend_posted_sales_invoice / amend_posted_purchase_invoice: admins only (or a role
--    granted can_edit_posted_sales / can_edit_posted_purchases). One transaction:
--    reverse the old version like cancel_*_invoice_atomic does (shared helper, cash kept),
--    save the new lines, post again with the new date. Same id and number; payments stay.
--    History in invoice_amendments, the invoice chatter and erp_events.
-- 5. purchases.doc_date / purchases.warehouse_id are added when missing: the purchase RPCs
--    already write them, but a database built from the production snapshot lacks them.
--
-- Existing invoices are not re-dated. Safe to re-run.
-- ============================================================================

-- ─── 1. Columns and history ─────────────────────────────────────────────────

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS doc_date DATE;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;
UPDATE public.purchases SET doc_date = COALESCE((created_at AT TIME ZONE 'Asia/Baku')::date, CURRENT_DATE) WHERE doc_date IS NULL;
ALTER TABLE public.purchases ALTER COLUMN doc_date SET DEFAULT CURRENT_DATE;
-- Also written by save_purchase_invoice_draft / process_purchase_receipt_event (and two sales
-- functions) but missing from the production catalog snapshot (supabase/baseline, 2026-10-06).
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- purchase_items belongs to the purchases module (supabase/modules): only where it is installed.
DO $guard$
BEGIN
  IF to_regclass('public.purchase_items') IS NOT NULL THEN
    ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS product_code TEXT;
    ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS product_name TEXT;
    ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS unit TEXT;
  END IF;
END;
$guard$;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

-- Bumped by each admin amendment; posting keys its journals with it so a re-post is not
-- taken for the reversed original (create_journal_entry is idempotent per key).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS amend_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS amend_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.invoice_amendments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type IN ('sale', 'purchase')),
  document_id   UUID NOT NULL,
  revision      INTEGER NOT NULL,
  reason        TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  old_values    JSONB NOT NULL,
  new_values    JSONB NOT NULL,
  amended_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amended_by_name TEXT,
  amended_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_amendments_document
  ON public.invoice_amendments (document_type, document_id, amended_at DESC);

ALTER TABLE public.invoice_amendments ENABLE ROW LEVEL SECURITY;
-- Read with the document; written only by the amend functions (security definer).
DROP POLICY IF EXISTS invoice_amendments_select ON public.invoice_amendments;
CREATE POLICY invoice_amendments_select ON public.invoice_amendments
  FOR SELECT TO authenticated
  USING (
    public.user_is_admin()
    OR (document_type = 'sale' AND public.has_permission('can_view_sales'))
    OR (document_type = 'purchase' AND public.has_permission('can_view_purchases'))
  );
REVOKE ALL ON public.invoice_amendments FROM anon;
GRANT SELECT ON public.invoice_amendments TO authenticated;
GRANT ALL ON public.invoice_amendments TO service_role;

-- ─── 2. The document date ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.document_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Baku')::date;
$$;

-- Sets (or with NULL clears) the date of the document being posted, for the rest of the
-- transaction. A closed accounting period is refused here with a readable message; the
-- journal guard (guard_journal_entry_period) still refuses it as before.
CREATE OR REPLACE FUNCTION public.use_document_date(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_date IS NOT NULL AND public.is_accounting_period_closed(p_date) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
      'Sənəd tarixi (%s) bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
      to_char(p_date, 'DD.MM.YYYY'), to_char(p_date, 'YYYY-MM'));
  END IF;
  PERFORM set_config('app.document_date', COALESCE(p_date::text, ''), true);
END;
$$;

-- The moment a record of the current document is dated: the document date at the current
-- Baku time of day. NULL when no document date is set or it is today (nothing changes).
CREATE OR REPLACE FUNCTION public.document_timestamp()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_raw  TEXT := NULLIF(current_setting('app.document_date', true), '');
  v_date DATE;
BEGIN
  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;
  v_date := v_raw::date;
  IF v_date = public.document_today() THEN
    RETURN NULL;
  END IF;
  RETURN (v_date::timestamp + (NOW() AT TIME ZONE 'Asia/Baku')::time) AT TIME ZONE 'Asia/Baku';
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_document_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ts TIMESTAMPTZ := public.document_timestamp();
BEGIN
  IF v_ts IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'journal_entries' THEN
    NEW.date := v_ts;
    NEW.entry_date := (v_ts AT TIME ZONE 'Asia/Baku')::date;
  ELSIF TG_TABLE_NAME = 'transactions' THEN
    NEW.transaction_date := v_ts;
  ELSE
    NEW.created_at := v_ts;
  END IF;
  RETURN NEW;
END;
$$;

-- "trg_journal_entries_document_date" sorts before "trg_journal_entries_period_guard", so the
-- guard checks the document date.
DROP TRIGGER IF EXISTS trg_journal_entries_document_date ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_document_date BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_document_date();
DROP TRIGGER IF EXISTS trg_transactions_document_date ON public.transactions;
CREATE TRIGGER trg_transactions_document_date BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_document_date();
DROP TRIGGER IF EXISTS trg_stock_movements_document_date ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_document_date BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_document_date();
DROP TRIGGER IF EXISTS trg_inventory_batches_document_date ON public.inventory_batches;
CREATE TRIGGER trg_inventory_batches_document_date BEFORE INSERT ON public.inventory_batches
  FOR EACH ROW EXECUTE FUNCTION public.apply_document_date();
DROP TRIGGER IF EXISTS trg_inventory_batch_consumptions_document_date ON public.inventory_batch_consumptions;
CREATE TRIGGER trg_inventory_batch_consumptions_document_date BEFORE INSERT ON public.inventory_batch_consumptions
  FOR EACH ROW EXECUTE FUNCTION public.apply_document_date();

CREATE OR REPLACE FUNCTION public.assert_payment_not_before_document(p_payment_date DATE, p_document_date DATE)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_payment_date IS NOT NULL AND p_document_date IS NOT NULL AND p_payment_date < p_document_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
      'Ödəniş tarixi (%s) faktura tarixindən (%s) əvvəl ola bilməz',
      to_char(p_payment_date, 'DD.MM.YYYY'), to_char(p_document_date, 'DD.MM.YYYY'));
  END IF;
END;
$$;

-- Date of a payment row entered inside the invoice form: its "date" (or "payment_date"),
-- else the invoice date. Never before the invoice date, never in the future.
CREATE OR REPLACE FUNCTION public.invoice_payment_date(p_payment JSONB, p_document_date DATE)
RETURNS DATE
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_date DATE := COALESCE(NULLIF(trim(p_payment->>'date'), ''), NULLIF(trim(p_payment->>'payment_date'), ''))::date;
BEGIN
  IF v_date IS NULL THEN
    RETURN p_document_date;
  END IF;
  PERFORM public.assert_payment_not_before_document(v_date, p_document_date);
  IF v_date > public.document_today() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş tarixi gələcəkdə ola bilməz';
  END IF;
  RETURN v_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_revision_suffix(p_revision INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(p_revision, 0) > 0 THEN ':r' || p_revision::text ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_amend_in_progress()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.invoice_amend', true) = 'on';
$$;

GRANT EXECUTE ON FUNCTION public.document_today() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.use_document_date(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_document_date(DATE) TO service_role;

-- ─── 3. Paid additional expenses keep their cash during an amendment ────────

CREATE OR REPLACE FUNCTION public.apply_document_additional_expenses(p_expenses jsonb, p_source_type text, p_source_id uuid, p_doc_ref text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp JSONB;
  v_amount NUMERIC;
  v_total NUMERIC := 0;
  v_account_id UUID;
  v_label TEXT;
  v_paid BOOLEAN;
BEGIN
  IF p_expenses IS NULL OR jsonb_typeof(p_expenses) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_exp IN SELECT value FROM jsonb_array_elements(p_expenses)
  LOOP
    v_amount := COALESCE(NULLIF(v_exp->>'amount', '')::numeric, 0);
    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;
    v_total := v_total + v_amount;
    v_paid := COALESCE((v_exp->>'paid_immediately')::boolean, false);
    -- An admin amendment keeps the cash already paid for them (fix F1); only the total counts.
    IF NOT v_paid OR public.invoice_amend_in_progress() THEN
      CONTINUE;
    END IF;

    v_account_id := NULLIF(v_exp->>'account_id', '')::uuid;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'Ödənilən əlavə xərc üçün kassa/bank hesabı seçilməlidir';
    END IF;

    v_label := COALESCE(NULLIF(trim(v_exp->>'label'), ''), 'Əlavə xərc');

    PERFORM public.post_cash_transaction(
      v_account_id,
      'Məxaric',
      v_amount,
      'Əlavə Xərc',
      format('%s — %s', p_doc_ref, v_label),
      NULL,
      p_source_type,
      p_source_id
    );
  END LOOP;

  RETURN v_total;
END;
$function$;

-- ─── 4. Three-dot payment: not before the invoice date ──────────────────────

CREATE OR REPLACE FUNCTION public.process_invoice_payment_event(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_document_type TEXT;
  v_document_id UUID;
  v_amount NUMERIC;
  v_account_id UUID;
  v_method TEXT;
  v_notes TEXT;
  v_payment_id TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_debt_amount NUMERIC;
  v_new_paid NUMERIC;
  v_new_remaining NUMERIC;
  v_new_debt NUMERIC;
  v_customer_id UUID;
  v_supplier_id UUID;
  v_doc_label TEXT;
  v_payments JSONB;
  v_new_payment JSONB;
  v_status TEXT;
  v_tx_id UUID;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_event_type TEXT;
  v_source_table TEXT;
  v_payment_date DATE;
  v_doc_date DATE;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödəniş event payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  v_document_type := lower(trim(COALESCE(p_payload->>'document_type', '')));
  v_document_id := NULLIF(p_payload->>'document_id', '')::uuid;
  v_amount := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  v_account_id := NULLIF(p_payload->>'account_id', '')::uuid;
  v_method := COALESCE(NULLIF(trim(p_payload->>'method'), ''), 'Ödəniş');
  v_notes := NULLIF(trim(p_payload->>'notes'), '');
  v_payment_id := COALESCE(NULLIF(trim(p_payload->>'payment_id'), ''), gen_random_uuid()::text);
  -- Optional payment date (YYYY-MM-DD). The customer may have paid days earlier.
  v_payment_date := COALESCE(NULLIF(trim(p_payload->>'payment_date'), '')::date, public.document_today());

  IF v_payment_date > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş tarixi gələcəkdə ola bilməz';
  END IF;

  IF v_document_id IS NULL THEN
    RAISE EXCEPTION 'document_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd identifikatoru tələb olunur';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank hesabı seçilməlidir';
  END IF;

  PERFORM id FROM accounts WHERE id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
  END IF;

  IF v_document_type = 'sale' THEN
    IF NOT (
      public.require_permission('can_edit_sales')
      OR public.require_permission('can_create_invoice')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'Satış ödənişi üçün icazəniz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, remaining_balance, customer_id, doc_no, payments, doc_date
    INTO v_total_amount, v_paid_amount, v_remaining, v_customer_id, v_doc_label, v_payments, v_doc_date
    FROM sales
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Satış fakturası tapılmadı';
    END IF;

    PERFORM public.assert_payment_not_before_document(v_payment_date, v_doc_date);

    v_total_amount := COALESCE(v_total_amount, 0);
    v_paid_amount := COALESCE(v_paid_amount, 0);
    v_remaining := GREATEST(COALESCE(v_remaining, v_total_amount - v_paid_amount), 0);

    IF v_amount > v_remaining + 0.0001 THEN
      RAISE EXCEPTION 'overpayment'
        USING ERRCODE = '22023',
              MESSAGE = format('Qalan borc: %s AZN', trim(to_char(v_remaining, 'FM999999990.00')));
    END IF;

    v_new_paid := v_paid_amount + v_amount;
    v_new_remaining := GREATEST(v_total_amount - v_new_paid, 0);

    v_new_payment := jsonb_build_object(
      'id', v_payment_id,
      'account_id', v_account_id::text,
      'method', v_method,
      'amount', v_amount,
      'date', v_payment_date::text
    );
    v_payments := COALESCE(v_payments, '[]'::jsonb) || jsonb_build_array(v_new_payment);

    UPDATE sales
    SET paid_amount = v_new_paid,
        remaining_balance = v_new_remaining,
        payments = v_payments
    WHERE id = v_document_id;

    PERFORM public.use_document_date(v_payment_date);
    v_tx_id := public.post_cash_transaction(
      v_account_id,
      'Mədaxil',
      v_amount,
      'Satış Ödənişi',
      COALESCE(v_notes, format('Satış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
      NULL,
      'sale',
      v_document_id
    );

    SELECT journal_entry_id INTO v_journal_id
    FROM transactions
    WHERE id = v_tx_id;

    PERFORM public.use_document_date(NULL);

    IF v_customer_id IS NOT NULL THEN
      PERFORM public.refresh_customer_ar_balance(v_customer_id);
    END IF;

    v_event_type := 'invoice_payment_sale';
    v_source_table := 'sales';

    v_result := jsonb_build_object(
      'success', true,
      'event_type', v_event_type,
      'document_type', 'sale',
      'document_id', v_document_id,
      'transaction_id', v_tx_id,
      'journal_entry_id', v_journal_id,
      'paid_amount', v_new_paid,
      'remaining_balance', v_new_remaining
    );
  ELSIF v_document_type = 'purchase' THEN
    IF NOT (
      public.require_permission('can_edit_purchases')
      OR public.require_permission('can_create_purchase')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'Alış ödənişi üçün icazəniz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, debt_amount, supplier_id, invoice_number, doc_date
    INTO v_total_amount, v_paid_amount, v_debt_amount, v_supplier_id, v_doc_label, v_doc_date
    FROM purchases
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Alış fakturası tapılmadı';
    END IF;

    PERFORM public.assert_payment_not_before_document(v_payment_date, v_doc_date);

    v_total_amount := COALESCE(v_total_amount, 0);
    v_paid_amount := COALESCE(v_paid_amount, 0);
    v_debt_amount := GREATEST(COALESCE(v_debt_amount, v_total_amount - v_paid_amount), 0);

    IF v_amount > v_debt_amount + 0.0001 THEN
      RAISE EXCEPTION 'overpayment'
        USING ERRCODE = '22023',
              MESSAGE = format('Qalan borc: %s AZN', trim(to_char(v_debt_amount, 'FM999999990.00')));
    END IF;

    v_new_paid := v_paid_amount + v_amount;
    v_new_debt := GREATEST(v_total_amount - v_new_paid, 0);
    v_status := CASE WHEN v_new_debt > 0.0001 THEN 'Borclu' ELSE 'Ödənilib' END;

    UPDATE purchases
    SET paid_amount = v_new_paid,
        debt_amount = v_new_debt
    WHERE id = v_document_id;

    PERFORM public.use_document_date(v_payment_date);
    v_tx_id := public.post_cash_transaction(
      v_account_id,
      'Məxaric',
      v_amount,
      'Alış Ödənişi',
      COALESCE(v_notes, format('Alış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
      NULL,
      'purchase',
      v_document_id
    );

    SELECT journal_entry_id INTO v_journal_id
    FROM transactions
    WHERE id = v_tx_id;

    PERFORM public.use_document_date(NULL);

    IF v_supplier_id IS NOT NULL THEN
      PERFORM public.refresh_supplier_ap_balance(v_supplier_id);
    END IF;

    v_event_type := 'invoice_payment_purchase';
    v_source_table := 'purchases';

    v_result := jsonb_build_object(
      'success', true,
      'event_type', v_event_type,
      'document_type', 'purchase',
      'document_id', v_document_id,
      'transaction_id', v_tx_id,
      'journal_entry_id', v_journal_id,
      'paid_amount', v_new_paid,
      'debt_amount', v_new_debt,
      'status', v_status
    );
  ELSE
    RAISE EXCEPTION 'invalid_document_type'
      USING ERRCODE = '22023',
            MESSAGE = 'document_type «sale» və ya «purchase» olmalıdır';
  END IF;

  v_event_id := public.log_erp_event(
    v_event_type,
    v_source_table,
    v_document_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_invoice_payment_event(JSONB) TO authenticated;

-- ─── 4b. Customer and supplier payments: the journal gets the payment date ──

CREATE OR REPLACE FUNCTION public.create_partner_payment(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_idempotency TEXT;
  v_existing public.payments%ROWTYPE;
  v_partner_id UUID;
  v_amount NUMERIC;
  v_payment_type TEXT;
  v_payment_method TEXT;
  v_payment_date TIMESTAMPTZ;
  v_reference_note TEXT;
  v_cash_account_id UUID;
  v_balance NUMERIC;
  v_payment_id UUID;
  v_tx_id UUID;
  v_journal_id UUID;
  v_tx_type TEXT;
  v_category TEXT;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş payload tələb olunur';
  END IF;

  IF NOT public.require_permission('can_manage_finance') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501', MESSAGE = 'Maliyyə əməliyyatı üçün icazəniz yoxdur';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.payments
    WHERE idempotency_key = v_idempotency
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_existing.id,
        'journal_entry_id', v_existing.journal_entry_id,
        'transaction_id', v_existing.transaction_id,
        'idempotent', true
      );
    END IF;
  END IF;

  v_partner_id := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_amount := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  v_payment_type := lower(trim(COALESCE(p_payload->>'payment_type', '')));
  v_payment_method := lower(trim(COALESCE(p_payload->>'payment_method', 'cash')));
  v_payment_date := COALESCE(NULLIF(p_payload->>'payment_date', '')::timestamptz, NOW());
  v_reference_note := NULLIF(trim(p_payload->>'reference_note'), '');
  v_cash_account_id := NULLIF(p_payload->>'cash_account_id', '')::uuid;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçilməlidir';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  IF v_payment_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_type «in» və ya «out» olmalıdır';
  END IF;

  IF v_payment_method NOT IN ('cash', 'bank') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_method «cash» və ya «bank» olmalıdır';
  END IF;

  PERFORM id FROM public.partners WHERE id = v_partner_id AND is_deleted = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Tərəfdaş tapılmadı';
  END IF;

  IF v_cash_account_id IS NULL THEN
    v_cash_account_id := public.resolve_default_cash_account_id(v_payment_method);
  END IF;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  SELECT balance INTO v_balance
  FROM public.accounts
  WHERE id = v_cash_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  IF v_payment_type = 'out' AND COALESCE(v_balance, 0) + 0.0001 < v_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023', MESSAGE = 'Hesab balansı kifayət etmir';
  END IF;

  INSERT INTO public.payments (
    payment_date,
    partner_id,
    amount,
    payment_type,
    payment_method,
    reference_note,
    cash_account_id,
    idempotency_key,
    created_by
  )
  VALUES (
    v_payment_date,
    v_partner_id,
    v_amount,
    v_payment_type,
    v_payment_method,
    v_reference_note,
    v_cash_account_id,
    v_idempotency,
    auth.uid()
  )
  RETURNING id INTO v_payment_id;

  v_tx_type := CASE WHEN v_payment_type = 'in' THEN 'Mədaxil' ELSE 'Məxaric' END;
  v_category := CASE
    WHEN v_payment_type = 'in' THEN 'Tərəfdaşdan mədaxil'
    ELSE 'Tərəfdaşa məxaric'
  END;

  INSERT INTO public.transactions (
    account_id,
    amount,
    type,
    unified_type,
    category,
    notes,
    description,
    transaction_date,
    created_at,
    reference_type,
    reference_id,
    source_type,
    source_id
  )
  VALUES (
    v_cash_account_id,
    v_amount,
    v_tx_type,
    CASE WHEN v_payment_type = 'in' THEN 'INCOME' ELSE 'EXPENSE' END,
    v_category,
    COALESCE(v_reference_note, v_category),
    COALESCE(v_reference_note, v_category),
    v_payment_date,
    NOW(),
    'partner_payment',
    v_payment_id,
    'partner_payment',
    v_payment_id
  )
  RETURNING id INTO v_tx_id;

  IF v_payment_type = 'in' THEN
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) + v_amount
    WHERE id = v_cash_account_id;
  ELSE
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) - v_amount
    WHERE id = v_cash_account_id;
  END IF;

  PERFORM public.use_document_date((v_payment_date AT TIME ZONE 'Asia/Baku')::date);
  v_journal_id := public.post_partner_payment_gl_journal(
    v_payment_id,
    v_partner_id,
    v_amount,
    v_payment_type,
    v_payment_method,
    v_cash_account_id,
    v_reference_note
  );

  PERFORM public.use_document_date(NULL);

  UPDATE public.payments
  SET journal_entry_id = v_journal_id,
      transaction_id = v_tx_id
  WHERE id = v_payment_id;

  UPDATE public.transactions
  SET journal_entry_id = v_journal_id
  WHERE id = v_tx_id;

  PERFORM public.refresh_partner_linked_balances(v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'journal_entry_id', v_journal_id,
    'transaction_id', v_tx_id
  );
END;
$function$;

-- ─── 5. History helpers ─────────────────────────────────────────────────────

-- Payments of a document dated before p_date ("12.10.2026: 50.00 AZN, ..."), NULL when none.
CREATE OR REPLACE FUNCTION public._invoice_payments_before(p_source_type TEXT, p_document_id UUID, p_date DATE)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT string_agg(
           format('%s: %s AZN', to_char((COALESCE(t.transaction_date, t.created_at) AT TIME ZONE 'Asia/Baku')::date, 'DD.MM.YYYY'),
                  trim(to_char(t.amount, 'FM999999990.00'))),
           ', ' ORDER BY COALESCE(t.transaction_date, t.created_at))
  FROM public.transactions t
  WHERE t.source_type = p_source_type
    AND t.source_id = p_document_id
    AND t.category IN ('Satış Ödənişi', 'Alış Ödənişi')
    AND COALESCE(t.reference_type, '') <> 'storno'
    AND NOT EXISTS (SELECT 1 FROM public.transactions s WHERE s.reference_type = 'storno' AND s.reference_id = t.id)
    AND (COALESCE(t.transaction_date, t.created_at) AT TIME ZONE 'Asia/Baku')::date < p_date;
$$;

CREATE OR REPLACE FUNCTION public._invoice_amendment_log(
  p_document_type TEXT, p_document_id UUID, p_revision INTEGER, p_reason TEXT, p_old JSONB, p_new JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := (SELECT full_name FROM public.profiles WHERE id = auth.uid());
BEGIN
  INSERT INTO public.invoice_amendments (document_type, document_id, revision, reason, old_values, new_values, amended_by, amended_by_name)
  VALUES (p_document_type, p_document_id, p_revision, p_reason, p_old, p_new, auth.uid(), v_name);

  IF to_regclass('public.mail_messages') IS NOT NULL THEN
    EXECUTE
      'INSERT INTO public.mail_messages (res_model, res_id, kind, body, author_id, author_name)
       VALUES ($1, $2, ''log'', $3, $4, $5)'
    USING CASE WHEN p_document_type = 'sale' THEN 'sales' ELSE 'purchases' END,
          p_document_id,
          format('Təsdiqlənmiş faktura dəyişdirildi (versiya %s): %s. Tarix %s → %s, məbləğ %s → %s',
                 p_revision, p_reason, p_old->>'doc_date', p_new->>'doc_date', p_old->>'total_amount', p_new->>'total_amount'),
          auth.uid(), v_name;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._invoice_payments_before(TEXT, UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._invoice_amendment_log(TEXT, UUID, INTEGER, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- ─── 6. Sales (module functions: only where the sales module is installed) ──

DO $guard$
BEGIN
  IF to_regprocedure('public.post_sales_invoice_draft(uuid)') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fn$
-- Reverses the stock, FIFO, cash (unless p_keep_cash) and journals of a posted sales invoice.
-- Shared by cancel_sales_invoice_atomic and amend_posted_sales_invoice; the caller locks the
-- invoice, checks permissions and sets the final status.
CREATE OR REPLACE FUNCTION public._reverse_sales_invoice_posting(
  p_sale_id uuid, p_label text, p_reason text, p_keep_cash boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label    TEXT := p_label;
  v_reason   TEXT := p_reason;
  v_line     RECORD;
  v_demand   JSONB := '{}'::jsonb;
  v_key      TEXT;
  v_units    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  -- 1. Stock lines (not dimensional, not services): give the quantity back,
  --    exploding kits through their BOM exactly as posting did.
  FOR v_line IN
    SELECT si.id, si.product_id, si.quantity, si.warehouse_id, si.unit, p.name AS product_name
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
      AND COALESCE(si.quantity, 0) > 0
      AND NULLIF(btrim(si.polywood_sale_mode), '') IS NULL
      AND COALESCE(si.sale_item_type, 'standard') <> 'service'
      AND NOT COALESCE(p.is_service, false)
  LOOP
    v_demand := public.merge_stock_demand(v_demand, v_line.product_id, v_line.quantity);

    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, source_line_id, description, created_by
    )
    VALUES (
      v_line.product_id, v_line.warehouse_id, 'in', v_line.quantity,
      COALESCE(v_line.unit, 'Ədəd'), 'sale_void', p_sale_id, v_line.id,
      format('Ləğv: satış fakturası %s — %s', v_label, COALESCE(v_line.product_name, '')),
      auth.uid()
    );
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_demand)
  LOOP
    UPDATE public.products
    SET stock = COALESCE(stock, 0) + (v_demand->>v_key)::numeric
    WHERE id = v_key::uuid;
  END LOOP;

  -- 2. Dimensional (Polywood) lines: put the cut pieces back.
  FOR v_line IN
    SELECT si.*, COALESCE(p.full_sheet_length_m, p.base_length, 4) AS sheet_length_m
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
      AND NULLIF(btrim(si.polywood_sale_mode), '') IS NOT NULL
  LOOP
    IF v_line.polywood_cut_details IS NOT NULL THEN
      PERFORM public.rollback_mixed_dimensional_sale(v_line.id);
      IF v_line.warehouse_id IS NOT NULL THEN
        UPDATE public.products
        SET stock = (
          SELECT COALESCE(SUM(length_m), 0)
          FROM public.polywood_pieces
          WHERE product_id = v_line.product_id
            AND warehouse_id = v_line.warehouse_id
            AND status = 'available'
        )
        WHERE id = v_line.product_id;
      END IF;
    ELSE
      -- Sold before piece tracking: restore the metres.
      v_units := CASE
        WHEN v_line.polywood_sale_mode = 'full_sheet'
          THEN COALESCE(v_line.quantity, 0) * v_line.sheet_length_m
        WHEN v_line.sale_item_type = 'dimensional'
          THEN COALESCE(v_line.polywood_length_m, v_line.quantity, 0) * GREATEST(COALESCE(v_line.piece_count, 1), 1)
        ELSE COALESCE(v_line.polywood_length_m, v_line.quantity, 0)
      END;
      IF v_units > 0 THEN
        UPDATE public.products SET stock = COALESCE(stock, 0) + v_units WHERE id = v_line.product_id;
      END IF;
    END IF;
  END LOOP;

  -- 3. FIFO: give consumed quantities back to their layers.
  UPDATE public.inventory_batches b
  SET remaining_qty = b.remaining_qty + c.qty
  FROM (
    SELECT batch_id, SUM(quantity) AS qty
    FROM public.inventory_batch_consumptions
    WHERE sale_id = p_sale_id AND batch_id IS NOT NULL
    GROUP BY batch_id
  ) c
  WHERE b.id = c.batch_id;

  DELETE FROM public.inventory_batch_consumptions WHERE sale_id = p_sale_id;
  UPDATE public.sale_items SET cogs_amount = 0 WHERE sale_id = p_sale_id;

  -- 4. Cash received for the invoice (and paid additional expenses).
  IF NOT p_keep_cash THEN
    v_cash := public.reverse_document_cash_transactions('sale', p_sale_id, v_label, v_reason);
  END IF;

  -- 5. Pending warehouse slips for the invoice are void with it.
  DELETE FROM public.warehouse_slips
  WHERE source_type = 'sale' AND source_document_id = p_sale_id;

  -- 6. Invoice and COGS journals.
  v_journals := public.reverse_document_journals(p_sale_id, v_reason);

  RETURN jsonb_build_object('cash_reversed', v_cash, 'journals_reversed', v_journals);
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.cancel_sales_invoice_atomic(p_sale_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale     public.sales%ROWTYPE;
  v_label    TEXT;
  v_reason   TEXT;
  v_line     RECORD;
  v_demand   JSONB := '{}'::jsonb;
  v_key      TEXT;
  v_units    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
  v_rev      JSONB;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Satış ID göndərilməyib';
  END IF;

  IF NOT (public.require_permission('can_delete_sales')
          OR public.require_permission('can_edit_sales')) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501', MESSAGE = 'Satış ləğvi üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Satış fakturası tapılmadı';
  END IF;

  v_label := COALESCE(NULLIF(trim(v_sale.doc_no), ''), NULLIF(trim(v_sale.invoice_number), ''), p_sale_id::text);
  v_reason := COALESCE(NULLIF(trim(p_reason), ''), format('Satış fakturası %s ləğv edildi', v_label));

  IF v_sale.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s artıq ləğv edilib', v_label);
  END IF;

  -- A draft never moved stock, cash or the ledger.
  IF v_sale.status = 'draft' THEN
    UPDATE public.sales SET status = 'cancelled', remaining_balance = 0 WHERE id = p_sale_id;
    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'doc_no', v_label,
                              'was', 'draft');
  END IF;

  v_rev := public._reverse_sales_invoice_posting(p_sale_id, v_label, v_reason, false);
  v_cash := (v_rev->>'cash_reversed')::int;
  v_journals := (v_rev->>'journals_reversed')::int;

  UPDATE public.sales
  SET status = 'cancelled',
      remaining_balance = 0,
      total_cogs = 0
  WHERE id = p_sale_id;

  PERFORM public.refresh_customer_ar_balance(v_sale.customer_id);

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', p_sale_id,
    'doc_no', v_label,
    'was', 'posted',
    'cash_reversed', v_cash,
    'journals_reversed', v_journals
  );
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.post_sales_invoice_draft(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale RECORD;
  v_items JSONB := '[]'::jsonb;
  v_payments JSONB;
  v_stock_demand JSONB := '{}'::jsonb;
  v_pay JSONB;
  v_pay_amount NUMERIC;
  v_account_id UUID;
  v_pay_method TEXT;
  v_journal_id UUID;
  v_cogs_result JSONB;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_add_exp_total NUMERIC;
  v_idempotency TEXT;
  v_result JSONB;
  v_event_id UUID;
  v_pay_date DATE;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış ID göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış təsdiqləmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Satış sənədi tapılmadı';
  END IF;

  -- Every record of this posting carries the invoice date (fix F1).
  PERFORM public.use_document_date(v_sale.doc_date);

  IF v_sale.status = 'posted' THEN
    RAISE EXCEPTION 'already_posted'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd artıq təsdiqlənib';
  END IF;

  IF v_sale.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION 'cancelled_document'
      USING ERRCODE = '22023',
            MESSAGE = 'Ləğv edilmiş sənəd təsdiqlənə bilməz';
  END IF;

  IF COALESCE(v_sale.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF COALESCE(v_sale.paid_amount, 0) > COALESCE(v_sale.total_amount, 0) + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  SELECT COALESCE(jsonb_agg(item_json ORDER BY ord), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      row_number() OVER (ORDER BY id) AS ord,
      jsonb_build_object(
        'product_id', product_id,
        'quantity', quantity,
        'warehouse_id', warehouse_id,
        'polywood_sale_mode', polywood_sale_mode,
        'polywood_length_m', polywood_length_m,
        'skip_stock', (polywood_sale_mode IS NOT NULL AND btrim(polywood_sale_mode) <> '')
      ) AS item_json
    FROM sale_items
    WHERE sale_id = p_sale_id
  ) lined;

  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  -- Stock deduction is handled by trg_sales_posted_inventory when status becomes posted.
  -- Pre-validate demand so posting fails before side effects if stock is insufficient.
  PERFORM public.build_and_validate_sale_stock_demand(v_items);

  v_idempotency := 'sale_invoice:' || p_sale_id::text || public.invoice_revision_suffix(v_sale.amend_revision);
  v_cogs_result := public.process_sale_fifo_cogs(
    p_sale_id,
    v_sale.doc_no,
    v_idempotency || ':cogs'
  );
  v_total_cogs := COALESCE((v_cogs_result->>'total_cogs')::numeric, 0);
  v_cogs_journal_id := NULLIF(v_cogs_result->>'cogs_journal_entry_id', '')::uuid;

  v_payments := COALESCE(v_sale.payments, '[]'::jsonb);
  -- An admin amendment keeps the payments already booked (fix F1).
  IF public.invoice_amend_in_progress() THEN
    v_payments := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;

      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');
      v_pay_date := public.invoice_payment_date(v_pay, v_sale.doc_date);
      PERFORM public.use_document_date(v_pay_date);
      PERFORM public.post_cash_transaction(
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_sale.doc_no, v_pay_method),
        NULL,
        'sale',
        p_sale_id
      );
      PERFORM public.use_document_date(v_sale.doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(v_sale.additional_expenses, '[]'::jsonb),
    'sale',
    p_sale_id,
    v_sale.doc_no
  );

  v_journal_id := public.post_sale_invoice_gl_journal(
    p_sale_id,
    v_sale.doc_no,
    v_sale.total_amount,
    v_sale.customer_id,
    v_idempotency
  );

  UPDATE sales
  SET status = 'posted',
      posted_at = NOW(),
      additional_expenses_total = v_add_exp_total
  WHERE id = p_sale_id;

  PERFORM public.refresh_customer_ar_balance(v_sale.customer_id);

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice_post',
    'sale_id', p_sale_id,
    'doc_no', v_sale.doc_no,
    'status', 'posted',
    'journal_entry_id', v_journal_id,
    'cogs_journal_entry_id', v_cogs_journal_id,
    'total_cogs', v_total_cogs,
    'total_amount', v_sale.total_amount,
    'paid_amount', v_sale.paid_amount,
    'remaining_balance', v_sale.remaining_balance
  );

  -- log_erp_event takes seven arguments:
  --   (p_event_type TEXT, p_source_table TEXT, p_source_id UUID, p_payload JSONB,
  --    p_journal_entry_id UUID, p_idempotency_key TEXT, p_result JSONB)
  -- The phase-4 rewrite passed six in the wrong order, so every attempt to post a
  -- sales invoice failed with:
  --   function public.log_erp_event(unknown, unknown, uuid, unknown, jsonb, uuid) does not exist
  -- PL/pgSQL resolves the call only when it runs, which is why this shipped.
  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    p_sale_id,
    jsonb_build_object('sale_id', p_sale_id, 'posted_from', 'draft', 'posted_by', auth.uid()),
    COALESCE(v_cogs_journal_id, v_journal_id),
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_sales_invoice_event(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_date DATE;
  v_pay_date DATE;
  v_idempotency TEXT;
  v_cached JSONB;
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_decrement_stock BOOLEAN := true;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_sale_id UUID;
  v_doc_no TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_pay_method TEXT;
  v_skip_stock BOOLEAN;
  v_polywood_mode TEXT;
  v_polywood_sale_mode TEXT;
  v_polywood_length_m NUMERIC;
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_cogs_result JSONB;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış event payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azı bir satış sətri tələb olunur';
  END IF;

  IF (p_payload ? 'decrement_stock') THEN
    v_decrement_stock := COALESCE((p_payload->>'decrement_stock')::boolean, true);
  END IF;

  v_customer_id := NULLIF(v_header->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Müştəri seçilməlidir';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(name), ''), NULLIF(trim(company_name), ''), '')
  INTO v_customer_name
  FROM customers
  WHERE id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Müştəri tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_remaining := GREATEST(
    COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, v_total_amount - v_paid_amount),
    0
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  IF v_decrement_stock THEN
    v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
  END IF;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
  IF v_doc_no IS NULL THEN
    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;
  END IF;

  INSERT INTO sales (
    doc_no, invoice_number, doc_date, customer_id, customer_name,
    seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
    total_amount, paid_amount, remaining_balance, delivery_address, delivery_type,
    delivery_fee, note, notes, payments, created_at
  )
  VALUES (
    v_doc_no,
    COALESCE(NULLIF(trim(v_header->>'invoice_number'), ''), v_doc_no),
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    v_customer_id,
    COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
    NULLIF(v_header->>'seller_id', '')::uuid,
    NULLIF(trim(v_header->>'seller_name'), ''),
    NULLIF(trim(v_header->>'warehouse_name'), ''),
    COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
    v_total_amount,
    v_paid_amount,
    v_remaining,
    NULLIF(trim(v_header->>'delivery_address'), ''),
    COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
    COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
    NULLIF(trim(v_header->>'note'), ''),
    NULLIF(trim(v_header->>'notes'), ''),
    COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
    COALESCE(NULLIF(v_header->>'created_at', '')::timestamptz, NOW())
  )
  RETURNING id INTO v_sale_id;

  -- Every record of this posting carries the invoice date (fix F1).
  v_doc_date := COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE);
  PERFORM public.use_document_date(v_doc_date);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_polywood_sale_mode := CASE
      WHEN v_item ? 'polywood_sale_mode'
      THEN NULLIF(trim(v_item->>'polywood_sale_mode'), '')
      ELSE NULL
    END;

    v_polywood_length_m := NULL;
    IF v_item ? 'polywood_length_m' THEN
      BEGIN
        v_polywood_length_m := NULLIF(trim(v_item->>'polywood_length_m'), '')::numeric;
      EXCEPTION
        WHEN OTHERS THEN
          v_polywood_length_m := NULL;
      END;
    END IF;

    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name, warehouse_id, warehouse_name,
      quantity, unit, unit_price, discount_percent, vat_rate, line_total, extra_info,
      polywood_sale_mode, polywood_length_m
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      NULLIF(v_item->>'warehouse_id', '')::uuid,
      NULLIF(trim(v_item->>'warehouse_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ædəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'discount_percent', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'vat_rate', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'line_total', '')::numeric, NULLIF(v_item->>'total', '')::numeric, 0),
      NULLIF(trim(v_item->>'extra_info'), ''),
      v_polywood_sale_mode,
      v_polywood_length_m
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || jsonb_build_array(
      jsonb_build_object(
        'index', v_idx,
        'id', v_item_id,
        'product_id', NULLIF(v_item->>'product_id', '')::uuid,
        'polywood_sale_mode', v_polywood_sale_mode
      )
    );
    v_idx := v_idx + 1;
  END LOOP;

  IF v_decrement_stock THEN
    PERFORM public.apply_sale_stock_decrement(v_stock_demand);

    v_cogs_result := public.process_sale_fifo_cogs(
      v_sale_id,
      v_doc_no,
      COALESCE(v_idempotency, 'sale_invoice:' || v_sale_id::text) || ':cogs'
    );
    v_total_cogs := COALESCE((v_cogs_result->>'total_cogs')::numeric, 0);
    v_cogs_journal_id := NULLIF(v_cogs_result->>'cogs_journal_entry_id', '')::uuid;
  END IF;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');
      v_pay_date := public.invoice_payment_date(v_pay, v_doc_date);
      PERFORM public.use_document_date(v_pay_date);

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_doc_no, v_pay_method),
        NULL,
        'sale',
        v_sale_id
      );
      PERFORM public.use_document_date(v_doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
    'sale',
    v_sale_id,
    v_doc_no
  );

  UPDATE sales
  SET additional_expenses = COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
      additional_expenses_total = v_add_exp_total
  WHERE id = v_sale_id;

  v_journal_id := public.post_sale_invoice_gl_journal(
    v_sale_id,
    v_doc_no,
    v_total_amount,
    v_customer_id,
    v_idempotency
  );

  PERFORM public.refresh_customer_ar_balance(v_customer_id);

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice',
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'items', v_item_ids,
    'journal_entry_id', v_journal_id,
    'cogs_journal_entry_id', v_cogs_journal_id,
    'total_cogs', v_total_cogs,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'remaining_balance', v_remaining
  );

  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    v_sale_id,
    p_payload,
    COALESCE(v_cogs_journal_id, v_journal_id),
    v_idempotency,
    v_result
  );

  v_result := v_result || jsonb_build_object('event_id', v_event_id);
  RETURN v_result;
END;
$function$;
  $fn$;

  EXECUTE $fn$
  -- Admins (or a role granted can_edit_posted_sales) change a posted sales invoice: the old
  -- version is reversed (stock, FIFO, journals; payments stay), the new one is saved and
  -- posted with its own date. Same id and number. One transaction.
  CREATE OR REPLACE FUNCTION public.amend_posted_sales_invoice(p_sale_id uuid, p_payload jsonb, p_reason text)
   RETURNS jsonb
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_sale     public.sales%ROWTYPE;
    v_reason   TEXT := NULLIF(trim(p_reason), '');
    v_label    TEXT;
    v_new_date DATE;
    v_header   JSONB;
    v_payload  JSONB;
    v_total    NUMERIC;
    v_blocking TEXT;
    v_old      JSONB;
    v_new      JSONB;
    v_post     JSONB;
    v_saved    JSONB;
    v_result   JSONB;
  BEGIN
    IF NOT (public.user_is_admin() OR public.has_permission('can_edit_posted_sales')) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Təsdiqlənmiş fakturanı yalnız administrator dəyişə bilər';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dəyişikliyin səbəbi göstərilməlidir';
    END IF;

    SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Satış fakturası tapılmadı';
    END IF;
    IF v_sale.status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Bu yolla yalnız təsdiqlənmiş faktura dəyişdirilir';
    END IF;

    v_label := COALESCE(NULLIF(trim(v_sale.doc_no), ''), p_sale_id::text);
    v_header := COALESCE(p_payload->'header', '{}'::jsonb);
    v_new_date := COALESCE(NULLIF(v_header->>'doc_date', '')::date, v_sale.doc_date, public.document_today());

    -- Old and new date must both be in open periods (use_document_date says which is closed).
    PERFORM public.use_document_date(COALESCE(v_sale.doc_date, public.document_today()));
    PERFORM public.use_document_date(v_new_date);
    PERFORM public.use_document_date(NULL);

    v_blocking := public._invoice_payments_before('sale', p_sale_id, v_new_date);
    IF v_blocking IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'Yeni faktura tarixi (%s) bu ödənişlərdən sonradır: %s. Əvvəlcə tarixi düzəldin və ya ödənişi ləğv edin.',
        to_char(v_new_date, 'DD.MM.YYYY'), v_blocking);
    END IF;

    v_old := jsonb_build_object(
      'doc_date', v_sale.doc_date, 'total_amount', v_sale.total_amount, 'paid_amount', v_sale.paid_amount,
      'customer_id', v_sale.customer_id,
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', si.product_id, 'product_name', si.product_name,
                 'quantity', si.quantity, 'unit_price', si.unit_price, 'line_total', si.line_total) ORDER BY si.id), '[]'::jsonb)
                FROM public.sale_items si WHERE si.sale_id = p_sale_id));

    -- 1. Undo the old version; cash received stays.
    PERFORM public._reverse_sales_invoice_posting(p_sale_id, v_label, format('Düzəliş: %s — %s', v_label, v_reason), true);

    UPDATE public.sales
    SET status = 'draft', inventory_deducted_at = NULL, total_cogs = 0, amend_revision = amend_revision + 1
    WHERE id = p_sale_id;

    -- 2. Save the new version under the same id and number, with the payments it already has.
    v_total := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
    v_header := v_header || jsonb_build_object(
      'id', p_sale_id, 'doc_no', v_sale.doc_no, 'invoice_number', v_sale.invoice_number,
      'paid_amount', COALESCE(v_sale.paid_amount, 0),
      'remaining_balance', GREATEST(v_total - COALESCE(v_sale.paid_amount, 0), 0));
    v_payload := COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
      'sale_id', p_sale_id, 'header', v_header, 'payments', COALESCE(v_sale.payments, '[]'::jsonb));
    v_saved := public.save_sales_invoice_draft(v_payload);

    SELECT total_amount INTO v_total FROM public.sales WHERE id = p_sale_id;
    IF COALESCE(v_total, 0) + 0.0001 < COALESCE(v_sale.paid_amount, 0) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'Yeni məbləğ (%s AZN) artıq ödənilmiş məbləğdən (%s AZN) azdır',
        trim(to_char(COALESCE(v_total, 0), 'FM999999990.00')), trim(to_char(COALESCE(v_sale.paid_amount, 0), 'FM999999990.00')));
    END IF;

    -- 3. Post it again with its own date; payments are not booked twice.
    PERFORM set_config('app.invoice_amend', 'on', true);
    v_post := public.post_sales_invoice_draft(p_sale_id);
    PERFORM set_config('app.invoice_amend', 'off', true);

    SELECT jsonb_build_object(
      'doc_date', s.doc_date, 'total_amount', s.total_amount, 'paid_amount', s.paid_amount, 'customer_id', s.customer_id,
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', si.product_id, 'product_name', si.product_name,
                 'quantity', si.quantity, 'unit_price', si.unit_price, 'line_total', si.line_total) ORDER BY si.id), '[]'::jsonb)
                FROM public.sale_items si WHERE si.sale_id = p_sale_id)),
      s.amend_revision
    INTO v_new, v_sale.amend_revision
    FROM public.sales s WHERE s.id = p_sale_id;

    PERFORM public._invoice_amendment_log('sale', p_sale_id, v_sale.amend_revision, v_reason, v_old, v_new);

    -- items: the saved lines, so the app can redo the Polywood piece cuts as after posting.
    v_result := jsonb_build_object('success', true, 'sale_id', p_sale_id, 'doc_no', v_sale.doc_no,
                                   'revision', v_sale.amend_revision, 'journal_entry_id', v_post->'journal_entry_id',
                                   'items', v_saved->'items');
    PERFORM public.log_erp_event('sales_invoice_amend', 'sales', p_sale_id,
      jsonb_build_object('reason', v_reason, 'old', v_old, 'new', v_new), NULLIF(v_post->>'journal_entry_id', '')::uuid,
      'sale_amend:' || p_sale_id::text || ':' || v_sale.amend_revision::text, v_result);
    RETURN v_result;
  END;
  $function$;
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION public._reverse_sales_invoice_posting(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.amend_posted_sales_invoice(uuid, jsonb, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.amend_posted_sales_invoice(uuid, jsonb, text) TO authenticated, service_role';
END;
$guard$;

-- ─── 7. Purchases (module functions: only where the purchases module is installed) ──

DO $guard$
BEGIN
  IF to_regprocedure('public.post_purchase_invoice_draft(uuid)') IS NULL
     OR to_regclass('public.purchase_items') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fn$
-- Reverses the stock, FIFO layers, cash (unless p_keep_cash) and journal of a posted purchase.
-- Shared by cancel_purchase_invoice_atomic and amend_posted_purchase_invoice.
CREATE OR REPLACE FUNCTION public._reverse_purchase_invoice_posting(
  p_purchase_id uuid, p_label text, p_reason text, p_keep_cash boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label    TEXT := p_label;
  v_reason   TEXT := p_reason;
  v_line     RECORD;
  v_stock    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  -- Goods from this purchase that were already sold or used cannot be unbought.
  IF EXISTS (
    SELECT 1 FROM public.inventory_batches
    WHERE document_id = p_purchase_id
      AND remaining_qty + 0.0001 < initial_qty
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('%s: bu alışın malının bir hissəsi artıq satılıb və ya istifadə olunub — ləğv etmək olmaz. Qaytarma sənədi ilə düzəldin.', v_label);
  END IF;

  -- 1. Stock out, per product.
  FOR v_line IN
    SELECT pi.product_id, SUM(pi.quantity) AS qty, MAX(p.name) AS product_name
    FROM public.purchase_items pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.purchase_id = p_purchase_id AND COALESCE(pi.quantity, 0) > 0
    GROUP BY pi.product_id
  LOOP
    SELECT stock INTO v_stock FROM public.products WHERE id = v_line.product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_line.qty THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('%s: %s üçün stok kifayət etmir (lazım: %s, mövcud: %s)',
                         v_label, v_line.product_name,
                         trim(to_char(v_line.qty, 'FM999999990.00')),
                         trim(to_char(COALESCE(v_stock, 0), 'FM999999990.00')));
    END IF;
    UPDATE public.products SET stock = COALESCE(v_stock, 0) - v_line.qty WHERE id = v_line.product_id;
  END LOOP;

  -- 2. Its FIFO layers (all unconsumed, checked above).
  DELETE FROM public.inventory_batches WHERE document_id = p_purchase_id;

  -- 3. Cash paid to the supplier (and paid additional expenses) comes back.
  IF NOT p_keep_cash THEN
    v_cash := public.reverse_document_cash_transactions('purchase', p_purchase_id, v_label, v_reason);
  END IF;

  DELETE FROM public.warehouse_slips
  WHERE source_type = 'purchase' AND source_document_id = p_purchase_id;

  -- 4. Bill journal.
  v_journals := public.reverse_document_journals(p_purchase_id, v_reason);

  RETURN jsonb_build_object('cash_reversed', v_cash, 'journals_reversed', v_journals);
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice_atomic(p_purchase_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_label    TEXT;
  v_reason   TEXT;
  v_line     RECORD;
  v_stock    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
  v_rev      JSONB;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Alış ID göndərilməyib';
  END IF;

  IF NOT (public.require_permission('can_delete_purchases')
          OR public.require_permission('can_edit_purchases')) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501', MESSAGE = 'Alış ləğvi üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Alış fakturası tapılmadı';
  END IF;

  v_label := COALESCE(NULLIF(trim(v_purchase.invoice_number), ''), p_purchase_id::text);
  v_reason := COALESCE(NULLIF(trim(p_reason), ''), format('Alış fakturası %s ləğv edildi', v_label));

  IF v_purchase.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s artıq ləğv edilib', v_label);
  END IF;

  IF v_purchase.status = 'draft' THEN
    UPDATE public.purchases SET status = 'cancelled', debt_amount = 0 WHERE id = p_purchase_id;
    RETURN jsonb_build_object('success', true, 'purchase_id', p_purchase_id,
                              'invoice_number', v_label, 'was', 'draft');
  END IF;

  v_rev := public._reverse_purchase_invoice_posting(p_purchase_id, v_label, v_reason, false);
  v_cash := (v_rev->>'cash_reversed')::int;
  v_journals := (v_rev->>'journals_reversed')::int;

  UPDATE public.purchases
  SET status = 'cancelled',
      debt_amount = 0
  WHERE id = p_purchase_id;

  PERFORM public.refresh_supplier_ap_balance(v_purchase.supplier_id);

  RETURN jsonb_build_object(
    'success', true,
    'purchase_id', p_purchase_id,
    'invoice_number', v_label,
    'was', 'posted',
    'cash_reversed', v_cash,
    'journals_reversed', v_journals
  );
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.post_purchase_invoice_draft(p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase RECORD;
  v_item RECORD;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_add_exp_total NUMERIC;
  v_idempotency TEXT;
  v_result JSONB;
  v_event_id UUID;
  v_pay_date DATE;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış ID göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış təsdiqləmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Alış sənədi tapılmadı';
  END IF;

  -- Every record of this posting carries the invoice date (fix F1).
  PERFORM public.use_document_date(v_purchase.doc_date);

  IF v_purchase.status = 'posted' THEN
    RAISE EXCEPTION 'already_posted'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd artıq təsdiqlənib';
  END IF;

  IF v_purchase.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION 'cancelled_document'
      USING ERRCODE = '22023',
            MESSAGE = 'Ləğv edilmiş sənəd təsdiqlənə bilməz';
  END IF;

  IF COALESCE(v_purchase.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF COALESCE(v_purchase.paid_amount, 0) > COALESCE(v_purchase.total_amount, 0) + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  FOR v_item IN
    SELECT product_id, quantity, unit_price
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
  LOOP
    v_product_id := v_item.product_id;
    v_qty := COALESCE(v_item.quantity, 0);
    v_unit_price := COALESCE(v_item.unit_price, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul, miqdar və qiymət tələb olunur';
    END IF;

    v_key := v_product_id::text;
    v_stock_demand := jsonb_set(
      v_stock_demand,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
      true
    );
    v_price_map := jsonb_set(v_price_map, ARRAY[v_key], to_jsonb(v_unit_price), true);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_stock_demand)) THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir məhsul tələb olunur';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);
    v_unit_price := COALESCE((v_price_map->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    UPDATE products
    SET stock = COALESCE(v_stock, 0) + v_qty,
        buy_price = v_unit_price
    WHERE id = v_product_id;

    PERFORM public.create_inventory_batch(
      v_product_id,
      p_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      -- An admin amendment keeps the payments already booked (fix F1).
      IF public.invoice_amend_in_progress() THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_date := public.invoice_payment_date(v_pay, v_purchase.doc_date);
      PERFORM public.use_document_date(v_pay_date);

      SELECT name INTO v_account_name
      FROM accounts
      WHERE id = v_account_id;

      v_pay_note := COALESCE(
        NULLIF(trim(v_pay->>'note'), ''),
        format('Alış fakturası %s', v_purchase.invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' — ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' — ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_pay_amount,
        'Alış Ödənişi',
        v_pay_note,
        NULL,
        'purchase',
        p_purchase_id
      );
      PERFORM public.use_document_date(v_purchase.doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(v_purchase.additional_expenses, '[]'::jsonb),
    'purchase',
    p_purchase_id,
    v_purchase.invoice_number
  );

  v_idempotency := 'purchase_receipt:' || p_purchase_id::text || public.invoice_revision_suffix(v_purchase.amend_revision);

  v_journal_id := public.post_purchase_bill_gl_journal(
    p_purchase_id,
    v_purchase.invoice_number,
    v_purchase.total_amount,
    v_purchase.supplier_id,
    v_idempotency
  );

  PERFORM public.refresh_supplier_ap_balance(v_purchase.supplier_id);

  UPDATE purchases
  SET status = 'posted',
      posted_at = NOW(),
      additional_expenses_total = v_add_exp_total
  WHERE id = p_purchase_id;

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_invoice_post',
    'purchase_id', p_purchase_id,
    'invoice_number', v_purchase.invoice_number,
    'status', 'posted',
    'journal_entry_id', v_journal_id,
    'total_amount', v_purchase.total_amount,
    'paid_amount', v_purchase.paid_amount,
    'debt_amount', v_purchase.debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    p_purchase_id,
    jsonb_build_object('purchase_id', p_purchase_id, 'posted_from', 'draft'),
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_purchase_receipt_event(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_date DATE;
  v_pay_date DATE;
  v_idempotency TEXT;
  v_cached JSONB;
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_supplier_id UUID;
  v_purchase_id UUID;
  v_invoice_number TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_debt_amount NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış event payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azı bir məhsul tələb olunur';
  END IF;

  v_supplier_id := NULLIF(v_header->>'supplier_id', '')::uuid;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Təchizatçı seçilməlidir';
  END IF;

  PERFORM id FROM suppliers WHERE id = v_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Təchizatçı tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_debt_amount := COALESCE(
    NULLIF(v_header->>'debt_amount', '')::numeric,
    GREATEST(v_total_amount - v_paid_amount, 0)
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  IF abs((v_paid_amount + v_debt_amount) - v_total_amount) > 0.01 THEN
    RAISE EXCEPTION 'amount_mismatch'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən və borc məbləğlərinin cəmi ümumi məbləğə bərabər olmalıdır';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul, miqdar və qiymət tələb olunur';
    END IF;

    v_key := v_product_id::text;
    v_stock_demand := jsonb_set(
      v_stock_demand,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
      true
    );
    v_price_map := jsonb_set(v_price_map, ARRAY[v_key], to_jsonb(v_unit_price), true);
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  v_invoice_number := COALESCE(
    NULLIF(trim(v_header->>'invoice_number'), ''),
    NULLIF(trim(p_payload->>'invoice_number'), ''),
    'PUR-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int
  );

  INSERT INTO purchases (
    invoice_number, supplier_id, warehouse_id, doc_date, responsible_id, responsible_name,
    total_amount, paid_amount, debt_amount, status, notes
  )
  VALUES (
    v_invoice_number,
    v_supplier_id,
    NULLIF(v_header->>'warehouse_id', '')::uuid,
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    NULLIF(v_header->>'responsible_id', '')::uuid,
    NULLIF(trim(v_header->>'responsible_name'), ''),
    v_total_amount,
    v_paid_amount,
    v_debt_amount,
    'posted',
    NULLIF(trim(v_header->>'notes'), '')
  )
  RETURNING id INTO v_purchase_id;

  -- Every record of this posting carries the invoice date (fix F1).
  v_doc_date := COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE);
  PERFORM public.use_document_date(v_doc_date);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO purchase_items (
      purchase_id, product_id, product_code, product_name, quantity, unit, unit_price, total_price
    )
    VALUES (
      v_purchase_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ædəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'total_price', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      )
    );
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);
    v_unit_price := COALESCE((v_price_map->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    UPDATE products
    SET stock = COALESCE(v_stock, 0) + v_qty,
        buy_price = v_unit_price
    WHERE id = v_product_id;

    PERFORM public.create_inventory_batch(
      v_product_id,
      v_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
  END LOOP;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_date := public.invoice_payment_date(v_pay, v_doc_date);
      PERFORM public.use_document_date(v_pay_date);

      SELECT name INTO v_account_name
      FROM accounts
      WHERE id = v_account_id;

      v_pay_note := COALESCE(
        NULLIF(trim(v_pay->>'note'), ''),
        format('Alış fakturası %s', v_invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' — ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' — ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_pay_amount,
        'Alış Ödənişi',
        v_pay_note,
        NULL,
        'purchase',
        v_purchase_id
      );
      PERFORM public.use_document_date(v_doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
    'purchase',
    v_purchase_id,
    v_invoice_number
  );

  UPDATE purchases
  SET additional_expenses = COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
      additional_expenses_total = v_add_exp_total
  WHERE id = v_purchase_id;

  v_journal_id := public.post_purchase_bill_gl_journal(
    v_purchase_id,
    v_invoice_number,
    v_total_amount,
    v_supplier_id,
    v_idempotency
  );

  PERFORM public.refresh_supplier_ap_balance(v_supplier_id);

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_receipt',
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice_number,
    'journal_entry_id', v_journal_id,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'debt_amount', v_debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    v_purchase_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$;
  $fn$;

  EXECUTE $fn$
  -- Admins (or a role granted can_edit_posted_purchases) change a posted purchase invoice.
  -- Refused like a cancellation when goods of this purchase were already sold or used.
  CREATE OR REPLACE FUNCTION public.amend_posted_purchase_invoice(p_purchase_id uuid, p_payload jsonb, p_reason text)
   RETURNS jsonb
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_purchase public.purchases%ROWTYPE;
    v_reason   TEXT := NULLIF(trim(p_reason), '');
    v_label    TEXT;
    v_new_date DATE;
    v_header   JSONB;
    v_payload  JSONB;
    v_total    NUMERIC;
    v_blocking TEXT;
    v_old      JSONB;
    v_new      JSONB;
    v_post     JSONB;
    v_result   JSONB;
  BEGIN
    IF NOT (public.user_is_admin() OR public.has_permission('can_edit_posted_purchases')) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Təsdiqlənmiş fakturanı yalnız administrator dəyişə bilər';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dəyişikliyin səbəbi göstərilməlidir';
    END IF;

    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Alış fakturası tapılmadı';
    END IF;
    IF v_purchase.status IN ('draft', 'cancelled', 'void', 'voided') OR v_purchase.posted_at IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Bu yolla yalnız təsdiqlənmiş faktura dəyişdirilir';
    END IF;

    v_label := COALESCE(NULLIF(trim(v_purchase.invoice_number), ''), p_purchase_id::text);
    v_header := COALESCE(p_payload->'header', '{}'::jsonb);
    v_new_date := COALESCE(NULLIF(v_header->>'doc_date', '')::date, v_purchase.doc_date, public.document_today());

    PERFORM public.use_document_date(COALESCE(v_purchase.doc_date, public.document_today()));
    PERFORM public.use_document_date(v_new_date);
    PERFORM public.use_document_date(NULL);

    v_blocking := public._invoice_payments_before('purchase', p_purchase_id, v_new_date);
    IF v_blocking IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'Yeni faktura tarixi (%s) bu ödənişlərdən sonradır: %s. Əvvəlcə tarixi düzəldin və ya ödənişi ləğv edin.',
        to_char(v_new_date, 'DD.MM.YYYY'), v_blocking);
    END IF;

    v_old := jsonb_build_object(
      'doc_date', v_purchase.doc_date, 'total_amount', v_purchase.total_amount, 'paid_amount', v_purchase.paid_amount,
      'supplier_id', v_purchase.supplier_id,
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', pi.product_id, 'product_name', pi.product_name,
                 'quantity', pi.quantity, 'unit_price', pi.unit_price, 'total_price', pi.total_price) ORDER BY pi.id), '[]'::jsonb)
                FROM public.purchase_items pi WHERE pi.purchase_id = p_purchase_id));

    PERFORM public._reverse_purchase_invoice_posting(p_purchase_id, v_label, format('Düzəliş: %s — %s', v_label, v_reason), true);

    UPDATE public.purchases
    SET status = 'draft', posted_at = NULL, amend_revision = amend_revision + 1
    WHERE id = p_purchase_id;

    v_total := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
    v_header := v_header || jsonb_build_object(
      'id', p_purchase_id, 'invoice_number', v_purchase.invoice_number,
      'paid_amount', COALESCE(v_purchase.paid_amount, 0),
      'debt_amount', GREATEST(v_total - COALESCE(v_purchase.paid_amount, 0), 0));
    v_payload := COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
      'header', v_header, 'payments', COALESCE(v_purchase.payments, '[]'::jsonb));
    PERFORM public.save_purchase_invoice_draft(v_payload);

    SELECT total_amount INTO v_total FROM public.purchases WHERE id = p_purchase_id;
    IF COALESCE(v_total, 0) + 0.0001 < COALESCE(v_purchase.paid_amount, 0) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'Yeni məbləğ (%s AZN) artıq ödənilmiş məbləğdən (%s AZN) azdır',
        trim(to_char(COALESCE(v_total, 0), 'FM999999990.00')), trim(to_char(COALESCE(v_purchase.paid_amount, 0), 'FM999999990.00')));
    END IF;

    PERFORM set_config('app.invoice_amend', 'on', true);
    v_post := public.post_purchase_invoice_draft(p_purchase_id);
    PERFORM set_config('app.invoice_amend', 'off', true);

    SELECT jsonb_build_object(
      'doc_date', p.doc_date, 'total_amount', p.total_amount, 'paid_amount', p.paid_amount, 'supplier_id', p.supplier_id,
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', pi.product_id, 'product_name', pi.product_name,
                 'quantity', pi.quantity, 'unit_price', pi.unit_price, 'total_price', pi.total_price) ORDER BY pi.id), '[]'::jsonb)
                FROM public.purchase_items pi WHERE pi.purchase_id = p_purchase_id)),
      p.amend_revision
    INTO v_new, v_purchase.amend_revision
    FROM public.purchases p WHERE p.id = p_purchase_id;

    PERFORM public._invoice_amendment_log('purchase', p_purchase_id, v_purchase.amend_revision, v_reason, v_old, v_new);

    v_result := jsonb_build_object('success', true, 'purchase_id', p_purchase_id, 'invoice_number', v_purchase.invoice_number,
                                   'revision', v_purchase.amend_revision, 'journal_entry_id', v_post->'journal_entry_id');
    PERFORM public.log_erp_event('purchase_invoice_amend', 'purchases', p_purchase_id,
      jsonb_build_object('reason', v_reason, 'old', v_old, 'new', v_new), NULLIF(v_post->>'journal_entry_id', '')::uuid,
      'purchase_amend:' || p_purchase_id::text || ':' || v_purchase.amend_revision::text, v_result);
    RETURN v_result;
  END;
  $function$;
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION public._reverse_purchase_invoice_posting(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.amend_posted_purchase_invoice(uuid, jsonb, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.amend_posted_purchase_invoice(uuid, jsonb, text) TO authenticated, service_role';
END;
$guard$;

NOTIFY pgrst, 'reload schema';
