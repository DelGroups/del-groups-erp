-- Per-user UI language preference (az | en | ru)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'az';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_locale_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_locale_check CHECK (locale IN ('az', 'en', 'ru'));

CREATE INDEX IF NOT EXISTS idx_profiles_locale ON profiles (locale);
