-- Checks supabase/migrations/20261015100000_activities_chatter.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Three users: an admin (A), a user without CRM access (B) and a non-admin with CRM access (C).
-- The record is a CRM deal, whose own policies let A and C read it and hide it from B.

insert into public.roles (id, name, permissions, description, created_at, is_system, scopes) values
  ('00000000-0000-0000-00c4-0000000000b0', 'Chatter test: no CRM', '{}'::jsonb, null, now(), false, '{}'::jsonb),
  ('00000000-0000-0000-00c4-0000000000c0', 'Chatter test: CRM', '{"can_view_crm": true, "can_manage_crm": true}'::jsonb, null, now(), false, '{}'::jsonb)
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00c4-00000000000a', 'chat-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00c4-00000000000b', 'chat-b@example.test', '{"full_name": "Bəhruz NoCRM", "role_name": "Chatter test: no CRM"}'),
  ('00000000-0000-0000-00c4-00000000000c', 'chat-c@example.test', '{"full_name": "Cavid CRM", "role_name": "Chatter test: CRM"}')
on conflict (id) do nothing;

insert into public.deals (id, title) values ('00000000-0000-0000-00c4-0000000000d1', 'Chatter test deal') on conflict (id) do nothing;

-- ── A: admin, can read the deal ─────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00c4-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_id uuid;
  v_count integer;
begin
  if not public.chatter_record_visible('deals', '00000000-0000-0000-00c4-0000000000d1') then raise exception 'FAIL admin cannot see the deal'; end if;
  if public.chatter_record_visible('not_a_table', '00000000-0000-0000-00c4-0000000000d1') then raise exception 'FAIL unknown model visible'; end if;
  if public.chatter_record_visible('deals', '00000000-0000-0000-00c4-0000000000ff') then raise exception 'FAIL missing record visible'; end if;

  insert into public.mail_messages (res_model, res_id, kind, body) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'note', 'Called the customer') returning id into v_id;
  if (select author_name from public.mail_messages where id = v_id) <> 'Aysel Admin' then raise exception 'FAIL author name not stored'; end if;
  insert into public.mail_messages (res_model, res_id, kind, body) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'message', 'Quote sent');

  -- Authors cannot be faked, "log" is system-only, unknown models and empty bodies are refused.
  begin
    insert into public.mail_messages (res_model, res_id, kind, body, author_id) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'note', 'x', '00000000-0000-0000-00c4-00000000000c');
    raise exception 'FAIL posted as another user';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.mail_messages (res_model, res_id, kind, body) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'log', 'fake log');
    raise exception 'FAIL user wrote a log line';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.mail_messages (res_model, res_id, kind, body) values ('profiles', '00000000-0000-0000-00c4-00000000000a', 'note', 'x');
    raise exception 'FAIL message on a table without chatter';
  exception when check_violation or insufficient_privilege then null;
  end;
  begin
    insert into public.mail_messages (res_model, res_id, kind, body) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'note', '   ');
    raise exception 'FAIL empty message';
  exception when check_violation then null;
  end;

  -- Editing marks the note as edited; the author and the record stay.
  update public.mail_messages set body = 'Called the customer twice', author_id = '00000000-0000-0000-00c4-00000000000c', res_id = '00000000-0000-0000-00c4-0000000000ff' where id = v_id;
  if (select edited_at is null or author_id <> '00000000-0000-0000-00c4-00000000000a' or res_id <> '00000000-0000-0000-00c4-0000000000d1' from public.mail_messages where id = v_id) then
    raise exception 'FAIL edit changed author or record, or was not marked';
  end if;

  -- A schedules a call for C.
  insert into public.activities (res_model, res_id, activity_type, summary, due_date, assigned_to)
  values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'call', 'Follow-up call', current_date + 1, '00000000-0000-0000-00c4-00000000000c');
  insert into public.activities (res_model, res_id, activity_type, summary, due_date)
  values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'todo', 'Prepare drawings', current_date);
  begin
    insert into public.activities (res_model, res_id, activity_type, summary, due_date) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'lunch', 'x', current_date);
    raise exception 'FAIL unknown activity type';
  exception when check_violation then null;
  end;
  select count(*) into v_count from public.chatter_users() where full_name in ('Aysel Admin', 'Cavid CRM');
  if v_count <> 2 then raise exception 'FAIL assignee list incomplete: %', v_count; end if;
end $$;
commit;

-- ── B: cannot read the deal, so sees and writes nothing on it ──────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00c4-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.mail_messages where res_id = '00000000-0000-0000-00c4-0000000000d1';
  if v_count <> 0 then raise exception 'FAIL user without access sees % messages', v_count; end if;
  select count(*) into v_count from public.activities where res_id = '00000000-0000-0000-00c4-0000000000d1';
  if v_count <> 0 then raise exception 'FAIL user without access sees % activities', v_count; end if;
  begin
    insert into public.mail_messages (res_model, res_id, kind, body) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'note', 'sneaky');
    raise exception 'FAIL user without access posted a note';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.activities (res_model, res_id, summary, due_date) values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'sneaky', current_date);
    raise exception 'FAIL user without access scheduled an activity';
  exception when insufficient_privilege then null;
  end;
  update public.activities set summary = 'hijacked' where res_id = '00000000-0000-0000-00c4-0000000000d1';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL user without access changed % activities', v_count; end if;
end $$;
commit;

-- ── C: reads the deal (CRM role), completes the activity assigned to them ──
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00c4-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.mail_messages where res_id = '00000000-0000-0000-00c4-0000000000d1' and kind in ('note', 'message');
  if v_count <> 2 then raise exception 'FAIL CRM user sees % of 2 messages', v_count; end if;

  -- C cannot edit or delete A's note.
  update public.mail_messages set body = 'changed by C' where author_name = 'Aysel Admin';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL edited someone else''s note'; end if;
  delete from public.mail_messages where author_name = 'Aysel Admin';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL deleted someone else''s note'; end if;

  -- The assignee marks the call done: done_by is the assignee and a log line is written.
  update public.activities set done_at = now() where summary = 'Follow-up call';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL assignee could not complete the activity'; end if;
  if (select done_by from public.activities where summary = 'Follow-up call') <> '00000000-0000-0000-00c4-00000000000c' then raise exception 'FAIL done_by not the assignee'; end if;
  if not exists (select 1 from public.mail_messages where kind = 'log' and body = 'activity_done:call:Follow-up call' and author_id = '00000000-0000-0000-00c4-00000000000c') then
    raise exception 'FAIL no log line for the completed activity';
  end if;

  -- C did not create or get the to-do, and is not admin: cannot change or delete it.
  update public.activities set summary = 'renamed' where summary = 'Prepare drawings';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL changed an activity of someone else'; end if;
  delete from public.activities where summary = 'Prepare drawings';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL deleted an activity of someone else'; end if;
end $$;
commit;

-- ── A deletes the to-do; reopening clears done_by ───────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00c4-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_count integer;
begin
  update public.activities set done_at = null where summary = 'Follow-up call';
  if (select done_by from public.activities where summary = 'Follow-up call') is not null then raise exception 'FAIL reopened activity keeps done_by'; end if;
  delete from public.activities where summary = 'Prepare drawings';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL creator could not delete'; end if;
end $$;
commit;

-- Anonymous visitors have no access.
begin;
set local role anon;
do $$
begin
  perform 1 from public.mail_messages;
  raise exception 'FAIL anon can read messages';
exception when insufficient_privilege then null;
end $$;
commit;

select 'ALL CHECKS PASSED';
