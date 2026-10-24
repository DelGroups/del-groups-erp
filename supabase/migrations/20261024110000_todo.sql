-- To-do (phase 22, module "todo", depends on core): personal tasks with personal stages.
--
--   todo_stages            each user's own kanban columns (built-in ones have a code and are
--                          translated in the UI; is_done marks the "finished" column)
--   todo_tasks             title, notes, priority, due date, tags, done time
--   todo_task_members      who works on a task (creator and assignees); every member keeps the
--                          task in their own stage and their own order (the priority stack)
--   todo_checklist_items   the task's checklist
--
-- Moving a task into a done stage finishes it for everyone; moving it out reopens it. Tasks carry
-- the chatter (phase 19): todo_tasks is added to chatter_models().
--
-- Who sees what: a task is seen and changed by its members only (admins too); a member moves
-- only their own card; the creator (or an admin) deletes a task. Stages are personal.
--
-- Only the new UI (NEW_UI) reads or writes these tables; applying the migration changes nothing
-- for anyone. Safe to re-run.

-- ── Chatter on tasks ───────────────────────────────────────────────────────

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
    'todo_tasks', 'transactions', 'warehouse_slips'
  ]::text[];
$$;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.todo_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text check (code is null or code in ('inbox', 'today', 'week', 'later', 'done')),
  name text check (name is null or length(btrim(name)) between 1 and 60),
  sequence integer not null default 100,
  is_done boolean not null default false,
  folded boolean not null default false,
  created_at timestamptz not null default now(),
  check (code is not null or name is not null)
);

create index if not exists todo_stages_user_idx on public.todo_stages (user_id, sequence);

comment on table public.todo_stages is
  'Personal kanban columns of the To-do module; built-in ones have a code (translated in the UI) (phase 22).';

create table if not exists public.todo_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 300),
  description text check (description is null or length(description) <= 10000),
  priority smallint not null default 0 check (priority between 0 and 2),
  due_date date,
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  done_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todo_tasks_due_idx on public.todo_tasks (due_date) where done_at is null;

comment on table public.todo_tasks is
  'To-do tasks (phase 22): title, notes, priority, due date, tags; done when a member moves it to a done stage.';

create table if not exists public.todo_task_members (
  task_id uuid not null references public.todo_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage_id uuid references public.todo_stages (id) on delete set null,
  sequence integer not null default 0,
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists todo_task_members_user_idx on public.todo_task_members (user_id, stage_id, sequence);

comment on table public.todo_task_members is
  'Members of a to-do task (creator and assignees), each with their own stage and order (phase 22).';

create table if not exists public.todo_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.todo_tasks (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 300),
  done boolean not null default false,
  sequence integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists todo_checklist_items_task_idx on public.todo_checklist_items (task_id, sequence);

comment on table public.todo_checklist_items is 'Checklist lines of a to-do task (phase 22).';

-- ── Helpers ────────────────────────────────────────────────────────────────

-- True when the current user works on the task (security definer: no RLS recursion).
create or replace function public.todo_is_member(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.todo_task_members m where m.task_id = p_task and m.user_id = auth.uid());
$$;

-- The user's stages, created with the built-in ones the first time; returns the first stage.
create or replace function public.todo_ensure_stages(p_user uuid default auth.uid())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first uuid;
begin
  if p_user is null then
    return null;
  end if;
  if p_user <> auth.uid() and auth.uid() is not null and not exists (select 1 from auth.users where id = p_user) then
    return null;
  end if;
  if not exists (select 1 from public.todo_stages s where s.user_id = p_user) then
    insert into public.todo_stages (user_id, code, sequence, is_done, folded) values
      (p_user, 'inbox', 10, false, false),
      (p_user, 'today', 20, false, false),
      (p_user, 'week', 30, false, false),
      (p_user, 'later', 40, false, false),
      (p_user, 'done', 50, true, true);
  end if;
  select s.id into v_first from public.todo_stages s where s.user_id = p_user and not s.is_done order by s.sequence, s.created_at limit 1;
  return v_first;
end;
$$;

-- ── Triggers ───────────────────────────────────────────────────────────────

-- The creator becomes the first member, in their first stage, on top of their stack.
create or replace function public.todo_tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.todo_task_members (task_id, user_id, stage_id, sequence, added_by)
    values (new.id, new.created_by, public.todo_ensure_stages(new.created_by), -extract(epoch from now())::integer, new.created_by)
    on conflict (task_id, user_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists todo_tasks_after_insert on public.todo_tasks;
create trigger todo_tasks_after_insert after insert on public.todo_tasks
  for each row execute function public.todo_tasks_after_insert();

create or replace function public.todo_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists todo_tasks_guard on public.todo_tasks;
create trigger todo_tasks_guard before update on public.todo_tasks
  for each row execute function public.todo_tasks_guard();

-- A member row: its stage must be the member's own (a new assignee starts in their first stage);
-- the task and the person never change.
create or replace function public.todo_task_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.task_id := old.task_id;
    new.user_id := old.user_id;
    new.added_by := old.added_by;
    new.created_at := old.created_at;
  end if;
  if new.stage_id is null or not exists (select 1 from public.todo_stages s where s.id = new.stage_id and s.user_id = new.user_id) then
    new.stage_id := public.todo_ensure_stages(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists todo_task_members_guard on public.todo_task_members;
create trigger todo_task_members_guard before insert or update on public.todo_task_members
  for each row execute function public.todo_task_members_guard();

-- A member moving the task into a done stage finishes it; out of one reopens it.
create or replace function public.todo_task_members_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done boolean := coalesce((select s.is_done from public.todo_stages s where s.id = new.stage_id), false);
  v_was boolean := tg_op = 'UPDATE' and coalesce((select s.is_done from public.todo_stages s where s.id = old.stage_id), false);
begin
  if v_done and not v_was then
    update public.todo_tasks set done_at = coalesce(done_at, now()) where id = new.task_id;
  elsif v_was and not v_done then
    update public.todo_tasks set done_at = null where id = new.task_id;
  end if;
  return null;
end;
$$;

drop trigger if exists todo_task_members_done on public.todo_task_members;
create trigger todo_task_members_done after insert or update of stage_id on public.todo_task_members
  for each row execute function public.todo_task_members_done();

-- Deleting a stage: its cards go to the user's first stage (not left without a column).
create or replace function public.todo_stages_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first uuid;
begin
  select s.id into v_first from public.todo_stages s
   where s.user_id = old.user_id and s.id <> old.id and not s.is_done order by s.sequence, s.created_at limit 1;
  update public.todo_task_members set stage_id = v_first where stage_id = old.id and v_first is not null;
  return old;
end;
$$;

drop trigger if exists todo_stages_before_delete on public.todo_stages;
create trigger todo_stages_before_delete before delete on public.todo_stages
  for each row execute function public.todo_stages_before_delete();

-- ── Row level security ─────────────────────────────────────────────────────

alter table public.todo_stages enable row level security;

drop policy if exists todo_stages_own on public.todo_stages;
create policy todo_stages_own on public.todo_stages
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.todo_tasks enable row level security;

drop policy if exists todo_tasks_select on public.todo_tasks;
create policy todo_tasks_select on public.todo_tasks
  for select to authenticated
  using (public.todo_is_member(id) or created_by = auth.uid() or public.is_admin());

drop policy if exists todo_tasks_insert on public.todo_tasks;
create policy todo_tasks_insert on public.todo_tasks
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists todo_tasks_update on public.todo_tasks;
create policy todo_tasks_update on public.todo_tasks
  for update to authenticated
  using (public.todo_is_member(id) or public.is_admin())
  with check (public.todo_is_member(id) or public.is_admin());

drop policy if exists todo_tasks_delete on public.todo_tasks;
create policy todo_tasks_delete on public.todo_tasks
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

alter table public.todo_task_members enable row level security;

drop policy if exists todo_task_members_select on public.todo_task_members;
create policy todo_task_members_select on public.todo_task_members
  for select to authenticated
  using (public.todo_is_member(task_id) or public.is_admin());

-- Members add colleagues to a task; the new member's stage is set by the guard.
drop policy if exists todo_task_members_insert on public.todo_task_members;
create policy todo_task_members_insert on public.todo_task_members
  for insert to authenticated
  with check (public.todo_is_member(task_id) or public.is_admin());

-- Each member moves only their own card.
drop policy if exists todo_task_members_update on public.todo_task_members;
create policy todo_task_members_update on public.todo_task_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A member leaves; the task's creator (or an admin) removes members.
drop policy if exists todo_task_members_delete on public.todo_task_members;
create policy todo_task_members_delete on public.todo_task_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.todo_tasks t where t.id = task_id and t.created_by = auth.uid())
  );

alter table public.todo_checklist_items enable row level security;

drop policy if exists todo_checklist_items_member on public.todo_checklist_items;
create policy todo_checklist_items_member on public.todo_checklist_items
  for all to authenticated
  using (public.todo_is_member(task_id) or public.is_admin())
  with check (public.todo_is_member(task_id) or public.is_admin());

revoke all on table public.todo_stages, public.todo_tasks, public.todo_task_members, public.todo_checklist_items from public, anon, authenticated;
grant select, insert, update, delete on table public.todo_stages, public.todo_tasks, public.todo_task_members, public.todo_checklist_items to authenticated;
grant all on table public.todo_stages, public.todo_tasks, public.todo_task_members, public.todo_checklist_items to service_role;
revoke all on function public.todo_is_member(uuid), public.todo_ensure_stages(uuid) from public, anon;
grant execute on function public.todo_is_member(uuid), public.todo_ensure_stages(uuid) to authenticated;
