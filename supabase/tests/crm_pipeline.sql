-- Checks supabase/migrations/20261025100000_crm_pipeline.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Three users: M manages CRM and its settings, S works the pipeline (view + manage CRM),
-- V may only look at it.

insert into public.roles (id, name, permissions, description, created_at, is_system, scopes) values
  ('00000000-0000-0000-00cc-0000000000a0', 'CRM test: manager', '{"can_view_crm": true, "can_manage_crm": true, "can_manage_settings": true}'::jsonb, null, now(), false, '{}'::jsonb),
  ('00000000-0000-0000-00cc-0000000000b0', 'CRM test: sales', '{"can_view_crm": true, "can_manage_crm": true}'::jsonb, null, now(), false, '{}'::jsonb),
  ('00000000-0000-0000-00cc-0000000000c0', 'CRM test: viewer', '{"can_view_crm": true}'::jsonb, null, now(), false, '{}'::jsonb)
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00cc-00000000000a', 'crm-m@example.test', '{"full_name": "Mələk Manager", "role_name": "CRM test: manager"}'),
  ('00000000-0000-0000-00cc-00000000000b', 'crm-s@example.test', '{"full_name": "Səbinə Sales", "role_name": "CRM test: sales"}'),
  ('00000000-0000-0000-00cc-00000000000c', 'crm-v@example.test', '{"full_name": "Vüqar Viewer", "role_name": "CRM test: viewer"}')
on conflict (id) do nothing;

-- The trigger may have given the profiles another role: pin the test roles.
update public.profiles set role_id = '00000000-0000-0000-00cc-0000000000a0' where id = '00000000-0000-0000-00cc-00000000000a';
update public.profiles set role_id = '00000000-0000-0000-00cc-0000000000b0' where id = '00000000-0000-0000-00cc-00000000000b';
update public.profiles set role_id = '00000000-0000-0000-00cc-0000000000c0' where id = '00000000-0000-0000-00cc-00000000000c';

-- ── Seed ────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.crm_teams where code = 'default') <> 1 then raise exception 'FAIL no default team'; end if;
  if not exists (select 1 from public.crm_stages where not is_won and not is_lost and team_id is null) then raise exception 'FAIL no shared open stage'; end if;
  if not exists (select 1 from public.crm_stages where is_won) or not exists (select 1 from public.crm_stages where is_lost) then raise exception 'FAIL no won or lost stage'; end if;
  if (select probability from public.crm_stages where is_won limit 1) <> 100 or (select probability from public.crm_stages where is_lost limit 1) <> 0 then raise exception 'FAIL won/lost probability'; end if;
  if (select count(*) from public.crm_lost_reasons where code is not null) < 5 then raise exception 'FAIL lost reasons not seeded'; end if;
  if exists (select 1 from public.deals where stage_id is null or team_id is null or stage is distinct from (select code from public.crm_stages s where s.id = stage_id)) then
    raise exception 'FAIL an existing deal was not linked to its stage';
  end if;
end $$;

-- ── S works the pipeline ───────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cc-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_first public.crm_stages := (select s from public.crm_stages s where not s.is_won and not s.is_lost and s.team_id is null order by s.sequence limit 1);
  v_open2 public.crm_stages;
  v_won uuid := (select id from public.crm_stages where is_won and team_id is null order by sequence limit 1);
  v_lost uuid := (select id from public.crm_stages where is_lost and team_id is null order by sequence limit 1);
  v_reason uuid := (select id from public.crm_lost_reasons where code = 'competitor');
  v_deal public.deals;
  v_id uuid;
begin
  -- A classic insert (text stage only) gets the stage, the default team and the stage probability.
  insert into public.deals (title, stage) values ('CRM test: classic', v_first.code) returning * into v_deal;
  if v_deal.stage_id <> v_first.id or v_deal.team_id is null or v_deal.probability <> v_first.probability or v_deal.type <> 'opportunity' then
    raise exception 'FAIL classic insert not synced: %', row_to_json(v_deal);
  end if;

  -- A lead without a stage starts in the first open stage.
  insert into public.deals (title, type, contact_name, email, source) values ('CRM test: lead', 'lead', 'Nərgiz', 'n@example.test', 'website') returning * into v_deal;
  if v_deal.stage_id <> v_first.id or v_deal.converted_at is not null then raise exception 'FAIL lead not in first stage: %', row_to_json(v_deal); end if;
  v_id := v_deal.id;

  -- Moving by stage_id sets the text code and the new stage's probability.
  select * into v_open2 from public.crm_stages s where not s.is_won and not s.is_lost and s.team_id is null and s.id <> v_first.id order by s.sequence limit 1;
  if v_open2.id is not null then
    update public.deals set stage_id = v_open2.id where id = v_id returning * into v_deal;
    if v_deal.stage <> v_open2.code or v_deal.probability <> v_open2.probability then raise exception 'FAIL move by stage_id: %', row_to_json(v_deal); end if;
  end if;
  -- A probability set by hand stays while the stage does not change.
  update public.deals set probability = 55 where id = v_id returning * into v_deal;
  if v_deal.probability <> 55 then raise exception 'FAIL manual probability overwritten'; end if;
  -- Converting a lead records when.
  update public.deals set type = 'opportunity' where id = v_id returning * into v_deal;
  if v_deal.converted_at is null then raise exception 'FAIL converted_at not set'; end if;

  -- Lost with a reason, then back to an open stage: the reason is cleared.
  update public.deals set stage_id = v_lost, lost_reason_id = v_reason, lost_note = 'Cheaper offer' where id = v_id returning * into v_deal;
  if v_deal.probability <> 0 or v_deal.lost_at is null or v_deal.lost_reason_id is distinct from v_reason then raise exception 'FAIL lost: %', row_to_json(v_deal); end if;
  update public.deals set stage_id = v_first.id where id = v_id returning * into v_deal;
  if v_deal.lost_at is not null or v_deal.lost_reason_id is not null or v_deal.probability <> v_first.probability then raise exception 'FAIL restore: %', row_to_json(v_deal); end if;

  -- Won: probability 100, won_at, always an opportunity.
  update public.deals set type = 'lead' where id = v_id;
  update public.deals set stage_id = v_won where id = v_id returning * into v_deal;
  if v_deal.probability <> 100 or v_deal.won_at is null or v_deal.type <> 'opportunity' then raise exception 'FAIL won: %', row_to_json(v_deal); end if;

  -- The classic pipeline moves by the text code; stage_id follows.
  update public.deals set stage = v_first.code where id = v_id returning * into v_deal;
  if v_deal.stage_id <> v_first.id or v_deal.won_at is not null then raise exception 'FAIL classic move not followed: %', row_to_json(v_deal); end if;
  begin
    update public.deals set stage = 'NO_SUCH_STAGE' where id = v_id;
    raise exception 'FAIL unknown stage code accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Bad values are refused.
  begin
    update public.deals set priority = 5 where id = v_id;
    raise exception 'FAIL priority 5 accepted';
  exception when check_violation then null;
  end;
  begin
    update public.deals set type = 'ticket' where id = v_id;
    raise exception 'FAIL unknown type accepted';
  exception when check_violation then null;
  end;

  -- Settings are read-only for the sales role.
  if not exists (select 1 from public.crm_stages) or not exists (select 1 from public.crm_teams) then raise exception 'FAIL sales cannot read stages or teams'; end if;
  begin
    insert into public.crm_stages (code, name) values ('CRM_TEST_S', 'Mine');
    raise exception 'FAIL sales created a stage';
  exception when insufficient_privilege then null;
  end;
  update public.crm_lost_reasons set active = false where code = 'competitor';
  if found then raise exception 'FAIL sales changed a lost reason'; end if;
end $$;
commit;

-- ── V only looks ────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cc-00000000000c","role":"authenticated"}', true);
do $$
begin
  if not exists (select 1 from public.deals where title = 'CRM test: lead') then raise exception 'FAIL viewer cannot see deals'; end if;
  if not exists (select 1 from public.crm_stages) then raise exception 'FAIL viewer cannot see stages'; end if;
  update public.deals set probability = 1 where title = 'CRM test: lead';
  if found then raise exception 'FAIL viewer changed a deal'; end if;
end $$;
commit;

-- ── M changes the settings ──────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00cc-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_team uuid;
  v_team_stage uuid;
  v_extra uuid;
  v_first uuid := (select id from public.crm_stages where not is_won and not is_lost and team_id is null order by sequence limit 1);
  v_deal uuid := (select id from public.deals where title = 'CRM test: classic');
  v_won_count integer := (select count(*) from public.crm_stages where is_won);
  v_lost uuid;
begin
  insert into public.crm_teams (name) values ('Export') returning id into v_team;
  insert into public.crm_team_members (team_id, user_id) values (v_team, '00000000-0000-0000-00cc-00000000000b');
  insert into public.crm_stages (team_id, code, name, sequence, probability) values (v_team, 'CRM_TEST_EXPORT', 'Export check', 15, 25) returning id into v_team_stage;

  -- A stage of another team is refused; moving the deal to the team puts it in a valid stage.
  begin
    update public.deals set stage_id = v_team_stage where id = v_deal;
    raise exception 'FAIL deal moved into another team''s stage';
  exception when invalid_parameter_value then null;
  end;
  update public.deals set team_id = v_team, stage_id = v_team_stage where id = v_deal;
  if (select stage from public.deals where id = v_deal) <> 'CRM_TEST_EXPORT' then raise exception 'FAIL team stage not used'; end if;

  -- Deleting a stage moves its deals; the last won stage cannot go.
  delete from public.crm_stages where id = v_team_stage;
  if (select stage_id from public.deals where id = v_deal) is distinct from v_first then raise exception 'FAIL deals of a deleted stage were not moved'; end if;
  if v_won_count = 1 then
    begin
      delete from public.crm_stages where is_won;
      raise exception 'FAIL deleted the only won stage';
    exception when invalid_parameter_value then null;
    end;
  end if;
  -- An extra open stage can be added and removed.
  insert into public.crm_stages (code, name, sequence) values ('CRM_TEST_EXTRA', 'Extra', 999) returning id into v_extra;
  delete from public.crm_stages where id = v_extra;

  -- Team code is fixed; targets are one per team, person and month.
  update public.crm_teams set code = 'renamed' where code = 'default';
  if not exists (select 1 from public.crm_teams where code = 'default') then raise exception 'FAIL team code changed'; end if;
  insert into public.crm_targets (team_id, month, amount) values (v_team, date '2026-11-01', 10000);
  insert into public.crm_targets (team_id, user_id, month, amount) values (v_team, '00000000-0000-0000-00cc-00000000000b', date '2026-11-01', 4000);
  begin
    insert into public.crm_targets (team_id, month, amount) values (v_team, date '2026-11-01', 1);
    raise exception 'FAIL two team targets for one month';
  exception when unique_violation then null;
  end;
  begin
    insert into public.crm_targets (team_id, month, amount) values (v_team, date '2026-11-15', 1);
    raise exception 'FAIL target month not the 1st';
  exception when check_violation then null;
  end;
  insert into public.crm_lost_reasons (name) values ('Delivery too slow');

  -- Deleting the team: its deals fall back to the default team and a valid stage.
  delete from public.crm_teams where id = v_team;
  if (select team_id from public.deals where id = v_deal) is distinct from public.crm_default_team() then raise exception 'FAIL deal kept a deleted team'; end if;
  select id into v_lost from public.crm_stages where is_lost limit 1;
  if v_lost is null then raise exception 'FAIL lost stage gone'; end if;
end $$;
commit;

-- Anonymous visitors have no access.
begin;
set local role anon;
do $$
begin
  perform 1 from public.crm_stages;
  raise exception 'FAIL anon can read stages';
exception when insufficient_privilege then null;
end $$;
commit;

select 'ALL CHECKS PASSED';
