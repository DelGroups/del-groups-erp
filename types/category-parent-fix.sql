-- Ensure category hierarchy column exists and is valid.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'categories_parent_id_fkey'
  ) THEN
    ALTER TABLE categories
      ADD CONSTRAINT categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES categories(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
