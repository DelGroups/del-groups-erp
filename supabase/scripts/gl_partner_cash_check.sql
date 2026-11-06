-- GL-1: are partner cash payments on the right ledger? READ-ONLY: every statement below is a SELECT.
-- Run it in the Supabase SQL Editor (production is fine: it writes nothing) and send the output.
-- The optional blocks at the end are commented out; they change nothing unless Del uncomments them.
--
-- Background (see supabase/migrations/20261107100000_gl_partner_cash_account.sql):
--   1000 "Kassa" is used only by partner payments (gl_coa_for_payment_method: 'bank' → 1100,
--   anything else → 1000). 1100 "Kassa və Bank" is the ledger of every other cash / bank flow
--   (invoice payments, expenses, imports). An account's own ledger is accounts.coa_id.
-- "Cash line" = a journal line that names a cash / bank account (journal_entry_lines.account_id).
-- "Usual code" of an account = its own ledger (accounts.coa_id); without one, the code most of its
-- other (non partner-payment) cash lines use; without those, 1100.
--
-- Output: 5 small tables, one statement each (the SQL Editor shows the last result; run them one
-- by one, or all at once and scroll through the results).

-- ─── 1. Partner payment journal entries by the cash line's ledger and account ───────────────
with partner_lines as (
  select je.id as entry_id, je.document_type, je.entry_date, jl.account_id, c.code, jl.debit, jl.credit
  from public.journal_entries je
  join public.journal_entry_lines jl on jl.journal_entry_id = je.id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where je.document_type in ('payment_receipt', 'payment_disbursement')
    and jl.account_id is not null
)
select '1. partner payments' as report,
       p.document_type,
       p.code as cash_line_code,
       coalesce(a.name, '(no account)') as cash_account,
       count(distinct p.entry_id) as entries,
       count(*) as lines,
       round(sum(p.debit), 2) as debit,
       round(sum(p.credit), 2) as credit,
       min(p.entry_date) as first_date,
       max(p.entry_date) as last_date
from partner_lines p
left join public.accounts a on a.id = p.account_id
group by p.document_type, p.code, a.name
order by p.document_type, p.code, a.name;

-- ─── 2. Each cash / bank account: its own ledger and the codes its other cash lines use ───────
with other_lines as (
  select jl.account_id, c.code, count(*) as n
  from public.journal_entry_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where jl.account_id is not null
    and coalesce(je.document_type, '') not in ('payment_receipt', 'payment_disbursement')
  group by jl.account_id, c.code
)
select '2. accounts' as report,
       a.name as cash_account,
       a.type,
       oc.code as own_ledger_code,
       coalesce(string_agg(o.code || ' × ' || o.n, ', ' order by o.n desc), '—') as other_lines_by_code
from public.accounts a
left join public.chart_of_accounts oc on oc.id = a.coa_id
left join other_lines o on o.account_id = a.id
group by a.id, a.name, a.type, oc.code
order by a.name;

-- ─── 3. Partner payment cash lines NOT on the account's usual code (what the fix changes) ────
with other_lines as (
  select jl.account_id, c.code, count(*) as n
  from public.journal_entry_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where jl.account_id is not null
    and coalesce(je.document_type, '') not in ('payment_receipt', 'payment_disbursement')
  group by jl.account_id, c.code
),
usual as (
  select a.id as account_id,
         coalesce(oc.code,
                  (select o.code from other_lines o where o.account_id = a.id order by o.n desc, o.code limit 1),
                  '1100') as usual_code
  from public.accounts a
  left join public.chart_of_accounts oc on oc.id = a.coa_id and oc.is_active
)
select '3. flagged partner lines' as report,
       coalesce(a.name, '(no account)') as cash_account,
       c.code as used_code,
       u.usual_code,
       to_char(je.entry_date, 'YYYY-MM') as period,
       count(*) as lines,
       round(sum(jl.debit - jl.credit), 2) as net_debit
from public.journal_entries je
join public.journal_entry_lines jl on jl.journal_entry_id = je.id
join public.chart_of_accounts c on c.id = jl.coa_id
left join public.accounts a on a.id = jl.account_id
left join usual u on u.account_id = jl.account_id
where je.document_type in ('payment_receipt', 'payment_disbursement')
  and jl.account_id is not null
  and c.code is distinct from coalesce(u.usual_code, '1100')
group by a.name, c.code, u.usual_code, to_char(je.entry_date, 'YYYY-MM')
order by period, a.name;

-- ─── 4. Totals of the flagged lines (the one number to read first) ──────────────────────────
with other_lines as (
  select jl.account_id, c.code, count(*) as n
  from public.journal_entry_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where jl.account_id is not null
    and coalesce(je.document_type, '') not in ('payment_receipt', 'payment_disbursement')
  group by jl.account_id, c.code
),
usual as (
  select a.id as account_id,
         coalesce(oc.code,
                  (select o.code from other_lines o where o.account_id = a.id order by o.n desc, o.code limit 1),
                  '1100') as usual_code
  from public.accounts a
  left join public.chart_of_accounts oc on oc.id = a.coa_id and oc.is_active
),
flagged as (
  select je.id as entry_id, jl.debit, jl.credit, je.entry_date
  from public.journal_entries je
  join public.journal_entry_lines jl on jl.journal_entry_id = je.id
  join public.chart_of_accounts c on c.id = jl.coa_id
  left join usual u on u.account_id = jl.account_id
  where je.document_type in ('payment_receipt', 'payment_disbursement')
    and jl.account_id is not null
    and c.code is distinct from coalesce(u.usual_code, '1100')
)
select '4. flagged totals' as report,
       (select count(*) from flagged) as flagged_lines,
       (select count(distinct entry_id) from flagged) as flagged_entries,
       (select round(coalesce(sum(debit), 0), 2) from flagged) as flagged_debit,
       (select round(coalesce(sum(credit), 0), 2) from flagged) as flagged_credit,
       (select count(*) from public.journal_entries where document_type in ('payment_receipt', 'payment_disbursement')) as partner_entries_total,
       (select count(*) from public.accounts where coa_id is null) as accounts_without_ledger,
       (select count(*) from flagged where public.is_accounting_period_closed(entry_date)) as flagged_lines_in_closed_periods;

-- ─── 5. GL vs the cash / bank screens, per account ──────────────────────────────────────────
-- gl_on_1000 / gl_on_1100 / gl_on_other: the account's cash lines by ledger (debit − credit).
-- balance: accounts.balance (what the cash / bank screens show). The difference is not only the
-- ledger split: opening balances typed when an account was created never had a journal entry.
select '5. gl vs balance' as report,
       a.name as cash_account,
       round(coalesce(sum(jl.debit - jl.credit) filter (where c.code = '1000'), 0), 2) as gl_on_1000,
       round(coalesce(sum(jl.debit - jl.credit) filter (where c.code = '1100'), 0), 2) as gl_on_1100,
       round(coalesce(sum(jl.debit - jl.credit) filter (where c.code not in ('1000', '1100')), 0), 2) as gl_on_other,
       round(coalesce(sum(jl.debit - jl.credit), 0), 2) as gl_total,
       round(coalesce(a.balance, 0), 2) as balance,
       round(coalesce(a.balance, 0) - coalesce(sum(jl.debit - jl.credit), 0), 2) as balance_minus_gl
from public.accounts a
left join public.journal_entry_lines jl on jl.account_id = a.id
left join public.chart_of_accounts c on c.id = jl.coa_id
group by a.id, a.name, a.balance
order by a.name;


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- OPTIONAL — NOT RUN. Del decides after reading tables 3 and 4. Everything below is commented
-- out; to use a block, remove the leading "-- " of its lines and run it on its own.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- A. Reclassification: one journal entry per period and cash account that moves the flagged net
--    amount from the code it was posted on (1000, or 1100 for a Kassa paid "by bank") to the
--    account's usual code. It does not touch the original entries.
--    - Date: the last day of the period when that period is open; when the period is closed
--      (period lock), today's date, and the memo names the original period. The period lock still
--      applies (create_journal_entry checks it), so nothing is written into a closed period.
--    - Idempotent: the key gl1-reclass:<period>:<account>:<from>→<to> makes a second run do nothing.
--    - Cash account balances (accounts.balance) do not change: only the ledger moves.
--
-- do $$
-- declare
--   r record;
--   v_date date;
--   v_memo text;
-- begin
--   for r in
--     with other_lines as (
--       select jl.account_id, c.code, count(*) as n
--       from public.journal_entry_lines jl
--       join public.journal_entries je on je.id = jl.journal_entry_id
--       join public.chart_of_accounts c on c.id = jl.coa_id
--       where jl.account_id is not null
--         and coalesce(je.document_type, '') not in ('payment_receipt', 'payment_disbursement')
--       group by jl.account_id, c.code
--     ),
--     usual as (
--       select a.id as account_id,
--              coalesce(oc.code,
--                       (select o.code from other_lines o where o.account_id = a.id order by o.n desc, o.code limit 1),
--                       '1100') as usual_code
--       from public.accounts a
--       left join public.chart_of_accounts oc on oc.id = a.coa_id and oc.is_active
--     )
--     select date_trunc('month', je.entry_date)::date as period_start,
--            jl.account_id, a.name as account_name, c.code as from_code, u.usual_code as to_code,
--            round(sum(jl.debit - jl.credit), 2) as net
--     from public.journal_entries je
--     join public.journal_entry_lines jl on jl.journal_entry_id = je.id
--     join public.chart_of_accounts c on c.id = jl.coa_id
--     join public.accounts a on a.id = jl.account_id
--     join usual u on u.account_id = jl.account_id
--     where je.document_type in ('payment_receipt', 'payment_disbursement')
--       and c.code is distinct from u.usual_code
--     group by 1, jl.account_id, a.name, c.code, u.usual_code
--     having round(sum(jl.debit - jl.credit), 2) <> 0
--     order by 1, a.name
--   loop
--     v_date := (r.period_start + interval '1 month - 1 day')::date;
--     v_memo := format('GL-1 reclassification %s: %s, %s → %s', to_char(r.period_start, 'YYYY-MM'), r.account_name, r.from_code, r.to_code);
--     if public.is_accounting_period_closed(v_date) then
--       v_date := public.document_today();
--       v_memo := v_memo || ' (period closed, posted today)';
--     end if;
--     perform public.create_journal_entry(jsonb_build_object(
--       'document_type', 'gl_reclassification',
--       'source_type', 'gl_reclassification',
--       'entry_date', v_date,
--       'idempotency_key', format('gl1-reclass:%s:%s:%s→%s', to_char(r.period_start, 'YYYY-MM'), r.account_id, r.from_code, r.to_code),
--       'description', v_memo,
--       'memo', v_memo,
--       'lines', jsonb_build_array(
--         -- net > 0 (more received than paid on the wrong code): Dt usual / Kt wrong; else the reverse.
--         jsonb_build_object('account_code', r.to_code, 'debit', greatest(r.net, 0), 'credit', greatest(-r.net, 0), 'cash_account_id', r.account_id, 'line_memo', v_memo),
--         jsonb_build_object('account_code', r.from_code, 'debit', greatest(-r.net, 0), 'credit', greatest(r.net, 0), 'cash_account_id', r.account_id, 'line_memo', v_memo)
--       )));
--   end loop;
-- end $$;
--
-- B. Accounts without a ledger of their own (table 4: accounts_without_ledger). Accounts created
--    after 2026-09-01 have accounts.coa_id empty (create_account_atomic never sets it). Invoices and
--    imports book them on 1100 anyway; after the migration, partner payments fall back to the
--    method for them (cash → 1000). Giving them 1100 makes all flows agree:
--
-- update public.accounts
-- set coa_id = (select id from public.chart_of_accounts where code = '1100' and is_active limit 1)
-- where coa_id is null;
