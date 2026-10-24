-- Checks supabase/migrations/20261015100000_activities_chatter.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Three users: an admin (A), a user without CRM access (B) and a non-admin with CRM access (C).
-- Covers messages, activities, activity types, followers, attachments and tracked fields.
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
  exception when foreign_key_violation then null;
  end;

  -- Admins add activity types; a new type can be used at once.
  insert into public.activity_types (code, name, icon, default_days) values ('site_visit', 'Site visit', 'meeting', 2);
  insert into public.activities (res_model, res_id, activity_type, summary, due_date)
  values ('deals', '00000000-0000-0000-00c4-0000000000d1', 'site_visit', 'Measure the showroom', current_date + 2);

  -- Authors and assignees follow the record automatically.
  select count(*) into v_count from public.mail_followers
   where res_model = 'deals' and res_id = '00000000-0000-0000-00c4-0000000000d1'
     and user_id in ('00000000-0000-0000-00c4-00000000000a', '00000000-0000-0000-00c4-00000000000c');
  if v_count <> 2 then raise exception 'FAIL author and assignee do not both follow: %', v_count; end if;

  -- A file on A's note must be stored under the deal.
  insert into public.mail_attachments (message_id, storage_path, file_name, mime_type, size_bytes)
  values (v_id, 'deals/00000000-0000-0000-00c4-0000000000d1/plan.pdf', 'plan.pdf', 'application/pdf', 1200);
  if (select res_model || '/' || res_id from public.mail_attachments where file_name = 'plan.pdf') <> 'deals/00000000-0000-0000-00c4-0000000000d1' then
    raise exception 'FAIL attachment record not copied from the message';
  end if;
  begin
    insert into public.mail_attachments (message_id, storage_path, file_name) values (v_id, 'sales/00000000-0000-0000-00c4-0000000000d1/x.pdf', 'x.pdf');
    raise exception 'FAIL attachment stored under another record';
  exception when invalid_parameter_value then null;
  end;
  if not public.chatter_path_visible('deals/00000000-0000-0000-00c4-0000000000d1/plan.pdf') then raise exception 'FAIL admin cannot see the file path'; end if;
  if public.chatter_path_visible('deals/not-a-uuid/plan.pdf') or public.chatter_path_visible('deals/00000000-0000-0000-00c4-0000000000d1') then
    raise exception 'FAIL malformed file path visible';
  end if;

  -- Changing a tracked field writes a log line with the old and new value.
  update public.deals set title = 'Chatter test deal (renamed)' where id = '00000000-0000-0000-00c4-0000000000d1';
  if not exists (
    select 1 from public.mail_messages
     where res_model = 'deals' and res_id = '00000000-0000-0000-00c4-0000000000d1' and kind = 'log'
       and body like 'tracking:%'
       and (substr(body, 10)::jsonb -> 0 ->> 'f') = 'title'
       and (substr(body, 10)::jsonb -> 0 ->> 'n') = 'Chatter test deal (renamed)'
  ) then
    raise exception 'FAIL no tracking line for the title change';
  end if;
  -- An untracked change writes nothing.
  select count(*) into v_count from public.mail_messages where res_id = '00000000-0000-0000-00c4-0000000000d1' and body like 'tracking:%';
  update public.deals set notes = 'untracked' where id = '00000000-0000-0000-00c4-0000000000d1';
  if (select count(*) from public.mail_messages where res_id = '00000000-0000-0000-00c4-0000000000d1' and body like 'tracking:%') <> v_count then
    raise exception 'FAIL untracked field wrote a log line';
  end if;
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
  select count(*) into v_count from public.mail_followers where res_id = '00000000-0000-0000-00c4-0000000000d1';
  if v_count <> 0 then raise exception 'FAIL user without access sees % followers', v_count; end if;
  select count(*) into v_count from public.mail_attachments where res_id = '00000000-0000-0000-00c4-0000000000d1';
  if v_count <> 0 then raise exception 'FAIL user without access sees % attachments', v_count; end if;
  if public.chatter_path_visible('deals/00000000-0000-0000-00c4-0000000000d1/plan.pdf') then raise exception 'FAIL user without access sees the file path'; end if;
  begin
    insert into public.mail_followers (res_model, res_id, user_id) values ('deals', '00000000-0000-0000-00c4-0000000000d1', '00000000-0000-0000-00c4-00000000000b');
    raise exception 'FAIL user without access followed the record';
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

  -- Activity types: readable, but only admins change them.
  if not exists (select 1 from public.activity_types where code = 'site_visit') then raise exception 'FAIL CRM user cannot read activity types'; end if;
  begin
    insert into public.activity_types (code, name) values ('party', 'Party');
    raise exception 'FAIL non-admin added an activity type';
  exception when insufficient_privilege then null;
  end;
  update public.activity_types set name = 'renamed' where code = 'site_visit';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL non-admin changed an activity type'; end if;

  -- Followers: C sees them, cannot remove A (A followed on their own), can leave and come back.
  select count(*) into v_count from public.mail_followers where res_id = '00000000-0000-0000-00c4-0000000000d1';
  if v_count < 2 then raise exception 'FAIL CRM user sees % followers', v_count; end if;
  delete from public.mail_followers where res_id = '00000000-0000-0000-00c4-0000000000d1' and user_id = '00000000-0000-0000-00c4-00000000000a';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL removed another user''s follow'; end if;
  delete from public.mail_followers where res_id = '00000000-0000-0000-00c4-0000000000d1' and user_id = '00000000-0000-0000-00c4-00000000000c';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL could not unfollow'; end if;
  insert into public.mail_followers (res_model, res_id, user_id) values ('deals', '00000000-0000-0000-00c4-0000000000d1', '00000000-0000-0000-00c4-00000000000c');

  -- C sees A's file, but cannot attach files to A's note or remove A's file.
  select count(*) into v_count from public.mail_attachments where res_id = '00000000-0000-0000-00c4-0000000000d1';
  if v_count <> 1 then raise exception 'FAIL CRM user sees % of 1 attachments', v_count; end if;
  begin
    insert into public.mail_attachments (message_id, storage_path, file_name)
    select id, 'deals/00000000-0000-0000-00c4-0000000000d1/c.pdf', 'c.pdf' from public.mail_messages where author_name = 'Aysel Admin' and kind = 'note' limit 1;
    raise exception 'FAIL attached a file to someone else''s note';
  exception when insufficient_privilege then null;
  end;
  delete from public.mail_attachments where file_name = 'plan.pdf';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL deleted someone else''s file'; end if;
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
  begin
    perform 1 from public.mail_messages;
    raise exception 'FAIL anon can read messages';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.mail_followers;
    raise exception 'FAIL anon can read followers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.mail_attachments;
    raise exception 'FAIL anon can read attachments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.activity_types;
    raise exception 'FAIL anon can read activity types';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

select 'ALL CHECKS PASSED';
