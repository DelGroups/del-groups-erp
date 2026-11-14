-- Checks supabase/migrations/20261120120000_accounting_guard_ui.sql (GUARD-3) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres: the dashboard figures, rule updates with validation,
-- bulk status changes, saved reports, the bell state, and that only admins (not even a user with
-- can_manage_settings) and never anon can use them. Everything runs in one transaction that is
-- rolled back. Any failed check raises an exception; the last line prints ALL CHECKS PASSED.

begin;

insert into public.roles (name, permissions, description, is_system)
select 'Guard UI test: settings', '{"can_manage_settings": true, "can_view_financial_reports": true}'::jsonb, 'GUARD-3 test', false
where not exists (select 1 from public.roles where name = 'Guard UI test: settings');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a12-00000000000a', 'guardui-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0a12-00000000000b', 'guardui-s@example.test', '{"full_name": "Samir Settings", "role_name": "Guard UI test: settings"}'),
  ('00000000-0000-0000-0a12-00000000000c', 'guardui-c@example.test', '{"full_name": "Cavid Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id in ('00000000-0000-0000-0a12-00000000000a', '00000000-0000-0000-0a12-00000000000c');
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Guard UI test: settings' limit 1)
where id = '00000000-0000-0000-0a12-00000000000b';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;

-- ─── Findings and runs to read (empty guard tables first, rolled back at the end) ──────────
truncate public.guard_finding_events, public.guard_findings, public.guard_runs, public.guard_reports, public.guard_admin_state cascade;

insert into public.guard_runs (id, trigger, started_at, finished_at, status, new_count, open_count, resolved_count) values
  ('00000000-0000-0000-0a12-0000000000d1', 'manual',    now() - interval '3 days', now() - interval '3 days', 'ok', 5, 5, 0),
  ('00000000-0000-0000-0a12-0000000000d2', 'scheduled', now() - interval '2 days', now() - interval '2 days', 'ok', 3, 8, 0),
  ('00000000-0000-0000-0a12-0000000000d3', 'button',    now() - interval '1 day',  now() - interval '1 day',  'partial', 0, 8, 0),
  ('00000000-0000-0000-0a12-0000000000d4', 'manual',    now(), null, 'running', 0, 0, 0);

-- 2 critical (ledger A1, A2), 1 high (documents B1), 3 medium (cash C... uses documents B2), 1 low (partners D3);
-- 1 acknowledged high, 1 false positive critical, 1 resolved medium.
insert into public.guard_findings (id, rule_code, severity, fingerprint, entity_type, entity_id, doc_no, doc_date, amount, status, first_seen_run, last_seen_run, first_seen_at, last_seen_at) values
  ('00000000-0000-0000-0a12-0000000000f1', 'A1', 'critical', 'ui:1', 'journal_entry', gen_random_uuid(), 'JE-1', current_date - 5, 10, 'open', '00000000-0000-0000-0a12-0000000000d1', '00000000-0000-0000-0a12-0000000000d3', now() - interval '3 days', now()),
  ('00000000-0000-0000-0a12-0000000000f2', 'A2', 'critical', 'ui:2', 'journal_entry', gen_random_uuid(), 'JE-2', current_date - 4, null, 'open', '00000000-0000-0000-0a12-0000000000d2', '00000000-0000-0000-0a12-0000000000d3', now() - interval '2 days', now()),
  ('00000000-0000-0000-0a12-0000000000f3', 'B1', 'high', 'ui:3', 'sale', gen_random_uuid(), 'S-3', current_date - 3, 30, 'open', '00000000-0000-0000-0a12-0000000000d3', '00000000-0000-0000-0a12-0000000000d3', now() - interval '1 day', now()),
  ('00000000-0000-0000-0a12-0000000000f4', 'B2', 'medium', 'ui:4', 'sale', gen_random_uuid(), 'S-4', current_date - 3, 40, 'open', '00000000-0000-0000-0a12-0000000000d3', '00000000-0000-0000-0a12-0000000000d3', now() - interval '1 day', now()),
  ('00000000-0000-0000-0a12-0000000000f5', 'B2', 'medium', 'ui:5', 'sale', gen_random_uuid(), 'S-5', current_date - 3, 50, 'open', '00000000-0000-0000-0a12-0000000000d3', '00000000-0000-0000-0a12-0000000000d3', now() - interval '1 day', now()),
  ('00000000-0000-0000-0a12-0000000000f6', 'B2', 'medium', 'ui:6', 'purchase', gen_random_uuid(), 'P-6', current_date - 3, 60, 'open', '00000000-0000-0000-0a12-0000000000d3', '00000000-0000-0000-0a12-0000000000d3', now() - interval '1 day', now()),
  ('00000000-0000-0000-0a12-0000000000f7', 'D3', 'low', 'ui:7', 'partner', gen_random_uuid(), 'Partner 7', null, 70, 'open', '00000000-0000-0000-0a12-0000000000d3', '00000000-0000-0000-0a12-0000000000d3', now() - interval '1 day', now()),
  ('00000000-0000-0000-0a12-0000000000f8', 'B1', 'high', 'ui:8', 'sale', gen_random_uuid(), 'S-8', current_date - 3, 80, 'acknowledged', '00000000-0000-0000-0a12-0000000000d1', '00000000-0000-0000-0a12-0000000000d3', now() - interval '3 days', now()),
  ('00000000-0000-0000-0a12-0000000000f9', 'A3', 'critical', 'ui:9', 'journal_entry', gen_random_uuid(), 'JE-9', current_date - 9, 90, 'false_positive', '00000000-0000-0000-0a12-0000000000d1', '00000000-0000-0000-0a12-0000000000d3', now() - interval '3 days', now()),
  ('00000000-0000-0000-0a12-0000000000fa', 'B2', 'medium', 'ui:10', 'sale', gen_random_uuid(), 'S-10', current_date - 9, 100, 'resolved', '00000000-0000-0000-0a12-0000000000d1', '00000000-0000-0000-0a12-0000000000d3', now() - interval '3 days', now());

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a12-00000000000a');

-- ═══ 1. The dashboard ═══
do $$
declare d jsonb := public.guard_dashboard();
begin
  if (d -> 'open' ->> 'critical')::int <> 2 or (d -> 'open' ->> 'high')::int <> 1 or (d -> 'open' ->> 'medium')::int <> 3
     or (d -> 'open' ->> 'low')::int <> 1 or (d -> 'open' ->> 'total')::int <> 7 then
    raise exception 'FAIL open counts %', d -> 'open';
  end if;
  if (d ->> 'acknowledged')::int <> 1 then raise exception 'FAIL acknowledged %', d ->> 'acknowledged'; end if;
  -- By category: ledger 2 critical, documents 1 high + 3 medium, partners 1 low (false positive and resolved not counted).
  if (select (c ->> 'total')::int from jsonb_array_elements(d -> 'by_category') c where c ->> 'category' = 'ledger') <> 2
     or (select (c ->> 'total')::int from jsonb_array_elements(d -> 'by_category') c where c ->> 'category' = 'documents') <> 4
     or (select (c ->> 'high')::int from jsonb_array_elements(d -> 'by_category') c where c ->> 'category' = 'documents') <> 1
     or (select (c ->> 'total')::int from jsonb_array_elements(d -> 'by_category') c where c ->> 'category' = 'partners') <> 1
     or jsonb_array_length(d -> 'by_category') <> 3 then
    raise exception 'FAIL by category %', d -> 'by_category';
  end if;
  -- The last run is the newest (also a running one); the trend has finished runs only, oldest first.
  if d -> 'last_run' ->> 'id' <> '00000000-0000-0000-0a12-0000000000d4' then raise exception 'FAIL last run %', d -> 'last_run'; end if;
  if jsonb_array_length(d -> 'trend') <> 3 or d -> 'trend' -> 0 ->> 'open_count' <> '5' or d -> 'trend' -> 2 ->> 'status' <> 'partial' then
    raise exception 'FAIL trend %', d -> 'trend';
  end if;
  -- The worst open findings: critical first, then high; never medium, low, acknowledged or closed ones.
  if jsonb_array_length(d -> 'top') <> 3 or d -> 'top' -> 0 ->> 'severity' <> 'critical' or d -> 'top' -> 2 ->> 'severity' <> 'high'
     or d -> 'top' -> 2 ->> 'id' <> '00000000-0000-0000-0a12-0000000000f3' or d -> 'top' -> 0 ->> 'category' <> 'ledger' then
    raise exception 'FAIL top %', d -> 'top';
  end if;
end $$;

-- ═══ 2. Rules: enable, severity, thresholds with validation ═══
do $$
declare r jsonb;
begin
  r := public.guard_update_rule('A1', false, 'high', '{"tolerance": 0.05}');
  if (r ->> 'enabled')::boolean or r ->> 'default_severity' <> 'high' or (r -> 'params' ->> 'tolerance')::numeric <> 0.05 then raise exception 'FAIL rule update %', r; end if;
  -- NULL leaves a part as it is; params are merged, other keys stay.
  r := public.guard_update_rule('A1', true, null, null);
  if not (r ->> 'enabled')::boolean or r ->> 'default_severity' <> 'high' or (r -> 'params' ->> 'tolerance')::numeric <> 0.05 then raise exception 'FAIL rule partial update %', r; end if;
  r := public.guard_update_rule('A10', null, null, '{"tolerance": 0.5}');
  if r -> 'params' ->> 'receivable_code' <> '1200' or (r -> 'params' ->> 'tolerance')::numeric <> 0.5 then raise exception 'FAIL params not merged %', r; end if;
  r := public.guard_update_rule('A6', null, null, '{"document_types": ["invoice", "bill"]}');
  if jsonb_array_length(r -> 'params' -> 'document_types') <> 2 then raise exception 'FAIL list param'; end if;
  r := public.guard_update_rule('B2', null, null, '{"days": 3}');
  if (r -> 'params' ->> 'days')::int <> 3 then raise exception 'FAIL days'; end if;
  if to_regclass('public.guard_rules') is not null and exists (select 1 from public.guard_rules where code = 'F2') then
    r := public.guard_update_rule('F2', null, null, '{"threshold": 0.9}');
    if (r -> 'params' ->> 'threshold')::numeric <> 0.9 then raise exception 'FAIL threshold'; end if;
  end if;

  -- Rejected: unknown rule, severity, unknown key, other type, negative, out of range, empty list item, empty text.
  begin perform public.guard_update_rule('ZZ', true, null, null); raise exception 'FAIL unknown rule';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.guard_update_rule('A1', null, 'urgent', null); raise exception 'FAIL severity';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_update_rule('A1', null, null, '{"nope": 1}'); raise exception 'FAIL unknown key';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_update_rule('A1', null, null, '{"tolerance": "big"}'); raise exception 'FAIL type';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_update_rule('A1', null, null, '{"tolerance": -1}'); raise exception 'FAIL negative';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_update_rule('A6', null, null, '{"document_types": ["invoice", ""]}'); raise exception 'FAIL empty item';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_update_rule('A6', null, null, '{"document_types": "invoice"}'); raise exception 'FAIL list type';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_update_rule('A1', null, null, '[1]'); raise exception 'FAIL params shape';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_update_rule('B6', null, null, '{"max_discount_pct": 5000}'); raise exception 'FAIL pct range';
  exception when sqlstate '22023' then null; end;
  if exists (select 1 from public.guard_rules where code = 'F2') then
    begin perform public.guard_update_rule('F2', null, null, '{"threshold": 0.2}'); raise exception 'FAIL threshold range';
    exception when sqlstate '22023' then null; end;
  end if;
  -- A failed update changed nothing.
  if (select (params ->> 'tolerance')::numeric from public.guard_rules where code = 'A1') <> 0.05 then raise exception 'FAIL a rejected update changed the rule'; end if;
end $$;

reset role;
do $$
begin
  if (select count(*) from public.audit_logs where table_name = 'guard_rules' and action = 'UPDATE' and new_values_json ->> 'code' = 'A1') < 2 then
    raise exception 'FAIL rule changes are not in audit_logs';
  end if;
end $$;

-- A disabled rule is skipped by a scan.
update public.guard_rules set enabled = false where code = 'A2';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a12-00000000000a');
create temp table ui_run as select public.guard_scan(array['A1', 'A2'], 'button') as id;
do $$
begin
  if (select rules_run from public.guard_runs where id = (select id from ui_run)) <> array['A1'] then raise exception 'FAIL disabled rule ran'; end if;
end $$;
reset role;
update public.guard_rules set enabled = true where code = 'A2';
-- The scan above must not have disturbed the seeded findings (A1 and A2 on journal_entry ids that do not exist are
-- auto-resolved only for rules that ran: A1). Put them back for the next checks.
update public.guard_findings set status = 'open' where id in ('00000000-0000-0000-0a12-0000000000f1', '00000000-0000-0000-0a12-0000000000f2');

-- ═══ 3. Many findings at once ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a12-00000000000a');
do $$
declare n int;
begin
  n := public.guard_bulk_set_status(array['00000000-0000-0000-0a12-0000000000f4', '00000000-0000-0000-0a12-0000000000f5', '00000000-0000-0000-0a12-0000000000f6',
                                          '00000000-0000-0000-0a12-0000000000ee']::uuid[], 'acknowledged', null);
  if n <> 3 then raise exception 'FAIL bulk acknowledge count %', n; end if;
  if (select count(*) from public.guard_findings where status = 'acknowledged') <> 4 then raise exception 'FAIL bulk acknowledge'; end if;
  if (select count(*) from public.guard_finding_events e where e.to_status = 'acknowledged' and e.actor = '00000000-0000-0000-0a12-00000000000a') <> 3 then
    raise exception 'FAIL bulk events';
  end if;
  begin perform public.guard_bulk_set_status(array['00000000-0000-0000-0a12-0000000000f7']::uuid[], 'false_positive', ' '); raise exception 'FAIL note required';
  exception when sqlstate '22023' then null; end;
  n := public.guard_bulk_set_status(array['00000000-0000-0000-0a12-0000000000f7']::uuid[], 'false_positive', 'Known partner');
  if n <> 1 or (select status from public.guard_findings where id = '00000000-0000-0000-0a12-0000000000f7') <> 'false_positive' then raise exception 'FAIL bulk false positive'; end if;
  if public.guard_bulk_set_status(null, 'acknowledged', null) <> 0 or public.guard_bulk_set_status(array[]::uuid[], 'acknowledged', null) <> 0 then raise exception 'FAIL empty bulk'; end if;
  begin perform public.guard_bulk_set_status((select array_agg(gen_random_uuid()) from generate_series(1, 501)), 'acknowledged', null); raise exception 'FAIL bulk cap';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_bulk_set_status(array['00000000-0000-0000-0a12-0000000000f1']::uuid[], 'auto_resolved', 'x'); raise exception 'FAIL bulk status';
  exception when sqlstate '22023' then null; end;
end $$;

-- ═══ 4. Reports ═══
do $$
declare id1 uuid; r record;
begin
  id1 := public.guard_create_report('scan', '  Findings of 14.11.2026  ', E'# Findings\n\n- A1: 1', '{"open": 7}', current_date, current_date);
  select * into r from public.guard_reports where id = id1;
  if r.kind <> 'scan' or r.title <> 'Findings of 14.11.2026' or r.created_by_type <> 'user' or r.created_by <> '00000000-0000-0000-0a12-00000000000a'
     or r.body not like '# Findings%' or (r.summary ->> 'open')::int <> 7 then
    raise exception 'FAIL report %', to_jsonb(r);
  end if;
  perform public.guard_create_report('on_demand', 'A question', 'x');
  begin perform public.guard_create_report('daily', 'Daily', 'x'); raise exception 'FAIL admin daily report';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_create_report('scan', '  ', 'x'); raise exception 'FAIL empty title';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_create_report('weekly', 'x', 'x'); raise exception 'FAIL kind';
  exception when sqlstate '22023' then null; end;
  begin perform public.guard_create_report('scan', 'x', 'x', '[1]'); raise exception 'FAIL summary';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
-- The server (service role, no signed-in user) saves the agent's reports.
do $$
declare id2 uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  id2 := public.guard_create_report('daily', 'Daily report', 'body');
  if (select created_by_type from public.guard_reports where id = id2) <> 'system' then raise exception 'FAIL system report'; end if;
end $$;

-- ═══ 5. The bell ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a12-00000000000c');
do $$
declare s jsonb;
begin
  -- Cavid never looked: every open critical / high finding is new (f1, f2 critical, f3 high), and the reports of others (3).
  s := public.guard_notification_state();
  if (s ->> 'new_findings')::int <> 3 or (s ->> 'new_critical')::int <> 2 or (s ->> 'new_reports')::int <> 3 then raise exception 'FAIL bell first look %', s; end if;
  perform public.guard_mark_seen('findings');
  s := public.guard_notification_state();
  if (s ->> 'new_findings')::int <> 0 or (s ->> 'new_reports')::int <> 3 then raise exception 'FAIL bell after findings seen %', s; end if;
  perform public.guard_mark_seen('reports');
  s := public.guard_notification_state();
  if (s ->> 'new_findings')::int <> 0 or (s ->> 'new_reports')::int <> 0 then raise exception 'FAIL bell after reports seen %', s; end if;
  begin perform public.guard_mark_seen('everything'); raise exception 'FAIL mark seen what';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
-- A new critical finding and a new report appear after Cavid looked.
insert into public.guard_findings (id, rule_code, severity, fingerprint, entity_type, doc_no, status, first_seen_run, last_seen_run, first_seen_at, last_seen_at)
values ('00000000-0000-0000-0a12-0000000000fb', 'A1', 'critical', 'ui:11', 'journal_entry', 'JE-11', 'open', '00000000-0000-0000-0a12-0000000000d3', '00000000-0000-0000-0a12-0000000000d3', now() + interval '1 second', now() + interval '1 second');
insert into public.guard_reports (kind, title, body, created_by_type, created_at) values ('daily', 'Tomorrow', 'x', 'ai', now() + interval '1 second');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a12-00000000000c');
do $$
declare s jsonb;
begin
  s := public.guard_notification_state();
  if (s ->> 'new_findings')::int <> 1 or (s ->> 'new_critical')::int <> 1 or (s ->> 'new_reports')::int <> 1 then raise exception 'FAIL bell new items %', s; end if;
end $$;
-- Aysel's own reports are not new to her; the seen state is per admin.
select pg_temp.as_user('00000000-0000-0000-0a12-00000000000a');
do $$
declare s jsonb;
begin
  s := public.guard_notification_state();
  if (s ->> 'new_reports')::int <> 2 then raise exception 'FAIL own reports counted as new %', s; end if;
  -- Nobody reads another admin's seen state.
  if exists (select 1 from public.guard_admin_state where user_id = '00000000-0000-0000-0a12-00000000000c') then raise exception 'FAIL another admin state readable'; end if;
end $$;
reset role;

-- ═══ 6. Only admins; never anon ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a12-00000000000b');
do $$
begin
  begin perform public.guard_dashboard(); raise exception 'FAIL non-admin dashboard'; exception when insufficient_privilege then null; end;
  begin perform public.guard_update_rule('A1', true, null, null); raise exception 'FAIL non-admin rule'; exception when insufficient_privilege then null; end;
  begin perform public.guard_bulk_set_status(array['00000000-0000-0000-0a12-0000000000f1']::uuid[], 'acknowledged', null); raise exception 'FAIL non-admin bulk'; exception when insufficient_privilege then null; end;
  begin perform public.guard_create_report('scan', 'x', 'x'); raise exception 'FAIL non-admin report'; exception when insufficient_privilege then null; end;
  begin perform public.guard_notification_state(); raise exception 'FAIL non-admin bell'; exception when insufficient_privilege then null; end;
  begin perform public.guard_mark_seen('all'); raise exception 'FAIL non-admin seen'; exception when insufficient_privilege then null; end;
  if exists (select 1 from public.guard_reports) or exists (select 1 from public.guard_admin_state) then raise exception 'FAIL non-admin can read reports'; end if;
end $$;
reset role;
set local role anon;
do $$
begin
  begin perform public.guard_dashboard(); raise exception 'FAIL anon dashboard'; exception when insufficient_privilege then null; end;
  begin perform public.guard_mark_seen('all'); raise exception 'FAIL anon seen'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
  if has_table_privilege('authenticated', 'public.guard_reports', 'insert') or has_table_privilege('authenticated', 'public.guard_admin_state', 'update') then
    raise exception 'FAIL guard tables writable';
  end if;
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and p.proname in
             ('guard_dashboard', 'guard_update_rule', 'guard_bulk_set_status', 'guard_create_report', 'guard_notification_state', 'guard_mark_seen')) then
    raise exception 'FAIL a trigger calls the guard';
  end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
