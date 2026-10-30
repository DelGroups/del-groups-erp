-- ============================================================================
-- User names for list columns (prompt 24c): "Created by" and "Salesperson".
--
-- Lists show the name behind created_by / issued_by. RLS on profiles lets a user read only
-- their own profile (or every profile with can_manage_users), so a seller could not see who
-- created a colleague's invoice. profile_display_names returns only (id, full_name) for the ids
-- asked, to signed-in users; nothing else of other profiles is exposed.
--
-- set_created_by_from_auth() is the BEFORE INSERT trigger used by the tables that get a
-- created_by column in the next migrations (purchases, inventory_writeoffs, contracts): a
-- signed-in insert always records the real user, whatever the client sent; service-role and
-- maintenance inserts (auth.uid() null) keep the value given.
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.profile_display_names(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, NULLIF(btrim(p.full_name), '')
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND cardinality(p_ids) <= 1000
    AND p.id = ANY (p_ids);
$$;

COMMENT ON FUNCTION public.profile_display_names(uuid[]) IS
  'Prompt 24c: id and full name of the given profiles, for "Created by" / "Salesperson" list columns. Signed-in users only, at most 1000 ids per call.';

REVOKE ALL ON FUNCTION public.profile_display_names(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_display_names(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_display_names(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_created_by_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_created_by_from_auth() IS
  'Prompt 24c: BEFORE INSERT trigger, created_by := auth.uid() for signed-in inserts.';

REVOKE ALL ON FUNCTION public.set_created_by_from_auth() FROM PUBLIC;
