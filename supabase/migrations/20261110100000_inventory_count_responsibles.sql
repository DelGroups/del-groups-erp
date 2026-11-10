-- ============================================================================
-- Inventory counts: the people responsible for a count (INV-4, flag COUNT_TEAM).
--
-- - inventory_count_responsibles: which employees count a document. Readable by
--   whoever can read the count (RLS through inventory_counts); written only by
--   the RPC below (no write policies, no write grants to API roles).
-- - inventory_count_employee_options(): active employees as choices (id, name,
--   code, position, department). employees itself is behind can_view_hr, which
--   warehouse staff do not have; this returns no salary or personal data and is
--   allowed to everyone who may create or run counts.
-- - inventory_count_set_responsibles(count, employee ids, actor): replaces the
--   set and writes inventory_counts.responsible_name = the names joined with
--   ", ", so lists, search, group by and exports keep working on the text.
--   Draft and in progress: anyone who may count. Review and posted: admins
--   only. Every change is logged with the old and new names.
-- - inventory_count_update_header is unchanged (older screens still call it).
-- - Existing counts are not touched: their free text stays as it is; nothing is
--   guessed from it.
--
-- Module tables (inventory): only where the module is installed. Safe to re-run.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('public.inventory_counts') IS NULL OR to_regclass('public.employees') IS NULL THEN
    RETURN;
  END IF;

  -- ─── Table ────────────────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS public.inventory_count_responsibles (
    count_id    UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
    -- An employee removed from HR leaves the count (its responsible_name text keeps the name).
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    added_by    UUID REFERENCES auth.users(id),
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- The chosen order (the same order as the names in responsible_name).
    sort_order  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (count_id, employee_id)
  );
  ALTER TABLE public.inventory_count_responsibles ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

  CREATE INDEX IF NOT EXISTS idx_inventory_count_responsibles_employee
    ON public.inventory_count_responsibles (employee_id);

  ALTER TABLE public.inventory_count_responsibles ENABLE ROW LEVEL SECURITY;

  -- Read: the rows of the counts the user can read (inventory_counts' own policy decides).
  DROP POLICY IF EXISTS inventory_count_responsibles_select ON public.inventory_count_responsibles;
  CREATE POLICY inventory_count_responsibles_select ON public.inventory_count_responsibles
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.inventory_counts c WHERE c.id = inventory_count_responsibles.count_id));

  -- Write: only through inventory_count_set_responsibles (security definer).
  REVOKE ALL ON TABLE public.inventory_count_responsibles FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public.inventory_count_responsibles TO authenticated;
  GRANT ALL ON TABLE public.inventory_count_responsibles TO service_role;

  -- ─── Active employees ────────────────────────────────────────────────────

  -- The same "active" spellings the HR status trigger normalises (normalize_employee_status).
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public._inventory_count_employee_active(p_status TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql
  IMMUTABLE
  AS $body$
    SELECT lower(btrim(COALESCE(p_status, ''))) IN ('', 'active', 'aktiv', 'активный', 'актив');
  $body$
  $fn$;

  -- ─── Choices: active employees, names only ───────────────────────────────

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_employee_options()
  RETURNS TABLE (id UUID, full_name TEXT, employee_code TEXT, "position" TEXT, department TEXT)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  #variable_conflict use_column
  BEGIN
    -- Same check as the count RPCs (service-role callers have authorised the user already).
    PERFORM public._inventory_count_authorize('can_writeoff_inventory');
    RETURN QUERY
      SELECT e.id,
             e.full_name,
             COALESCE(NULLIF(btrim(e.employee_code), ''), NULLIF(btrim(e.code), '')),
             NULLIF(btrim(e.position), ''),
             NULLIF(btrim(e.department), '')
      FROM public.employees e
      WHERE public._inventory_count_employee_active(e.status)
        AND NULLIF(btrim(e.full_name), '') IS NOT NULL
      ORDER BY e.full_name, e.id;
  END;
  $body$
  $fn$;

  -- ─── Set the people of a count ───────────────────────────────────────────

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.inventory_count_set_responsibles(
    p_count_id     UUID,
    p_employee_ids UUID[],
    p_actor        UUID DEFAULT NULL
  )
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_actor   UUID := COALESCE(auth.uid(), p_actor);
    v_admin   BOOLEAN := public._inventory_count_actor_is_admin(p_actor);
    v_doc     public.inventory_counts;
    v_ids     UUID[];
    v_before  UUID[];
    v_unknown INTEGER;
    v_text    TEXT;
  BEGIN
    PERFORM public._inventory_count_authorize('can_writeoff_inventory');
    v_doc := public._inventory_count_lock(p_count_id, ARRAY['draft', 'in_progress', 'review', 'posted']);

    IF v_doc.status IN ('review', 'posted') AND NOT v_admin THEN
      RAISE EXCEPTION '%', 'Yoxlanılan və ya təsdiqlənmiş sayımın məsul şəxslərini yalnız administrator dəyişə bilər'
        USING ERRCODE = '42501';
    END IF;

    -- Distinct ids, in the order chosen.
    SELECT COALESCE(array_agg(d.eid ORDER BY d.ord), '{}')
    INTO v_ids
    FROM (
      SELECT t.eid, min(t.ord) AS ord
      FROM unnest(COALESCE(p_employee_ids, '{}'::uuid[])) WITH ORDINALITY AS t(eid, ord)
      WHERE t.eid IS NOT NULL
      GROUP BY t.eid
    ) d;

    -- Same limit as MAX_COUNT_TEAM in src/modules/inventory/lib/countTeam.ts.
    IF cardinality(v_ids) > 50 THEN
      RAISE EXCEPTION '%', 'Bir sayıma ən çox 50 məsul şəxs seçilə bilər' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(array_agg(r.employee_id ORDER BY r.employee_id), '{}')
    INTO v_before
    FROM public.inventory_count_responsibles r
    WHERE r.count_id = v_doc.id;

    -- Every id is an active employee, or one already on this count (left HR since).
    SELECT count(*)
    INTO v_unknown
    FROM unnest(v_ids) AS i(eid)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = i.eid
        AND (public._inventory_count_employee_active(e.status) OR e.id = ANY (v_before))
    );
    IF v_unknown > 0 THEN
      RAISE EXCEPTION '%', 'Seçilən işçi tapılmadı və ya aktiv deyil' USING ERRCODE = '22023';
    END IF;

    SELECT string_agg(e.full_name, ', ' ORDER BY t.ord)
    INTO v_text
    FROM unnest(v_ids) WITH ORDINALITY AS t(eid, ord)
    JOIN public.employees e ON e.id = t.eid;
    v_text := NULLIF(btrim(COALESCE(v_text, '')), '');

    -- Nothing changed: no write, no log line.
    IF (SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM unnest(v_ids) AS x) = v_before
       AND v_text IS NOT DISTINCT FROM v_doc.responsible_name THEN
      RETURN v_text;
    END IF;

    DELETE FROM public.inventory_count_responsibles
    WHERE count_id = v_doc.id AND NOT (employee_id = ANY (v_ids));

    INSERT INTO public.inventory_count_responsibles (count_id, employee_id, added_by, added_at, sort_order)
    SELECT v_doc.id, t.eid, v_actor, NOW(), t.ord
    FROM unnest(v_ids) WITH ORDINALITY AS t(eid, ord)
    ON CONFLICT (count_id, employee_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;

    UPDATE public.inventory_counts
    SET responsible_name = v_text,
        updated_at = NOW()
    WHERE id = v_doc.id;

    PERFORM public._inventory_count_log(
      v_doc.id, 'INVENTORY_COUNT_RESPONSIBLES',
      format('Məsul şəxslər dəyişdi: %s → %s', COALESCE(v_doc.responsible_name, '—'), COALESCE(v_text, '—')),
      v_actor,
      jsonb_build_object(
        'old_names', v_doc.responsible_name,
        'new_names', v_text,
        'old_employee_ids', to_jsonb(v_before),
        'new_employee_ids', to_jsonb(v_ids),
        'status', v_doc.status
      )
    );

    RETURN v_text;
  END;
  $body$
  $fn$;

  -- ─── Grants (like the other count RPCs) ──────────────────────────────────

  EXECUTE 'REVOKE ALL ON FUNCTION public._inventory_count_employee_active(TEXT) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._inventory_count_employee_active(TEXT) TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_count_employee_options() FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_employee_options() TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_count_set_responsibles(UUID, UUID[], UUID) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_set_responsibles(UUID, UUID[], UUID) TO authenticated, service_role';
END;
$guard$;

NOTIFY pgrst, 'reload schema';
