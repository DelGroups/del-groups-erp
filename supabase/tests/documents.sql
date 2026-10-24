-- Checks supabase/migrations/20261024120000_documents.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Users: an admin (A), B with role "Docs test: sales", C with role "Docs test: finance".
-- C makes a Finance folder, shares it with the finance role and with B read-only; files,
-- subfolders, requests and system folders follow those rules.

insert into public.roles (id, name, permissions, description, created_at, is_system, scopes) values
  ('00000000-0000-0000-00cd-0000000000b0', 'Docs test: sales', '{}'::jsonb, null, now(), false, '{}'::jsonb),
  ('00000000-0000-0000-00cd-0000000000c0', 'Docs test: finance', '{}'::jsonb, null, now(), false, '{}'::jsonb)
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00cd-00000000000a', 'docs-a@example.test', '{"full_name": "Aqil Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00cd-00000000000b', 'docs-b@example.test', '{"full_name": "Banu Sales", "role_name": "Docs test: sales"}'),
  ('00000000-0000-0000-00cd-00000000000c', 'docs-c@example.test', '{"full_name": "Cahid Finance", "role_name": "Docs test: finance"}')
on conflict (id) do nothing;

-- The test roles are set on the profiles (the profile trigger may map role names differently).
update public.profiles set role_id = '00000000-0000-0000-00cd-0000000000b0' where id = '00000000-0000-0000-00cd-00000000000b';
update public.profiles set role_id = '00000000-0000-0000-00cd-0000000000c0' where id = '00000000-0000-0000-00cd-00000000000c';

do $$
begin
  if (select count(*) from public.document_folders where system_code in ('expenses', 'contracts', 'products')) <> 3 then
    raise exception 'FAIL system folders not seeded';
  end if;
end $$;

-- ── C: a folder, open first, then shared ────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_finance uuid;
  v_sub uuid;
begin
  insert into public.document_folders (name) values ('Finance') returning id into v_finance;
  insert into public.document_folders (name, parent_id) values ('2026', v_finance) returning id into v_sub;
  -- No rules yet: open to everyone (checked as B below), writable for C.
  if not public.document_folder_allowed(v_sub, true) then raise exception 'FAIL open folder not writable'; end if;
  insert into public.documents (folder_id, name, storage_path, mime_type, size_bytes, tags)
  values (v_sub, 'budget.pdf', v_sub || '/u1-budget.pdf', 'application/pdf', 2048, '{plan}');
  if not public.document_path_writable(v_sub || '/u2-x.pdf') then raise exception 'FAIL path in a writable folder refused'; end if;
  if public.document_path_writable(v_sub || '/a/b.pdf') or public.document_path_writable('not-a-folder/x.pdf') then raise exception 'FAIL malformed path accepted'; end if;
  begin
    insert into public.documents (folder_id, name, storage_path) values (v_sub, 'x', v_finance || '/wrong.pdf');
    raise exception 'FAIL document stored under another folder';
  exception when insufficient_privilege then null;
  end;
  -- No cycles; system folders get no subfolders and no files.
  begin
    update public.document_folders set parent_id = v_sub where id = v_finance;
    raise exception 'FAIL folder moved into itself';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.document_folders (name, parent_id) select 'x', id from public.document_folders where system_code = 'expenses';
    raise exception 'FAIL subfolder in a system folder';
  exception when invalid_parameter_value or insufficient_privilege then null;
  end;
  begin
    insert into public.documents (folder_id, name, storage_path) select id, 'x', id || '/x.pdf' from public.document_folders where system_code = 'contracts';
    raise exception 'FAIL file added to a system folder';
  exception when insufficient_privilege then null;
  end;
  -- Folders with files cannot be deleted.
  begin
    delete from public.document_folders where id = v_sub;
    raise exception 'FAIL deleted a folder with files';
  exception when foreign_key_violation then null;
  end;
end $$;
commit;

-- B sees the open folder before it is shared.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000b","role":"authenticated"}', true);
do $$
begin
  if not exists (select 1 from public.document_folders where name = 'Finance') then raise exception 'FAIL open folder hidden'; end if;
  if not exists (select 1 from public.documents where name = 'budget.pdf') then raise exception 'FAIL file of an open folder hidden'; end if;
end $$;
commit;

-- C restricts Finance to the finance role.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000c","role":"authenticated"}', true);
do $$
declare
  v_finance uuid := (select id from public.document_folders where name = 'Finance');
begin
  insert into public.document_folder_access (folder_id, role_id, can_write) values (v_finance, '00000000-0000-0000-00cd-0000000000c0', true);
  if not public.document_folder_allowed((select id from public.document_folders where name = '2026'), true) then raise exception 'FAIL finance role lost write access'; end if;
end $$;
commit;

-- B (sales role) no longer sees Finance, its subfolder or its files.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.document_folders where name in ('Finance', '2026');
  if v_count <> 0 then raise exception 'FAIL restricted folders visible: %', v_count; end if;
  select count(*) into v_count from public.documents where name = 'budget.pdf';
  if v_count <> 0 then raise exception 'FAIL file of a restricted folder visible'; end if;
  -- System folders are listed (their files come from the server with each module's check).
  select count(*) into v_count from public.document_folders where system_code is not null;
  if v_count <> 3 then raise exception 'FAIL system folders hidden: %', v_count; end if;
  begin
    insert into public.document_folder_access (folder_id, user_id, can_write)
    select id, '00000000-0000-0000-00cd-00000000000b', true from public.document_folders where system_code = 'expenses';
    raise exception 'FAIL non-owner changed sharing';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- C gives B read-only access.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000c","role":"authenticated"}', true);
do $$
begin
  insert into public.document_folder_access (folder_id, user_id, can_write)
  select id, '00000000-0000-0000-00cd-00000000000b', false from public.document_folders where name = 'Finance';
  -- C asks B for a file in 2026.
  insert into public.document_requests (folder_id, title, requested_user_id, due_date)
  select id, 'Signed budget', '00000000-0000-0000-00cd-00000000000b', current_date + 3 from public.document_folders where name = '2026';
  begin
    insert into public.document_requests (folder_id, title, requested_user_id) select id, 'Nobody', null from public.document_folders where name = '2026';
    raise exception 'FAIL request without a person';
  exception when check_violation then null;
  end;
end $$;
commit;

-- B: reads (rules inherited by the subfolder), cannot write, answers the request.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_count integer;
  v_sub uuid := (select id from public.document_folders where name = '2026');
  v_doc uuid := (select id from public.documents where name = 'budget.pdf');
  v_req uuid := (select id from public.document_requests where title = 'Signed budget');
begin
  if v_sub is null or v_doc is null then raise exception 'FAIL read-only member cannot see the subfolder or its file'; end if;
  if public.document_folder_allowed(v_sub, true) then raise exception 'FAIL read-only member may write'; end if;
  begin
    insert into public.documents (folder_id, name, storage_path) values (v_sub, 'mine.pdf', v_sub || '/mine.pdf');
    raise exception 'FAIL read-only member added a file';
  exception when insufficient_privilege then null;
  end;
  update public.documents set name = 'renamed.pdf' where id = v_doc;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL read-only member renamed a file'; end if;
  delete from public.documents where id = v_doc;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL read-only member deleted a file'; end if;
  -- The asked person attaches a document: the request is done; other fields stay.
  update public.document_requests set document_id = v_doc, title = 'changed', status = 'cancelled' where id = v_req;
  if (select status <> 'done' or done_at is null or title <> 'Signed budget' from public.document_requests where id = v_req) then
    raise exception 'FAIL fulfilling the request: %', (select row_to_json(r) from public.document_requests r where id = v_req);
  end if;
end $$;
commit;

-- A (admin) sees everything, still cannot write into system folders.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cd-00000000000a","role":"authenticated"}', true);
do $$
begin
  if not exists (select 1 from public.documents where name = 'budget.pdf') then raise exception 'FAIL admin cannot see a restricted file'; end if;
  if public.document_folder_allowed((select id from public.document_folders where system_code = 'products'), true) then raise exception 'FAIL admin may write into a system folder'; end if;
end $$;
commit;

-- Anonymous visitors have no access.
begin;
set local role anon;
do $$
begin
  perform 1 from public.documents;
  raise exception 'FAIL anon can read documents';
exception when insufficient_privilege then null;
end $$;
commit;

select 'ALL CHECKS PASSED';
