-- Cancelled sales invoices kept their open amount (remaining_balance), so
-- customers.balance and the dashboard's "Müştəri borcları" still counted them
-- after the invoice was voided. The app now clears it on cancel; this fixes the
-- invoices that were cancelled before that change.

UPDATE public.sales
SET remaining_balance = 0
WHERE lower(trim(coalesce(status, ''))) IN ('cancelled', 'ləğv edildi', 'legv edildi', 'void', 'voided')
  AND coalesce(remaining_balance, 0) <> 0;

-- Re-derive the stored balance of every customer that has a cancelled invoice.
SELECT public.refresh_customer_ar_balance(c.customer_id)
FROM (
  SELECT DISTINCT customer_id
  FROM public.sales
  WHERE customer_id IS NOT NULL
    AND lower(trim(coalesce(status, ''))) IN ('cancelled', 'ləğv edildi', 'legv edildi', 'void', 'voided')
) AS c;

-- The management dashboard subscribes to changes on these tables so its KPIs
-- update live. Realtime still honours each table's RLS policies.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'purchases', 'transactions', 'customers', 'products'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
