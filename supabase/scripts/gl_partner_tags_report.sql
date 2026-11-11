-- LED-2: GL partner tags report. READ-ONLY: run it in the Supabase SQL Editor after
-- 20261112100000_gl_partner_tags.sql and send the results back. It changes nothing.
--
-- Lists every journal line on 1200 (receivables) / 2100 (payables) without a partner,
-- and the partner it should have, found from:
--   B  the entry's cash row (transactions.journal_entry_id): the sale, purchase or
--      production order it pays (invoice payments, single and multi-account, stornos)
--   C  an opening-balance entry: its customer / supplier
--   D  the entry's document: a sale or purchase (invoice journals, production deliveries)
-- A line is "fixable" when exactly one partner is found; the backfill
-- (gl_partner_tags_backfill.sql) only touches those, with the same rules.

-- 1. Totals per status, account and reason.
with lines as (
  select l.id as line_id, l.journal_entry_id, l.partner_id, l.partner_type, a.code, l.debit, l.credit,
         e.entry_date, e.document_type, e.document_id, e.source_type, e.source_id, e.description
  from public.journal_entry_lines l
  join public.chart_of_accounts a on a.id = l.coa_id
  join public.journal_entries e on e.id = l.journal_entry_id
  -- partner_id is a validated foreign key to partners: an empty one is the only wrong value.
  where a.code in ('1200', '2100') and l.partner_id is null
),
candidates as (
  -- matching rules (begin): keep this block identical in the report and the backfill.
  -- B. The entry's cash row(s) and the document they pay (invoice payments, stornos, advances).
  select x.line_id,
         public._gl_partner_for_source(
           case when t.reference_type in ('sale', 'purchase') then t.reference_type else t.source_type end,
           case when t.reference_type in ('sale', 'purchase') then t.reference_id else t.source_id end) as partner,
         'B cash row of ' || coalesce(case when t.reference_type in ('sale', 'purchase') then t.reference_type end, t.source_type, '?') as rule
  from lines x join public.transactions t on t.journal_entry_id = x.journal_entry_id
  union all
  -- C. Opening-balance entries: their customer / supplier.
  select x.line_id, public._partner_ledger_partner(x.document_id, null), 'C customer opening balance'
  from lines x where x.document_type = 'customer_opening_balance'
  union all
  select x.line_id, public._partner_ledger_partner(null, x.document_id), 'C supplier opening balance'
  from lines x where x.document_type = 'supplier_opening_balance'
  union all
  -- D. The entry's document or source is a sale or a purchase (two joins keep the indexes).
  select x.line_id, public._gl_partner_for_source('sale', d.id), 'D sale document'
  from lines x join public.sales d on d.id = x.document_id
  union all
  select x.line_id, public._gl_partner_for_source('sale', d.id), 'D sale document'
  from lines x join public.sales d on d.id = x.source_id
  union all
  select x.line_id, public._gl_partner_for_source('purchase', d.id), 'D purchase document'
  from lines x join public.purchases d on d.id = x.document_id
  union all
  select x.line_id, public._gl_partner_for_source('purchase', d.id), 'D purchase document'
  from lines x join public.purchases d on d.id = x.source_id
  -- matching rules (end)
),
proposal as (
  select c.line_id,
         count(distinct c.partner) filter (where c.partner is not null) as partners_found,
         min(c.partner::text) filter (where c.partner is not null)::uuid as partner,
         string_agg(distinct c.rule, ', ') as rules
  from candidates c group by c.line_id
),
report as (
  select x.*, coalesce(p.partners_found, 0) as partners_found, p.partner as proposed_partner, p.rules,
         case when coalesce(p.partners_found, 0) = 1 then 'fixable'
              when coalesce(p.partners_found, 0) > 1 then 'ambiguous'
              else 'no partner found' end as status
  from lines x left join proposal p on p.line_id = x.line_id
)
select status, code as account, coalesce(rules, '—') as found_by, count(*) as lines,
       round(sum(debit), 2) as debit, round(sum(credit), 2) as credit,
       min(entry_date) as first_date, max(entry_date) as last_date
from report
group by status, code, rules
order by status, code, rules;

-- 2. The lines (newest first), with the partner each would get.
with lines as (
  select l.id as line_id, l.journal_entry_id, l.partner_id, l.partner_type, a.code, l.debit, l.credit,
         e.entry_date, e.document_type, e.document_id, e.source_type, e.source_id, e.description
  from public.journal_entry_lines l
  join public.chart_of_accounts a on a.id = l.coa_id
  join public.journal_entries e on e.id = l.journal_entry_id
  -- partner_id is a validated foreign key to partners: an empty one is the only wrong value.
  where a.code in ('1200', '2100') and l.partner_id is null
),
candidates as (
  -- matching rules (begin): keep this block identical in the report and the backfill.
  -- B. The entry's cash row(s) and the document they pay (invoice payments, stornos, advances).
  select x.line_id,
         public._gl_partner_for_source(
           case when t.reference_type in ('sale', 'purchase') then t.reference_type else t.source_type end,
           case when t.reference_type in ('sale', 'purchase') then t.reference_id else t.source_id end) as partner,
         'B cash row of ' || coalesce(case when t.reference_type in ('sale', 'purchase') then t.reference_type end, t.source_type, '?') as rule
  from lines x join public.transactions t on t.journal_entry_id = x.journal_entry_id
  union all
  -- C. Opening-balance entries: their customer / supplier.
  select x.line_id, public._partner_ledger_partner(x.document_id, null), 'C customer opening balance'
  from lines x where x.document_type = 'customer_opening_balance'
  union all
  select x.line_id, public._partner_ledger_partner(null, x.document_id), 'C supplier opening balance'
  from lines x where x.document_type = 'supplier_opening_balance'
  union all
  -- D. The entry's document or source is a sale or a purchase (two joins keep the indexes).
  select x.line_id, public._gl_partner_for_source('sale', d.id), 'D sale document'
  from lines x join public.sales d on d.id = x.document_id
  union all
  select x.line_id, public._gl_partner_for_source('sale', d.id), 'D sale document'
  from lines x join public.sales d on d.id = x.source_id
  union all
  select x.line_id, public._gl_partner_for_source('purchase', d.id), 'D purchase document'
  from lines x join public.purchases d on d.id = x.document_id
  union all
  select x.line_id, public._gl_partner_for_source('purchase', d.id), 'D purchase document'
  from lines x join public.purchases d on d.id = x.source_id
  -- matching rules (end)
),
proposal as (
  select c.line_id,
         count(distinct c.partner) filter (where c.partner is not null) as partners_found,
         min(c.partner::text) filter (where c.partner is not null)::uuid as partner,
         string_agg(distinct c.rule, ', ') as rules
  from candidates c group by c.line_id
)
select x.entry_date, x.code as account, x.debit, x.credit, x.description,
       x.document_type, x.source_type,
       case when coalesce(p.partners_found, 0) = 1 then 'fixable'
            when coalesce(p.partners_found, 0) > 1 then 'ambiguous'
            else 'no partner found' end as status,
       pa.name as proposed_partner_name, p.rules as found_by,
       p.partner as proposed_partner_id, x.line_id, x.journal_entry_id
from lines x
left join proposal p on p.line_id = x.line_id
left join public.partners pa on pa.id = p.partner
order by x.entry_date desc, x.line_id;

-- 3. Production deliveries whose sales invoice is a draft although booked (revenue on 1200,
--    stock out, advance). The partner ledger counts them (20261112100000); the sales screen
--    still shows them as drafts that could be posted a second time. Not changed here.
select s.doc_no, s.doc_date, s.customer_name, s.total_amount, s.status, s.production_order_id,
       exists (select 1 from public.journal_entries e where e.source_id = s.id and e.source_type like 'production_delivery%') as revenue_booked,
       s.id as sale_id
from public.sales s
where s.production_order_id is not null
  and lower(btrim(coalesce(s.status, ''))) = 'draft'
order by s.doc_date desc;
