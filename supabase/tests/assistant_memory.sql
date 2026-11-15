-- Checks supabase/migrations/20261121110000_assistant_memory.sql (AST-3): only admins read the notes; an
-- employee (the assistant on their behalf) writes only about themselves and the customers / products they may
-- see; forbidden topics are refused; the notes of one turn are company + own + the record in view; recall,
-- touch, admin edit and delete (audited); the guard's notes are copied once; the 5 000-note cap; anon nothing.
-- One transaction, rolled back; the last line prints ALL CHECKS PASSED.

begin;
set local client_min_messages = warning;

insert into public.roles (name, permissions, description, is_system)
select 'Memory test: sales', '{"can_view_customers": true, "can_view_sales": true}'::jsonb, 'AST-3 test', false
where not exists (select 1 from public.roles where name = 'Memory test: sales');
insert into public.roles (name, permissions, description, is_system)
select 'Memory test: none', '{}'::jsonb, 'AST-3 test', false
where not exists (select 1 from public.roles where name = 'Memory test: none');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a53-00000000000a', 'ast3-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0a53-00000000000e', 'ast3-e@example.test', '{"full_name": "Elvin Sales", "role_name": "Memory test: sales"}'),
  ('00000000-0000-0000-0a53-00000000000f', 'ast3-f@example.test', '{"full_name": "Fidan None", "role_name": "Memory test: none"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0a53-00000000000a';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Memory test: sales' limit 1)
where id = '00000000-0000-0000-0a53-00000000000e';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Memory test: none' limit 1)
where id = '00000000-0000-0000-0a53-00000000000f';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

truncate public.assistant_memory;

do $$
declare
  a uuid := '00000000-0000-0000-0a53-00000000000a';
  e uuid := '00000000-0000-0000-0a53-00000000000e';
  f uuid := '00000000-0000-0000-0a53-00000000000f';
  cust uuid := '00000000-0000-0000-0a53-0000000000c1';
  prod uuid := '00000000-0000-0000-0a53-0000000000d1';
  v_id uuid;
  v_n int;
  v_ok boolean;
begin
  -- The server writes company notes and notes about anyone.
  perform pg_temp.as_server();
  perform public.assistant_memory_save('company', 'Price list', 'Prices are reviewed every Monday.', 'fact');
  perform public.assistant_memory_save('employee_note', 'VAT on services', 'Often forgets VAT on service lines.', 'skill_gap', e);
  perform public.assistant_memory_save('user', 'Fidan routine', 'Enters supplier invoices on Mondays.', 'routine', f);
  perform public.assistant_memory_save('product', 'Black panel', 'Sold in sheets of 2.8 m.', 'fact', prod);

  -- An employee writes about themselves and the customers they may see …
  perform pg_temp.as_user(e);
  v_id := public.assistant_memory_save('user', 'Report language', 'Prefers reports in Russian.', 'preference');
  if (select subject_id from public.assistant_memory where id = v_id) <> e then raise exception 'FAIL own note subject'; end if;
  if (select source from public.assistant_memory where id = v_id) <> 'assistant' then raise exception 'FAIL default source'; end if;
  perform public.assistant_memory_save('partner', 'Konik pays late', 'Konik MMC usually pays 10 days late.', 'pattern', cust, 'admin');
  if (select source from public.assistant_memory where subject = 'Konik pays late') <> 'user' then raise exception 'FAIL an employee cannot write as admin'; end if;
  -- … but not about someone else, the company, employee notes or products they may not see.
  v_ok := false; begin perform public.assistant_memory_save('user', 'About Fidan', 'Fidan is slow.', 'fact', f); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL note about another user'; end if;
  v_ok := false; begin perform public.assistant_memory_save('company', 'Company fact', 'We close at six.', 'fact'); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL company note by employee'; end if;
  v_ok := false; begin perform public.assistant_memory_save('employee_note', 'Self note', 'Something here.', 'fact', e); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL employee_note by employee'; end if;
  v_ok := false; begin perform public.assistant_memory_save('product', 'Panel note', 'Something here.', 'fact', prod); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL product note without can_view_products'; end if;

  -- Without the permission, not even a customer note.
  perform pg_temp.as_user(f);
  v_ok := false; begin perform public.assistant_memory_save('partner', 'Konik', 'Something here.', 'fact', cust); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL partner note without can_view_customers'; end if;

  -- Forbidden topics are refused, even for the server and admins.
  perform pg_temp.as_server();
  v_ok := false; begin perform public.assistant_memory_save('company', 'Wifi', 'The office password is 1234.', 'fact'); exception when others then v_ok := sqlerrm = 'forbidden_memory'; end;
  if not v_ok then raise exception 'FAIL forbidden password'; end if;
  v_ok := false; begin perform public.assistant_memory_save('user', 'Health', 'Elvin was on sick leave, diagnosis flu.', 'fact', e); exception when others then v_ok := sqlerrm = 'forbidden_memory'; end;
  if not v_ok then raise exception 'FAIL forbidden health'; end if;
  v_ok := false; begin perform public.assistant_memory_save('user', 'Din', 'Elvin dini bayramlarda işləmir.', 'fact', e); exception when others then v_ok := sqlerrm = 'forbidden_memory'; end;
  if not v_ok then raise exception 'FAIL forbidden religion (az)'; end if;
  v_ok := false; begin perform public.assistant_memory_save('company', 'Политика', 'Директор поддерживает политическую партию X.', 'fact'); exception when others then v_ok := sqlerrm = 'forbidden_memory'; end;
  if not v_ok then raise exception 'FAIL forbidden politics (ru)'; end if;
  -- Bad input.
  v_ok := false; begin perform public.assistant_memory_save('company', 'x', 'too short subject', 'fact'); exception when others then v_ok := sqlerrm = 'invalid_memory'; end;
  if not v_ok then raise exception 'FAIL short subject'; end if;
  v_ok := false; begin perform public.assistant_memory_save('partner', 'No subject id', 'Missing the customer.', 'fact'); exception when others then v_ok := sqlerrm = 'invalid_memory'; end;
  if not v_ok then raise exception 'FAIL partner without id'; end if;

  -- Saving the same subject again updates the note.
  perform public.assistant_memory_save('company', '  price   LIST ', 'Prices are reviewed every Tuesday.', 'fact');
  if (select count(*) from public.assistant_memory where scope = 'company' and lower(subject) = 'price list') <> 1 then raise exception 'FAIL one note per subject'; end if;
  if (select body from public.assistant_memory where scope = 'company' and lower(subject) = 'price list') not like '%Tuesday%' then raise exception 'FAIL update by subject'; end if;

  -- Only admins read the table.
  perform pg_temp.as_user(e);
  execute 'set local role authenticated';
  select count(*) into v_n from public.assistant_memory;
  if v_n <> 0 then raise exception 'FAIL an employee reads % notes', v_n; end if;
  perform pg_temp.as_user(a);
  select count(*) into v_n from public.assistant_memory;
  if v_n <> 6 then raise exception 'FAIL admin reads all notes: %', v_n; end if;
  execute 'reset role';

  -- One turn's notes: company + own (user and employee notes) + the record in view they may see.
  perform pg_temp.as_user(e);
  select count(*) into v_n from public.assistant_memory_for_turn('customer', cust);
  if v_n <> 4 then raise exception 'FAIL for_turn (employee, customer in view): %', v_n; end if;
  if exists (select 1 from public.assistant_memory_for_turn('customer', cust) where subject = 'Fidan routine') then raise exception 'FAIL another user''s note in the turn'; end if;
  if exists (select 1 from public.assistant_memory_for_turn('product', prod) where subject = 'Black panel') then raise exception 'FAIL product note without permission'; end if;
  select count(*) into v_n from public.assistant_memory_for_turn(null, null);
  if v_n <> 3 then raise exception 'FAIL for_turn without a record: %', v_n; end if;
  perform pg_temp.as_user(f);
  if exists (select 1 from public.assistant_memory_for_turn('customer', cust) where scope = 'partner') then raise exception 'FAIL partner note without can_view_customers'; end if;
  select count(*) into v_n from public.assistant_memory_for_turn(null, null);
  if v_n <> 2 then raise exception 'FAIL for_turn for Fidan (company + own): %', v_n; end if;

  -- Recall: the same visibility, by text.
  perform pg_temp.as_user(e);
  if not exists (select 1 from public.assistant_memory_recall('late')) then raise exception 'FAIL recall finds the customer note'; end if;
  if exists (select 1 from public.assistant_memory_recall('Mondays')) then raise exception 'FAIL recall shows another user''s note'; end if;
  perform pg_temp.as_user(a);
  if not exists (select 1 from public.assistant_memory_recall('Mondays')) then raise exception 'FAIL admin recall sees all'; end if;

  -- Touch marks use.
  perform pg_temp.as_user(e);
  perform public.assistant_memory_touch(array(select id from public.assistant_memory_for_turn(null, null)));
  if (select use_count from public.assistant_memory where subject = 'Report language') <> 1 or (select last_used_at from public.assistant_memory where subject = 'Report language') is null then
    raise exception 'FAIL touch';
  end if;

  -- An employee cannot edit or delete; an admin can, and it is audited.
  select id into v_id from public.assistant_memory where subject = 'Konik pays late';
  v_ok := false; begin perform public.assistant_memory_delete(v_id); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL employee delete'; end if;
  v_ok := false; begin perform public.assistant_memory_update(v_id, 'Konik', 'Changed by employee.'); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL employee update'; end if;
  perform pg_temp.as_user(a);
  perform public.assistant_memory_update(v_id, 'Konik pays late', 'Konik MMC pays about two weeks late.', 'pattern');
  if (select source from public.assistant_memory where id = v_id) <> 'admin' then raise exception 'FAIL admin edit source'; end if;
  if not exists (select 1 from public.audit_logs where table_name = 'assistant_memory' and record_id = v_id and action = 'UPDATE' and user_id = a) then raise exception 'FAIL edit audited'; end if;
  perform public.assistant_memory_delete(v_id);
  if exists (select 1 from public.assistant_memory where id = v_id) then raise exception 'FAIL delete'; end if;
  if not exists (select 1 from public.audit_logs where table_name = 'assistant_memory' and record_id = v_id and action = 'DELETE') then raise exception 'FAIL delete audited'; end if;
  v_id := public.assistant_memory_save('company', 'Admin rule', 'Discounts above 10% need the director.', 'fact', null, 'admin');
  if not exists (select 1 from public.audit_logs where table_name = 'assistant_memory' and record_id = v_id and action = 'CREATE') then raise exception 'FAIL admin note audited'; end if;

  -- Expired notes are not used.
  perform pg_temp.as_server();
  perform public.assistant_memory_save('company', 'Old promo', 'Promo until yesterday.', 'fact', null, 'assistant', 1, '{}'::jsonb, now() - interval '1 day');
  perform pg_temp.as_user(e);
  if exists (select 1 from public.assistant_memory_for_turn(null, null) where subject = 'Old promo') then raise exception 'FAIL expired note used'; end if;
end $$;

-- An inactive user gets nothing and writes nothing.
select pg_temp.as_server();
update public.profiles set is_active = false where id = '00000000-0000-0000-0a53-00000000000e';
do $$
declare v_ok boolean := false;
begin
  perform pg_temp.as_user('00000000-0000-0000-0a53-00000000000e');
  if exists (select 1 from public.assistant_memory_for_turn(null, null)) then raise exception 'FAIL inactive reads notes'; end if;
  begin perform public.assistant_memory_save('user', 'Inactive', 'Should not be saved.', 'fact'); exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'FAIL inactive writes'; end if;
end $$;
select pg_temp.as_server();
update public.profiles set is_active = true where id = '00000000-0000-0000-0a53-00000000000e';

-- anon may call nothing.
do $$
declare v_ok boolean := false;
begin
  execute 'set local role anon';
  begin perform public.assistant_memory_for_turn(null, null); exception when insufficient_privilege then v_ok := true; end;
  execute 'reset role';
  if not v_ok then raise exception 'FAIL anon for_turn'; end if;
end $$;

-- The guard's notes are copied once: never again after the first run, even if an admin deleted one.
select pg_temp.as_server();
insert into public.guard_agent_memory (kind, subject, body, source) values ('pattern', 'Konik rounding', 'Konik invoices are rounded to 0.05.', 'agent');
delete from public.assistant_memory_imports where name = 'guard_agent_memory';
\ir ../migrations/20261121110000_assistant_memory.sql
do $$
begin
  if (select count(*) from public.assistant_memory where scope = 'company' and subject = 'Konik rounding') <> 1 then raise exception 'FAIL guard note copied'; end if;
  if (select evidence ->> 'guard_memory_id' from public.assistant_memory where subject = 'Konik rounding') is null then raise exception 'FAIL guard evidence'; end if;
  delete from public.assistant_memory where subject = 'Konik rounding';
end $$;
\ir ../migrations/20261121110000_assistant_memory.sql
do $$
begin
  if exists (select 1 from public.assistant_memory where subject = 'Konik rounding') then raise exception 'FAIL a deleted guard note came back on re-run'; end if;
end $$;

-- The cap: 5 000 notes.
do $$
declare v_ok boolean := false;
begin
  perform pg_temp.as_server();
  insert into public.assistant_memory (scope, kind, subject, body)
  select 'company', 'fact', 'Filler note ' || g, 'Filler body text ' || g
  from generate_series(1, 5000 - (select count(*) from public.assistant_memory)) g;
  begin perform public.assistant_memory_save('company', 'One too many', 'This one does not fit.', 'fact'); exception when others then v_ok := sqlerrm = 'memory_full'; end;
  if not v_ok then raise exception 'FAIL cap'; end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
