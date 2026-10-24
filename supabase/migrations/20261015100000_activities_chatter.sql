-- Activities and Chatter (phase 19, plan §5.4): notes, messages and activities on any record of
-- the new UI's view engine.
--
--   mail_messages  a record's thread: "note" (internal), "message", and "log" (written by the
--                  system, e.g. when an activity is done; users cannot insert it)
--   activities     to-do / call / meeting on a record, with due date, assignee and done state
--   activity_types the kinds of activity (to-do, call, meeting built in; admins add more)
--   mail_followers users who follow a record (authors and assignees follow automatically)
--   mail_attachments files on a message, stored in the private "chatter-attachments" bucket
--                  under <res_model>/<res_id>/...
--
-- Tracked fields: chatter_track_changes() writes a "log" line ("tracking:[...]") when a tracked
-- field of a sale, purchase, customer or CRM deal changes, generalising the audit_logs idea to
-- the record's own thread. It never blocks the business write.
--
-- Records are named by (res_model, res_id): the table and the row id. Only the tables listed in
-- chatter_models() can carry chatter. Visibility follows the record: a user sees a record's
-- messages and activities only if row level security lets them read that record
-- (chatter_record_visible runs as the user, so the record table's own policies decide).
-- Every tenant has its own database, so rows are scoped to the tenant like every other table.
--
-- Only the new UI (NEW_UI) reads or writes these tables, so applying the migration changes
-- nothing for anyone. Safe to re-run.

-- ── Which tables can carry chatter ─────────────────────────────────────────

create or replace function public.chatter_models()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'accounts', 'contracts', 'customers', 'deals', 'employee_advances', 'employee_leaves', 'employees',
    'expenses', 'inventory_counts', 'inventory_initial_balances', 'inventory_writeoffs', 'payments',
    'payrolls', 'production_orders', 'products', 'purchases', 'sales', 'sales_commissions', 'suppliers',
    'transactions', 'warehouse_slips'
  ]::text[];
$$;

-- True when the current user may read the record (the record table's RLS decides).
create or replace function public.chatter_record_visible(p_model text, p_record uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if p_model is null or p_record is null or not (p_model = any (public.chatter_models())) then
    return false;
  end if;
  if to_regclass('public.' || quote_ident(p_model)) is null then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1)', p_model) into v_found using p_record;
  return coalesce(v_found, false);
end;
$$;

-- Names of active users, for the assignee picker and authors (profiles may be private to admins).
create or replace function public.chatter_users()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email, '')
    from public.profiles p
   where coalesce(p.is_active, true)
   order by 2;
$$;

-- ── Messages ───────────────────────────────────────────────────────────────

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  res_model text not null check (res_model = any (public.chatter_models())),
  res_id uuid not null,
  kind text not null default 'note' check (kind in ('note', 'message', 'log')),
  body text not null check (length(btrim(body)) between 1 and 10000),
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists mail_messages_record_idx on public.mail_messages (res_model, res_id, created_at desc);

comment on table public.mail_messages is
  'Chatter of a record (res_model, res_id): notes, messages and system log lines (phase 19).';

-- ── Activity types ─────────────────────────────────────────────────────────

-- Built-in types have no name (the UI translates the code); admins add their own with a name.
create table if not exists public.activity_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text check (name is null or length(btrim(name)) between 1 and 60),
  icon text not null default 'todo' check (icon in ('todo', 'call', 'meeting', 'email', 'document')),
  default_days integer not null default 0 check (default_days between 0 and 365),
  sequence integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.activity_types (code, name, icon, default_days, sequence) values
  ('todo', null, 'todo', 0, 10),
  ('call', null, 'call', 1, 20),
  ('meeting', null, 'meeting', 3, 30)
on conflict (code) do nothing;

comment on table public.activity_types is
  'Kinds of activity: built-in to-do, call, meeting (translated in the UI) and admin-defined ones (phase 19).';

-- ── Activities ─────────────────────────────────────────────────────────────

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  res_model text not null check (res_model = any (public.chatter_models())),
  res_id uuid not null,
  activity_type text not null default 'todo' references public.activity_types (code) on update cascade,
  summary text not null check (length(btrim(summary)) between 1 and 200),
  note text check (note is null or length(note) <= 5000),
  due_date date not null,
  assigned_to uuid default auth.uid() references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((done_at is null) = (done_by is null))
);

create index if not exists activities_record_idx on public.activities (res_model, res_id, due_date);
create index if not exists activities_assignee_open_idx on public.activities (assigned_to, due_date) where done_at is null;

comment on table public.activities is
  'Planned to-dos, calls and meetings on a record (res_model, res_id), with due date and assignee (phase 19).';

-- ── Followers ──────────────────────────────────────────────────────────────

create table if not exists public.mail_followers (
  id uuid primary key default gen_random_uuid(),
  res_model text not null check (res_model = any (public.chatter_models())),
  res_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (res_model, res_id, user_id)
);

create index if not exists mail_followers_user_idx on public.mail_followers (user_id);

comment on table public.mail_followers is
  'Users following a record''s chatter; authors and assignees follow automatically (phase 19).';

-- ── Attachments ────────────────────────────────────────────────────────────

-- res_model / res_id are copied from the message, so visibility needs no join.
create table if not exists public.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.mail_messages (id) on delete cascade,
  res_model text not null,
  res_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 10485760),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists mail_attachments_message_idx on public.mail_attachments (message_id);

comment on table public.mail_attachments is
  'Files on a chatter message, in the private chatter-attachments bucket under <res_model>/<res_id>/ (phase 19).';

-- True when a storage path "<res_model>/<res_id>/<file>" belongs to a record the user can read.
create or replace function public.chatter_path_visible(p_path text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_model text := split_part(p_path, '/', 1);
  v_id text := split_part(p_path, '/', 2);
begin
  if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or split_part(p_path, '/', 3) = '' then
    return false;
  end if;
  return public.chatter_record_visible(v_model, v_id::uuid);
end;
$$;

-- ── Triggers ───────────────────────────────────────────────────────────────

-- The author's display name is stored with the message (profiles may be private to admins).
create or replace function public.mail_messages_set_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_name := (select coalesce(nullif(btrim(p.full_name), ''), p.email) from public.profiles p where p.id = new.author_id);
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  -- Authors and records never change after posting.
  if tg_op = 'UPDATE' then
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.res_model := old.res_model;
    new.res_id := old.res_id;
    new.kind := old.kind;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists mail_messages_set_author on public.mail_messages;
create trigger mail_messages_set_author before insert or update on public.mail_messages
  for each row execute function public.mail_messages_set_author();

-- Marking an activity done records who did it and writes a log line on the record's chatter.
create or replace function public.activities_track_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.res_model := old.res_model;
  new.res_id := old.res_id;
  new.created_by := old.created_by;
  if new.done_at is not null and old.done_at is null then
    new.done_by := auth.uid();
    insert into public.mail_messages (res_model, res_id, kind, body, author_id)
    values (new.res_model, new.res_id, 'log', 'activity_done:' || new.activity_type || ':' || new.summary, auth.uid());
  elsif new.done_at is null then
    new.done_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists activities_track_done on public.activities;
create trigger activities_track_done before update on public.activities
  for each row execute function public.activities_track_done();

-- Adds a follower once (no-op for a missing user).
create or replace function public.chatter_follow(p_model text, p_record uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.mail_followers (res_model, res_id, user_id, added_by)
  select p_model, p_record, p_user, p_user
   where p_user is not null and exists (select 1 from auth.users u where u.id = p_user)
  on conflict (res_model, res_id, user_id) do nothing;
$$;

-- Whoever writes on a record, and whoever is assigned an activity, follows it.
create or replace function public.chatter_auto_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'mail_messages' then
    if new.kind <> 'log' then
      perform public.chatter_follow(new.res_model, new.res_id, new.author_id);
    end if;
  else
    if tg_op = 'INSERT' then
      perform public.chatter_follow(new.res_model, new.res_id, new.created_by);
    end if;
    if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
      perform public.chatter_follow(new.res_model, new.res_id, new.assigned_to);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists mail_messages_auto_follow on public.mail_messages;
create trigger mail_messages_auto_follow after insert on public.mail_messages
  for each row execute function public.chatter_auto_follow();

drop trigger if exists activities_auto_follow on public.activities;
create trigger activities_auto_follow after insert or update of assigned_to on public.activities
  for each row execute function public.chatter_auto_follow();

-- An attachment belongs to its message's record; the file must be stored under that record.
create or replace function public.mail_attachments_set_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.res_model, m.res_id into new.res_model, new.res_id from public.mail_messages m where m.id = new.message_id;
  if new.res_model is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if split_part(new.storage_path, '/', 1) <> new.res_model or split_part(new.storage_path, '/', 2) <> new.res_id::text then
    raise exception 'attachment path must start with %/%/', new.res_model, new.res_id using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists mail_attachments_set_record on public.mail_attachments;
create trigger mail_attachments_set_record before insert on public.mail_attachments
  for each row execute function public.mail_attachments_set_record();

-- ── Tracked fields ─────────────────────────────────────────────────────────

-- AFTER UPDATE trigger; its arguments are the tracked column names. Writes one log line
-- "tracking:[{"f":field,"o":old,"n":new},...]" on the record's chatter. Tracking must never
-- block the business write, so any error here is swallowed.
create or replace function public.chatter_track_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_changes jsonb := '[]'::jsonb;
  v_field text;
begin
  foreach v_field in array tg_argv loop
    if (v_old -> v_field) is distinct from (v_new -> v_field) then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('f', v_field, 'o', v_old -> v_field, 'n', v_new -> v_field));
    end if;
  end loop;
  if jsonb_array_length(v_changes) > 0 then
    insert into public.mail_messages (res_model, res_id, kind, body, author_id)
    values (tg_table_name, new.id, 'log', left('tracking:' || v_changes::text, 10000), auth.uid());
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- Tracked fields per table. Only columns that exist are used, and tables that are not installed
-- (module not present) are skipped.
do $track$
declare
  v_spec record;
  v_fields text[];
begin
  for v_spec in
    select * from (values
      ('sales', array['status', 'grand_total', 'paid_amount', 'due_date', 'warehouse_slip_status']),
      ('purchases', array['status', 'grand_total', 'paid_amount', 'due_date', 'warehouse_slip_status']),
      ('customers', array['name', 'phone', 'address', 'voen', 'default_price_tier']),
      ('deals', array['title', 'stage', 'expected_value', 'assigned_to'])
    ) as s (tbl, fields)
  loop
    if to_regclass('public.' || v_spec.tbl) is null then
      continue;
    end if;
    select array_agg(f order by o) into v_fields
      from unnest(v_spec.fields) with ordinality as u (f, o)
     where exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = v_spec.tbl and c.column_name = u.f);
    execute format('drop trigger if exists chatter_track_changes on public.%I', v_spec.tbl);
    if v_fields is not null then
      execute format(
        'create trigger chatter_track_changes after update on public.%I for each row execute function public.chatter_track_changes(%s)',
        v_spec.tbl, (select string_agg(quote_literal(f), ', ') from unnest(v_fields) f)
      );
    end if;
  end loop;
end;
$track$;

-- ── Row level security ─────────────────────────────────────────────────────

alter table public.mail_messages enable row level security;

drop policy if exists mail_messages_select on public.mail_messages;
create policy mail_messages_select on public.mail_messages
  for select to authenticated
  using (public.chatter_record_visible(res_model, res_id));

-- Users post notes and messages as themselves, on records they can read; "log" is system-only.
drop policy if exists mail_messages_insert on public.mail_messages;
create policy mail_messages_insert on public.mail_messages
  for insert to authenticated
  with check (author_id = auth.uid() and kind in ('note', 'message') and public.chatter_record_visible(res_model, res_id));

-- Authors edit or delete their own notes and messages.
drop policy if exists mail_messages_update on public.mail_messages;
create policy mail_messages_update on public.mail_messages
  for update to authenticated
  using (author_id = auth.uid() and kind <> 'log')
  with check (author_id = auth.uid() and kind <> 'log');

drop policy if exists mail_messages_delete on public.mail_messages;
create policy mail_messages_delete on public.mail_messages
  for delete to authenticated
  using (author_id = auth.uid() and kind <> 'log');

alter table public.activities enable row level security;

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated
  using (public.chatter_record_visible(res_model, res_id));

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated
  with check (created_by = auth.uid() and public.chatter_record_visible(res_model, res_id));

-- The creator, the assignee or an admin may change or complete an activity.
drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities
  for update to authenticated
  using (public.chatter_record_visible(res_model, res_id) and (created_by = auth.uid() or assigned_to = auth.uid() or public.is_admin()))
  with check (public.chatter_record_visible(res_model, res_id));

drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- Everyone signed in reads the activity types; only admins change them.
alter table public.activity_types enable row level security;

drop policy if exists activity_types_select on public.activity_types;
create policy activity_types_select on public.activity_types
  for select to authenticated
  using (true);

drop policy if exists activity_types_write on public.activity_types;
create policy activity_types_write on public.activity_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Followers: visible with the record; anyone who can read a record may add followers to it;
-- a follower leaves on their own, the one who added them or an admin may remove them.
alter table public.mail_followers enable row level security;

drop policy if exists mail_followers_select on public.mail_followers;
create policy mail_followers_select on public.mail_followers
  for select to authenticated
  using (public.chatter_record_visible(res_model, res_id));

drop policy if exists mail_followers_insert on public.mail_followers;
create policy mail_followers_insert on public.mail_followers
  for insert to authenticated
  with check (added_by = auth.uid() and public.chatter_record_visible(res_model, res_id));

drop policy if exists mail_followers_delete on public.mail_followers;
create policy mail_followers_delete on public.mail_followers
  for delete to authenticated
  using (user_id = auth.uid() or added_by = auth.uid() or public.is_admin());

-- Attachments: visible with the record; added by the message's author, removed with the message.
alter table public.mail_attachments enable row level security;

drop policy if exists mail_attachments_select on public.mail_attachments;
create policy mail_attachments_select on public.mail_attachments
  for select to authenticated
  using (public.chatter_record_visible(res_model, res_id));

drop policy if exists mail_attachments_insert on public.mail_attachments;
create policy mail_attachments_insert on public.mail_attachments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.mail_messages m where m.id = message_id and m.author_id = auth.uid() and m.kind <> 'log')
  );

drop policy if exists mail_attachments_delete on public.mail_attachments;
create policy mail_attachments_delete on public.mail_attachments
  for delete to authenticated
  using (created_by = auth.uid());

revoke all on table public.mail_messages, public.activities, public.mail_followers, public.mail_attachments, public.activity_types from public, anon, authenticated;
grant select, insert, update, delete on table public.mail_messages, public.activities to authenticated;
grant select, insert, delete on table public.mail_followers, public.mail_attachments to authenticated;
grant select, insert, update, delete on table public.activity_types to authenticated;
grant all on table public.mail_messages, public.activities, public.mail_followers, public.mail_attachments, public.activity_types to service_role;
revoke all on function public.chatter_users() from public, anon;
grant execute on function public.chatter_users() to authenticated;
grant execute on function public.chatter_models(), public.chatter_record_visible(text, uuid), public.chatter_path_visible(text) to authenticated;
revoke all on function public.chatter_follow(text, uuid, uuid) from public, anon, authenticated;

-- ── Storage: private bucket for chatter files ──────────────────────────────

-- Files live under <res_model>/<res_id>/<uuid>-<name>. Reading and uploading follow the record's
-- access; only the uploader deletes. Skipped where the storage schema is absent (plain Postgres).
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('chatter-attachments', 'chatter-attachments', false, 10485760)
  on conflict (id) do nothing;

  execute 'drop policy if exists chatter_attachments_select on storage.objects';
  execute $p$create policy chatter_attachments_select on storage.objects for select to authenticated
    using (bucket_id = 'chatter-attachments' and public.chatter_path_visible(name))$p$;
  execute 'drop policy if exists chatter_attachments_insert on storage.objects';
  execute $p$create policy chatter_attachments_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'chatter-attachments' and public.chatter_path_visible(name))$p$;
  execute 'drop policy if exists chatter_attachments_delete on storage.objects';
  execute $p$create policy chatter_attachments_delete on storage.objects for delete to authenticated
    using (bucket_id = 'chatter-attachments' and owner = auth.uid())$p$;
end;
$storage$;
