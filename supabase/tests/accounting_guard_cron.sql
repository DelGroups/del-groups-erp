-- Checks supabase/migrations/20261120130000_accounting_guard_cron.sql (GUARD-4) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (no pg_cron): the scheduled scan does nothing while the
-- setting is off; the first scheduled scan is a full one; an incremental scan runs only the checks that can
-- look at changes, touches only the rows changed since the last good scan and closes nothing; a full scan
-- closes what is gone and cleans the guard's own old history; the schedule is validated, admin only, and
-- the next runs are right; with a stand-in for pg_cron the two jobs are (re)created and nothing else is
-- touched; and the guard wrote no business data. One transaction, rolled back. Any failed check raises an
-- exception; the last line prints ALL CHECKS PASSED.

begin;

insert into public.roles (name, permissions, description, is_system)
select 'Guard cron test: settings', '{"can_manage_settings": true}'::jsonb, 'GUARD-4 test', false
where not exists (select 1 from public.roles where name = 'Guard cron test: settings');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a13-00000000000a', 'guardcron-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0a13-00000000000b', 'guardcron-s@example.test', '{"full_name": "Samir Settings", "role_name": "Guard cron test: settings"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0a13-00000000000a';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Guard cron test: settings' limit 1)
where id = '00000000-0000-0000-0a13-00000000000b';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;
create or replace function pg_temp.business_checksum() returns text language plpgsql as $$
declare t text; v text; acc text := '';
begin
  foreach t in array array['journal_entries', 'journal_entry_lines', 'sales', 'sale_items', 'purchases', 'payments', 'transactions',
                           'accounts', 'expenses', 'partners', 'products', 'warehouse_stocks', 'stock_movements'] loop
    execute format('select count(*)::text || '':'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from public.%I x', t) into v;
    acc := acc || t || '=' || v || ';';
  end loop;
  return acc;
end $$;
create or replace function pg_temp.sale(p_id uuid, p_no text, p_total numeric, p_paid numeric, p_at timestamptz) returns void language sql as $$
  insert into public.sales (id, invoice_number, doc_no, total_amount, paid_amount, remaining_balance, debt_amount, status, doc_date,
                            created_at, updated_at, posted_at, payment_type, currency, exchange_rate)
  values (p_id, 'INV-' || p_id, p_no, p_total, p_paid, greatest(p_total - p_paid, 0), greatest(p_total - p_paid, 0), 'posted',
          (p_at at time zone 'UTC')::date, p_at, p_at, p_at, 'credit', 'AZN', 1);
$$;

-- ─── A clean slate: the guard's tables and the business tables the checks read (rolled back) ──
set local session_replication_role = replica;
truncate public.guard_finding_events, public.guard_findings, public.guard_runs, public.guard_reports, public.guard_admin_state cascade;
truncate public.journal_entry_lines, public.journal_entries, public.sale_items, public.sales, public.purchases, public.payments,
         public.transactions, public.accounts, public.expenses, public.expense_attachments, public.audit_logs, public.invoice_amendments,
         public.document_date_changes, public.accounting_periods, public.customers, public.suppliers, public.partners, public.products,
         public.warehouse_stocks, public.stock_movements, public.inventory_batches cascade;
do $$
begin
  if to_regclass('public.import_shipments') is not null then execute 'truncate public.import_shipments, public.import_payments, public.import_prepayments cascade'; end if;
  if to_regclass('public.purchase_items') is not null then execute 'truncate public.purchase_items cascade'; end if;
  if to_regclass('public.inventory_counts') is not null then execute 'truncate public.inventory_counts, public.inventory_count_items cascade'; end if;
end $$;
-- Two overpaid sales from two hours ago (B1): both are known to the first scan.
select pg_temp.sale('00000000-0000-0000-0a13-0000000005a1', 'C-OLD-A', 100, 150, now() - interval '2 hours');
select pg_temp.sale('00000000-0000-0000-0a13-0000000005a2', 'C-OLD-B', 100, 150, now() - interval '2 hours');
set local session_replication_role = origin;

-- ═══ 1. Defaults: off, in range, and the checks that need everything are marked ═══
do $$
declare s jsonb := public._guard_schedule_settings();
begin
  if (s ->> 'enabled')::boolean or (s ->> 'incremental_minutes')::int <> 30 or (s ->> 'nightly_hour_utc')::int <> 22 or (s ->> 'retention_days')::int <> 365 then
    raise exception 'FAIL defaults %', s;
  end if;
  if (select string_agg(code, ',' order by code) from public.guard_rules where full_only) <> 'A10,A8,A9,C1,C2,D1,D2,D3,E1,E2,E4,F1,F2,F3,F4,F5' then
    raise exception 'FAIL full-only checks %', (select string_agg(code, ',' order by code) from public.guard_rules where full_only);
  end if;
  if exists (select 1 from public.guard_rules where code in ('A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'E3', 'E5') and full_only) then
    raise exception 'FAIL an incremental check is marked full-only';
  end if;
  -- Out-of-range values in system_settings fall back to the defaults instead of breaking a scan.
  update public.system_settings set value = '{"enabled": true, "incremental_minutes": 7, "nightly_hour_utc": 99, "retention_days": 1}' where key = 'accounting_guard';
  s := public._guard_schedule_settings();
  if not (s ->> 'enabled')::boolean or (s ->> 'incremental_minutes')::int <> 30 or (s ->> 'nightly_hour_utc')::int <> 22 or (s ->> 'retention_days')::int <> 365 then
    raise exception 'FAIL settings not kept in range %', s;
  end if;
  update public.system_settings set value = '{"enabled": false, "incremental_minutes": 30, "nightly_hour_utc": 22, "retention_days": 365}' where key = 'accounting_guard';
end $$;

-- ═══ 2. Off: the scheduled scan does nothing ═══
do $$
begin
  if public.guard_scheduled_run('incremental') is not null or public.guard_scheduled_run('full') is not null then raise exception 'FAIL a scan ran while the setting is off'; end if;
  if exists (select 1 from public.guard_runs) then raise exception 'FAIL a run row exists while the setting is off'; end if;
  begin perform public.guard_scheduled_run('weekly'); raise exception 'FAIL mode'; exception when sqlstate '22023' then null; end;
end $$;

-- ═══ 3. An admin turns it on ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a13-00000000000a');
do $$
declare st jsonb;
begin
  st := public.guard_set_schedule(true, 30, 22, 365);
  if not (st -> 'settings' ->> 'enabled')::boolean then raise exception 'FAIL not enabled %', st; end if;
  if (st ->> 'pg_cron_available')::boolean or jsonb_array_length(st -> 'jobs') <> 0 then raise exception 'FAIL pg_cron should not be there %', st; end if;
  if st -> 'last_scheduled_run' is not null and st ->> 'last_scheduled_run' <> 'null' then raise exception 'FAIL a last run before any run'; end if;
  if (select value ->> 'enabled' from public.system_settings where key = 'accounting_guard') <> 'true' then raise exception 'FAIL setting not stored'; end if;
end $$;
-- The scheduled functions are for the server: not even an admin signed in can call them.
do $$
begin
  begin perform public.guard_scheduled_run('full'); raise exception 'FAIL admin called the scheduled run'; exception when insufficient_privilege then null; end;
  begin perform public.guard_apply_schedule(); raise exception 'FAIL admin called apply'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.audit_logs where table_name = 'system_settings' and new_values_json ->> 'key' = 'accounting_guard') < 1 then raise exception 'FAIL schedule change not in audit_logs'; end if;
end $$;

-- ═══ 4. The first scheduled scan is a full one ═══
create temp table cron_run1 as select public.guard_scheduled_run('incremental') as id;
-- Inside one transaction now() does not move: give the runs the distinct times real runs have.
update public.guard_runs set started_at = now() - interval '30 minutes', finished_at = now() - interval '30 minutes' where id = (select id from cron_run1);
do $$
declare r public.guard_runs%rowtype;
begin
  select * into r from public.guard_runs where id = (select id from cron_run1);
  if r.id is null or r.trigger <> 'scheduled' or r.since is not null or r.status <> 'ok' then raise exception 'FAIL first scan % %', r.trigger, r.since; end if;
  if cardinality(r.rules_run) <> (select count(*) from public.guard_rules where enabled) then raise exception 'FAIL the first scan did not run every check'; end if;
  if (select count(*) from public.guard_findings where rule_code = 'B1' and status = 'open') <> 2 then raise exception 'FAIL the overpaid sales not found'; end if;
end $$;

-- ═══ 5. An incremental scan: only what can look at changes, only what changed, closes nothing ═══
-- A new overpaid sale appears; the second old one is fixed without anyone touching its updated_at.
set local session_replication_role = replica;
select pg_temp.sale('00000000-0000-0000-0a13-0000000005a3', 'C-NEW', 100, 150, now());
update public.sales set paid_amount = 50, remaining_balance = 50, debt_amount = 50 where id = '00000000-0000-0000-0a13-0000000005a2';
set local session_replication_role = origin;
create temp table cron_run2 as select public.guard_scheduled_run('incremental') as id;
update public.guard_runs set started_at = now() - interval '20 minutes', finished_at = now() - interval '20 minutes' where id = (select id from cron_run2);
do $$
declare r public.guard_runs%rowtype; run1 uuid := (select id from cron_run1);
begin
  select * into r from public.guard_runs where id = (select id from cron_run2);
  if r.id is null or r.id = run1 or r.trigger <> 'scheduled' or r.since is null then raise exception 'FAIL incremental run %', to_jsonb(r); end if;
  if r.rules_run && array['A8', 'A9', 'A10', 'C1', 'C2', 'D1', 'D2', 'D3', 'F1', 'F2', 'F3', 'F4', 'F5', 'E1', 'E2', 'E4'] then raise exception 'FAIL full-only checks ran %', r.rules_run; end if;
  if not r.rules_run @> array['A1', 'B1', 'E3'] then raise exception 'FAIL incremental checks did not run %', r.rules_run; end if;
  -- The new sale is found by this run.
  if (select first_seen_run from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a13-0000000005a3:overpaid') <> r.id then raise exception 'FAIL new sale not found by the incremental run'; end if;
  -- The old sale nobody changed was not looked at again: last seen in the first run, and still open although it is fixed.
  if (select last_seen_run from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a13-0000000005a1:overpaid') <> run1 then raise exception 'FAIL an unchanged row was looked at'; end if;
  if (select status from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a13-0000000005a2:overpaid') <> 'open' then raise exception 'FAIL an incremental run closed a finding'; end if;
  -- Everything new is about the new sale (no posting entry, overpaid) and nothing was closed.
  if r.new_count <> (select count(*) from public.guard_findings where first_seen_run = r.id) or r.new_count < 1 or r.resolved_count <> 0 then raise exception 'FAIL counts % %', r.new_count, r.resolved_count; end if;
  if exists (select 1 from public.guard_findings where first_seen_run = r.id and entity_id is distinct from '00000000-0000-0000-0a13-0000000005a3'::uuid) then raise exception 'FAIL the incremental run found something unrelated to the changed sale'; end if;
  -- The window starts 5 minutes before the last good scheduled scan.
  if r.since <> (select started_at - interval '5 minutes' from public.guard_runs where id = run1) then raise exception 'FAIL since'; end if;
end $$;

-- ═══ 6. One scan at a time ═══
insert into public.guard_runs (id, trigger, status) values ('00000000-0000-0000-0a13-0000000000d9', 'scheduled', 'running');
do $$
begin
  if public.guard_scheduled_run('incremental') is not null or public.guard_scheduled_run('full') is not null then raise exception 'FAIL a scan started while another runs'; end if;
end $$;
delete from public.guard_runs where id = '00000000-0000-0000-0a13-0000000000d9';

-- ═══ 7. The nightly full scan: closes what is gone and cleans the guard's own old history ═══
-- Old history: an auto-resolved finding and a run 400 days old (go), an open finding 400 days old and a fresh
-- auto-resolved one (stay).
insert into public.guard_runs (id, trigger, started_at, finished_at, status) values ('00000000-0000-0000-0a13-0000000000d8', 'scheduled', now() - interval '400 days', now() - interval '400 days', 'ok');
insert into public.guard_findings (id, rule_code, severity, fingerprint, status, first_seen_run, last_seen_run, first_seen_at, last_seen_at, resolved_at) values
  ('00000000-0000-0000-0a13-0000000000f1', 'A1', 'critical', 'cron:old-closed', 'auto_resolved', '00000000-0000-0000-0a13-0000000000d8', '00000000-0000-0000-0a13-0000000000d8', now() - interval '401 days', now() - interval '400 days', now() - interval '400 days'),
  ('00000000-0000-0000-0a13-0000000000f2', 'A1', 'critical', 'cron:old-open', 'open', '00000000-0000-0000-0a13-0000000000d8', '00000000-0000-0000-0a13-0000000000d8', now() - interval '401 days', now() - interval '400 days', null),
  ('00000000-0000-0000-0a13-0000000000f3', 'A1', 'critical', 'cron:recent-closed', 'auto_resolved', '00000000-0000-0000-0a13-0000000000d8', '00000000-0000-0000-0a13-0000000000d8', now() - interval '30 days', now() - interval '29 days', now() - interval '29 days');
-- Those rows are not "seen" by any scan, so the full scan auto-resolves the open one; keep it open by marking it a false positive.
update public.guard_findings set status = 'false_positive' where id = '00000000-0000-0000-0a13-0000000000f2';
create temp table cron_before as select pg_temp.business_checksum() as sum;
create temp table cron_run3 as select public.guard_scheduled_run('full') as id;
update public.guard_runs set started_at = now() - interval '10 minutes', finished_at = now() - interval '10 minutes' where id = (select id from cron_run3);
grant select on cron_run3 to authenticated;
do $$
declare r public.guard_runs%rowtype;
begin
  select * into r from public.guard_runs where id = (select id from cron_run3);
  if r.since is not null or r.trigger <> 'scheduled' or r.status <> 'ok' then raise exception 'FAIL full run %', to_jsonb(r); end if;
  -- What was fixed is closed by the full scan.
  if (select status from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a13-0000000005a2:overpaid') <> 'auto_resolved' then raise exception 'FAIL the fixed finding was not auto-resolved'; end if;
  if (select status from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a13-0000000005a1:overpaid') <> 'open' then raise exception 'FAIL a real problem was closed'; end if;
  -- Retention.
  if exists (select 1 from public.guard_findings where id = '00000000-0000-0000-0a13-0000000000f1') then raise exception 'FAIL an old closed finding was not cleaned'; end if;
  if not exists (select 1 from public.guard_findings where id = '00000000-0000-0000-0a13-0000000000f2') then raise exception 'FAIL an old open (false positive) finding was cleaned'; end if;
  if not exists (select 1 from public.guard_findings where id = '00000000-0000-0000-0a13-0000000000f3') then raise exception 'FAIL a recent closed finding was cleaned'; end if;
  if exists (select 1 from public.guard_runs where id = '00000000-0000-0000-0a13-0000000000d8') then raise exception 'FAIL an old run was not cleaned'; end if;
  if not exists (select 1 from public.guard_runs where id = r.id) then raise exception 'FAIL the new run is gone'; end if;
  -- The events of a deleted finding go with it; the findings kept have no dangling run.
  if exists (select 1 from public.guard_finding_events e where not exists (select 1 from public.guard_findings f where f.id = e.finding_id)) then raise exception 'FAIL orphan events'; end if;
end $$;

-- ═══ 8. The guard wrote no business data ═══
do $$
begin
  if pg_temp.business_checksum() <> (select sum from cron_before) then raise exception 'FAIL the scheduled scan changed business data'; end if;
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal
             and p.proname in ('guard_scheduled_run', 'guard_apply_schedule', 'guard_schedule_state', 'guard_set_schedule', '_guard_schedule_settings')) then
    raise exception 'FAIL a trigger calls the schedule';
  end if;
  if has_function_privilege('authenticated', 'public.guard_scheduled_run(text)', 'execute') or has_function_privilege('anon', 'public.guard_scheduled_run(text)', 'execute')
     or has_function_privilege('authenticated', 'public.guard_apply_schedule()', 'execute') or has_function_privilege('anon', 'public.guard_set_schedule(boolean, integer, integer, integer)', 'execute') then
    raise exception 'FAIL schedule functions exposed';
  end if;
end $$;

-- ═══ 9. Validation, admin only, and the next runs ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a13-00000000000a');
do $$
declare st jsonb;
begin
  begin perform public.guard_set_schedule(true, 7, 22, 365); raise exception 'FAIL minutes'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_schedule(true, 30, 24, 365); raise exception 'FAIL hour'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_schedule(true, 30, -1, 365); raise exception 'FAIL hour low'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_schedule(true, 30, 22, 29); raise exception 'FAIL retention low'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_schedule(true, 30, 22, 3651); raise exception 'FAIL retention high'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_schedule(null, 30, 22, 365); raise exception 'FAIL enabled null'; exception when sqlstate '22023' then null; end;
  begin perform public.guard_set_schedule(true, null, 22, 365); raise exception 'FAIL minutes null'; exception when sqlstate '22023' then null; end;
  -- A rejected change changed nothing.
  if (public.guard_schedule_state() -> 'settings' ->> 'incremental_minutes')::int <> 30 then raise exception 'FAIL a rejected change was stored'; end if;

  st := public.guard_set_schedule(false, 15, 3, 90);
  if (st -> 'settings' ->> 'enabled')::boolean or (st -> 'settings' ->> 'incremental_minutes')::int <> 15 or (st -> 'settings' ->> 'nightly_hour_utc')::int <> 3 or (st -> 'settings' ->> 'retention_days')::int <> 90 then
    raise exception 'FAIL settings %', st -> 'settings';
  end if;
  -- Next runs: the next quarter hour, and 03:00 UTC.
  if (st ->> 'next_incremental')::timestamptz <= now() or (st ->> 'next_incremental')::timestamptz > now() + interval '15 minutes'
     or extract(minute from (st ->> 'next_incremental')::timestamptz at time zone 'UTC')::int % 15 <> 0 then
    raise exception 'FAIL next incremental %', st ->> 'next_incremental';
  end if;
  if (st ->> 'next_full')::timestamptz <= now() or (st ->> 'next_full')::timestamptz > now() + interval '1 day'
     or extract(hour from (st ->> 'next_full')::timestamptz at time zone 'UTC')::int <> 3 or extract(minute from (st ->> 'next_full')::timestamptz at time zone 'UTC')::int <> 0 then
    raise exception 'FAIL next full %', st ->> 'next_full';
  end if;
  if st -> 'last_scheduled_run' ->> 'id' <> (select id::text from cron_run3) then raise exception 'FAIL last scheduled run %', st -> 'last_scheduled_run'; end if;
  st := public.guard_set_schedule(true, 60, 22, 365);
  if extract(minute from (st ->> 'next_incremental')::timestamptz at time zone 'UTC')::int <> 0 then raise exception 'FAIL hourly next run'; end if;
end $$;
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a13-00000000000b');
do $$
begin
  begin perform public.guard_set_schedule(true, 30, 22, 365); raise exception 'FAIL non-admin set'; exception when insufficient_privilege then null; end;
  begin perform public.guard_schedule_state(); raise exception 'FAIL non-admin state'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin perform public.guard_schedule_state(); raise exception 'FAIL anon state'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ═══ 10. With pg_cron (a stand-in schema here): the two jobs are (re)created, and nothing else is touched ═══
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean not null default true);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid;
$$;
create function cron.unschedule(p_jobid bigint) returns boolean language sql as $$
  delete from cron.job where jobid = p_jobid returning true;
$$;
insert into cron.job (jobname, schedule, command) values ('someone-elses-job', '* * * * *', 'select 1');
do $$
declare st jsonb;
begin
  update public.system_settings set value = '{"enabled": false, "incremental_minutes": 15, "nightly_hour_utc": 3, "retention_days": 90}' where key = 'accounting_guard';
  if not public.guard_apply_schedule() then raise exception 'FAIL apply with pg_cron'; end if;
  if (select count(*) from cron.job where jobname like 'guard-%') <> 2 then raise exception 'FAIL jobs %', (select count(*) from cron.job where jobname like 'guard-%'); end if;
  if (select schedule from cron.job where jobname = 'guard-incremental') <> '*/15 * * * *' or (select schedule from cron.job where jobname = 'guard-full') <> '0 3 * * *' then raise exception 'FAIL job schedules'; end if;
  if (select command from cron.job where jobname = 'guard-incremental') <> 'SELECT public.guard_scheduled_run(''incremental'')'
     or (select command from cron.job where jobname = 'guard-full') <> 'SELECT public.guard_scheduled_run(''full'')' then raise exception 'FAIL job commands'; end if;
  -- Again: still two (idempotent), and the other job is untouched.
  perform public.guard_apply_schedule();
  perform public.guard_apply_schedule();
  if (select count(*) from cron.job where jobname like 'guard-%') <> 2 or (select count(*) from cron.job where jobname = 'someone-elses-job') <> 1 then raise exception 'FAIL not idempotent or touched another job'; end if;
  -- Saving as an admin moves the jobs; the state lists them.
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0a13-00000000000a","role":"authenticated"}', true);
  st := public.guard_set_schedule(false, 60, 22, 365);
  if not (st ->> 'pg_cron_available')::boolean or jsonb_array_length(st -> 'jobs') <> 2 then raise exception 'FAIL state with pg_cron %', st; end if;
  if (select schedule from cron.job where jobname = 'guard-incremental') <> '0 * * * *' or (select schedule from cron.job where jobname = 'guard-full') <> '0 22 * * *' then raise exception 'FAIL jobs not moved'; end if;
  -- The jobs exist while the setting is off, and do nothing then.
  if public.guard_scheduled_run('incremental') is not null then raise exception 'FAIL ran while off'; end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
