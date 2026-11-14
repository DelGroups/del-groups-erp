-- Checks supabase/migrations/20261120100000_accounting_guard_core.sql (GUARD-1) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres:
--   * every rule A1-A10, B1-B9, C1-C2, D1-D3 flags its bad case and not its good case;
--   * a second scan does not duplicate, a fixed problem is auto-resolved, a false positive stays
--     (and opens again when it changes materially), one failing rule does not stop the others;
--   * a non-admin cannot scan, change a finding or read the guard tables, anon cannot call it;
--   * the guard writes nothing to business tables (checksums before / after) and adds no trigger.
-- Everything runs in one transaction that is rolled back: the business tables are emptied first
-- (TRUNCATE inside the transaction) so the totals rules (A10, D) see only this file's rows, and
-- the rows seeded here are written with triggers off (session_replication_role = replica) because
-- most of them are broken on purpose. Any failed check raises an exception; the last line prints
-- ALL CHECKS PASSED.

begin;

-- ─── Users (with triggers on: the profile comes from auth.users) ────────────
insert into public.roles (name, permissions, description, is_system)
select 'Guard test: settings', '{"can_manage_settings": true, "can_view_financial_reports": true}'::jsonb, 'GUARD-1 test', false
where not exists (select 1 from public.roles where name = 'Guard test: settings');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a11-00000000000a', 'guard-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0a11-00000000000b', 'guard-s@example.test', '{"full_name": "Samir Settings", "role_name": "Guard test: settings"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0a11-00000000000a';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Guard test: settings' limit 1)
where id = '00000000-0000-0000-0a11-00000000000b';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;

-- ─── Empty business tables (rolled back at the end) ─────────────────────────
set local session_replication_role = replica;
truncate public.journal_entry_lines, public.journal_entries, public.sale_items, public.sales, public.purchases,
         public.payments, public.transactions, public.accounts, public.expenses, public.expense_attachments,
         public.audit_logs, public.invoice_amendments, public.document_date_changes, public.accounting_periods,
         public.customers, public.suppliers, public.partners, public.products, public.warehouse_stocks,
         public.stock_movements, public.inventory_batches,
         public.guard_finding_events, public.guard_findings, public.guard_runs cascade;
do $$
begin
  if to_regclass('public.import_shipments') is not null then
    execute 'truncate public.import_shipments, public.import_payments, public.import_prepayments cascade';
  end if;
  if to_regclass('public.purchase_items') is not null then execute 'truncate public.purchase_items cascade'; end if;
  if to_regclass('public.inventory_counts') is not null then execute 'truncate public.inventory_counts, public.inventory_count_items cascade'; end if;
end $$;

-- ─── Helpers ────────────────────────────────────────────────────────────────
create or replace function pg_temp.coa(p_code text) returns uuid language sql as $$
  select id from public.chart_of_accounts where code = p_code order by is_active desc limit 1;
$$;
-- A journal entry with its lines: [code, debit, credit, cash account, partner].
create or replace function pg_temp.je(p_id uuid, p_no text, p_date date, p_type text, p_doc uuid, p_lines jsonb,
                                      p_posted timestamptz default now()) returns uuid language plpgsql as $$
declare l jsonb;
begin
  insert into public.journal_entries (id, entry_no, entry_date, date, source_type, source_id, document_type, document_id, posted_at, memo)
  values (p_id, p_no, p_date, p_date::timestamptz, p_type, p_doc, p_type, p_doc, p_posted, 'GUARD-1 test');
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.journal_entry_lines (journal_entry_id, coa_id, debit, credit, account_id, partner_id, partner_type)
    values (p_id, pg_temp.coa(l ->> 0), (l ->> 1)::numeric, (l ->> 2)::numeric, nullif(l ->> 3, '')::uuid, nullif(l ->> 4, '')::uuid,
            case when nullif(l ->> 4, '') is not null then 'partner' end);
  end loop;
  return p_id;
end $$;
create or replace function pg_temp.sale(p_id uuid, p_no text, p_partner uuid, p_total numeric, p_date date,
                                        p_paid numeric default 0) returns uuid language sql as $$
  insert into public.sales (id, invoice_number, doc_no, partner_id, total_amount, paid_amount, remaining_balance, debt_amount,
                            status, doc_date, created_at, posted_at, payment_type, currency, exchange_rate)
  values (p_id, 'INV-' || p_id, p_no, p_partner, p_total, p_paid, greatest(p_total - p_paid, 0), greatest(p_total - p_paid, 0),
          'posted', p_date, now(), now(), 'credit', 'AZN', 1)
  returning id;
$$;
-- A sale with its invoice entry (1200 / 4000), the normal case.
create or replace function pg_temp.posted_sale(p_id uuid, p_no text, p_partner uuid, p_total numeric, p_date date) returns uuid language sql as $$
  select pg_temp.sale(p_id, p_no, p_partner, p_total, p_date);
  select pg_temp.je(gen_random_uuid(), 'JE-' || p_id, p_date, 'invoice', p_id,
                    jsonb_build_array(jsonb_build_array('1200', p_total, 0, null, p_partner), jsonb_build_array('4000', 0, p_total, null, null)));
  select p_id;
$$;
create or replace function pg_temp.fp(p text) returns boolean language sql as $$
  select exists (select 1 from public.guard_findings where fingerprint = p and status = 'open');
$$;
create or replace function pg_temp.expect(p_rule text, p_bad text, p_good text) returns void language plpgsql as $$
begin
  if not pg_temp.fp(p_bad) then
    raise exception 'FAIL % bad case not found: %', p_rule, p_bad;
  end if;
  if (select rule_code from public.guard_findings where fingerprint = p_bad) <> p_rule then
    raise exception 'FAIL % bad case filed under another rule', p_rule;
  end if;
  if p_good is not null and exists (select 1 from public.guard_findings where fingerprint = p_good) then
    raise exception 'FAIL % good case flagged: %', p_rule, p_good;
  end if;
end $$;
-- Checksums of the business tables the rules read (compared before / after the scans).
create or replace function pg_temp.business_checksum() returns text language plpgsql as $$
declare t text; v text; acc text := '';
begin
  foreach t in array array['journal_entries', 'journal_entry_lines', 'sales', 'sale_items', 'purchases', 'payments',
                           'transactions', 'accounts', 'expenses', 'expense_attachments', 'invoice_amendments',
                           'document_date_changes', 'accounting_periods', 'partners', 'customers', 'suppliers',
                           'products', 'warehouse_stocks', 'stock_movements', 'inventory_batches'] loop
    execute format('select count(*)::text || '':'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from public.%I x', t) into v;
    acc := acc || t || '=' || v || ';';
  end loop;
  -- audit_logs: only rows the guard did not write (guard_set_finding_status logs its own change).
  select acc || 'audit_logs=' || count(*) || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') into acc
  from public.audit_logs x where x.table_name <> 'guard_findings';
  return acc;
end $$;

-- ─── Fixed ids ──────────────────────────────────────────────────────────────
-- Partners
--   p_good  customer with a normal sale      p_gs   supplier with a normal purchase
--   p_b2    duplicate invoices               p_b7   history for the outlier check
--   p_d1    customer who paid without an invoice (credit balance)
--   p_d2    supplier paid without an invoice  p_d3  customer with a 120-day-old debt
insert into public.partners (id, name, entity_type, is_customer, is_supplier, created_at, credit_limit, is_deleted) values
  ('00000000-0000-0000-0a11-0000000000e1', 'G good customer', 'legal', true, false, now(), 0, false),
  ('00000000-0000-0000-0a11-0000000000e2', 'G good supplier', 'legal', false, true, now(), 0, false),
  ('00000000-0000-0000-0a11-0000000000e3', 'G B2 customer', 'legal', true, false, now(), 0, false),
  ('00000000-0000-0000-0a11-0000000000e4', 'G B7 customer', 'legal', true, false, now(), 0, false),
  ('00000000-0000-0000-0a11-0000000000e5', 'G D1 customer', 'legal', true, false, now(), 0, false),
  ('00000000-0000-0000-0a11-0000000000e6', 'G D2 supplier', 'legal', false, true, now(), 0, false),
  ('00000000-0000-0000-0a11-0000000000e7', 'G D3 customer', 'legal', true, false, now(), 0, false);

-- ═══ Phase 1: A10 on clean books (the rule compares totals, so it is checked first) ═══
do $$
declare
  p_good uuid := '00000000-0000-0000-0a11-0000000000e1';
  n int;
begin
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-000000000501', 'G-OK', p_good, 100, public._guard_today() - 1);
  -- Good: the partner ledger (100) equals the receivable account (100).
  select count(*) into n from public.guard_check_a10('{"tolerance": 0.01}', null);
  if n <> 0 then raise exception 'FAIL A10 good case: % rows', n; end if;
  -- Bad: a manual entry on 1200 that no partner document explains.
  perform pg_temp.je('00000000-0000-0000-0a11-00000000a10b', 'G-A10', public._guard_today() - 1, 'manual', null,
                     '[["1200", 25, 0, null, null], ["4990", 0, 25, null, null]]');
  select count(*) into n from public.guard_check_a10('{"tolerance": 0.01}', null);
  if n <> 1 then raise exception 'FAIL A10 bad case: % rows', n; end if;
  if (select amount from public.guard_check_a10('{"tolerance": 0.01}', null)) <> 25 then raise exception 'FAIL A10 amount'; end if;
end $$;

-- ═══ Phase 2: one bad and one good case per rule ═══
do $$
declare
  today date := public._guard_today();
  p_good uuid := '00000000-0000-0000-0a11-0000000000e1';
  p_gs uuid := '00000000-0000-0000-0a11-0000000000e2';
  p_b2 uuid := '00000000-0000-0000-0a11-0000000000e3';
  p_b7 uuid := '00000000-0000-0000-0a11-0000000000e4';
  p_d1 uuid := '00000000-0000-0000-0a11-0000000000e5';
  p_d2 uuid := '00000000-0000-0000-0a11-0000000000e6';
  p_d3 uuid := '00000000-0000-0000-0a11-0000000000e7';
  acc_good uuid := '00000000-0000-0000-0a11-0000000000c1';
  acc_a9 uuid := '00000000-0000-0000-0a11-0000000000c2';
  acc_c2 uuid := '00000000-0000-0000-0a11-0000000000c3';
  acc_c1 uuid := '00000000-0000-0000-0a11-0000000000c4';
  i int;
  t uuid;
begin
  -- Cash accounts. good: balance = cash rows = ledger lines. a9: no ledger lines. c2: balance
  -- above its cash rows (ledger agrees with the balance). c1: dips below zero between two rows.
  insert into public.accounts (id, code, name, type, balance, coa_id) values
    (acc_good, 'G-KASSA', 'G Kassa', 'Kassa', 100, pg_temp.coa('1100')),
    (acc_a9, 'G-A9', 'G A9', 'Kassa', 50, pg_temp.coa('1100')),
    (acc_c2, 'G-C2', 'G C2', 'Bank', 70, pg_temp.coa('1100')),
    (acc_c1, 'G-C1', 'G C1', 'Kassa', 10, pg_temp.coa('1100'));
  insert into public.transactions (id, account_id, type, amount, category, transaction_date, created_at) values
    ('00000000-0000-0000-0a11-0000000007c1', acc_good, 'Mədaxil', 100, 'Digər', now() - interval '6 days', now()),
    ('00000000-0000-0000-0a11-0000000007c2', acc_a9, 'Mədaxil', 50, 'Digər', now() - interval '6 days', now()),
    ('00000000-0000-0000-0a11-0000000007c3', acc_c2, 'Mədaxil', 50, 'Digər', now() - interval '6 days', now()),
    ('00000000-0000-0000-0a11-0000000007c4', acc_c1, 'Mədaxil', 10, 'Digər', now() - interval '5 days', now()),
    ('00000000-0000-0000-0a11-0000000007c5', acc_c1, 'Məxaric', 30, 'Digər', now() - interval '3 days', now()),
    ('00000000-0000-0000-0a11-0000000007c6', acc_c1, 'Mədaxil', 30, 'Digər', now() - interval '1 day', now());
  perform pg_temp.je(gen_random_uuid(), 'G-TX1', today - 6, 'cash_transaction', '00000000-0000-0000-0a11-0000000007c1',
                     jsonb_build_array(jsonb_build_array('1100', 100, 0, acc_good, null), jsonb_build_array('4990', 0, 100, null, null)));
  perform pg_temp.je(gen_random_uuid(), 'G-TX3', today - 6, 'cash_transaction', '00000000-0000-0000-0a11-0000000007c3',
                     jsonb_build_array(jsonb_build_array('1100', 70, 0, acc_c2, null), jsonb_build_array('4990', 0, 70, null, null)));
  perform pg_temp.je(gen_random_uuid(), 'G-TX4', today - 5, 'cash_transaction', '00000000-0000-0000-0a11-0000000007c4',
                     jsonb_build_array(jsonb_build_array('1100', 10, 0, acc_c1, null), jsonb_build_array('4990', 0, 10, null, null)));
  perform pg_temp.je(gen_random_uuid(), 'G-TX5', today - 3, 'cash_transaction', '00000000-0000-0000-0a11-0000000007c5',
                     jsonb_build_array(jsonb_build_array('6190', 30, 0, null, null), jsonb_build_array('1100', 0, 30, acc_c1, null)));
  perform pg_temp.je(gen_random_uuid(), 'G-TX6', today - 1, 'cash_transaction', '00000000-0000-0000-0a11-0000000007c6',
                     jsonb_build_array(jsonb_build_array('1100', 30, 0, acc_c1, null), jsonb_build_array('4990', 0, 30, null, null)));
  -- (the cash row of acc_a9 has no journal entry: A9 bad case)

  -- A1 unbalanced / A2 no lines / good: balanced.
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000a1', 'G-A1', today, 'manual', null, '[["6190", 10, 0], ["4990", 0, 9]]');
  insert into public.journal_entries (id, entry_no, entry_date, date, source_type, document_type, posted_at)
  values ('00000000-0000-0000-0a11-0000000000a2', 'G-A2', today, today, 'manual', 'manual', now());
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000a0', 'G-GOOD', today, 'manual', null, '[["6190", 10, 0], ["4990", 0, 10]]');

  -- A3 orphan: an invoice entry for a sale that does not exist.
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000a3', 'G-A3', today, 'invoice', '00000000-0000-0000-0a11-00000000dead',
                     '[["6190", 5, 0], ["4990", 0, 5]]');

  -- A4 posted sale without an entry; A4 COGS: total_cogs > 0 without a COGS entry.
  perform pg_temp.sale('00000000-0000-0000-0a11-0000000005a4', 'G-A4', p_good, 40, today - 1);
  update public.sales set total_cogs = 12 where id = '00000000-0000-0000-0a11-000000000501';
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005c0', 'G-COGS-OK', p_good, 20, today - 1);
  update public.sales set total_cogs = 8 where id = '00000000-0000-0000-0a11-0000000005c0';
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000c9', 'G-COGS', today - 1, 'sale_cogs', '00000000-0000-0000-0a11-0000000005c0',
                     '[["5000", 8, 0], ["1300", 0, 8]]');
  update public.sales set cogs_journal_entry_id = '00000000-0000-0000-0a11-0000000000c9' where id = '00000000-0000-0000-0a11-0000000005c0';

  -- A5 the sale says 60, its entry 55.
  perform pg_temp.sale('00000000-0000-0000-0a11-0000000005a5', 'G-A5', p_good, 60, today - 1);
  perform pg_temp.je(gen_random_uuid(), 'G-A5', today - 1, 'invoice', '00000000-0000-0000-0a11-0000000005a5',
                     jsonb_build_array(jsonb_build_array('1200', 55, 0, null, p_good), jsonb_build_array('4000', 0, 55, null, null)));

  -- A6 posted twice; good: an original and its reversal plus the new entry (not counted).
  perform pg_temp.sale('00000000-0000-0000-0a11-0000000005a6', 'G-A6', p_good, 30, today - 1);
  for i in 1..2 loop
    perform pg_temp.je(gen_random_uuid(), 'G-A6-' || i, today - 1, 'invoice', '00000000-0000-0000-0a11-0000000005a6',
                       jsonb_build_array(jsonb_build_array('1200', 30, 0, null, p_good), jsonb_build_array('4000', 0, 30, null, null)));
  end loop;

  -- A7 closed period (2020-01, closed 2020-02-05): posted after the close / before it.
  insert into public.accounting_periods (period_year, period_month, status, closed_at) values (2020, 1, 'closed', '2020-02-05');
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000a7', 'G-A7', '2020-01-15', 'manual', null, '[["6190", 3, 0], ["4990", 0, 3]]', now());
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000b7', 'G-A7-OK', '2020-01-10', 'manual', null, '[["6190", 3, 0], ["4990", 0, 3]]', '2020-01-31');

  -- A8 reversed_by points nowhere; good: a proper pair.
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000a8', 'G-A8', today, 'manual', null, '[["6190", 4, 0], ["4990", 0, 4]]');
  update public.journal_entries set reversed_by = '00000000-0000-0000-0a11-00000000beef' where id = '00000000-0000-0000-0a11-0000000000a8';
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000d1', 'G-R1', today, 'manual', null, '[["6190", 6, 0], ["4990", 0, 6]]');
  perform pg_temp.je('00000000-0000-0000-0a11-0000000000d2', 'G-R2', today, 'manual', null, '[["4990", 6, 0], ["6190", 0, 6]]');
  update public.journal_entries set reversed_by = '00000000-0000-0000-0a11-0000000000d2' where id = '00000000-0000-0000-0a11-0000000000d1';
  update public.journal_entries set reversal_of = '00000000-0000-0000-0a11-0000000000d1' where id = '00000000-0000-0000-0a11-0000000000d2';

  -- B1 paid more than the total.
  perform pg_temp.sale('00000000-0000-0000-0a11-0000000005b1', 'G-B1', p_good, 100, today - 1, 120);

  -- B2 same partner, same total, one day apart; a third one 10 days later is not a duplicate.
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005b2', 'G-B2-1', p_b2, 77, today - 12);
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005b3', 'G-B2-2', p_b2, 77, today - 11);
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005b4', 'G-B2-3', p_b2, 77, today - 1);

  -- B3 the same document number twice, written differently (case, a trailing space).
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005d1', 'G-B3', p_good, 15, today - 1);
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005d2', 'g-b3 ', p_good, 16, today - 1);

  -- B4 a payment dated before its invoice; good: a payment after it. A future-dated sale.
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005e4', 'G-B4', p_good, 25, today - 2);
  insert into public.transactions (id, type, amount, category, source_type, source_id, transaction_date, created_at) values
    ('00000000-0000-0000-0a11-0000000007b4', 'Mədaxil', 5, 'Satış Ödənişi', 'sale', '00000000-0000-0000-0a11-0000000005e4', now() - interval '5 days', now()),
    ('00000000-0000-0000-0a11-0000000007b5', 'Mədaxil', 5, 'Satış Ödənişi', 'sale', '00000000-0000-0000-0a11-0000000005e4', now(), now());
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005e5', 'G-B4-F', p_good, 25, today + 3);

  -- B5 backdated by 60 days; a date change by amendment; an amendment of the total only.
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005f5', 'G-B5', p_good, 35, today - 60);
  insert into public.invoice_amendments (id, document_type, document_id, revision, reason, old_values, new_values) values
    ('00000000-0000-0000-0a11-0000000009b5', 'sale', '00000000-0000-0000-0a11-000000000501', 1, 'date',
     jsonb_build_object('doc_date', (today - 3)::text, 'total_amount', 100), jsonb_build_object('doc_date', (today - 1)::text, 'total_amount', 100)),
    ('00000000-0000-0000-0a11-0000000009b6', 'sale', '00000000-0000-0000-0a11-000000000501', 2, 'total',
     jsonb_build_object('doc_date', (today - 1)::text, 'total_amount', 90), jsonb_build_object('doc_date', (today - 1)::text, 'total_amount', 100));

  -- B6 lines: below cost, zero price, 50 % discount; good: a normal line.
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005b6', 'G-B6', p_good, 60, today - 1);
  insert into public.sale_items (id, sale_id, quantity, unit_price, line_total, cogs_amount, discount_percent, product_name) values
    ('00000000-0000-0000-0a11-0000000008b1', '00000000-0000-0000-0a11-0000000005b6', 1, 10, 10, 15, 0, 'below cost'),
    ('00000000-0000-0000-0a11-0000000008b2', '00000000-0000-0000-0a11-0000000005b6', 1, 0, 0, 0, 0, 'zero price'),
    ('00000000-0000-0000-0a11-0000000008b3', '00000000-0000-0000-0a11-0000000005b6', 1, 100, 50, 20, 50, 'discount'),
    ('00000000-0000-0000-0a11-0000000008b4', '00000000-0000-0000-0a11-000000000501', 1, 100, 100, 60, 10, 'normal');

  -- B7 five sales of 100, then 1,000 (10 x the median) and 400 (4 x).
  for i in 1..5 loop
    perform pg_temp.posted_sale(('00000000-0000-0000-0a11-00000000070' || i)::uuid, 'G-B7-' || i, p_b7, 100, today - 40 + i * 5);
  end loop;
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-000000000711', 'G-B7-BIG', p_b7, 1000, today - 2);
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-000000000712', 'G-B7-OK', p_b7, 400, today - 3);

  -- B8 a 900 cash expense without a receipt; good: the same with an attachment.
  insert into public.expenses (id, code, amount, category, account_id, status, payment_mode, expense_date, created_at) values
    ('00000000-0000-0000-0a11-0000000006b8', 'G-EXP-1', 900, 'Digər', acc_good, 'posted', 'company', today - 1, now()),
    ('00000000-0000-0000-0a11-0000000006b9', 'G-EXP-2', 900, 'Digər', acc_good, 'posted', 'company', today - 1, now());
  insert into public.expense_attachments (expense_id, storage_path, file_name) values
    ('00000000-0000-0000-0a11-0000000006b9', 'g/receipt.pdf', 'receipt.pdf');

  -- B9 a posted sale deleted (audit_logs); good: a draft deleted.
  insert into public.audit_logs (id, action, module, table_name, record_id, old_values_json) values
    ('00000000-0000-0000-0a11-0000000004b9', 'DELETE', 'FINANCE', 'sales', gen_random_uuid(), '{"status": "posted", "doc_no": "G-DEL", "total_amount": 70}'),
    ('00000000-0000-0000-0a11-0000000004ba', 'DELETE', 'FINANCE', 'sales', gen_random_uuid(), '{"status": "draft", "doc_no": "G-DRAFT"}');

  -- Good supplier: a purchase with its bill.
  insert into public.purchases (id, invoice_number, partner_id, total_amount, paid_amount, debt_amount, status, doc_date, created_at, posted_at)
  values ('00000000-0000-0000-0a11-0000000006a1', 'G-P1', p_gs, 100, 0, 100, 'posted', today - 1, now(), now());
  perform pg_temp.je(gen_random_uuid(), 'G-P1', today - 1, 'bill', '00000000-0000-0000-0a11-0000000006a1',
                     jsonb_build_array(jsonb_build_array('1300', 100, 0, null, null), jsonb_build_array('2100', 0, 100, null, p_gs)));

  -- D1 a customer paid 80 with no invoice; D2 a supplier paid 50 with no invoice.
  insert into public.payments (id, payment_date, partner_id, amount, payment_type, payment_method, cash_account_id, journal_entry_id, created_at) values
    ('00000000-0000-0000-0a11-0000000003d1', now() - interval '1 day', p_d1, 80, 'in', 'cash', acc_good, '00000000-0000-0000-0a11-0000000002d1', now()),
    ('00000000-0000-0000-0a11-0000000003d2', now() - interval '1 day', p_d2, 50, 'out', 'cash', acc_good, '00000000-0000-0000-0a11-0000000002d2', now());
  perform pg_temp.je('00000000-0000-0000-0a11-0000000002d1', 'G-D1', today - 1, 'payment_receipt', '00000000-0000-0000-0a11-0000000003d1',
                     jsonb_build_array(jsonb_build_array('1000', 80, 0, null, null), jsonb_build_array('1200', 0, 80, null, p_d1)));
  perform pg_temp.je('00000000-0000-0000-0a11-0000000002d2', 'G-D2', today - 1, 'payment_disbursement', '00000000-0000-0000-0a11-0000000003d2',
                     jsonb_build_array(jsonb_build_array('2100', 50, 0, null, p_d2), jsonb_build_array('1000', 0, 50, null, null)));

  -- D3 a debt of 120 days.
  perform pg_temp.posted_sale('00000000-0000-0000-0a11-0000000005d3', 'G-D3', p_d3, 30, today - 120);
  update public.sales set created_at = now() - interval '120 days' where id = '00000000-0000-0000-0a11-0000000005d3';
end $$;

-- ═══ Phase 2b: product data and stock cases (GUARD-2) ═══
do $$
declare
  today date := public._guard_today();
  wh uuid := '00000000-0000-0000-0a11-0000000000a9';
begin
  insert into public.warehouses (id, code, name, is_default) values (wh, 'G-WH', 'G warehouse', false) on conflict (id) do nothing;

  -- One stockable product, complete (unit, category, prices) and with one warehouse row equal to its stock,
  -- so that only the case under test is wrong.
  create or replace function pg_temp.prod(p_n int, p_code text, p_name text, p_stock numeric default 10,
                                          p_wh_stock numeric default null, p_unit text default 'əd', p_cat text default 'Cat',
                                          p_sell numeric default 10, p_buy numeric default 5, p_barcode text default null)
  returns uuid language plpgsql as $f$
  declare v_id uuid := ('00000000-0000-0000-0a11-0000000f' || lpad(p_n::text, 4, '0'))::uuid;
  begin
    insert into public.products (id, code, name, category, unit, buy_price, sell_price, stock, barcode)
    values (v_id, p_code, p_name, p_cat, p_unit, p_buy, p_sell, p_stock, p_barcode);
    insert into public.warehouse_stocks (product_id, warehouse_id, current_stock)
    values (v_id, '00000000-0000-0000-0a11-0000000000a9', coalesce(p_wh_stock, p_stock));
    return v_id;
  end $f$;
  create or replace function pg_temp.pid(p_n int) returns uuid language sql as $f$
    select ('00000000-0000-0000-0a11-0000000f' || lpad(p_n::text, 4, '0'))::uuid;
  $f$;

  -- F1: the same name twice (different case); good: a unique name.
  perform pg_temp.prod(1, 'Q-1', 'Qapı');
  perform pg_temp.prod(2, 'Q-2', 'qapı');
  perform pg_temp.prod(3, 'U-1', 'Unikal ad');
  -- F2: spaces, Azerbaijani letters, a Cyrillic look-alike; good: genuinely different names.
  perform pg_temp.prod(4, 'KB-1', 'Konik bar');
  perform pg_temp.prod(5, 'KB-2', 'konik  bar');
  perform pg_temp.prod(6, 'AG-1', 'Ağac');
  perform pg_temp.prod(7, 'AG-2', 'Agac');
  perform pg_temp.prod(8, 'KBL-1', 'Kаbel');   -- the а is Cyrillic
  perform pg_temp.prod(9, 'KBL-2', 'Kabel');
  perform pg_temp.prod(10, 'MX-1', 'Mixi 40mm');
  perform pg_temp.prod(11, 'TX-1', 'Taxta 20mm');
  perform pg_temp.prod(12, 'KB-3X15', 'Kabel 3x1.5');
  perform pg_temp.prod(13, 'KB-3X25', 'Kabel 3x2.5');
  -- F3: stray spaces, the name in the code column, a space in a code, a name that is another product's code.
  perform pg_temp.prod(14, 'SP-1', ' Boşluq ad ');
  perform pg_temp.prod(15, 'Plain name', 'Plain name');
  perform pg_temp.prod(16, 'ab cd', 'Digər ad');
  perform pg_temp.prod(17, 'XY-1', 'XY-77');
  perform pg_temp.prod(18, 'XY-77', 'XY adı');
  -- F4: no unit, zero sale price, zero buy price, no category.
  perform pg_temp.prod(19, 'U-0', 'Vahidsiz', p_unit => null);
  perform pg_temp.prod(20, 'SP-0', 'Satışsız qiymət', p_sell => 0);
  perform pg_temp.prod(21, 'BP-0', 'Alışsız qiymət', p_buy => 0);
  perform pg_temp.prod(22, 'NC-0', 'Kateqoriyasız', p_cat => null);
  -- F5: the same code (other case), the same barcode (a space in front).
  perform pg_temp.prod(23, 'DUP-1', 'Kod bir');
  perform pg_temp.prod(24, 'dup-1', 'Kod iki');
  perform pg_temp.prod(25, 'BC-1', 'Barkod bir', p_barcode => '4012345');
  perform pg_temp.prod(26, 'BC-2', 'Barkod iki', p_barcode => ' 4012345');
  -- E1: the total says 10, the warehouse rows say 7. E2: a warehouse below zero.
  perform pg_temp.prod(27, 'E1-1', 'Cəm uyğunsuz', p_stock => 10, p_wh_stock => 7);
  perform pg_temp.prod(28, 'E2-1', 'Mənfi qalıq', p_stock => 0, p_wh_stock => -3);
  -- E3: sold 8 with 5 in stock (balance -3 after the sale, then 9 came in); good: 10 in, 4 out.
  perform pg_temp.prod(29, 'E3-1', 'Qalıqsız satış', p_stock => 6);
  perform pg_temp.prod(30, 'E3-2', 'Qalıqlı satış', p_stock => 6);
  perform pg_temp.sale('00000000-0000-0000-0a11-0000000005e1', 'G-E3-1', null, 80, today - 5);
  perform pg_temp.sale('00000000-0000-0000-0a11-0000000005e2', 'G-E3-2', null, 40, today - 5);
  insert into public.stock_movements (id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, created_at) values
    ('00000000-0000-0000-0a11-0000000e0001', pg_temp.pid(29), wh, 'in', 5, 'import', null, now() - interval '10 days'),
    ('00000000-0000-0000-0a11-0000000e0002', pg_temp.pid(29), wh, 'out', 8, 'sale', '00000000-0000-0000-0a11-0000000005e1', now() - interval '5 days'),
    ('00000000-0000-0000-0a11-0000000e0003', pg_temp.pid(29), wh, 'in', 9, 'import', null, now() - interval '2 days'),
    ('00000000-0000-0000-0a11-0000000e0004', pg_temp.pid(30), wh, 'in', 10, 'import', null, now() - interval '10 days'),
    ('00000000-0000-0000-0a11-0000000e0005', pg_temp.pid(30), wh, 'out', 4, 'sale', '00000000-0000-0000-0a11-0000000005e2', now() - interval '5 days');
  -- E4: stock on a zero-cost batch; good: a batch with a cost. Prices 10 then 25 (jump) and 10 then 12 (fine).
  perform pg_temp.prod(31, 'E4-1', 'Sıfır maya');
  perform pg_temp.prod(32, 'E4-2', 'Maya ilə');
  insert into public.inventory_batches (product_id, unit_cost, initial_qty, remaining_qty) values
    (pg_temp.pid(31), 0, 5, 5), (pg_temp.pid(32), 3, 5, 5);
  perform pg_temp.prod(33, 'E4-3', 'Qiymət sıçrayışı');
  perform pg_temp.prod(34, 'E4-4', 'Qiymət normal');
  insert into public.purchases (id, invoice_number, total_amount, paid_amount, debt_amount, status, doc_date, created_at, posted_at) values
    ('00000000-0000-0000-0a11-0000000006e1', 'G-PU-1', 20, 0, 20, 'posted', today - 20, now(), now()),
    ('00000000-0000-0000-0a11-0000000006e2', 'G-PU-2', 37, 0, 37, 'posted', today - 10, now(), now());
  insert into public.purchase_items (id, purchase_id, product_id, quantity, unit_price, total_price, currency, exchange_rate) values
    ('00000000-0000-0000-0a11-0000000007e1', '00000000-0000-0000-0a11-0000000006e1', pg_temp.pid(33), 1, 10, 10, 'AZN', 1),
    ('00000000-0000-0000-0a11-0000000007e2', '00000000-0000-0000-0a11-0000000006e2', pg_temp.pid(33), 1, 25, 25, 'AZN', 1),
    ('00000000-0000-0000-0a11-0000000007e3', '00000000-0000-0000-0a11-0000000006e1', pg_temp.pid(34), 1, 10, 10, 'AZN', 1),
    ('00000000-0000-0000-0a11-0000000007e4', '00000000-0000-0000-0a11-0000000006e2', pg_temp.pid(34), 1, 12, 12, 'AZN', 1);
  -- E5: a posted count: half missing (flagged), 10 % over (fine), nothing expected but 3 found (flagged), exact (fine).
  insert into public.inventory_counts (id, document_number, warehouse_id, status, count_date, posted_at)
  values ('00000000-0000-0000-0a11-0000000008c1', 'G-CNT-1', wh, 'posted', today - 3, now());
  insert into public.inventory_count_items (id, count_id, product_id, product_name, expected_qty, actual_qty, unit_cost) values
    ('00000000-0000-0000-0a11-0000000009c1', '00000000-0000-0000-0a11-0000000008c1', pg_temp.pid(3), 'Unikal ad', 10, 5, 5),
    ('00000000-0000-0000-0a11-0000000009c2', '00000000-0000-0000-0a11-0000000008c1', pg_temp.pid(1), 'Qapı', 10, 11, 5),
    ('00000000-0000-0000-0a11-0000000009c3', '00000000-0000-0000-0a11-0000000008c1', pg_temp.pid(2), 'qapı', 0, 3, 5),
    ('00000000-0000-0000-0a11-0000000009c4', '00000000-0000-0000-0a11-0000000008c1', pg_temp.pid(30), 'Qalıqlı satış', 20, 20, 5);
end $$;

-- Business data as it is before the guard runs.
create temp table guard_before as select pg_temp.business_checksum() as sum;
set local session_replication_role = origin;

-- ═══ Phase 3: scan as an admin ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
create temp table guard_run1 as select public.guard_scan(null, 'manual') as id;

do $$
declare
  p_good text := '00000000-0000-0000-0a11-0000000000e1';
  r record;
begin
  select * into r from public.guard_runs where id = (select id from guard_run1);
  if r.status <> 'ok' then raise exception 'FAIL run status % %', r.status, r.error; end if;
  if cardinality(r.rules_run) <> 34 then raise exception 'FAIL rules run %', r.rules_run; end if;
  if r.new_count < 24 or r.new_count <> (select count(*) from public.guard_findings) then raise exception 'FAIL new_count %', r.new_count; end if;

  perform pg_temp.expect('A1', 'A1:00000000-0000-0000-0a11-0000000000a1', 'A1:00000000-0000-0000-0a11-0000000000a0');
  perform pg_temp.expect('A2', 'A2:00000000-0000-0000-0a11-0000000000a2', 'A2:00000000-0000-0000-0a11-0000000000a0');
  perform pg_temp.expect('A3', 'A3:00000000-0000-0000-0a11-0000000000a3', 'A3:00000000-0000-0000-0a11-0000000000a0');
  perform pg_temp.expect('A4', 'A4:sale:00000000-0000-0000-0a11-0000000005a4', 'A4:sale:00000000-0000-0000-0a11-000000000501');
  perform pg_temp.expect('A4', 'A4:sale_cogs:00000000-0000-0000-0a11-000000000501', 'A4:sale_cogs:00000000-0000-0000-0a11-0000000005c0');
  perform pg_temp.expect('A5', 'A5:sale:00000000-0000-0000-0a11-0000000005a5', 'A5:sale:00000000-0000-0000-0a11-000000000501');
  perform pg_temp.expect('A6', 'A6:invoice:00000000-0000-0000-0a11-0000000005a6', 'A6:invoice:00000000-0000-0000-0a11-000000000501');
  perform pg_temp.expect('A7', 'A7:00000000-0000-0000-0a11-0000000000a7', 'A7:00000000-0000-0000-0a11-0000000000b7');
  perform pg_temp.expect('A8', 'A8:reversed_by:00000000-0000-0000-0a11-0000000000a8', 'A8:reversed_by:00000000-0000-0000-0a11-0000000000d1');
  if exists (select 1 from public.guard_findings where fingerprint in ('A8:reversal_of:00000000-0000-0000-0a11-0000000000d2',
             'A8:amount:00000000-0000-0000-0a11-0000000000d2')) then raise exception 'FAIL A8 good pair flagged'; end if;
  perform pg_temp.expect('A9', 'A9:00000000-0000-0000-0a11-0000000000c2', 'A9:00000000-0000-0000-0a11-0000000000c1');
  perform pg_temp.expect('A10', 'A10:receivable', null);
  perform pg_temp.expect('B1', 'B1:sale:00000000-0000-0000-0a11-0000000005b1:overpaid', 'B1:sale:00000000-0000-0000-0a11-000000000501:overpaid');
  perform pg_temp.expect('B2', 'B2:sale:00000000-0000-0000-0a11-0000000005b2:00000000-0000-0000-0a11-0000000005b3',
                                'B2:sale:00000000-0000-0000-0a11-0000000005b3:00000000-0000-0000-0a11-0000000005b4');
  perform pg_temp.expect('B3', 'B3:sale:g-b3', 'B3:sale:g-ok');
  perform pg_temp.expect('B4', 'B4:payment_before:00000000-0000-0000-0a11-0000000007b4', 'B4:payment_before:00000000-0000-0000-0a11-0000000007b5');
  perform pg_temp.expect('B4', 'B4:future:sale:00000000-0000-0000-0a11-0000000005e5', 'B4:future:sale:00000000-0000-0000-0a11-0000000005e4');
  perform pg_temp.expect('B5', 'B5:backdated:sale:00000000-0000-0000-0a11-0000000005f5', 'B5:backdated:sale:00000000-0000-0000-0a11-000000000501');
  perform pg_temp.expect('B5', 'B5:amendment:00000000-0000-0000-0a11-0000000009b5', 'B5:amendment:00000000-0000-0000-0a11-0000000009b6');
  perform pg_temp.expect('B6', 'B6:below_cost:00000000-0000-0000-0a11-0000000008b1', 'B6:below_cost:00000000-0000-0000-0a11-0000000008b4');
  perform pg_temp.expect('B6', 'B6:zero_price:00000000-0000-0000-0a11-0000000008b2', 'B6:zero_price:00000000-0000-0000-0a11-0000000008b4');
  perform pg_temp.expect('B6', 'B6:discount:00000000-0000-0000-0a11-0000000008b3', 'B6:discount:00000000-0000-0000-0a11-0000000008b4');
  perform pg_temp.expect('B7', 'B7:sale:00000000-0000-0000-0a11-000000000711', 'B7:sale:00000000-0000-0000-0a11-000000000712');
  perform pg_temp.expect('B8', 'B8:00000000-0000-0000-0a11-0000000006b8', 'B8:00000000-0000-0000-0a11-0000000006b9');
  perform pg_temp.expect('B9', 'B9:00000000-0000-0000-0a11-0000000004b9', 'B9:00000000-0000-0000-0a11-0000000004ba');
  perform pg_temp.expect('C1', 'C1:00000000-0000-0000-0a11-0000000000c4', 'C1:00000000-0000-0000-0a11-0000000000c1');
  perform pg_temp.expect('C2', 'C2:00000000-0000-0000-0a11-0000000000c3', 'C2:00000000-0000-0000-0a11-0000000000c1');
  perform pg_temp.expect('D1', 'D1:00000000-0000-0000-0a11-0000000000e5', 'D1:' || p_good);
  perform pg_temp.expect('D2', 'D2:00000000-0000-0000-0a11-0000000000e6', 'D2:00000000-0000-0000-0a11-0000000000e2');
  if not exists (select 1 from public.guard_findings where rule_code = 'D3' and partner_id = '00000000-0000-0000-0a11-0000000000e7') then
    raise exception 'FAIL D3 bad case not found';
  end if;
  if exists (select 1 from public.guard_findings where rule_code = 'D3' and partner_id = p_good::uuid) then
    raise exception 'FAIL D3 good case flagged';
  end if;
  -- One finding per problem: the bad cases of a rule are not filed twice.
  if exists (select 1 from public.guard_findings group by fingerprint having count(*) > 1) then raise exception 'FAIL duplicate fingerprint'; end if;
  -- Every finding was logged as found.
  if exists (select 1 from public.guard_findings f where not exists (
               select 1 from public.guard_finding_events e where e.finding_id = f.id and e.to_status = 'open')) then
    raise exception 'FAIL finding without event';
  end if;
  -- Severity comes from the rule.
  if (select severity from public.guard_findings where fingerprint = 'A1:00000000-0000-0000-0a11-0000000000a1') <> 'critical'
     or (select severity from public.guard_findings where fingerprint = 'B3:sale:g-b3') <> 'medium' then
    raise exception 'FAIL severity';
  end if;
end $$;

-- GUARD-2: product data and stock rules, bad and good cases.
do $$
declare
  wh text := '00000000-0000-0000-0a11-0000000000a9';
  f record;
begin
  -- F1 the same name; good: a unique name. The cluster lists both products with their cards.
  perform pg_temp.expect('F1', 'F1:' || lower('Qapı'), 'F1:unikal ad');
  select * into f from public.guard_findings where fingerprint = 'F1:' || lower('Qapı');
  if f.details -> 'product_ids' <> jsonb_build_array(pg_temp.pid(1), pg_temp.pid(2)) then raise exception 'FAIL F1 members %', f.details -> 'product_ids'; end if;
  if jsonb_array_length(f.details -> 'products') <> 2
     or (f.details -> 'products' -> 0 ->> 'unit') <> 'əd' or (f.details -> 'products' -> 0 ->> 'category') <> 'Cat'
     or (f.details -> 'products' -> 0 -> 'last_movement') is null or not (f.details -> 'products' -> 0 ? 'stock') then
    raise exception 'FAIL F1 cards %', f.details -> 'products';
  end if;

  -- F2 similar names: spaces, Azerbaijani letters, a Cyrillic look-alike.
  perform pg_temp.expect('F2', 'F2:' || pg_temp.pid(4), null);
  perform pg_temp.expect('F2', 'F2:' || pg_temp.pid(6), null);
  perform pg_temp.expect('F2', 'F2:' || pg_temp.pid(8), null);
  if (select details -> 'product_ids' from public.guard_findings where fingerprint = 'F2:' || pg_temp.pid(4)) <> jsonb_build_array(pg_temp.pid(4), pg_temp.pid(5))
     or (select details -> 'product_ids' from public.guard_findings where fingerprint = 'F2:' || pg_temp.pid(6)) <> jsonb_build_array(pg_temp.pid(6), pg_temp.pid(7))
     or (select details -> 'product_ids' from public.guard_findings where fingerprint = 'F2:' || pg_temp.pid(8)) <> jsonb_build_array(pg_temp.pid(8), pg_temp.pid(9)) then
    raise exception 'FAIL F2 clusters';
  end if;
  -- Genuinely different names are in no cluster; the exact same name is F1's, not F2's.
  if exists (select 1 from public.guard_findings g where g.rule_code = 'F2'
             and g.details -> 'product_ids' ?| array[pg_temp.pid(1)::text, pg_temp.pid(2)::text, pg_temp.pid(3)::text, pg_temp.pid(10)::text,
                                                    pg_temp.pid(11)::text, pg_temp.pid(12)::text, pg_temp.pid(13)::text]) then
    raise exception 'FAIL F2 matched names that differ';
  end if;
  if (select count(*) from public.guard_findings where rule_code = 'F2') <> 3 then raise exception 'FAIL F2 clusters: %', (select count(*) from public.guard_findings where rule_code = 'F2'); end if;

  -- F3
  perform pg_temp.expect('F3', 'F3:name_spaces:' || pg_temp.pid(14), 'F3:name_spaces:' || pg_temp.pid(3));
  perform pg_temp.expect('F3', 'F3:code_is_name:' || pg_temp.pid(15), 'F3:code_is_name:' || pg_temp.pid(3));
  perform pg_temp.expect('F3', 'F3:code_has_space:' || pg_temp.pid(16), 'F3:code_has_space:' || pg_temp.pid(3));
  perform pg_temp.expect('F3', 'F3:name_is_a_code:' || pg_temp.pid(17), 'F3:name_is_a_code:' || pg_temp.pid(18));
  if exists (select 1 from public.guard_findings where rule_code = 'F3' and entity_id = pg_temp.pid(3)) then raise exception 'FAIL F3 good product flagged'; end if;

  -- F4; good: a complete product.
  perform pg_temp.expect('F4', 'F4:no_unit:' || pg_temp.pid(19), 'F4:no_unit:' || pg_temp.pid(3));
  perform pg_temp.expect('F4', 'F4:zero_sell_price:' || pg_temp.pid(20), 'F4:zero_sell_price:' || pg_temp.pid(3));
  perform pg_temp.expect('F4', 'F4:zero_buy_price:' || pg_temp.pid(21), 'F4:zero_buy_price:' || pg_temp.pid(3));
  perform pg_temp.expect('F4', 'F4:no_category:' || pg_temp.pid(22), 'F4:no_category:' || pg_temp.pid(3));
  if exists (select 1 from public.guard_findings where rule_code = 'F4' and entity_id = pg_temp.pid(3)) then raise exception 'FAIL F4 good product flagged'; end if;

  -- F5 code (other case) and barcode (a space); one finding per value, with both products.
  perform pg_temp.expect('F5', 'F5:code:dup-1', 'F5:code:u-1');
  perform pg_temp.expect('F5', 'F5:barcode:4012345', null);
  if (select details -> 'product_ids' from public.guard_findings where fingerprint = 'F5:code:dup-1') <> jsonb_build_array(pg_temp.pid(23), pg_temp.pid(24))
     or (select details -> 'product_ids' from public.guard_findings where fingerprint = 'F5:barcode:4012345') <> jsonb_build_array(pg_temp.pid(25), pg_temp.pid(26)) then
    raise exception 'FAIL F5 members';
  end if;

  -- E1: the report's other kinds. A total mismatch is "high"; the kinds F1 / F4 / F5 own are not repeated.
  perform pg_temp.expect('E1', 'E1:total_mismatch:' || pg_temp.pid(27), 'E1:total_mismatch:' || pg_temp.pid(3));
  if (select severity from public.guard_findings where fingerprint = 'E1:total_mismatch:' || pg_temp.pid(27)) <> 'high' then raise exception 'FAIL E1 severity'; end if;
  if exists (select 1 from public.guard_findings where rule_code = 'E1' and details ->> 'kind' in ('duplicate_name', 'no_category', 'duplicate_code', 'duplicate_barcode', 'service_or_composite')) then
    raise exception 'FAIL E1 repeats another rule';
  end if;

  -- E2 a warehouse below zero; good: a warehouse with stock.
  perform pg_temp.expect('E2', 'E2:' || pg_temp.pid(28) || ':' || wh, 'E2:' || pg_temp.pid(3) || ':' || wh);

  -- E3 sold 8 when 5 were there; good: sold 4 of 10.
  perform pg_temp.expect('E3', 'E3:00000000-0000-0000-0a11-0000000e0002', 'E3:00000000-0000-0000-0a11-0000000e0005');
  if (select amount from public.guard_findings where fingerprint = 'E3:00000000-0000-0000-0a11-0000000e0002') <> 3 then raise exception 'FAIL E3 shortfall'; end if;

  -- E4 zero cost; good: a cost. A price jump from 10 to 25; good: 10 to 12 and the first price.
  perform pg_temp.expect('E4', 'E4:zero_cost:' || pg_temp.pid(31), 'E4:zero_cost:' || pg_temp.pid(32));
  perform pg_temp.expect('E4', 'E4:jump:00000000-0000-0000-0a11-0000000007e2', 'E4:jump:00000000-0000-0000-0a11-0000000007e1');
  if exists (select 1 from public.guard_findings where fingerprint in ('E4:jump:00000000-0000-0000-0a11-0000000007e3', 'E4:jump:00000000-0000-0000-0a11-0000000007e4')) then
    raise exception 'FAIL E4 small change flagged';
  end if;

  -- E5 half missing and "nothing expected, 3 found"; good: 10 % over and an exact count.
  perform pg_temp.expect('E5', 'E5:00000000-0000-0000-0a11-0000000009c1', 'E5:00000000-0000-0000-0a11-0000000009c2');
  perform pg_temp.expect('E5', 'E5:00000000-0000-0000-0a11-0000000009c3', 'E5:00000000-0000-0000-0a11-0000000009c4');
end $$;

-- The scan scopes: 'products' runs F1-F5, 'stock' runs E1-E5.
create temp table guard_run_products as select public.guard_scan(array['products'], 'button') as id;
create temp table guard_run_stock as select public.guard_scan(array['stock'], 'button') as id;
do $$
begin
  if (select rules_run from public.guard_runs where id = (select id from guard_run_products)) <> array['F1', 'F2', 'F3', 'F4', 'F5']
     or (select rules_run from public.guard_runs where id = (select id from guard_run_stock)) <> array['E1', 'E2', 'E3', 'E4', 'E5'] then
    raise exception 'FAIL scopes: % / %', (select rules_run from public.guard_runs where id = (select id from guard_run_products)),
                                          (select rules_run from public.guard_runs where id = (select id from guard_run_stock));
  end if;
  if (select status from public.guard_runs where id = (select id from guard_run_products)) <> 'ok'
     or (select status from public.guard_runs where id = (select id from guard_run_stock)) <> 'ok' then
    raise exception 'FAIL product scans: %', (select error from public.guard_runs where id = (select id from guard_run_products));
  end if;
  -- A scoped scan does not add findings again.
  if (select new_count from public.guard_runs where id = (select id from guard_run_products)) <> 0 then raise exception 'FAIL products rescan added findings'; end if;
end $$;

-- A second scan does not duplicate; a scoped scan runs only its rules.
create temp table guard_count1 as select count(*) as n from public.guard_findings;
create temp table guard_run2 as select public.guard_scan(null, 'button') as id;
create temp table guard_run3 as select public.guard_scan(array['cash', 'B3'], 'button') as id;
do $$
begin
  if (select count(*) from public.guard_findings) <> (select n from guard_count1) then raise exception 'FAIL second scan added findings'; end if;
  if (select new_count from public.guard_runs where id = (select id from guard_run2)) <> 0 then raise exception 'FAIL second scan new_count'; end if;
  if (select rules_run from public.guard_runs where id = (select id from guard_run3)) <> array['C1', 'C2', 'B3'] then
    raise exception 'FAIL scoped scan rules %', (select rules_run from public.guard_runs where id = (select id from guard_run3));
  end if;
  if exists (select 1 from public.guard_findings where status <> 'open') then raise exception 'FAIL a status changed without a reason'; end if;
  if (select last_seen_run from public.guard_findings where fingerprint = 'C1:00000000-0000-0000-0a11-0000000000c4') <> (select id from guard_run3)
     or (select last_seen_run from public.guard_findings where fingerprint = 'A1:00000000-0000-0000-0a11-0000000000a1') <> (select id from guard_run2) then
    raise exception 'FAIL last_seen_run';
  end if;
end $$;

-- Admin actions: a note is required for false positive / resolved.
do $$
declare v uuid := (select id from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a11-0000000005b1:overpaid');
begin
  begin
    perform public.guard_set_finding_status(v, 'false_positive', '  ');
    raise exception 'FAIL false positive without a note';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.guard_set_finding_status(v, 'auto_resolved', 'x');
    raise exception 'FAIL auto_resolved by hand';
  exception when sqlstate '22023' then null;
  end;
  perform public.guard_set_finding_status(v, 'false_positive', 'The customer paid a deposit for the next order');
  perform public.guard_set_finding_status((select id from public.guard_findings where fingerprint = 'B3:sale:g-b3'), 'acknowledged', null);
  if (select status from public.guard_findings where id = v) <> 'false_positive'
     or (select resolved_by from public.guard_findings where id = v) <> '00000000-0000-0000-0a11-00000000000a' then
    raise exception 'FAIL false positive not stored';
  end if;
  if not exists (select 1 from public.guard_finding_events where finding_id = v and from_status = 'open' and to_status = 'false_positive'
                 and actor = '00000000-0000-0000-0a11-00000000000a' and note like 'The customer%') then
    raise exception 'FAIL event of the status change';
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.audit_logs where table_name = 'guard_findings' and action = 'UPDATE'
                 and new_values_json ->> 'status' = 'false_positive') then
    raise exception 'FAIL status change not in audit_logs';
  end if;
end $$;

-- Fix the A1 entry and the acknowledged B3 duplicate; a scan then auto-resolves them.
-- The false positive stays as it is.
set local session_replication_role = replica;
update public.journal_entry_lines set credit = 10
where journal_entry_id = '00000000-0000-0000-0a11-0000000000a1' and credit = 9;
update public.sales set doc_no = 'G-B3-2' where id = '00000000-0000-0000-0a11-0000000005d2';
set local session_replication_role = origin;
drop table guard_before;
create temp table guard_before as select pg_temp.business_checksum() as sum;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
create temp table guard_run4 as select public.guard_scan() as id;
do $$
begin
  if (select status from public.guard_findings where fingerprint = 'A1:00000000-0000-0000-0a11-0000000000a1') <> 'auto_resolved' then
    raise exception 'FAIL A1 not auto-resolved';
  end if;
  if (select status from public.guard_findings where fingerprint = 'B3:sale:g-b3') <> 'auto_resolved' then
    raise exception 'FAIL acknowledged B3 not auto-resolved';
  end if;
  if (select resolved_count from public.guard_runs where id = (select id from guard_run4)) <> 2 then
    raise exception 'FAIL resolved_count %', (select resolved_count from public.guard_runs where id = (select id from guard_run4));
  end if;
  if (select status from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a11-0000000005b1:overpaid') <> 'false_positive' then
    raise exception 'FAIL false positive reopened';
  end if;
  if not exists (select 1 from public.guard_finding_events e join public.guard_findings f on f.id = e.finding_id
                 where f.fingerprint = 'A1:00000000-0000-0000-0a11-0000000000a1' and e.to_status = 'auto_resolved') then
    raise exception 'FAIL auto-resolve event';
  end if;
end $$;
reset role;

-- The false positive changes materially (paid 120 -> 130): it opens again.
set local session_replication_role = replica;
update public.sales set paid_amount = 130 where id = '00000000-0000-0000-0a11-0000000005b1';
set local session_replication_role = origin;
drop table guard_before;
create temp table guard_before as select pg_temp.business_checksum() as sum;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
select public.guard_scan(array['documents']);
do $$
begin
  if (select status from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a11-0000000005b1:overpaid') <> 'open' then
    raise exception 'FAIL false positive not reopened after a material change';
  end if;
  if (select amount from public.guard_findings where fingerprint = 'B1:sale:00000000-0000-0000-0a11-0000000005b1:overpaid') <> 30 then
    raise exception 'FAIL amount not updated';
  end if;
end $$;
reset role;

-- One failing rule is logged and the others go on.
update public.guard_rules set params = '{"tolerance": "not a number"}' where code = 'A1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
create temp table guard_run5 as select public.guard_scan(array['ledger']) as id;
do $$
declare r record;
begin
  select * into r from public.guard_runs where id = (select id from guard_run5);
  if r.status <> 'partial' or not (r.rule_errors ? 'A1') or r.error is null then raise exception 'FAIL failing rule not logged: % %', r.status, r.rule_errors; end if;
  if cardinality(r.rules_run) <> 10 then raise exception 'FAIL other rules stopped'; end if;
  -- The failed rule did not auto-resolve anything; the others still found theirs.
  if (select last_seen_run from public.guard_findings where fingerprint = 'A2:00000000-0000-0000-0a11-0000000000a2') <> r.id then
    raise exception 'FAIL A2 not run';
  end if;
end $$;
reset role;
update public.guard_rules set params = '{"tolerance": 0.01}' where code = 'A1';

-- A disabled rule does not run.
update public.guard_rules set enabled = false where code = 'D3';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
create temp table guard_run6 as select public.guard_scan(array['partners']) as id;
do $$
begin
  if (select rules_run from public.guard_runs where id = (select id from guard_run6)) <> array['D1', 'D2'] then
    raise exception 'FAIL disabled rule ran';
  end if;
end $$;
reset role;
update public.guard_rules set enabled = true where code = 'D3';

-- ═══ Phase 3c: a "not a duplicate" decision on a name cluster (GUARD-2) ═══
-- It survives a change of the cards' stock; it lapses when the cluster gains a product.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
do $$ begin
  perform public.guard_set_finding_status((select id from public.guard_findings where fingerprint = 'F2:' || pg_temp.pid(4)),
                                          'false_positive', 'Two sizes of the same bar');
end $$;
reset role;
set local session_replication_role = replica;
update public.products set stock = 11 where id = pg_temp.pid(4);
update public.warehouse_stocks set current_stock = 11 where product_id = pg_temp.pid(4);
set local session_replication_role = origin;
drop table guard_before;
create temp table guard_before as select pg_temp.business_checksum() as sum;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
create temp table guard_run_x as select public.guard_scan(array['products'], 'button') as id;
do $$
begin
  if (select status from public.guard_findings where fingerprint = 'F2:' || pg_temp.pid(4)) <> 'false_positive' then
    raise exception 'FAIL a cluster decision lapsed when only the stock changed';
  end if;
  if (select (c ->> 'stock')::numeric from public.guard_findings f, jsonb_array_elements(f.details -> 'products') c
      where f.fingerprint = 'F2:' || pg_temp.pid(4) and c ->> 'id' = pg_temp.pid(4)::text) <> 11 then
    raise exception 'FAIL the cluster card is not refreshed';
  end if;
end $$;
reset role;
-- A third product with the same look: the cluster changed, the decision lapses.
set local session_replication_role = replica;
do $$ begin perform pg_temp.prod(36, 'KB-4', 'KONİK BAR'); end $$;
set local session_replication_role = origin;
drop table guard_before;
create temp table guard_before as select pg_temp.business_checksum() as sum;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000a');
create temp table guard_run_y as select public.guard_scan(array['products'], 'button') as id;
do $$
begin
  if (select status from public.guard_findings where fingerprint = 'F2:' || pg_temp.pid(4)) <> 'open' then
    raise exception 'FAIL the decision did not lapse when the cluster gained a product';
  end if;
  if jsonb_array_length((select details -> 'product_ids' from public.guard_findings where fingerprint = 'F2:' || pg_temp.pid(4))) <> 3 then
    raise exception 'FAIL cluster did not grow';
  end if;
end $$;
reset role;

-- ═══ Phase 4: the guard wrote nothing to business data ═══
do $$
begin
  if pg_temp.business_checksum() <> (select sum from guard_before) then
    raise exception 'FAIL the guard changed business data';
  end if;
  -- No trigger anywhere calls a guard function.
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
             where not t.tgisinternal
               and (p.proname like 'guard\_check\_%' or p.proname like '\_guard\_%'
                    or p.proname in ('guard_scan', 'guard_set_finding_status'))) then
    raise exception 'FAIL a trigger calls the guard';
  end if;
  -- The rule functions are not callable by signed-in users or anon.
  if has_function_privilege('authenticated', 'public.guard_check_a1(jsonb, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.guard_check_a1(jsonb, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.guard_scan(text[], text, timestamptz)', 'execute') then
    raise exception 'FAIL guard functions exposed';
  end if;
  if has_table_privilege('authenticated', 'public.guard_findings', 'insert')
     or has_table_privilege('authenticated', 'public.guard_findings', 'update')
     or has_table_privilege('authenticated', 'public.guard_rules', 'update') then
    raise exception 'FAIL guard tables writable';
  end if;
end $$;

-- ═══ Phase 5: a non-admin (even with can_manage_settings) is refused ═══
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a11-00000000000b');
do $$
begin
  begin
    perform public.guard_scan();
    raise exception 'FAIL non-admin could scan';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.guard_set_finding_status((select id from public.guard_runs limit 1), 'acknowledged', null);
    raise exception 'FAIL non-admin could change a finding';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.guard_findings) or exists (select 1 from public.guard_runs)
     or exists (select 1 from public.guard_rules) or exists (select 1 from public.guard_finding_events) then
    raise exception 'FAIL non-admin can read the guard tables';
  end if;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.guard_scan();
    raise exception 'FAIL anon could scan';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL CHECKS PASSED';
rollback;
