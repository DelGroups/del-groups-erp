-- LED-2: opening balances without a journal. READ-ONLY: run it in the Supabase SQL Editor
-- and send the result back. It changes nothing.
--
-- Until 20261112100000_gl_partner_tags.sql, set_customer_opening_balance_atomic /
-- set_supplier_opening_balance_atomic put customers.id / suppliers.id into
-- journal_entry_lines.partner_id (a foreign key to partners.id), so every change failed
-- and rolled back. Opening balances that exist were stored some other way and have no
-- journal (or a partial one). This lists, per customer / supplier, the stored opening
-- balance next to what the opening-balance journals hold, and the difference.
-- Posting the missing journals is NOT part of LED-2 (options in the PR).

with customer_journals as (
  select e.document_id as customer_id, round(sum(l.debit - l.credit), 2) as journaled
  from public.journal_entries e
  join public.journal_entry_lines l on l.journal_entry_id = e.id
  join public.chart_of_accounts a on a.id = l.coa_id and a.code = '1200'
  where e.document_type = 'customer_opening_balance'
  group by e.document_id
),
supplier_journals as (
  select e.document_id as supplier_id, round(sum(l.credit - l.debit), 2) as journaled
  from public.journal_entries e
  join public.journal_entry_lines l on l.journal_entry_id = e.id
  join public.chart_of_accounts a on a.id = l.coa_id and a.code = '2100'
  where e.document_type = 'supplier_opening_balance'
  group by e.document_id
),
rows_ as (
  select 'customer' as kind, coalesce(nullif(btrim(c.full_name), ''), c.name, c.company_name) as name,
         round(c.opening_balance, 2) as opening_balance, coalesce(j.journaled, 0) as journaled,
         public.resolve_unified_partner_id(c.id, null) as partner_id, c.id as customer_or_supplier_id
  from public.customers c left join customer_journals j on j.customer_id = c.id
  where coalesce(c.opening_balance, 0) <> 0 or coalesce(j.journaled, 0) <> 0
  union all
  select 'supplier', coalesce(nullif(btrim(s.full_name), ''), s.company_name),
         round(s.opening_balance, 2), coalesce(j.journaled, 0),
         public.resolve_unified_partner_id(null, s.id), s.id
  from public.suppliers s left join supplier_journals j on j.supplier_id = s.id
  where coalesce(s.opening_balance, 0) <> 0 or coalesce(j.journaled, 0) <> 0
)
select * from (
  select kind, name, opening_balance, journaled, round(opening_balance - journaled, 2) as missing_journal,
         case when journaled = 0 then 'no journal'
              when abs(opening_balance - journaled) < 0.01 then 'ok'
              else 'partial journal' end as status,
         partner_id is null as no_partner_row,
         partner_id, customer_or_supplier_id
  from rows_
) r
order by r.status = 'ok', abs(r.missing_journal) desc, r.kind, r.name;
