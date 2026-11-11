-- Checks supabase/migrations/20261111200000_journal_entry_no_sequence.sql on a database built
-- with scripts/db/build-fresh.sh --plain-postgres. Any failed check raises an exception; the
-- last line prints ALL CHECKS PASSED. Leaves test rows behind: run it on a throwaway database.

do $$
declare
  v_ids uuid[] := '{}';
  v_id uuid;
  i int;
  v_bad int;
begin
  -- 2,000 entries on one day: with 4 random digits a collision was all but certain.
  for i in 1 .. 2000 loop
    v_id := public.create_journal_entry(jsonb_build_object(
      'entry_date', '2026-11-01',
      'description', 'JE number test',
      'idempotency_key', 'je-no-test:' || i,
      'lines', jsonb_build_array(
        jsonb_build_object('account_code', '1100', 'debit', 1, 'credit', 0),
        jsonb_build_object('account_code', '3900', 'debit', 0, 'credit', 1))));
    v_ids := v_ids || v_id;
  end loop;

  select count(*) into v_bad from public.journal_entries
  where id = any (v_ids) and entry_no !~ '^JE-20261101-[0-9]{6}$';
  if v_bad > 0 then raise exception 'FAIL % entry numbers not JE-<date>-<6 digits>', v_bad; end if;
  if (select count(distinct entry_no) from public.journal_entries where id = any (v_ids)) <> 2000 then
    raise exception 'FAIL entry numbers repeat';
  end if;

  -- An entry_no given by the caller is kept.
  v_id := public.create_journal_entry(jsonb_build_object(
    'entry_no', 'JE-MANUAL-1', 'entry_date', '2026-11-01', 'description', 'JE number test',
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', 1, 'credit', 0),
      jsonb_build_object('account_code', '3900', 'debit', 0, 'credit', 1))));
  if (select entry_no from public.journal_entries where id = v_id) <> 'JE-MANUAL-1' then
    raise exception 'FAIL a given entry_no was replaced';
  end if;
end $$;

-- The migration runs twice without errors.
\ir ../migrations/20261111200000_journal_entry_no_sequence.sql

select 'ALL CHECKS PASSED';
