-- ============================================================================
-- Delivery act (Təhvil-təslim aktı): the directors who sign it.
--
-- The act printed from a sales invoice reads "… "DEL GROUPS" MMC-nin direktoru X şəxsində (satıcı) …
-- "Y" MMC, direktoru Z şəxsində (alıcı) …". Neither name was stored anywhere:
--
--   company_profile.director_name   the director of the company using this ERP (Settings → Company)
--   customers.director_name         the director (representative) of a company customer (customer card,
--                                   shown for legal customers only)
--
-- Plain nullable text, at most 120 characters. No data is changed, no policy changes: the columns follow
-- the existing row security of both tables. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.company_profile') IS NOT NULL THEN
    ALTER TABLE public.company_profile ADD COLUMN IF NOT EXISTS director_name TEXT;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_profile_director_name_len') THEN
      ALTER TABLE public.company_profile
        ADD CONSTRAINT company_profile_director_name_len CHECK (director_name IS NULL OR char_length(director_name) <= 120);
    END IF;
  END IF;
END
$$;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS director_name TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_director_name_len') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_director_name_len CHECK (director_name IS NULL OR char_length(director_name) <= 120);
  END IF;
END
$$;

COMMENT ON COLUMN public.customers.director_name IS 'Director / representative of a company customer; printed on the delivery act.';

NOTIFY pgrst, 'reload schema';
