-- Checks supabase/migrations/20261110100000_inventory_count_responsibles.sql (INV-4) on a
-- database built with scripts/db/build-fresh.sh --plain-postgres. Any failed check raises an
-- exception; the last line prints ALL CHECKS PASSED. Leaves test rows behind: run it on a
-- throwaway database only.
--
-- Users: A admin; W warehouse staff (may count; no can_view_hr and none of the invoice /
-- purchase / production rights that open the employees_select_pickers policy).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00cd-00000000000a', 'cr-a@example.test', '{"full_name": "Arzu Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00cd-00000000000b', 'cr-w@example.test', '{"full_name": "Vüqar Anbardar"}')
on conflict (id) do nothing;
insert into public.roles (id, name, permissions, is_system)
values ('00000000-0000-0000-00cd-0000000000f1', 'CR Warehouse', '{"can_view_products": true, "can_writeoff_inventory": true}'::jsonb, false)
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00cd-00000000000a';
update public.profiles set role_id = '00000000-0000-0000-00cd-0000000000f1', is_active = true
where id = '00000000-0000-0000-00cd-00000000000b';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-00cd-0000000000e1', 'CR-W1', 'CR main', false, now())
on conflict (id) do nothing;

-- Employees: two active (one written "Aktiv"), one inactive, one with a salary to keep private.
insert into public.employees (id, code, employee_code, full_name, position, department, status, salary, phone) values
  ('00000000-0000-0000-00cd-0000000000a1', 'CR-1', 'E-001', 'Əli Həsənov',      'Anbardar',  'Anbar',   'active',   900, '+994500000001'),
  ('00000000-0000-0000-00cd-0000000000a2', 'CR-2', null,    'Səbinə Qasımova',  'Operator',  'Anbar',   'Aktiv',    800, '+994500000002'),
  ('00000000-0000-0000-00cd-0000000000a3', 'CR-3', 'E-003', 'Köhnə İşçi',       'Anbardar',  'Anbar',   'inactive', 700, '+994500000003')
on conflict (id) do nothing;

-- Counts: draft with old free text, in progress, review, posted, and an old one left alone.
insert into public.inventory_counts (id, document_number, count_date, warehouse_id, status, responsible_name) values
  ('00000000-0000-0000-00cd-0000000000c1', 'CR-DRAFT',  public.inventory_count_today(), '00000000-0000-0000-00cd-0000000000e1', 'draft',       'Köhnə mətn: Əli və Səbinə'),
  ('00000000-0000-0000-00cd-0000000000c2', 'CR-PROG',   public.inventory_count_today(), '00000000-0000-0000-00cd-0000000000e1', 'in_progress', null),
  ('00000000-0000-0000-00cd-0000000000c3', 'CR-REVIEW', public.inventory_count_today(), '00000000-0000-0000-00cd-0000000000e1', 'review',      null),
  ('00000000-0000-0000-00cd-0000000000c4', 'CR-POSTED', public.inventory_count_today(), '00000000-0000-0000-00cd-0000000000e1', 'posted',      'Posted text'),
  ('00000000-0000-0000-00cd-0000000000c5', 'CR-OLD',    public.inventory_count_today(), '00000000-0000-0000-00cd-0000000000e1', 'draft',       'Only free text')
on conflict (id) do nothing;

-- ── Schema ──────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.inventory_count_responsibles') is null then raise exception 'FAIL table missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.inventory_count_responsibles'::regclass) then
    raise exception 'FAIL RLS is off';
  end if;
  -- The header RPC keeps its signature (older screens call it).
  if to_regprocedure('public.inventory_count_update_header(uuid, date, text, text, uuid)') is null then
    raise exception 'FAIL inventory_count_update_header signature changed';
  end if;
  -- The choices return names only: no salary, no phone.
  if pg_get_function_result('public.inventory_count_employee_options()'::regprocedure) ~* '(salary|phone)' then
    raise exception 'FAIL employee options expose personal data: %', pg_get_function_result('public.inventory_count_employee_options()'::regprocedure);
  end if;
  -- Nothing guessed from the old free text.
  if exists (select 1 from public.inventory_count_responsibles where count_id = '00000000-0000-0000-00cd-0000000000c5') then
    raise exception 'FAIL an old count got people from its free text';
  end if;
end $$;

-- ── W (may count, cannot read employees) ───────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_ok    boolean;
  v_text  text;
  v_names text[];
  v_n     integer;
  v_log   jsonb;
begin
  -- The employees table itself is closed to M ...
  select count(*) into v_n from public.employees where id::text like '00000000-0000-0000-00cd-%';
  if v_n <> 0 then raise exception 'FAIL M read employees directly (% rows): test user can read employees?', v_n; end if;

  -- ... but the count choices list the active ones, by name.
  select array_agg(full_name order by full_name) into v_names
  from public.inventory_count_employee_options() where id::text like '00000000-0000-0000-00cd-%';
  if v_names is distinct from array['Səbinə Qasımova', 'Əli Həsənov'] and v_names is distinct from array['Əli Həsənov', 'Səbinə Qasımova'] then
    raise exception 'FAIL employee options for M: %', v_names;
  end if;
  if (select employee_code from public.inventory_count_employee_options() where id = '00000000-0000-0000-00cd-0000000000a2') <> 'CR-2' then
    raise exception 'FAIL an employee without employee_code falls back to code';
  end if;

  -- Draft: replaces the free text, names in the chosen order, duplicates dropped.
  v_text := public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c1',
    array['00000000-0000-0000-00cd-0000000000a2', '00000000-0000-0000-00cd-0000000000a1', '00000000-0000-0000-00cd-0000000000a2']::uuid[]);
  if v_text <> 'Səbinə Qasımova, Əli Həsənov' then raise exception 'FAIL draft names: %', v_text; end if;
  if (select responsible_name from public.inventory_counts where id = '00000000-0000-0000-00cd-0000000000c1') <> v_text then
    raise exception 'FAIL responsible_name not written';
  end if;
  -- The rows keep the chosen order (the chips and the text agree).
  if (select array_agg(employee_id order by sort_order) from public.inventory_count_responsibles where count_id = '00000000-0000-0000-00cd-0000000000c1')
     <> array['00000000-0000-0000-00cd-0000000000a2', '00000000-0000-0000-00cd-0000000000a1']::uuid[] then
    raise exception 'FAIL chosen order not kept';
  end if;
  -- M reads the rows of a count M can read.
  select count(*) into v_n from public.inventory_count_responsibles where count_id = '00000000-0000-0000-00cd-0000000000c1';
  if v_n <> 2 then raise exception 'FAIL M sees % responsible rows', v_n; end if;

  -- In progress: allowed for anyone who may count.
  v_text := public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c2', array['00000000-0000-0000-00cd-0000000000a1']::uuid[]);
  if v_text <> 'Əli Həsənov' then raise exception 'FAIL in-progress names: %', v_text; end if;

  -- Review and posted: refused for a non-admin.
  v_ok := false;
  begin
    perform public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c4', array['00000000-0000-0000-00cd-0000000000a1']::uuid[]);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a non-admin changed the people of a posted count'; end if;
  v_ok := false;
  begin
    perform public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c3', array['00000000-0000-0000-00cd-0000000000a1']::uuid[]);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a non-admin changed the people of a count in review'; end if;
  -- Passing an admin as p_actor does not help a signed-in non-admin.
  v_ok := false;
  begin
    perform public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c4', array['00000000-0000-0000-00cd-0000000000a1']::uuid[],
      '00000000-0000-0000-00cd-00000000000a');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL p_actor let a non-admin act as admin'; end if;

  -- An inactive employee cannot be added.
  v_ok := false;
  begin
    perform public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c1', array['00000000-0000-0000-00cd-0000000000a3']::uuid[]);
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL an inactive employee was added'; end if;

  -- No direct writes: only the RPC.
  v_ok := false;
  begin
    insert into public.inventory_count_responsibles (count_id, employee_id) values ('00000000-0000-0000-00cd-0000000000c5', '00000000-0000-0000-00cd-0000000000a1');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL M wrote the table directly'; end if;
  v_ok := false;
  begin
    delete from public.inventory_count_responsibles where count_id = '00000000-0000-0000-00cd-0000000000c1';
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL M deleted rows directly'; end if;
end $$;
commit;

-- The change was logged with the old and new names.
do $$
declare
  v_log jsonb;
  v_n   integer;
begin
  select new_values_json into v_log from public.audit_logs
  where table_name = 'inventory_counts' and record_id = '00000000-0000-0000-00cd-0000000000c1'
    and new_values_json ->> 'event' = 'INVENTORY_COUNT_RESPONSIBLES'
  order by created_at desc limit 1;
  if v_log is null then raise exception 'FAIL no log line for the draft change'; end if;
  if v_log ->> 'old_names' <> 'Köhnə mətn: Əli və Səbinə' or v_log ->> 'new_names' <> 'Səbinə Qasımova, Əli Həsənov' then
    raise exception 'FAIL log names: %', v_log;
  end if;
  if (select user_id from public.audit_logs where table_name = 'inventory_counts' and record_id = '00000000-0000-0000-00cd-0000000000c1'
        and new_values_json ->> 'event' = 'INVENTORY_COUNT_RESPONSIBLES' order by created_at desc limit 1) <> '00000000-0000-0000-00cd-00000000000b' then
    raise exception 'FAIL log user is not M';
  end if;
  if (select added_by from public.inventory_count_responsibles where count_id = '00000000-0000-0000-00cd-0000000000c1' limit 1) <> '00000000-0000-0000-00cd-00000000000b' then
    raise exception 'FAIL added_by is not M';
  end if;
end $$;

-- ── A (admin): posted counts ────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_text text;
  v_before integer;
  v_after integer;
begin
  v_text := public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c4',
    array['00000000-0000-0000-00cd-0000000000a1', '00000000-0000-0000-00cd-0000000000a2']::uuid[]);
  if v_text <> 'Əli Həsənov, Səbinə Qasımova' then raise exception 'FAIL admin posted names: %', v_text; end if;
  if (select status from public.inventory_counts where id = '00000000-0000-0000-00cd-0000000000c4') <> 'posted' then
    raise exception 'FAIL the posted count changed status';
  end if;

  -- The same set again: nothing written, nothing logged.
  select count(*) into v_before from public.audit_logs where record_id = '00000000-0000-0000-00cd-0000000000c4' and new_values_json ->> 'event' = 'INVENTORY_COUNT_RESPONSIBLES';
  perform public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c4',
    array['00000000-0000-0000-00cd-0000000000a2', '00000000-0000-0000-00cd-0000000000a1']::uuid[]);
  select count(*) into v_after from public.audit_logs where record_id = '00000000-0000-0000-00cd-0000000000c4' and new_values_json ->> 'event' = 'INVENTORY_COUNT_RESPONSIBLES';
  -- The order differs, so the text changes once; a third identical call must not log.
  perform public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c4',
    array['00000000-0000-0000-00cd-0000000000a2', '00000000-0000-0000-00cd-0000000000a1']::uuid[]);
  if (select count(*) from public.audit_logs where record_id = '00000000-0000-0000-00cd-0000000000c4' and new_values_json ->> 'event' = 'INVENTORY_COUNT_RESPONSIBLES') <> v_after then
    raise exception 'FAIL an unchanged set was logged again';
  end if;
  if v_before < 1 then raise exception 'FAIL admin change on a posted count not logged'; end if;
  if (select new_values_json ->> 'status' from public.audit_logs where record_id = '00000000-0000-0000-00cd-0000000000c4'
        and new_values_json ->> 'event' = 'INVENTORY_COUNT_RESPONSIBLES' order by created_at limit 1) <> 'posted' then
    raise exception 'FAIL log does not say posted';
  end if;

  -- An empty set clears the people and the text.
  v_text := public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c3', '{}'::uuid[]);
  if v_text is not null then raise exception 'FAIL empty set text: %', v_text; end if;
end $$;
commit;

-- ── Server actions (service role: no auth.uid(), the user comes in p_actor) ──
do $$
declare
  v_ok boolean := false;
begin
  begin
    perform public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c4', array['00000000-0000-0000-00cd-0000000000a1']::uuid[],
      '00000000-0000-0000-00cd-00000000000b');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL service call for a non-admin changed a posted count'; end if;
  if public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c4', array['00000000-0000-0000-00cd-0000000000a1']::uuid[],
       '00000000-0000-0000-00cd-00000000000a') <> 'Əli Həsənov' then
    raise exception 'FAIL service call for an admin';
  end if;
  -- An employee already on a count may stay after leaving HR (inactive).
  update public.employees set status = 'inactive' where id = '00000000-0000-0000-00cd-0000000000a1';
  if public.inventory_count_set_responsibles('00000000-0000-0000-00cd-0000000000c2',
       array['00000000-0000-0000-00cd-0000000000a1', '00000000-0000-0000-00cd-0000000000a2']::uuid[],
       '00000000-0000-0000-00cd-00000000000b') <> 'Əli Həsənov, Səbinə Qasımova' then
    raise exception 'FAIL keeping an employee who left';
  end if;
  update public.employees set status = 'active' where id = '00000000-0000-0000-00cd-0000000000a1';
  -- Deleting a count removes its people.
  delete from public.inventory_counts where id = '00000000-0000-0000-00cd-0000000000c2';
  if exists (select 1 from public.inventory_count_responsibles where count_id = '00000000-0000-0000-00cd-0000000000c2') then
    raise exception 'FAIL people left behind by a deleted count';
  end if;
end $$;

-- ── anon: no access ─────────────────────────────────────────────────────────
begin;
set local role anon;
do $$
declare
  v_ok boolean := false;
begin
  begin
    perform * from public.inventory_count_employee_options();
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL anon listed employees'; end if;
end $$;
rollback;

-- The migration runs twice without errors.
\ir ../migrations/20261110100000_inventory_count_responsibles.sql

select 'ALL CHECKS PASSED';
