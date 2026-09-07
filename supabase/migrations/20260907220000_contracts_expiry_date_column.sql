-- Restore expiry_date as the canonical contracts end-date column

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contracts'
      AND column_name = 'end_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contracts'
      AND column_name = 'expiry_date'
  ) THEN
    ALTER TABLE contracts RENAME COLUMN end_date TO expiry_date;
  END IF;
END $$;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS expiry_date DATE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contracts'
      AND column_name = 'end_date'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contracts'
      AND column_name = 'expiry_date'
  ) THEN
    UPDATE contracts
    SET expiry_date = end_date
    WHERE expiry_date IS NULL
      AND end_date IS NOT NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
