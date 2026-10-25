-- CRM pipeline (prompt 21): sales teams, stages per team, lost reasons and targets, and the
-- deals table grown into leads and opportunities.
--
-- Data-preserving: deals stays the one CRM record (same ids, quotations, chatter, calendar
-- links). New columns only; every existing deal becomes an opportunity of the default team in
-- the stage with the same code. deals.stage (text) is kept in sync with deals.stage_id by a
-- trigger, both ways, so the classic pipeline keeps working while NEW_CRM is off.
--
-- Stages: team_id null = shared by every team (the seeded ones, from crm_config); a team can
-- add its own. A stage is won, lost or open; open stages carry the default probability.
-- Built-in teams and lost reasons have a code (translated in the UI) and no name.
--
-- Rights: CRM settings tables are read with can_view_crm and changed with can_manage_settings
-- (the /settings/crm page); deals keep their existing policies (can_view_crm / can_manage_crm).
-- Rollback: supabase/scripts/crm_pipeline_rollback.sql. Safe to re-run.

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists public.crm_teams (
  id uuid primary key default gen_random_uuid(),
  code text unique check (code is null or code ~ '^[a-z][a-z0-9_]{0,39}$'),
  name text check (name is null or length(btrim(name)) between 1 and 80),
  leader_id uuid references auth.users (id) on delete set null,
  sequence integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code is not null or name is not null)
);

comment on table public.crm_teams is
  'Sales teams of the CRM pipeline (prompt 21); the built-in one has a code and no name.';

create table if not exists public.crm_team_members (
  team_id uuid not null references public.crm_teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists crm_team_members_user_idx on public.crm_team_members (user_id);

comment on table public.crm_team_members is 'Salespeople of a CRM team (prompt 21).';

create table if not exists public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.crm_teams (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  name text not null check (length(btrim(name)) between 1 and 60),
  color text not null default '#94a3b8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sequence integer not null default 100,
  probability numeric(5,2) not null default 10 check (probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  folded boolean not null default false,
  created_at timestamptz not null default now(),
  check (not (is_won and is_lost))
);

create index if not exists crm_stages_team_idx on public.crm_stages (team_id, sequence);

comment on table public.crm_stages is
  'Pipeline stages (prompt 21). team_id null = shared by all teams. code is the value of deals.stage.';

create table if not exists public.crm_lost_reasons (
  id uuid primary key default gen_random_uuid(),
  code text unique check (code is null or code ~ '^[a-z][a-z0-9_]{0,39}$'),
  name text check (name is null or length(btrim(name)) between 1 and 80),
  sequence integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (code is not null or name is not null)
);

comment on table public.crm_lost_reasons is
  'Why an opportunity was lost (prompt 21); built-in reasons have a code and no name.';

create table if not exists public.crm_targets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.crm_teams (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount numeric(15,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique nulls not distinct (team_id, user_id, month)
);

comment on table public.crm_targets is
  'Monthly sales targets (won revenue) per team, or per salesperson in a team (prompt 21).';

-- ── Deals: leads and opportunities ───────────────────────────────────────────
-- Only where the CRM module is installed (deals, quotations) and, for the invoice link, sales.

do $$
begin
  if to_regclass('public.deals') is null then
    return;
  end if;
  alter table public.deals
    add column if not exists type text not null default 'opportunity',
    add column if not exists team_id uuid references public.crm_teams (id) on delete set null,
    add column if not exists stage_id uuid references public.crm_stages (id) on delete restrict,
    add column if not exists probability numeric(5,2),
    add column if not exists expected_close date,
    add column if not exists priority smallint not null default 0,
    add column if not exists tags text[] not null default '{}',
    add column if not exists contact_name text,
    add column if not exists email text,
    add column if not exists phone text,
    add column if not exists company_name text,
    add column if not exists source text,
    add column if not exists medium text,
    add column if not exists lost_reason_id uuid references public.crm_lost_reasons (id) on delete set null,
    add column if not exists lost_note text,
    add column if not exists won_at timestamptz,
    add column if not exists lost_at timestamptz,
    add column if not exists converted_at timestamptz,
    add column if not exists sequence integer not null default 0;

  alter table public.deals drop constraint if exists deals_type_check;
  alter table public.deals add constraint deals_type_check check (type in ('lead', 'opportunity'));
  alter table public.deals drop constraint if exists deals_crm_fields_check;
  alter table public.deals add constraint deals_crm_fields_check check (
    (probability is null or probability between 0 and 100)
    and priority between 0 and 3
    and cardinality(tags) <= 20
    and (contact_name is null or length(contact_name) <= 200)
    and (email is null or length(email) <= 200)
    and (phone is null or length(phone) <= 60)
    and (company_name is null or length(company_name) <= 200)
    and (source is null or length(source) <= 80)
    and (medium is null or length(medium) <= 80)
    and (lost_note is null or length(lost_note) <= 2000)
  );

  create index if not exists deals_stage_id_idx on public.deals (stage_id, sequence);
  create index if not exists deals_team_idx on public.deals (team_id, type);
  create index if not exists deals_expected_close_idx on public.deals (expected_close) where expected_close is not null;
  create index if not exists deals_lost_reason_idx on public.deals (lost_reason_id) where lost_reason_id is not null;

  comment on column public.deals.stage is
    'Code of the stage (crm_stages.code), kept in sync with stage_id for the classic pipeline.';

  if to_regclass('public.quotations') is not null and to_regclass('public.sales') is not null then
    alter table public.quotations
      add column if not exists sale_id uuid references public.sales (id) on delete set null;
    create index if not exists quotations_sale_idx on public.quotations (sale_id) where sale_id is not null;
  end if;
end;
$$;

-- ── Seed: default team, stages from crm_config, lost reasons ────────────────

insert into public.crm_teams (code, sequence) values ('default', 10)
on conflict (code) do nothing;

-- One shared stage per configured stage (same code, label, colour and order), so every deal
-- keeps its stage. Probability: 10 for the first open stage, then up to 70, 100 won, 0 lost.
with config as (
  select coalesce(
    (select value -> 'stages' from public.system_settings where key = 'crm_config'),
    '[{"id":"LEAD","label":"Lead","color":"#38bdf8","kind":"open"},{"id":"QUALIFIED","label":"Qualified","color":"#818cf8","kind":"open"},{"id":"PROPOSAL","label":"Proposal","color":"#fbbf24","kind":"proposal"},{"id":"WON","label":"Won","color":"#34d399","kind":"won"},{"id":"LOST","label":"Lost","color":"#fb7185","kind":"lost"}]'::jsonb
  ) as stages
), cfg_rows as (
  select upper(btrim(s ->> 'id')) as code,
         coalesce(nullif(btrim(s ->> 'label'), ''), upper(btrim(s ->> 'id'))) as name,
         case when (s ->> 'color') ~ '^#[0-9a-fA-F]{6}$' then lower(s ->> 'color') else '#94a3b8' end as color,
         coalesce(s ->> 'kind', 'open') as kind,
         n
    from config, jsonb_array_elements(case when jsonb_typeof(config.stages) = 'array' then config.stages else '[]'::jsonb end) with ordinality as e(s, n)
), valid as (
  select distinct on (code) * from cfg_rows where code ~ '^[A-Z][A-Z0-9_]{0,39}$' order by code, n
), ranked as (
  select *, row_number() over (partition by kind in ('won', 'lost') order by n) as open_rank,
         count(*) filter (where kind not in ('won', 'lost')) over () as open_count
    from valid
)
insert into public.crm_stages (code, name, color, sequence, probability, is_won, is_lost, folded)
select code, left(name, 60), color, n::integer * 10,
       case when kind = 'won' or code = 'WON' then 100
            when kind = 'lost' or code = 'LOST' then 0
            when open_count <= 1 then 10
            else round(10 + (open_rank - 1) * 60.0 / (open_count - 1)) end,
       kind = 'won' or code = 'WON',
       (kind = 'lost' or code = 'LOST') and not (kind = 'won' or code = 'WON'),
       kind = 'lost' or code = 'LOST'
  from ranked
on conflict (code) do nothing;

-- Every tenant needs at least one open, one won and one lost stage.
insert into public.crm_stages (code, name, color, sequence, probability)
select 'LEAD', 'Lead', '#38bdf8', 5, 10
 where not exists (select 1 from public.crm_stages where not is_won and not is_lost)
on conflict (code) do nothing;
insert into public.crm_stages (code, name, color, sequence, probability, is_won)
select 'WON', 'Won', '#34d399', 900, 100, true
 where not exists (select 1 from public.crm_stages where is_won)
on conflict (code) do nothing;
insert into public.crm_stages (code, name, color, sequence, probability, is_lost, folded)
select 'LOST', 'Lost', '#fb7185', 910, 0, true, true
 where not exists (select 1 from public.crm_stages where is_lost)
on conflict (code) do nothing;

insert into public.crm_lost_reasons (code, sequence) values
  ('too_expensive', 10), ('competitor', 20), ('no_budget', 30), ('no_response', 40), ('not_interested', 50)
on conflict (code) do nothing;

-- ── Helpers and triggers ────────────────────────────────────────────────────

-- The helpers run with the caller's rights (RLS applies over the API); inside the security
-- definer trigger they run as its owner.
create or replace function public.crm_default_team()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id from public.crm_teams t where t.active order by t.sequence, t.created_at limit 1;
$$;

-- First open stage a deal of this team starts in (team stages and shared ones, by order).
create or replace function public.crm_first_stage(p_team uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id from public.crm_stages s
   where (s.team_id is null or s.team_id = p_team) and not s.is_won and not s.is_lost
   order by s.sequence, s.created_at
   limit 1;
$$;

-- The won or lost stage of a team (its own first, else a shared one).
create or replace function public.crm_outcome_stage(p_team uuid, p_won boolean)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id from public.crm_stages s
   where (s.team_id is null or s.team_id = p_team) and (case when p_won then s.is_won else s.is_lost end)
   order by (s.team_id is null), s.sequence
   limit 1;
$$;

-- The stage with this code for a team. A code that only the classic settings know (a stage
-- added in crm_config after this migration) becomes a shared stage on first use.
create or replace function public.crm_stage_for_code(p_code text, p_team uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cfg jsonb;
  v_kind text;
begin
  select s.id into v_id from public.crm_stages s
   where s.code = upper(p_code) and (s.team_id is null or s.team_id = p_team)
   order by (s.team_id is null) limit 1;
  if v_id is not null or upper(coalesce(p_code, '')) !~ '^[A-Z][A-Z0-9_]{0,39}$' then
    return v_id;
  end if;
  select e.s into v_cfg
    from public.system_settings ss, jsonb_array_elements(case when jsonb_typeof(ss.value -> 'stages') = 'array' then ss.value -> 'stages' else '[]'::jsonb end) as e(s)
   where ss.key = 'crm_config' and upper(e.s ->> 'id') = upper(p_code)
   limit 1;
  if v_cfg is null then
    return null;
  end if;
  v_kind := coalesce(v_cfg ->> 'kind', 'open');
  insert into public.crm_stages (code, name, color, sequence, probability, is_won, is_lost, folded)
  values (
    upper(p_code),
    left(coalesce(nullif(btrim(v_cfg ->> 'label'), ''), upper(p_code)), 60),
    case when (v_cfg ->> 'color') ~ '^#[0-9a-fA-F]{6}$' then lower(v_cfg ->> 'color') else '#94a3b8' end,
    500,
    case v_kind when 'won' then 100 when 'lost' then 0 when 'proposal' then 60 else 20 end,
    v_kind = 'won',
    v_kind = 'lost',
    v_kind = 'lost'
  )
  on conflict (code) do nothing
  returning id into v_id;
  return coalesce(v_id, (select s.id from public.crm_stages s where s.code = upper(p_code)));
end;
$$;

create or replace function public.crm_deals_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage public.crm_stages;
  v_stage_changed boolean;
begin
  if new.team_id is null then
    new.team_id := public.crm_default_team();
  end if;

  -- No stage_id yet (classic insert, existing deals): take it from the text code. The classic
  -- pipeline changes the text code only: follow it.
  if new.stage_id is null and new.stage is not null then
    new.stage_id := public.crm_stage_for_code(new.stage, new.team_id);
  elsif tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id and new.stage is distinct from old.stage then
    new.stage_id := public.crm_stage_for_code(new.stage, new.team_id);
    if new.stage_id is null then
      raise exception 'unknown CRM stage %', new.stage using errcode = '22023';
    end if;
  end if;

  -- A stage of another team does not fit (e.g. after a team change): back to the first stage.
  if new.stage_id is not null and exists (
    select 1 from public.crm_stages s where s.id = new.stage_id and s.team_id is not null and s.team_id is distinct from new.team_id
  ) then
    if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
      raise exception 'stage belongs to another team' using errcode = '22023';
    end if;
    new.stage_id := null;
  end if;
  if new.stage_id is null then
    new.stage_id := public.crm_first_stage(new.team_id);
  end if;

  select * into v_stage from public.crm_stages s where s.id = new.stage_id;
  if v_stage.id is null then
    raise exception 'no CRM stage available' using errcode = '22023';
  end if;
  new.stage := v_stage.code;

  v_stage_changed := tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id;
  if v_stage.is_won then
    new.probability := 100;
    new.won_at := coalesce(new.won_at, now());
    new.lost_at := null;
    new.lost_reason_id := null;
    new.lost_note := null;
    new.type := 'opportunity';
  elsif v_stage.is_lost then
    new.probability := 0;
    new.lost_at := coalesce(new.lost_at, now());
    new.won_at := null;
  else
    new.won_at := null;
    new.lost_at := null;
    new.lost_reason_id := null;
    new.lost_note := null;
    -- Moving to an open stage sets its probability, unless the same change sets one.
    if v_stage_changed and (tg_op = 'INSERT' and new.probability is null
        or tg_op = 'UPDATE' and new.probability is not distinct from old.probability) then
      new.probability := v_stage.probability;
    end if;
  end if;
  new.probability := coalesce(new.probability, v_stage.probability);

  -- converted_at: when a lead became an opportunity (null for deals created as opportunities).
  if tg_op = 'UPDATE' and old.type = 'lead' and new.type = 'opportunity' then
    new.converted_at := coalesce(new.converted_at, now());
  elsif new.type = 'lead' then
    new.converted_at := null;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.deals') is not null then
    drop trigger if exists crm_deals_sync on public.deals;
    create trigger crm_deals_sync before insert or update on public.deals
      for each row execute function public.crm_deals_sync();
  end if;
end;
$$;

-- Deleting a stage moves its deals to the first stage of their team (or refuses when none).
create or replace function public.crm_stages_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal record;
  v_target uuid;
begin
  if (old.is_won and not exists (select 1 from public.crm_stages s where s.id <> old.id and s.is_won and (s.team_id is null or s.team_id = old.team_id)))
     or (old.is_lost and not exists (select 1 from public.crm_stages s where s.id <> old.id and s.is_lost and (s.team_id is null or s.team_id = old.team_id)))
     or (not old.is_won and not old.is_lost and not exists (select 1 from public.crm_stages s where s.id <> old.id and not s.is_won and not s.is_lost and s.team_id is null)) then
    raise exception 'the pipeline needs an open, a won and a lost stage' using errcode = '22023';
  end if;
  if to_regclass('public.deals') is null then
    return old;
  end if;
  for v_deal in select d.id, d.team_id from public.deals d where d.stage_id = old.id loop
    select s.id into v_target from public.crm_stages s
     where s.id <> old.id and (s.team_id is null or s.team_id = v_deal.team_id)
       and s.is_won = old.is_won and s.is_lost = old.is_lost
     order by s.sequence limit 1;
    if v_target is null then
      raise exception 'no stage to move the deals of this stage to' using errcode = '22023';
    end if;
    update public.deals set stage_id = v_target where id = v_deal.id;
  end loop;
  return old;
end;
$$;

drop trigger if exists crm_stages_before_delete on public.crm_stages;
create trigger crm_stages_before_delete before delete on public.crm_stages
  for each row execute function public.crm_stages_before_delete();

create or replace function public.crm_teams_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.code := old.code;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_teams_touch on public.crm_teams;
create trigger crm_teams_touch before insert or update on public.crm_teams
  for each row execute function public.crm_teams_touch();

-- ── Existing deals ──────────────────────────────────────────────────────────

-- Fires crm_deals_sync for every deal not linked yet: default team, stage_id from the code,
-- probability, won/lost dates. updated_at is put back afterwards so lists keep their order.
-- One block = one transaction, also under psql's autocommit.
do $$
declare
  v_dates jsonb;
begin
  if to_regclass('public.deals') is null then
    return;
  end if;
  select jsonb_object_agg(d.id::text, d.updated_at) into v_dates from public.deals d where d.stage_id is null;
  if v_dates is null then
    return;
  end if;
  update public.deals set team_id = coalesce(team_id, public.crm_default_team()) where stage_id is null;
  alter table public.deals disable trigger crm_deals_sync;
  update public.deals d set updated_at = (v_dates ->> d.id::text)::timestamptz where v_dates ? d.id::text;
  alter table public.deals enable trigger crm_deals_sync;
end;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.crm_teams enable row level security;
alter table public.crm_team_members enable row level security;
alter table public.crm_stages enable row level security;
alter table public.crm_lost_reasons enable row level security;
alter table public.crm_targets enable row level security;

-- Same two policies on each settings table: read with can_view_crm, change with can_manage_settings.
do $$
declare
  t text;
begin
  foreach t in array array['crm_teams', 'crm_team_members', 'crm_stages', 'crm_lost_reasons', 'crm_targets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.require_permission(%L))', t || '_select', t, 'can_view_crm');
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.require_permission(%L)) with check (public.require_permission(%L))', t || '_write', t, 'can_manage_settings', 'can_manage_settings');
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

-- Trigger functions and the stage creator are not API endpoints (triggers fire without EXECUTE).
revoke all on function public.crm_stage_for_code(text, uuid) from public, anon, authenticated;
revoke all on function public.crm_deals_sync(), public.crm_stages_before_delete(), public.crm_teams_touch() from public, anon, authenticated;
revoke all on function public.crm_default_team(), public.crm_first_stage(uuid), public.crm_outcome_stage(uuid, boolean) from public, anon;
grant execute on function public.crm_default_team(), public.crm_first_stage(uuid), public.crm_outcome_stage(uuid, boolean) to authenticated;
