-- Ensure contracts payment-term columns exist (idempotent for remote Supabase)

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS advance_percentage NUMERIC;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS payment_stages INTEGER;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS payment_terms_notes TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_date DATE DEFAULT CURRENT_DATE;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS expiry_date DATE;

NOTIFY pgrst, 'reload schema';
