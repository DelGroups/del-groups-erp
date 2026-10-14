-- Saved searches ("favourites") of the view engine (prompt 17, plan §6.1).
--
-- One row = one named search panel state (search text, filters, group by, sort, view) that a
-- user saved on one screen (view_key, e.g. 'crm.deals'). Rows are private: every user sees and
-- changes only their own. At most one default per user and screen; it opens with the screen.
--
-- Only the new UI (NEW_UI) reads or writes this table, so applying the migration changes
-- nothing for anyone. Safe to re-run.

create table if not exists public.view_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  view_key text not null check (view_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' and length(view_key) <= 64),
  name text not null check (length(btrim(name)) between 1 and 80),
  state jsonb not null check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 8192),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint view_favorites_name_key unique (user_id, view_key, name)
);

create unique index if not exists view_favorites_one_default
  on public.view_favorites (user_id, view_key) where is_default;

comment on table public.view_favorites is
  'Saved search panel states of the view engine, private to each user (prompt 17).';

alter table public.view_favorites enable row level security;

drop policy if exists view_favorites_own on public.view_favorites;
create policy view_favorites_own on public.view_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.view_favorites from public, anon, authenticated;
grant select, insert, update, delete on table public.view_favorites to authenticated;
grant all on table public.view_favorites to service_role;
