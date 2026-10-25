-- Widget home page (prompt 24b): each user's own layout, and one company default layout.
--
-- home_layouts: one row per user (their widgets, columns, order and sizes). Only the user reads
-- and writes their own row. home_layout_defaults: a single row with the layout new users start
-- from; everyone signed in reads it, only admins (public.user_is_admin()) write it.
-- Only the new home (NEW_HOME) reads these tables. Safe to re-run.

create table if not exists public.home_layouts (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  layout jsonb not null check (jsonb_typeof(layout) = 'object' and pg_column_size(layout) <= 16384),
  updated_at timestamptz not null default now()
);

comment on table public.home_layouts is
  'Home page widget layout of each user (prompt 24b), private to the user.';

create table if not exists public.home_layout_defaults (
  id boolean primary key default true check (id),
  layout jsonb not null check (jsonb_typeof(layout) = 'object' and pg_column_size(layout) <= 16384),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.home_layout_defaults is
  'The company default home layout (single row, prompt 24b): read by everyone, written by admins.';

create or replace function public.home_layouts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists home_layouts_touch on public.home_layouts;
create trigger home_layouts_touch before insert or update on public.home_layouts
  for each row execute function public.home_layouts_touch();
drop trigger if exists home_layout_defaults_touch on public.home_layout_defaults;
create trigger home_layout_defaults_touch before insert or update on public.home_layout_defaults
  for each row execute function public.home_layouts_touch();

alter table public.home_layouts enable row level security;
alter table public.home_layout_defaults enable row level security;

drop policy if exists home_layouts_own on public.home_layouts;
create policy home_layouts_own on public.home_layouts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists home_layout_defaults_select on public.home_layout_defaults;
create policy home_layout_defaults_select on public.home_layout_defaults
  for select to authenticated
  using (true);

drop policy if exists home_layout_defaults_admin on public.home_layout_defaults;
create policy home_layout_defaults_admin on public.home_layout_defaults
  for all to authenticated
  using ((select public.user_is_admin()))
  with check ((select public.user_is_admin()));

revoke all on table public.home_layouts, public.home_layout_defaults from public, anon, authenticated;
grant select, insert, update, delete on table public.home_layouts, public.home_layout_defaults to authenticated;
grant all on table public.home_layouts, public.home_layout_defaults to service_role;
revoke all on function public.home_layouts_touch() from public, anon, authenticated;
