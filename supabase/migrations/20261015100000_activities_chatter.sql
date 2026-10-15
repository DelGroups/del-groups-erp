-- Activities and Chatter (phase 19, plan §5.4): notes, messages and activities on any record of
-- the new UI's view engine.
--
--   mail_messages  a record's thread: "note" (internal), "message", and "log" (written by the
--                  system, e.g. when an activity is done; users cannot insert it)
--   activities     to-do / call / meeting on a record, with due date, assignee and done state
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

-- ── Activities ─────────────────────────────────────────────────────────────

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  res_model text not null check (res_model = any (public.chatter_models())),
  res_id uuid not null,
  activity_type text not null default 'todo' check (activity_type in ('todo', 'call', 'meeting')),
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

revoke all on table public.mail_messages, public.activities from public, anon, authenticated;
grant select, insert, update, delete on table public.mail_messages, public.activities to authenticated;
grant all on table public.mail_messages, public.activities to service_role;
revoke all on function public.chatter_users() from public, anon;
grant execute on function public.chatter_users() to authenticated;
grant execute on function public.chatter_models(), public.chatter_record_visible(text, uuid) to authenticated;
