-- Checks supabase/migrations/20261029300000_duplicate_product_names.sql (fix F4) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00f4-00000000000b', 'dpn-s@example.test', '{"full_name": "Samir Seller"}')
on conflict (id) do nothing;

-- The production pattern: one item twice, the second row with its name in the code column.
-- The same name is allowed (no unique constraint): these inserts must succeed.
insert into public.products (id, code, name, stock, is_service, is_composite, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-00f4-000000000001', 'F4-KON-S',        'F4 Konik bar',       194, false, false, 'standard', 4),
  ('00000000-0000-0000-00f4-000000000002', 'F4 Konik bar',    '  f4 konik BAR ',    182, false, false, 'standard', 4),
  -- One stockable product, one service and one composite share a name: not a duplicate.
  ('00000000-0000-0000-00f4-000000000003', 'F4-MON',          'F4 Montaj',            3, false, false, 'standard', 4),
  ('00000000-0000-0000-00f4-000000000004', 'F4-MON-SVC',      'F4 Montaj',            0, true,  false, 'standard', 4),
  ('00000000-0000-0000-00f4-000000000005', 'F4-MON-KIT',      'F4 Montaj',            0, false, true,  'standard', 4),
  -- A unique name, and a name that only differs inside (btrim keeps inner spaces).
  ('00000000-0000-0000-00f4-000000000006', 'F4-UNQ',          'F4 Unique',            1, false, false, 'standard', 4),
  ('00000000-0000-0000-00f4-000000000007', 'F4-KON-2SP',      'F4 Konik  bar',        1, false, false, 'standard', 4)
on conflict (id) do nothing;

do $$
declare
  v_n int;
  v_keys int;
begin
  select count(*), count(distinct details) into v_n, v_keys
  from public.stock_integrity_report()
  where issue = 'duplicate_name' and product_id in ('00000000-0000-0000-00f4-000000000001', '00000000-0000-0000-00f4-000000000002');
  if v_n <> 2 or v_keys <> 1 then raise exception 'FAIL the pair is not one duplicate_name group (rows %, groups %)', v_n, v_keys; end if;

  if (select details from public.stock_integrity_report() where issue = 'duplicate_name' and product_id = '00000000-0000-0000-00f4-000000000002')
     is distinct from 'name = f4 konik bar' then
    raise exception 'FAIL details do not carry the normalised name';
  end if;

  if (select stock_before from public.stock_integrity_report() where issue = 'duplicate_name' and product_id = '00000000-0000-0000-00f4-000000000001') <> 194
     or (select stock_before from public.stock_integrity_report() where issue = 'duplicate_name' and product_id = '00000000-0000-0000-00f4-000000000002') <> 182 then
    raise exception 'FAIL duplicate_name rows do not carry each product''s stock';
  end if;

  if exists (select 1 from public.stock_integrity_report() where issue = 'duplicate_name' and fixable) then
    raise exception 'FAIL duplicate_name reported as fixable';
  end if;

  if exists (select 1 from public.stock_integrity_report() where issue = 'duplicate_name' and product_id in (
      '00000000-0000-0000-00f4-000000000003', '00000000-0000-0000-00f4-000000000004', '00000000-0000-0000-00f4-000000000005')) then
    raise exception 'FAIL services or composites made a stockable product a duplicate';
  end if;

  if exists (select 1 from public.stock_integrity_report() where issue = 'duplicate_name' and product_id in (
      '00000000-0000-0000-00f4-000000000006', '00000000-0000-0000-00f4-000000000007')) then
    raise exception 'FAIL a unique name was reported';
  end if;

  -- The other kinds still work (the function was replaced as a whole).
  if not exists (select 1 from public.stock_integrity_report() where issue = 'service_or_composite' and product_id = '00000000-0000-0000-00f4-000000000004') then
    raise exception 'FAIL the F2 kinds are gone from the report';
  end if;
end $$;

-- Never fixed automatically.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.stock_integrity_fix('duplicate_name', null, null);
  exception when others then v_ok := sqlstate = '22023';
  end;
  if not v_ok then raise exception 'FAIL stock_integrity_fix accepted duplicate_name'; end if;
end $$;

-- Reading the report changes nothing.
do $$
begin
  if (select count(*) from public.products where id::text like '00000000-0000-0000-00f4-%') <> 7
     or (select stock from public.products where id = '00000000-0000-0000-00f4-000000000002') <> 182
     or (select code from public.products where id = '00000000-0000-0000-00f4-000000000002') <> 'F4 Konik bar' then
    raise exception 'FAIL products changed';
  end if;
end $$;

-- Only admins read the report.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f4-00000000000b","role":"authenticated"}', true);
do $$
declare v_ok boolean := false;
begin
  begin perform 1 from public.stock_integrity_report(); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a non-admin read the integrity report'; end if;
end $$;
rollback;

-- The read-only check script runs (its result rows are printed above this line).
\ir ../scripts/product_integrity_check.sql

select 'ALL CHECKS PASSED';
