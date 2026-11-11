-- LED-1: partner ledger check. READ-ONLY: run it in the Supabase SQL Editor after
-- 20261111100000_partner_ledger.sql and send the result back. It changes nothing.
--
-- One row per partner where any balance is not zero (+ = the partner owes us, - = we owe them):
--   ledger_balance  the new partner ledger (view partner_ledger_movements)
--   stored_balance  today's number (compute_partner_net_balance: open invoices only)
--   gl_balance      the general ledger, accounts 1200 / 2100 by partner_id
--   delta_stored    ledger - stored     delta_gl    ledger - GL
-- Plus one row "GL 1200/2100 without a partners.id": GL movement no partner can be found for
-- (invoice payments, opening balances and production deliveries post without a partners.id
-- today; LED-2 fixes that). Expected differences: docs/ledgers/partner-ledger-spec.md.

-- 1. Per partner, biggest differences first.
select partner_name,
       ledger_balance, stored_balance, gl_balance,
       delta_stored, delta_gl,
       case
         when partner_id is null then 'GL without partner (LED-2)'
         when abs(delta_stored) < 0.01 and abs(delta_gl) < 0.01 then 'all agree'
         when abs(delta_stored) < 0.01 then 'GL differs'
         when abs(delta_gl) < 0.01 then 'stored differs'
         else 'both differ'
       end as status,
       partner_id
from public.check_partner_ledger_integrity()
order by partner_id is null desc, greatest(abs(delta_stored), abs(delta_gl)) desc, partner_name;

-- 2. Totals: how many partners in each status and the sum of each balance.
select count(*) filter (where partner_id is not null) as partners,
       count(*) filter (where partner_id is not null and abs(delta_stored) < 0.01 and abs(delta_gl) < 0.01) as all_agree,
       count(*) filter (where partner_id is not null and abs(delta_stored) >= 0.01) as stored_differs,
       count(*) filter (where partner_id is not null and abs(delta_gl) >= 0.01) as gl_differs,
       round(sum(ledger_balance) filter (where partner_id is not null), 2) as ledger_total,
       round(sum(stored_balance) filter (where partner_id is not null), 2) as stored_total,
       round(sum(gl_balance), 2) as gl_total_incl_no_partner
from public.check_partner_ledger_integrity();

-- 3. Where the ledger's numbers come from (rows and money per kind of movement).
select source_type, count(*) as movements, round(sum(debit), 2) as debit, round(sum(credit), 2) as credit
from public.partner_ledger_movements
group by source_type
order by source_type;
