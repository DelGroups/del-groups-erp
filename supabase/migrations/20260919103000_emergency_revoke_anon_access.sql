-- ============================================================================
-- EMERGENCY PATCH — close public (anon) access to business data.
--
-- Why: the Supabase anon key is public by design (it is shipped in the client
-- bundle and served by /api/public-config). Verified on 2026-09-19 that an
-- UNAUTHENTICATED request carrying only that key could read customers,
-- products, employees, accounts, warehouse_stocks, journal_entries and
-- journal_entry_lines, and that an INSERT into journal_entry_lines was
-- rejected only by a NOT NULL constraint (23502) — not by permissions (42501).
-- That means the `anon` role held write privileges on the general ledger.
--
-- This migration removes every privilege the `anon` role holds on public
-- tables, and stops future tables from inheriting any.
--
-- Safe to apply: the application never queries business tables as `anon`.
-- Server actions use the service_role client (bypasses this entirely) and
-- browser queries run as `authenticated` after login. The single pre-login
-- read is the login screen's company name + logo, preserved below.
-- ============================================================================

-- 1. Strip every anon privilege on every existing public table.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'settings'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.tablename);
  END LOOP;
END $$;

-- 2. Views are separate objects; strip those too.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT viewname AS relname FROM pg_views WHERE schemaname = 'public'
    UNION ALL
    SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
  END LOOP;
END $$;

-- 3. Stop anon inheriting privileges on anything created later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 4. Keep the login screen working: branding columns only, read-only.
--    (Column-level grant — anon cannot see any other column of settings.)
REVOKE ALL ON TABLE public.settings FROM anon;
GRANT SELECT (company_name, logo_url) ON TABLE public.settings TO anon;
