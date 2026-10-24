-- Documents (phase 23, module "documents", depends on core): folders, files, file requests.
--
--   document_folders        a tree; system folders (expense receipts, contracts, product images)
--                           show existing attachments where they already are (no file moves)
--   document_folder_access  who may open a folder: a role or a user, read or read + write;
--                           the nearest folder up the tree that has rules decides, a folder
--                           without rules anywhere above it is open to every signed-in user
--   documents               a file in the private "documents" bucket: folder, tags, owner and an
--                           optional link to a record (deal, customer, sale, …)
--   document_requests       "please send me this file": asked of a colleague or a customer /
--                           supplier, with a due date, done when a document is attached
--
-- Files count toward the plan's storage limit like every other upload (tenant_storage_used_bytes
-- sums storage.objects, and the storage_quota_insert policy stops uploads at 100 %).
--
-- Only the new UI (NEW_UI) reads or writes these tables; applying the migration changes nothing
-- for anyone. Safe to re-run.

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.document_folders (id) on delete cascade,
  name text check (name is null or length(btrim(name)) between 1 and 120),
  system_code text unique check (system_code is null or system_code in ('expenses', 'contracts', 'products')),
  sequence integer not null default 100,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (name is not null or system_code is not null),
  check (system_code is null or parent_id is null)
);

create index if not exists document_folders_parent_idx on public.document_folders (parent_id);

comment on table public.document_folders is
  'Document folders (phase 23): a tree; system folders show existing attachments in place.';

insert into public.document_folders (system_code, sequence) values
  ('expenses', 900), ('contracts', 910), ('products', 920)
on conflict (system_code) do nothing;

create table if not exists public.document_folder_access (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.document_folders (id) on delete cascade,
  role_id uuid references public.roles (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  can_write boolean not null default false,
  created_at timestamptz not null default now(),
  check ((role_id is null) <> (user_id is null))
);

create unique index if not exists document_folder_access_role_uq on public.document_folder_access (folder_id, role_id) where role_id is not null;
create unique index if not exists document_folder_access_user_uq on public.document_folder_access (folder_id, user_id) where user_id is not null;
create index if not exists document_folder_access_user_idx on public.document_folder_access (user_id) where user_id is not null;

comment on table public.document_folder_access is
  'Who may open a document folder (role or user; read, or read and write). The nearest folder with rules decides (phase 23).';

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.document_folders (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text check (mime_type is null or length(mime_type) <= 200),
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 52428800),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  owner_id uuid default auth.uid() references auth.users (id) on delete set null,
  res_model text check (res_model is null or res_model = any (public.chatter_models())),
  res_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((res_model is null) = (res_id is null))
);

create index if not exists documents_folder_idx on public.documents (folder_id, created_at desc);
create index if not exists documents_owner_idx on public.documents (owner_id);
create index if not exists documents_record_idx on public.documents (res_model, res_id) where res_model is not null;
create index if not exists documents_tags_idx on public.documents using gin (tags);

comment on table public.documents is
  'Files of the Documents module (phase 23) in the private documents bucket, with folder, tags, owner and record link.';

create table if not exists public.document_requests (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.document_folders (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  note text check (note is null or length(note) <= 2000),
  requested_user_id uuid references auth.users (id) on delete set null,
  partner_model text check (partner_model is null or partner_model in ('customers', 'suppliers')),
  partner_id uuid,
  partner_name text check (partner_name is null or length(partner_name) <= 200),
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  document_id uuid references public.documents (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  check ((partner_model is null) = (partner_id is null)),
  check (requested_user_id is not null or partner_id is not null),
  check ((status = 'done') = (done_at is not null))
);

create index if not exists document_requests_user_idx on public.document_requests (requested_user_id, status);
create index if not exists document_requests_folder_idx on public.document_requests (folder_id);
create index if not exists document_requests_document_idx on public.document_requests (document_id) where document_id is not null;

comment on table public.document_requests is
  'Requests for a file (phase 23): asked of a colleague or a customer/supplier, with a due date; done when a document is attached.';

-- ── Access helpers (security definer, explicit user check; no RLS recursion) ──

-- The folder whose rules apply: the nearest one (itself or above) that has rules; null = open.
create or replace function public.document_rules_folder(p_folder uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select f.id, f.parent_id, 0 as depth from public.document_folders f where f.id = p_folder
    union all
    select f.id, f.parent_id, up.depth + 1 from public.document_folders f join up on f.id = up.parent_id where up.depth < 50
  )
  select up.id from up
   where exists (select 1 from public.document_folder_access a where a.folder_id = up.id)
   order by up.depth
   limit 1;
$$;

-- p_write = false: may open the folder; true: may also add, change and remove files in it.
create or replace function public.document_folder_allowed(p_folder uuid, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_rules uuid;
begin
  if v_user is null or p_folder is null or not exists (select 1 from public.document_folders f where f.id = p_folder) then
    return false;
  end if;
  -- System folders are listed by the server with each module's own permission check; nobody
  -- (not even an admin) adds files to them here.
  if exists (select 1 from public.document_folders f where f.id = p_folder and f.system_code is not null) then
    return not p_write;
  end if;
  if public.is_admin() then
    return true;
  end if;
  v_rules := public.document_rules_folder(p_folder);
  if v_rules is null then
    return true;
  end if;
  return exists (
    select 1 from public.document_folder_access a
     where a.folder_id = v_rules
       and (not p_write or a.can_write)
       and (a.user_id = v_user or a.role_id = (select p.role_id from public.profiles p where p.id = v_user))
  );
end;
$$;

-- Storage path "<folder id>/<file>": the user may upload into that folder.
create or replace function public.document_path_writable(p_path text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_folder text := split_part(p_path, '/', 1);
begin
  if v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or split_part(p_path, '/', 2) = '' or split_part(p_path, '/', 3) <> '' then
    return false;
  end if;
  return public.document_folder_allowed(v_folder::uuid, true);
end;
$$;

-- ── Triggers ───────────────────────────────────────────────────────────────

-- Folders: no cycles, system folders keep their place and code.
create or replace function public.document_folders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.system_code := old.system_code;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.parent_id is not null then
    if exists (select 1 from public.document_folders f where f.id = new.parent_id and f.system_code is not null) then
      raise exception 'system folders have no subfolders' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and exists (
      with recursive up as (
        select f.id, f.parent_id, 0 as depth from public.document_folders f where f.id = new.parent_id
        union all
        select f.id, f.parent_id, up.depth + 1 from public.document_folders f join up on f.id = up.parent_id where up.depth < 50
      )
      select 1 from up where up.id = new.id
    ) then
      raise exception 'a folder cannot move into itself' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_folders_guard on public.document_folders;
create trigger document_folders_guard before insert or update on public.document_folders
  for each row execute function public.document_folders_guard();

-- Documents: owner, file and creation time never change; moving needs write access to the target.
create or replace function public.documents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    new.storage_path := old.storage_path;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_guard on public.documents;
create trigger documents_guard before insert or update on public.documents
  for each row execute function public.documents_guard();

-- Requests: the asked colleague only attaches a document (and so finishes the request); the
-- creator edits or cancels. done_at follows the status.
create or replace function public.document_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if v_user is distinct from old.created_by and not public.is_admin() then
      new.folder_id := old.folder_id;
      new.title := old.title;
      new.note := old.note;
      new.requested_user_id := old.requested_user_id;
      new.partner_model := old.partner_model;
      new.partner_id := old.partner_id;
      new.partner_name := old.partner_name;
      new.due_date := old.due_date;
      if new.status = 'cancelled' then
        new.status := old.status;
      end if;
    end if;
  end if;
  if new.document_id is not null and new.status = 'pending' then
    new.status := 'done';
  end if;
  new.done_at := case when new.status = 'done' then coalesce(new.done_at, now()) else null end;
  return new;
end;
$$;

drop trigger if exists document_requests_guard on public.document_requests;
create trigger document_requests_guard before insert or update on public.document_requests
  for each row execute function public.document_requests_guard();

-- ── Row level security ─────────────────────────────────────────────────────

alter table public.document_folders enable row level security;

drop policy if exists document_folders_select on public.document_folders;
create policy document_folders_select on public.document_folders
  for select to authenticated
  using (public.document_folder_allowed(id, false));

-- New folders: at the top (anyone) or inside a folder one may write to; never system folders.
drop policy if exists document_folders_insert on public.document_folders;
create policy document_folders_insert on public.document_folders
  for insert to authenticated
  with check (
    system_code is null
    and created_by = (select auth.uid())
    and (parent_id is null or public.document_folder_allowed(parent_id, true))
  );

drop policy if exists document_folders_update on public.document_folders;
create policy document_folders_update on public.document_folders
  for update to authenticated
  using (system_code is null and public.document_folder_allowed(id, true))
  with check (system_code is null and (parent_id is null or public.document_folder_allowed(parent_id, true)));

drop policy if exists document_folders_delete on public.document_folders;
create policy document_folders_delete on public.document_folders
  for delete to authenticated
  using (system_code is null and (created_by = (select auth.uid()) or public.is_admin()) and public.document_folder_allowed(id, true));

-- Access rules: seen by those who may open the folder, changed by its creator or an admin.
alter table public.document_folder_access enable row level security;

drop policy if exists document_folder_access_select on public.document_folder_access;
create policy document_folder_access_select on public.document_folder_access
  for select to authenticated
  using (public.document_folder_allowed(folder_id, false));

drop policy if exists document_folder_access_write on public.document_folder_access;
create policy document_folder_access_write on public.document_folder_access
  for all to authenticated
  using (public.is_admin() or exists (select 1 from public.document_folders f where f.id = folder_id and f.created_by = (select auth.uid()) and f.system_code is null))
  with check (public.is_admin() or exists (select 1 from public.document_folders f where f.id = folder_id and f.created_by = (select auth.uid()) and f.system_code is null));

alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (public.document_folder_allowed(folder_id, false));

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.document_folder_allowed(folder_id, true)
    and split_part(storage_path, '/', 1) = folder_id::text
    and (res_model is null or public.chatter_record_visible(res_model, res_id))
  );

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (public.document_folder_allowed(folder_id, true))
  with check (public.document_folder_allowed(folder_id, true) and (res_model is null or public.chatter_record_visible(res_model, res_id)));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (public.document_folder_allowed(folder_id, true));

alter table public.document_requests enable row level security;

drop policy if exists document_requests_select on public.document_requests;
create policy document_requests_select on public.document_requests
  for select to authenticated
  using (created_by = (select auth.uid()) or requested_user_id = (select auth.uid()) or public.document_folder_allowed(folder_id, false));

drop policy if exists document_requests_insert on public.document_requests;
create policy document_requests_insert on public.document_requests
  for insert to authenticated
  with check (created_by = (select auth.uid()) and public.document_folder_allowed(folder_id, true));

drop policy if exists document_requests_update on public.document_requests;
create policy document_requests_update on public.document_requests
  for update to authenticated
  using (created_by = (select auth.uid()) or requested_user_id = (select auth.uid()) or public.is_admin())
  with check (document_id is null or exists (select 1 from public.documents d where d.id = document_id));

drop policy if exists document_requests_delete on public.document_requests;
create policy document_requests_delete on public.document_requests
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_admin());

revoke all on table public.document_folders, public.document_folder_access, public.documents, public.document_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.document_folders, public.document_folder_access, public.documents, public.document_requests to authenticated;
grant all on table public.document_folders, public.document_folder_access, public.documents, public.document_requests to service_role;
revoke all on function public.document_rules_folder(uuid), public.document_folder_allowed(uuid, boolean), public.document_path_writable(text) from public, anon;
grant execute on function public.document_rules_folder(uuid), public.document_folder_allowed(uuid, boolean), public.document_path_writable(text) to authenticated;

-- ── Storage: private bucket for documents ──────────────────────────────────

-- Files live under <folder id at upload>/<uuid>-<name>. Uploading needs write access to that
-- folder; reading and deleting follow the document's current folder (a moved document keeps its
-- path). Skipped where the storage schema is absent (plain Postgres).
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('documents', 'documents', false, 52428800)
  on conflict (id) do nothing;

  execute 'drop policy if exists documents_files_select on storage.objects';
  execute $p$create policy documents_files_select on storage.objects for select to authenticated
    using (bucket_id = 'documents' and exists (
      select 1 from public.documents d where d.storage_path = name and public.document_folder_allowed(d.folder_id, false)))$p$;
  execute 'drop policy if exists documents_files_insert on storage.objects';
  execute $p$create policy documents_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'documents' and public.document_path_writable(name))$p$;
  execute 'drop policy if exists documents_files_delete on storage.objects';
  execute $p$create policy documents_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'documents' and (
      exists (select 1 from public.documents d where d.storage_path = name and public.document_folder_allowed(d.folder_id, true))
      or (owner = (select auth.uid()) and not exists (select 1 from public.documents d where d.storage_path = name))))$p$;
end;
$storage$;
