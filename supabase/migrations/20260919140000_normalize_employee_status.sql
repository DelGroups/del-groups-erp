-- ============================================================================
-- Payroll produced nothing because employee status was stored as a display label.
--
-- Verified on production 2026-09-19: the only employee row held status 'Aktiv',
-- while calculate_monthly_payroll_drafts loops
--   WHERE COALESCE(status, 'active') = 'active'
-- so no employee ever matched, every payroll run inserted zero rows, and the UI
-- reported nothing at all. The same strict comparison is used elsewhere (the
-- production module's employee picker), which is why those lists looked empty.
--
-- The edit form makes it self-perpetuating: its <select> carries canonical
-- values, so a stored label matches no option, React keeps the stale label in
-- state, and saving writes the label straight back.
--
-- Fix: normalise what is stored, keep it normalised with a trigger, and make
-- the payroll loop tolerant of anything that slips through.
-- ============================================================================

-- 1. Canonicalise existing rows (Azerbaijani, Russian and English labels).
UPDATE public.employees
SET status = CASE
  WHEN lower(btrim(COALESCE(status, ''))) IN ('', 'active', 'aktiv', 'активный', 'актив') THEN 'active'
  WHEN lower(btrim(status)) IN ('inactive', 'deaktiv', 'qeyri-aktiv', 'неактивный') THEN 'inactive'
  WHEN lower(btrim(status)) IN ('on_leave', 'məzuniyyətdə', 'mezuniyyetde', 'в отпуске') THEN 'on_leave'
  WHEN lower(btrim(status)) IN ('terminated', 'işdən çıxıb', 'isden cixib', 'уволен') THEN 'terminated'
  ELSE lower(btrim(status))
END
WHERE status IS NULL OR status <> CASE
  WHEN lower(btrim(COALESCE(status, ''))) IN ('', 'active', 'aktiv', 'активный', 'актив') THEN 'active'
  WHEN lower(btrim(status)) IN ('inactive', 'deaktiv', 'qeyri-aktiv', 'неактивный') THEN 'inactive'
  WHEN lower(btrim(status)) IN ('on_leave', 'məzuniyyətdə', 'mezuniyyetde', 'в отпуске') THEN 'on_leave'
  WHEN lower(btrim(status)) IN ('terminated', 'işdən çıxıb', 'isden cixib', 'уволен') THEN 'terminated'
  ELSE lower(btrim(status))
END;

-- 2. Keep it canonical whatever the client sends.
CREATE OR REPLACE FUNCTION public.normalize_employee_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status := CASE
    WHEN lower(btrim(COALESCE(NEW.status, ''))) IN ('', 'active', 'aktiv', 'активный', 'актив') THEN 'active'
    WHEN lower(btrim(NEW.status)) IN ('inactive', 'deaktiv', 'qeyri-aktiv', 'неактивный') THEN 'inactive'
    WHEN lower(btrim(NEW.status)) IN ('on_leave', 'məzuniyyətdə', 'mezuniyyetde', 'в отпуске') THEN 'on_leave'
    WHEN lower(btrim(NEW.status)) IN ('terminated', 'işdən çıxıb', 'isden cixib', 'уволен') THEN 'terminated'
    ELSE lower(btrim(NEW.status))
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_normalize_status ON public.employees;
CREATE TRIGGER trg_employees_normalize_status
  BEFORE INSERT OR UPDATE OF status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.normalize_employee_status();

-- 3. Belt and braces: the payroll loop no longer depends on exact casing.
CREATE OR REPLACE FUNCTION public.employee_is_payable(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(p_status, 'active'))) IN ('', 'active', 'aktiv', 'активный', 'актив');
$$;

GRANT EXECUTE ON FUNCTION public.employee_is_payable(TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
