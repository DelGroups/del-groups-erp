-- Checks supabase/migrations/20261120140000_accounting_guard_agent.sql (GUARD-5) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres: the agent's memory (save, update by subject, limits, delete),
-- its suggestion on a finding (set, dismiss, only for a finding still to look at, never changes the finding's
-- status), its cost this month, and that only admins (not even a user with can_manage_settings) and the server
-- can use them, never anon. One transaction, rolled back. Any failed check raises an exception; the last line
-- prints ALL CHECKS PASSED.

begin;

insert into public.roles (name, permissions, description, is_system)
select 'Guard agent test: settings', '{"can_manage_settings": true}'::jsonb, 'GUARD-5 test', false
where not exists (select 1 from public.roles where name = 'Guard agent test: settings');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a14-00000000000a', 'guardagent-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0a14-00000000000b', 'guardagent-s@example.test', '{"full_name": "Samir Settings", "role_name": "Guard agent test: settings"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0a14-00000000000a';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Guard agent test: settings' limit 1)
where id = '00000000-0000-0000-0a14-00000000000b';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;

truncate public.guard_finding_events, public.guard_findings, public.guard_runs, public.guard_reports, public.guard_admin_state, public.guard_agent_memory, public.guard_ai_usage cascade;
insert into public.guard_runs (id, trigger, status) values ('00000000-0000-0000-0a14-0000000000d1', 'manual', 'ok');
insert into public.guard_findings (id, rule_code, severity, fingerprint, entity_type, doc_no, status, first_seen_run, last_seen_run) values
  ('00000000-0000-0000-0a14-0000000000f1', 'B6', 'medium', 'agent:1', 'sale', 'S-1', 'open', '00000000-0000-0000-0a14-0000000000d1', '00000000-0000-0000-0a14-0000000000d1'),
  ('00000000-0000-0000-0a14-0000000000f2', 'B6', 'medium', 'agent:2', 'sale', 'S-2', 'resolved', '00000000-0000-0000-0a14-0000000000d1', '00000000-0000-0000-0a14-0000000000d1');

-- ═══ 1. Memory: save, update by subject, kinds, limits ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a14-00000000000a');
do $$
declare a uuid; b uuid; r record;
begin
  a := public.guard_memory_save('  Konik   bar is sold below cost ', 'Sales below cost to customer X are a standing discount agreed by the owner.', 'pattern', 'agent', '00000000-0000-0000-0a14-0000000000f1', 'sale', null);
  select * into r from public.guard_agent_memory where id = a;
  if r.subject <> 'Konik bar is sold below cost' or r.kind <> 'pattern' or r.source <> 'agent' or r.source_ref <> '00000000-0000-0000-0a14-0000000000f1' or r.created_by <> '00000000-0000-0000-0a14-00000000000a' then
    raise exception 'FAIL memory saved %', to_jsonb(r);
  end if;
  -- The same subject (other case, other spaces) updates the note; an admin's edit makes it the admin's.
  b := public.guard_memory_save('konik bar is SOLD below cost', 'Agreed with the owner on 01.11.2026, valid until the end of the year.', 'fact', 'admin');
  if b <> a or (select count(*) from public.guard_agent_memory) <> 1 then raise exception 'FAIL same subject did not update'; end if;
  select * into r from public.guard_agent_memory where id = a;
  if r.body not like 'Agreed with the owner%' or r.kind <> 'fact' or r.source <> 'admin' or r.source_ref <> '00000000-0000-0000-0a14-0000000000f1' then raise exception 'FAIL update %', to_jsonb(r); end if;
  perform public.guard_memory_save('Preference: short reports', 'The owner reads the first three lines only.', 'preference', 'admin');
  if (select count(*) from public.guard_agent_memory) <> 2 then raise exception 'FAIL second note'; end if;

  -- Rejected: too short / too long, unknown kind or source, empty.
  begin perform public.guard_memory_save('ab', 'long enough body', 'fact', 'agent'); raise exception 'FAIL short subject'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_memory_save('A good subject', 'no', 'fact', 'agent'); raise exception 'FAIL short body'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_memory_save(repeat('x', 121), 'long enough body', 'fact', 'agent'); raise exception 'FAIL long subject'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_memory_save('A good subject', repeat('x', 2001), 'fact', 'agent'); raise exception 'FAIL long body'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_memory_save('A good subject', 'long enough body', 'secret', 'agent'); raise exception 'FAIL kind'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_memory_save('A good subject', 'long enough body', 'fact', 'robot'); raise exception 'FAIL source'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_memory_save(null, 'long enough body'); raise exception 'FAIL null subject'; exception when sqlstate '22023' then null; end;
  if (select count(*) from public.guard_agent_memory) <> 2 then raise exception 'FAIL a rejected note was stored'; end if;

  -- Delete.
  if not public.guard_memory_delete(a) or public.guard_memory_delete(a) then raise exception 'FAIL delete'; end if;
  if (select count(*) from public.guard_agent_memory) <> 1 then raise exception 'FAIL delete count'; end if;
end $$;
reset role;

-- At most 500 notes (checked as the server, which writes in bulk).
do $$
begin
  insert into public.guard_agent_memory (subject, body) select 'Note number ' || g, 'body of note ' || g from generate_series(1, 499) g;
  if (select count(*) from public.guard_agent_memory) <> 500 then raise exception 'FAIL fill'; end if;
  perform set_config('request.jwt.claims', '', true);
  begin perform public.guard_memory_save('One more note', 'This one does not fit.'); raise exception 'FAIL memory cap'; exception when sqlstate '22023' then null; end;
  -- A note that already exists is still updated at the cap.
  perform public.guard_memory_save('Note number 7', 'Updated at the cap.');
  if (select body from public.guard_agent_memory where subject = 'Note number 7') <> 'Updated at the cap.' then raise exception 'FAIL update at the cap'; end if;
  delete from public.guard_agent_memory where subject like 'Note number %';
end $$;

-- ═══ 2. The suggestion on a finding ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a14-00000000000a');
do $$
declare s jsonb;
begin
  if not public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', '{"status": "false_positive", "reason": "  Standing discount agreed with the owner  ", "report_id": "00000000-0000-0000-0a14-0000000000aa"}') then raise exception 'FAIL suggestion not set'; end if;
  select agent_suggestion into s from public.guard_findings where id = '00000000-0000-0000-0a14-0000000000f1';
  if s ->> 'status' <> 'false_positive' or s ->> 'reason' <> 'Standing discount agreed with the owner' or s -> 'report_id' is null or s -> 'at' is null then raise exception 'FAIL suggestion %', s; end if;
  -- It is only a suggestion: the finding's status did not change, and nothing was logged as a decision.
  if (select status from public.guard_findings where id = '00000000-0000-0000-0a14-0000000000f1') <> 'open' then raise exception 'FAIL the suggestion changed the status'; end if;
  if exists (select 1 from public.guard_finding_events where finding_id = '00000000-0000-0000-0a14-0000000000f1') then raise exception 'FAIL the suggestion wrote an event'; end if;
  -- A finding that is already closed takes no suggestion.
  if public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f2', '{"status": "false_positive", "reason": "fine"}') then raise exception 'FAIL closed finding took a suggestion'; end if;
  if (select agent_suggestion from public.guard_findings where id = '00000000-0000-0000-0a14-0000000000f2') is not null then raise exception 'FAIL closed finding changed'; end if;
  -- Rejected: another status, no reason, a short reason, a long reason, not an object; an unknown finding.
  begin perform public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', '{"status": "resolved", "reason": "fixed"}'); raise exception 'FAIL status'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', '{"status": "false_positive"}'); raise exception 'FAIL reason'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', '{"status": "false_positive", "reason": "ok"}'); raise exception 'FAIL short reason'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', jsonb_build_object('status', 'false_positive', 'reason', repeat('x', 501))); raise exception 'FAIL long reason'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', '[1]'); raise exception 'FAIL shape'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000ee', '{"status": "false_positive", "reason": "fine"}'); raise exception 'FAIL unknown finding'; exception when sqlstate 'P0002' then null; end;
  -- A rejected suggestion changed nothing; an admin dismisses it.
  if (select agent_suggestion ->> 'reason' from public.guard_findings where id = '00000000-0000-0000-0a14-0000000000f1') <> 'Standing discount agreed with the owner' then raise exception 'FAIL a rejected suggestion changed the finding'; end if;
  if not public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', null) then raise exception 'FAIL dismiss'; end if;
  if (select agent_suggestion from public.guard_findings where id = '00000000-0000-0000-0a14-0000000000f1') is not null then raise exception 'FAIL dismiss did not clear'; end if;
end $$;
reset role;

-- ═══ 3. The cost of this month ═══
insert into public.guard_ai_usage (kind, model, cost_usd, at) values
  ('daily', 'claude-sonnet-5-5', 0.25, now()),
  ('chat', 'claude-sonnet-5-5', 0.10, now()),
  ('monthly', 'claude-opus-5-5', null, now()),
  ('daily', 'claude-sonnet-5-5', 5.00, date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' - interval '1 day');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a14-00000000000a');
do $$
begin
  if public.guard_ai_month_cost() <> 0.35 then raise exception 'FAIL month cost %', public.guard_ai_month_cost(); end if;
end $$;
reset role;
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  if public.guard_ai_month_cost() <> 0.35 then raise exception 'FAIL month cost (server)'; end if;
  begin insert into public.guard_ai_usage (kind) values ('weekly'); raise exception 'FAIL usage kind'; exception when check_violation then null; end;
end $$;

-- ═══ 4. Only admins and the server; never anon; no direct writes ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a14-00000000000b');
do $$
begin
  begin perform public.guard_memory_save('A good subject', 'long enough body'); raise exception 'FAIL non-admin save'; exception when insufficient_privilege then null; end;
  begin perform public.guard_memory_delete(gen_random_uuid()); raise exception 'FAIL non-admin delete'; exception when insufficient_privilege then null; end;
  begin perform public.guard_set_agent_suggestion('00000000-0000-0000-0a14-0000000000f1', null); raise exception 'FAIL non-admin suggestion'; exception when insufficient_privilege then null; end;
  begin perform public.guard_ai_month_cost(); raise exception 'FAIL non-admin cost'; exception when insufficient_privilege then null; end;
  if exists (select 1 from public.guard_agent_memory) or exists (select 1 from public.guard_ai_usage) then raise exception 'FAIL non-admin can read memory or usage'; end if;
end $$;
reset role;
set local role anon;
do $$
begin
  begin perform public.guard_memory_save('A good subject', 'long enough body'); raise exception 'FAIL anon save'; exception when insufficient_privilege then null; end;
  begin perform public.guard_ai_month_cost(); raise exception 'FAIL anon cost'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
  if has_table_privilege('authenticated', 'public.guard_agent_memory', 'insert') or has_table_privilege('authenticated', 'public.guard_agent_memory', 'update')
     or has_table_privilege('authenticated', 'public.guard_agent_memory', 'delete') or has_table_privilege('authenticated', 'public.guard_ai_usage', 'insert') then
    raise exception 'FAIL guard tables writable directly';
  end if;
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal
             and p.proname in ('guard_memory_save', 'guard_memory_delete', 'guard_set_agent_suggestion', 'guard_ai_month_cost')) then
    raise exception 'FAIL a trigger calls the agent functions';
  end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
