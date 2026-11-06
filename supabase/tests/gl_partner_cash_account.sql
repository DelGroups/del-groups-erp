-- Checks supabase/migrations/20261107100000_gl_partner_cash_account.sql (GL-1) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres: a partner payment's cash line is booked on the chosen
-- cash / bank account's own ledger (accounts.coa_id), in and out, one account and two accounts, and
-- every journal balances; an account without a ledger falls back to the method (cash 1000, bank
-- 1100). Then the read-only check script runs. Any failed check raises an exception; the last line
-- prints ALL CHECKS PASSED. Leaves test rows behind: run it on a throwaway database only.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0c11-00000000000a', 'gl1-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0c11-00000000000a';

-- Ledgers: the usual 1100, and a bank ledger of its own (1110) to tell "the account's ledger" from 1100.
insert into public.chart_of_accounts (code, name, account_type, is_active) values ('1110', 'GL1 ABB bank', 'asset', true)
on conflict (code) do nothing;
insert into public.accounts (id, code, name, type, balance, coa_id) values
  ('00000000-0000-0000-0c11-0000000000c1', 'GL1-KASSA', 'GL1 Kassa', 'cash', 10000, (select id from public.chart_of_accounts where code = '1100')),
  ('00000000-0000-0000-0c11-0000000000c2', 'GL1-ABB', 'GL1 ABB', 'bank', 10000, (select id from public.chart_of_accounts where code = '1110')),
  ('00000000-0000-0000-0c11-0000000000c3', 'GL1-NOLEDGER', 'GL1 no ledger', 'cash', 10000, null)
on conflict (id) do nothing;
insert into public.partners (id, name, entity_type, is_customer, is_supplier, created_at, credit_limit, is_deleted) values
  ('00000000-0000-0000-0c11-0000000000e1', 'GL1 partner', 'legal', true, true, now(), 0, false)
on conflict (id) do nothing;

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), false);
$$;
-- The cash lines of an entry, "code:debit:credit" sorted, and whether it balances (read as the owner).
create or replace function pg_temp.cash_lines(p_entry uuid) returns text language sql security definer as $$
  select string_agg(c.code || ':' || jl.debit || ':' || jl.credit, ', ' order by c.code, jl.debit, jl.credit)
  from public.journal_entry_lines jl join public.chart_of_accounts c on c.id = jl.coa_id
  where jl.journal_entry_id = p_entry and jl.account_id is not null;
$$;
create or replace function pg_temp.balanced(p_entry uuid) returns boolean language sql security definer as $$
  select coalesce(sum(debit), 0) = coalesce(sum(credit), 0) and count(*) > 1 from public.journal_entry_lines where journal_entry_id = p_entry;
$$;
create or replace function pg_temp.counter(p_entry uuid) returns text language sql security definer as $$
  select string_agg(c.code || ':' || jl.debit || ':' || jl.credit, ', ' order by c.code)
  from public.journal_entry_lines jl join public.chart_of_accounts c on c.id = jl.coa_id
  where jl.journal_entry_id = p_entry and jl.account_id is null;
$$;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0c11-00000000000a');

do $$
declare
  v_partner uuid := '00000000-0000-0000-0c11-0000000000e1';
  v_kassa uuid := '00000000-0000-0000-0c11-0000000000c1';
  v_abb uuid := '00000000-0000-0000-0c11-0000000000c2';
  v_none uuid := '00000000-0000-0000-0c11-0000000000c3';
  r jsonb;
  r2 jsonb;
  e uuid;
begin
  -- 1. In, one account, a Kassa paid "cash": its own ledger 1100 (was 1000 before the fix).
  r := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'amount', 100, 'payment_type', 'in',
    'payment_method', 'cash', 'cash_account_id', v_kassa, 'idempotency_key', 'gl1-1'));
  e := (r ->> 'journal_entry_id')::uuid;
  if pg_temp.cash_lines(e) <> '1100:100.00:0.00' then raise exception 'FAIL 1 cash line %', pg_temp.cash_lines(e); end if;
  if pg_temp.counter(e) <> '1200:0.00:100.00' then raise exception 'FAIL 1 counter line %', pg_temp.counter(e); end if;
  if not pg_temp.balanced(e) then raise exception 'FAIL 1 not balanced'; end if;
  -- The same key again: the same entry, nothing new (idempotency key unchanged).
  r2 := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'amount', 100, 'payment_type', 'in',
    'payment_method', 'cash', 'cash_account_id', v_kassa, 'idempotency_key', 'gl1-1'));
  if r2 ->> 'journal_entry_id' is distinct from r ->> 'journal_entry_id' then raise exception 'FAIL 1 not idempotent'; end if;

  -- 2. In, one account, a bank account: its own ledger 1110, even when the method says "cash".
  r := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'amount', 70, 'payment_type', 'in',
    'payment_method', 'cash', 'cash_account_id', v_abb, 'idempotency_key', 'gl1-2'));
  e := (r ->> 'journal_entry_id')::uuid;
  if pg_temp.cash_lines(e) <> '1110:70.00:0.00' then raise exception 'FAIL 2 cash line %', pg_temp.cash_lines(e); end if;
  if not pg_temp.balanced(e) then raise exception 'FAIL 2 not balanced'; end if;

  -- 3. Out, one account, the bank paid "bank": 1110 on the credit side, 2100 on the debit side.
  r := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'amount', 40, 'payment_type', 'out',
    'payment_method', 'bank', 'cash_account_id', v_abb, 'idempotency_key', 'gl1-3'));
  e := (r ->> 'journal_entry_id')::uuid;
  if pg_temp.cash_lines(e) <> '1110:0.00:40.00' then raise exception 'FAIL 3 cash line %', pg_temp.cash_lines(e); end if;
  if pg_temp.counter(e) <> '2100:40.00:0.00' then raise exception 'FAIL 3 counter line %', pg_temp.counter(e); end if;
  if not pg_temp.balanced(e) then raise exception 'FAIL 3 not balanced'; end if;

  -- 4. In, two accounts (IMP-5 lines): one entry, each cash line on its account's ledger, whatever the line's method.
  r := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'payment_type', 'in', 'idempotency_key', 'gl1-4',
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', v_kassa, 'amount', 30, 'method', 'cash'),
      jsonb_build_object('account_id', v_abb, 'amount', 20, 'method', 'cash'))));
  e := (r ->> 'journal_entry_id')::uuid;
  if pg_temp.cash_lines(e) <> '1100:30.00:0.00, 1110:20.00:0.00' then raise exception 'FAIL 4 cash lines %', pg_temp.cash_lines(e); end if;
  if pg_temp.counter(e) <> '1200:0.00:50.00' then raise exception 'FAIL 4 counter line %', pg_temp.counter(e); end if;
  if not pg_temp.balanced(e) then raise exception 'FAIL 4 not balanced'; end if;
  if jsonb_array_length(r -> 'payment_ids') <> 2 then raise exception 'FAIL 4 payments %', r -> 'payment_ids'; end if;

  -- 5. Out, two accounts.
  r := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'payment_type', 'out', 'idempotency_key', 'gl1-5',
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', v_kassa, 'amount', 15, 'method', 'cash'),
      jsonb_build_object('account_id', v_abb, 'amount', 25, 'method', 'transfer'))));
  e := (r ->> 'journal_entry_id')::uuid;
  if pg_temp.cash_lines(e) <> '1100:0.00:15.00, 1110:0.00:25.00' then raise exception 'FAIL 5 cash lines %', pg_temp.cash_lines(e); end if;
  if pg_temp.counter(e) <> '2100:40.00:0.00' then raise exception 'FAIL 5 counter line %', pg_temp.counter(e); end if;
  if not pg_temp.balanced(e) then raise exception 'FAIL 5 not balanced'; end if;

  -- 6. An account without a ledger of its own: the method decides, as before (cash 1000, bank 1100).
  r := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'amount', 10, 'payment_type', 'in',
    'payment_method', 'cash', 'cash_account_id', v_none, 'idempotency_key', 'gl1-6'));
  if pg_temp.cash_lines((r ->> 'journal_entry_id')::uuid) <> '1000:10.00:0.00' then raise exception 'FAIL 6 cash fallback %', pg_temp.cash_lines((r ->> 'journal_entry_id')::uuid); end if;
  r := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'amount', 10, 'payment_type', 'in',
    'payment_method', 'bank', 'cash_account_id', v_none, 'idempotency_key', 'gl1-7'));
  if pg_temp.cash_lines((r ->> 'journal_entry_id')::uuid) <> '1100:10.00:0.00' then raise exception 'FAIL 6 bank fallback %', pg_temp.cash_lines((r ->> 'journal_entry_id')::uuid); end if;
end $$;
reset role;

-- 7. The helper and the balances: the cash screens moved with every payment.
do $$
begin
  if public.gl_coa_for_cash_account('00000000-0000-0000-0c11-0000000000c2', 'cash') <> '1110' then raise exception 'FAIL helper own ledger'; end if;
  if public.gl_coa_for_cash_account('00000000-0000-0000-0c11-0000000000c3', 'cash') <> '1000' then raise exception 'FAIL helper cash fallback'; end if;
  if public.gl_coa_for_cash_account(null, 'bank') <> '1100' then raise exception 'FAIL helper bank fallback'; end if;
  -- Kassa: 10,000 + 100 + 30 − 15; ABB: 10,000 + 70 − 40 + 20 − 25.
  if (select balance from public.accounts where id = '00000000-0000-0000-0c11-0000000000c1') <> 10115 then raise exception 'FAIL Kassa balance'; end if;
  if (select balance from public.accounts where id = '00000000-0000-0000-0c11-0000000000c2') <> 10025 then raise exception 'FAIL ABB balance'; end if;
end $$;

-- 8. The read-only check script runs on this database (and writes nothing).
create temp table gl1_before as select (select count(*) from public.journal_entries) as entries, (select count(*) from public.journal_entry_lines) as lines;
\ir ../scripts/gl_partner_cash_check.sql
do $$
begin
  if (select count(*) from public.journal_entries) <> (select entries from gl1_before)
     or (select count(*) from public.journal_entry_lines) <> (select lines from gl1_before) then
    raise exception 'FAIL the check script wrote something';
  end if;
end $$;

select set_config('request.jwt.claims', '', false);
select 'ALL CHECKS PASSED';
