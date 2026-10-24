-- Checks supabase/migrations/20261024110000_todo.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Three users: an admin (A), and two staff users (B, C). C captures a task, adds a checklist
-- and A as assignee; A finishes it in A's own done stage; B never sees it until added.

insert into public.roles (id, name, permissions, description, created_at, is_system, scopes) values
  ('00000000-0000-0000-00cb-0000000000b0', 'To-do test: staff', '{}'::jsonb, null, now(), false, '{}'::jsonb)
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00cb-00000000000a', 'todo-a@example.test', '{"full_name": "Arzu Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00cb-00000000000b', 'todo-b@example.test', '{"full_name": "Bayram Staff", "role_name": "To-do test: staff"}'),
  ('00000000-0000-0000-00cb-00000000000c', 'todo-c@example.test', '{"full_name": "Cəmilə Staff", "role_name": "To-do test: staff"}')
on conflict (id) do nothing;

-- ── C: captures a task ──────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cb-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_task uuid;
  v_inbox uuid;
  v_member public.todo_task_members;
begin
  insert into public.todo_tasks (title, priority, tags, due_date) values ('Order samples', 2, '{sales}', current_date) returning id into v_task;
  -- The creator is a member, in their first stage (the built-in stages were created).
  select * into v_member from public.todo_task_members where task_id = v_task and user_id = '00000000-0000-0000-00cb-00000000000c';
  select id into v_inbox from public.todo_stages where user_id = '00000000-0000-0000-00cb-00000000000c' and code = 'inbox';
  if v_member.task_id is null or v_member.stage_id is distinct from v_inbox then raise exception 'FAIL creator not in their inbox: %', row_to_json(v_member); end if;
  if (select count(*) from public.todo_stages where user_id = '00000000-0000-0000-00cb-00000000000c') <> 5 then raise exception 'FAIL built-in stages not created'; end if;

  insert into public.todo_checklist_items (task_id, label, sequence) values (v_task, 'Ask for prices', 10), (v_task, 'Pick colours', 20);
  -- A is assigned; giving A one of C's stages puts A's card in A's own first stage.
  insert into public.todo_task_members (task_id, user_id, stage_id) values (v_task, '00000000-0000-0000-00cb-00000000000a', v_inbox);
  if (select s.user_id from public.todo_task_members m join public.todo_stages s on s.id = m.stage_id
       where m.task_id = v_task and m.user_id = '00000000-0000-0000-00cb-00000000000a') <> '00000000-0000-0000-00cb-00000000000a' then
    raise exception 'FAIL assignee card in someone else''s stage';
  end if;

  -- Tasks are created as yourself; titles must not be empty; the chatter works on tasks.
  begin
    insert into public.todo_tasks (title, created_by) values ('x', '00000000-0000-0000-00cb-00000000000b');
    raise exception 'FAIL created a task for someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.todo_tasks (title) values ('   ');
    raise exception 'FAIL empty title';
  exception when check_violation then null;
  end;
  if not ('todo_tasks' = any (public.chatter_models())) then raise exception 'FAIL tasks carry no chatter'; end if;
  insert into public.mail_messages (res_model, res_id, kind, body) values ('todo_tasks', v_task, 'note', 'Supplier called back');
  -- C cannot see or change another user's stages.
  update public.todo_stages set name = 'mine' where user_id = '00000000-0000-0000-00cb-00000000000a';
  if found then raise exception 'FAIL changed someone else''s stage'; end if;
end $$;
commit;

-- ── B: not a member ─────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cb-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_count integer;
  v_task uuid := (select id from public.todo_tasks where title = 'Order samples');
begin
  if v_task is not null then raise exception 'FAIL non-member sees the task'; end if;
  select count(*) into v_count from public.todo_checklist_items;
  if v_count <> 0 then raise exception 'FAIL non-member sees % checklist lines', v_count; end if;
  select count(*) into v_count from public.todo_task_members where user_id <> '00000000-0000-0000-00cb-00000000000b';
  if v_count <> 0 then raise exception 'FAIL non-member sees members'; end if;
  select count(*) into v_count from public.mail_messages where res_model = 'todo_tasks';
  if v_count <> 0 then raise exception 'FAIL non-member sees the task''s chatter'; end if;
  begin
    insert into public.todo_task_members (task_id, user_id)
    select t.id, '00000000-0000-0000-00cb-00000000000b' from public.todo_tasks t where t.title = 'Order samples';
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'FAIL non-member joined a task'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- ── A: assignee (and admin) finishes the task ───────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cb-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_count integer;
  v_task uuid := (select id from public.todo_tasks where title = 'Order samples');
  v_done uuid := (select id from public.todo_stages where user_id = '00000000-0000-0000-00cb-00000000000a' and is_done);
  v_today uuid := (select id from public.todo_stages where user_id = '00000000-0000-0000-00cb-00000000000a' and code = 'today');
begin
  if v_task is null then raise exception 'FAIL assignee cannot see the task'; end if;
  if (select count(*) from public.todo_checklist_items where task_id = v_task) <> 2 then raise exception 'FAIL assignee does not see the checklist'; end if;
  update public.todo_checklist_items set done = true where task_id = v_task;
  -- Moving into the done stage finishes the task for everyone; out of it reopens it.
  update public.todo_task_members set stage_id = v_done where task_id = v_task and user_id = '00000000-0000-0000-00cb-00000000000a';
  if (select done_at is null from public.todo_tasks where id = v_task) then raise exception 'FAIL done stage did not finish the task'; end if;
  update public.todo_task_members set stage_id = v_today where task_id = v_task and user_id = '00000000-0000-0000-00cb-00000000000a';
  if (select done_at is not null from public.todo_tasks where id = v_task) then raise exception 'FAIL leaving the done stage did not reopen'; end if;
  update public.todo_task_members set stage_id = v_done where task_id = v_task and user_id = '00000000-0000-0000-00cb-00000000000a';
  -- A moves only their own card (C's card stays where C put it).
  update public.todo_task_members set stage_id = v_today, sequence = 99 where task_id = v_task and user_id = '00000000-0000-0000-00cb-00000000000c';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL moved another member''s card'; end if;
  -- A adds B; B's card is in B's first stage (created for B).
  insert into public.todo_task_members (task_id, user_id) values (v_task, '00000000-0000-0000-00cb-00000000000b');
end $$;
commit;

-- ── B: now a member, but not the creator ────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cb-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_count integer;
  v_task uuid := (select id from public.todo_tasks where title = 'Order samples');
begin
  if v_task is null then raise exception 'FAIL new member cannot see the task'; end if;
  if (select count(*) from public.todo_stages where user_id = '00000000-0000-0000-00cb-00000000000b') <> 5 then raise exception 'FAIL new member got no stages'; end if;
  if (select done_at is null from public.todo_tasks where id = v_task) then raise exception 'FAIL done state not shared'; end if;
  delete from public.todo_tasks where id = v_task;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL a member who is not the creator deleted the task'; end if;
  -- Deleting a stage moves its cards to the first stage.
  update public.todo_task_members set stage_id = (select id from public.todo_stages where user_id = '00000000-0000-0000-00cb-00000000000b' and code = 'later')
   where task_id = v_task and user_id = '00000000-0000-0000-00cb-00000000000b';
  delete from public.todo_stages where user_id = '00000000-0000-0000-00cb-00000000000b' and code = 'later';
  if (select s.code from public.todo_task_members m join public.todo_stages s on s.id = m.stage_id where m.task_id = v_task and m.user_id = '00000000-0000-0000-00cb-00000000000b') <> 'inbox' then
    raise exception 'FAIL cards of a deleted stage were not moved to the first stage';
  end if;
  -- B leaves the task.
  delete from public.todo_task_members where task_id = v_task and user_id = '00000000-0000-0000-00cb-00000000000b';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL member could not leave'; end if;
end $$;
commit;

-- ── C deletes the task: members, checklist go with it ───────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cb-00000000000c","role":"authenticated"}', true);
do $$
declare
  v_task uuid := (select id from public.todo_tasks where title = 'Order samples');
begin
  delete from public.todo_tasks where id = v_task;
  if exists (select 1 from public.todo_tasks where id = v_task) then raise exception 'FAIL creator could not delete'; end if;
end $$;
commit;

do $$
begin
  if exists (select 1 from public.todo_task_members m left join public.todo_tasks t on t.id = m.task_id where t.id is null)
     or exists (select 1 from public.todo_checklist_items i left join public.todo_tasks t on t.id = i.task_id where t.id is null) then
    raise exception 'FAIL rows left behind by a deleted task';
  end if;
end $$;

-- Anonymous visitors have no access.
begin;
set local role anon;
do $$
begin
  perform 1 from public.todo_tasks;
  raise exception 'FAIL anon can read tasks';
exception when insufficient_privilege then null;
end $$;
commit;

select 'ALL CHECKS PASSED';
