-- Checks supabase/migrations/20261111100000_partner_ledger.sql (LED-1) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres. Every movement is made by the real RPCs (invoices,
-- payments, cancellation, amendment, opening balances, imports). Any failed check raises an
-- exception; the last line prints ALL CHECKS PASSED. Leaves test rows behind: run it on a
-- throwaway database only.
--
-- Expected balances (debit - credit; + = the partner owes us, - = we owe them):
--   C1 sale 30 paid in the form 30                                   0
--   C2 sale 50, paid 20 (two accounts), partner payment in 10        20
--   C3 sale 40 paid 15 in the form, then cancelled                    0
--   C4 sale 30 amended to 60                                         60
--   C5 customer opening balance 100                                 100
--   S2 supplier opening balance 70, then sends us 5 (money in: we hold more of theirs)  -75  (payable 75)
--   CB customer and supplier: sale 80; purchase 50 paid 10          40  (receivable 80, payable 40)
--   SU USD import supplier: goods 1,000 USD (300 prepaid at 1.60 = 480, 700 at 1.70 = 1,190 →
--      1,670 AZN); payment 400 USD at 1.75 = 700 AZN settles 680  -510
--   BR customs broker: cost 246.50 AZN, paid 100                 -146.50
--   CM sale 25, then its partner deleted (merged away)               25  (kept on the deleted partner)
-- Sum: -486.50

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0ed1-00000000000a', 'led1-a@example.test', '{"full_name": "Lalə Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0ed1-00000000000b', 'led1-n@example.test', '{"full_name": "Nərmin Sales"}'),
  ('00000000-0000-0000-0ed1-00000000000d', 'led1-d@example.test', '{"full_name": "Dünya Former Admin"}')
on conflict (id) do nothing;
insert into public.roles (id, name, permissions, is_system)
values ('00000000-0000-0000-0ed1-0000000000f1', 'LED1 Sales only', '{"can_view_sales": true, "can_create_invoice": true}'::jsonb, false)
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-0ed1-00000000000a';
update public.profiles set role_id = '00000000-0000-0000-0ed1-0000000000f1', is_active = true
where id = '00000000-0000-0000-0ed1-00000000000b';
-- An admin whose profile was deactivated.
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = false
where id = '00000000-0000-0000-0ed1-00000000000d';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-0ed1-0000000000e1', 'LED1-W', 'LED1 anbar', false, now()) on conflict (id) do nothing;
insert into public.accounts (id, code, name, type, balance, is_vat_account) values
  ('00000000-0000-0000-0ed1-0000000000a1', 'LED1-K', 'LED1 Kassa', 'cash', 100000, false),
  ('00000000-0000-0000-0ed1-0000000000a2', 'LED1-B', 'LED1 Bank', 'bank', 100000, false)
on conflict (id) do nothing;
insert into public.customers (id, full_name) values
  ('00000000-0000-0000-0ed1-0000000000c1', 'LED1 C1 paid at creation'),
  ('00000000-0000-0000-0ed1-0000000000c2', 'LED1 C2 partly paid'),
  ('00000000-0000-0000-0ed1-0000000000c3', 'LED1 C3 cancelled'),
  ('00000000-0000-0000-0ed1-0000000000c4', 'LED1 C4 amended'),
  ('00000000-0000-0000-0ed1-0000000000c5', 'LED1 C5 opening'),
  ('00000000-0000-0000-0ed1-0000000000cb', 'LED1 Both'),
  ('00000000-0000-0000-0ed1-0000000000cd', 'LED1 CM merged away')
on conflict (id) do nothing;
insert into public.suppliers (id, full_name, entity_type) values
  ('00000000-0000-0000-0ed1-0000000000d2', 'LED1 S2 opening', 'legal'),
  ('00000000-0000-0000-0ed1-0000000000db', 'LED1 Both', 'legal'),
  ('00000000-0000-0000-0ed1-0000000000d5', 'LED1 USD supplier', 'legal'),
  ('00000000-0000-0000-0ed1-0000000000d6', 'LED1 customs broker', 'legal')
on conflict (id) do nothing;

-- One partner that is both customer and supplier (as a merge leaves it).
update public.partners set supplier_id = null, is_supplier = false, is_deleted = true
where supplier_id = '00000000-0000-0000-0ed1-0000000000db';
update public.partners set supplier_id = '00000000-0000-0000-0ed1-0000000000db', is_supplier = true
where customer_id = '00000000-0000-0000-0ed1-0000000000cb';

insert into public.products (id, code, name, stock, buy_price, is_service, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-0ed1-000000000001', 'LED1-P1', 'LED1 sold', 0, 5, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-0ed1-000000000002', 'LED1-P2', 'LED1 bought', 0, 5, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-0ed1-000000000003', 'LED1-P3', 'LED1 imported', 0, 0, false, 'standard', 4, 'Ədəd')
on conflict (id) do nothing;
select public.adjust_warehouse_stock('00000000-0000-0000-0ed1-000000000001', '00000000-0000-0000-0ed1-0000000000e1', 500);
select public.create_inventory_batch('00000000-0000-0000-0ed1-000000000001', gen_random_uuid(), 'purchase', 5, 500);

create or replace function pg_temp.sale_payload(p_customer uuid, p_date date, p_qty numeric, p_price numeric, p_payments jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('customer_id', p_customer, 'doc_date', p_date::text,
      'total_amount', p_qty * p_price, 'subtotal', p_qty * p_price,
      'paid_amount', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0),
      'remaining_balance', p_qty * p_price - coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0)),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0ed1-000000000001', 'product_name', 'LED1', 'quantity', p_qty,
      'unit_price', p_price, 'line_total', p_qty * p_price, 'total', p_qty * p_price, 'warehouse_id', '00000000-0000-0000-0ed1-0000000000e1')),
    'payments', p_payments);
$$;
create or replace function pg_temp.partner_of(p_customer uuid, p_supplier uuid) returns uuid language sql as $$
  select public.resolve_unified_partner_id(p_customer, p_supplier);
$$;
-- The view read as the owner.
create or replace function pg_temp.balance(p_partner uuid) returns numeric language sql security definer as $$
  select coalesce(round(sum(debit - credit), 2), 0) from public.partner_ledger_movements where partner_id = p_partner;
$$;
create temp table led_ids (k text primary key, id uuid);
grant all on led_ids to authenticated;

-- Opening balances, stored on the customer / supplier as older data has them. (The RPCs
-- set_customer/supplier_opening_balance_atomic put customers.id / suppliers.id into
-- journal_entry_lines.partner_id, which must be a partners.id: on this database they fail with a
-- foreign key error. That is LED-2's fix; the ledger reads the stored opening_balance either way.)
update public.customers set opening_balance = 100 where id = '00000000-0000-0000-0ed1-0000000000c5';
update public.suppliers set opening_balance = 70 where id = '00000000-0000-0000-0ed1-0000000000d2';

-- Imports: the draft saved as the form does (service role), with a customs-broker cost line.
select public.import_shipment_save_draft(null,
  '{"supplier_id": "00000000-0000-0000-0ed1-0000000000d5", "currency_code": "USD", "invoice_no": "INV-LED1", "invoice_date": "2026-10-01", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-0ed1-0000000000e1"}',
  '[{"position": 0, "product_id": "00000000-0000-0000-0ed1-000000000003", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 100}]',
  '[{"position": 0, "cost_type": "customs_fee", "partner_id": "00000000-0000-0000-0ed1-0000000000d6", "amount": 246.5, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "by_value"}]',
  '[{"cost_position": 0, "line_position": 0, "amount_azn": 246.5}]', '00000000-0000-0000-0ed1-00000000000a');

-- ── Movements, made as the admin through the app's RPCs ─────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed1-00000000000a","role":"authenticated"}', false);
do $$
declare
  d0 date := public.document_today();
  v_id uuid;
  v_ship uuid := (select id from public.import_shipments where invoice_no = 'INV-LED1');
  v_pay uuid;
begin
  -- C1: paid in full in the invoice form ("paid at creation").
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed1-0000000000c1', d0 - 20, 3, 10,
    jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-0ed1-0000000000a1', 'amount', 30, 'method', 'Nağd')))) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);

  -- C2: 50, then 20 over two accounts, then a partner payment of 10.
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed1-0000000000c2', d0 - 20, 5, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  insert into led_ids values ('c2_sale', v_id);
  perform public.process_invoice_payment_event(jsonb_build_object('document_type', 'sale', 'document_id', v_id,
    'payment_date', (d0 - 10)::text, 'idempotency_key', 'led1-c2-pay',
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0ed1-0000000000a1', 'amount', 15, 'method', 'Nağd'),
      jsonb_build_object('account_id', '00000000-0000-0000-0ed1-0000000000a2', 'amount', 5, 'method', 'Bank'))));
  perform public.create_partner_payment(jsonb_build_object('partner_id', pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c2', null),
    'amount', 10, 'payment_type', 'in', 'payment_method', 'cash', 'cash_account_id', '00000000-0000-0000-0ed1-0000000000a1',
    'payment_date', (d0 - 5)::text, 'idempotency_key', 'led1-c2-partner-pay'));

  -- C3: 40 with 15 paid in the form, then cancelled (stock and cash reversed).
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed1-0000000000c3', d0 - 15, 4, 10,
    jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-0ed1-0000000000a1', 'amount', 15, 'method', 'Nağd')))) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  perform public.cancel_sales_invoice_atomic(v_id, 'LED1 cancel test');
  insert into led_ids values ('c3_sale', v_id);

  -- C4: 30, amended to 60.
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed1-0000000000c4', d0 - 12, 3, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  perform public.amend_posted_sales_invoice(v_id, pg_temp.sale_payload('00000000-0000-0000-0ed1-0000000000c4', d0 - 12, 6, 10, '[]'::jsonb), 'LED1 quantity fixed');
  insert into led_ids values ('c4_sale', v_id);

  -- CB: a sale of 80 and a purchase of 50 with 10 paid in the form.
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed1-0000000000cb', d0 - 8, 8, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  v_id := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-0ed1-0000000000db', 'doc_date', (d0 - 7)::text,
      'warehouse_id', '00000000-0000-0000-0ed1-0000000000e1', 'invoice_number', 'LED1-PUR-1', 'total_amount', 50, 'paid_amount', 10, 'debt_amount', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0ed1-000000000002', 'product_name', 'LED1', 'quantity', 10, 'unit_price', 5, 'total', 50)),
    'payments', jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-0ed1-0000000000a1', 'amount', 10, 'payment_date', (d0 - 7)::text))
  )) ->> 'purchase_id')::uuid;
  perform public.post_purchase_invoice_draft(v_id);

  -- S2 (a supplier only) refunds us 5: money in, still on the supplier side.
  perform public.create_partner_payment(jsonb_build_object('partner_id', pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000d2'),
    'amount', 5, 'payment_type', 'in', 'payment_method', 'cash', 'cash_account_id', '00000000-0000-0000-0ed1-0000000000a1',
    'payment_date', (d0 - 3)::text, 'idempotency_key', 'led1-s2-refund'));

  -- CM: a sale of 25; its partner is deleted below (as merge_partners leaves a merged-away one).
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed1-0000000000cd', d0 - 6, 5, 5, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);

  -- SU: prepayment 300 USD at 1.60 while a draft, confirm, then 400 USD at 1.75 over two accounts.
  perform public.prepay_import_supplier(v_ship, '2026-10-02', 'LED1 advance', 300, 1.6,
    '[{"account_id": "00000000-0000-0000-0ed1-0000000000a1", "amount": 480}]', 'led1-prepay');
  perform public.confirm_import_shipment(v_ship, null, 'led1-confirm');
  v_pay := (select id from public.import_payables where shipment_id = v_ship and source = 'goods');
  perform public.pay_import_payable(v_pay, '2026-10-10', 'LED1 goods',
    '[{"account_id": "00000000-0000-0000-0ed1-0000000000a1", "amount": 500}, {"account_id": "00000000-0000-0000-0ed1-0000000000a2", "amount": 200}]',
    'led1-goods-pay', 400, 1.75);
  -- BR: 100 of the 246.50 customs fee.
  v_pay := (select id from public.import_payables where shipment_id = v_ship and source <> 'goods');
  perform public.pay_import_payable(v_pay, '2026-10-11', 'LED1 broker',
    '[{"account_id": "00000000-0000-0000-0ed1-0000000000a1", "amount": 100}]', 'led1-broker-pay');
end $$;
reset role;
insert into led_ids select 'cm_partner', id from public.partners where customer_id = '00000000-0000-0000-0ed1-0000000000cd';
update public.partners set is_deleted = true, deleted_at = now() where customer_id = '00000000-0000-0000-0ed1-0000000000cd';

-- ── The view: balances, no double counting, cancellation and amendment ─────
do $$
declare
  c1 uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c1', null);
  c2 uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c2', null);
  c3 uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c3', null);
  c4 uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c4', null);
  c5 uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c5', null);
  s2 uuid := pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000d2');
  cb uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000cb', null);
  su uuid := pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000d5');
  br uuid := pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000d6');
  cm uuid := (select id from led_ids where k = 'cm_partner');
  v_bad text;
begin
  if pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000db') <> cb then raise exception 'FAIL fixture: CB is not one partner'; end if;
  select string_agg(format('%s: %s (expected %s)', k, pg_temp.balance(p), e), '; ') into v_bad
  from (values ('C1', c1, 0::numeric), ('C2', c2, 20), ('C3', c3, 0), ('C4', c4, 60), ('C5', c5, 100), ('S2', s2, -75),
               ('CB', cb, 40), ('SU', su, -510), ('BR', br, -146.5), ('CM', cm, 25)) x(k, p, e)
  where pg_temp.balance(p) <> e;
  if v_bad is not null then raise exception 'FAIL balances: %', v_bad; end if;

  -- The view balance equals the sum of the fixtures.
  if (select round(sum(debit - credit), 2) from public.partner_ledger_movements where partner_id in (c1, c2, c3, c4, c5, s2, cb, su, br, cm)) <> -486.5 then
    raise exception 'FAIL fixtures sum %', (select round(sum(debit - credit), 2) from public.partner_ledger_movements where partner_id in (c1, c2, c3, c4, c5, s2, cb, su, br, cm));
  end if;

  -- C1: invoice + payment, never the payment twice.
  if (select count(*) from public.partner_ledger_movements where partner_id = c1) <> 2 then
    raise exception 'FAIL C1 rows: %', (select string_agg(source_type, ',') from public.partner_ledger_movements where partner_id = c1);
  end if;
  -- C2: the two payment lines and the partner payment.
  if (select count(*) from public.partner_ledger_movements where partner_id = c2 and source_type = 'sale_payment') <> 2
     or (select count(*) from public.partner_ledger_movements where partner_id = c2 and source_type = 'partner_payment') <> 1 then
    raise exception 'FAIL C2 payments: %', (select string_agg(source_type || ' ' || credit, ', ') from public.partner_ledger_movements where partner_id = c2);
  end if;
  -- C3: no invoice; the payment and its reversal net to zero.
  if exists (select 1 from public.partner_ledger_movements where partner_id = c3 and source_type = 'sale') then raise exception 'FAIL a cancelled invoice is counted'; end if;
  if (select count(*) from public.partner_ledger_movements where partner_id = c3 and source_type = 'sale_payment_reversal') <> 1 then
    raise exception 'FAIL C3 reversal missing: %', (select string_agg(source_type, ',') from public.partner_ledger_movements where partner_id = c3);
  end if;
  -- C4: one invoice at its amended amount.
  if (select count(*) from public.partner_ledger_movements where partner_id = c4 and source_type = 'sale') <> 1
     or (select debit from public.partner_ledger_movements where partner_id = c4 and source_type = 'sale') <> 60 then
    raise exception 'FAIL amended invoice';
  end if;
  -- Imports: the payments copies in public.payments are not counted again.
  if exists (select 1 from public.partner_ledger_movements where partner_id in (su, br) and source_type = 'partner_payment') then
    raise exception 'FAIL import payments counted twice';
  end if;
  if not exists (select 1 from public.payments where partner_id = su) then raise exception 'FAIL fixture: no payments copy to skip'; end if;
  -- Dates are the document dates.
  if (select entry_date from public.partner_ledger_movements where partner_id = su and source_type = 'import_prepayment') <> '2026-10-02' then
    raise exception 'FAIL prepayment date';
  end if;
  -- Opening balances come before the partner's first movement.
  if (select entry_date from public.partner_ledger_movements where partner_id = c5 and source_type = 'opening_customer') <> '1900-01-01'
     or (select entry_date from public.partner_ledger_movements where partner_id = s2 and source_type = 'opening_supplier') <> '1900-01-01' then
    raise exception 'FAIL opening date';
  end if;
  -- A supplier's refund stays on the supplier side.
  if (select side from public.partner_ledger_movements where partner_id = s2 and source_type = 'partner_payment') <> 'payable' then
    raise exception 'FAIL refund side';
  end if;
  -- A deleted (merged-away) partner keeps its invoice.
  if not exists (select 1 from public.partner_ledger_movements where partner_id = cm and source_type = 'sale') then
    raise exception 'FAIL deleted partner lost its invoice';
  end if;
end $$;

-- ── Statement, balances and the integrity check, as the admin ───────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed1-00000000000a","role":"authenticated"}', false);
do $$
declare
  d0 date := public.document_today();
  c2 uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c2', null);
  cb uuid := pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000cb', null);
  su uuid := pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000d5');
  br uuid := pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000d6');
  st jsonb;
  usd jsonb;
  r record;
  v_ok boolean := false;
begin
  -- C2 from day -12: opening 50 (the invoice), then -20 and -10.
  st := public.get_partner_statement(c2, d0 - 12, d0);
  if (st ->> 'opening_balance')::numeric <> 50 or (st ->> 'period_debit')::numeric <> 0 or (st ->> 'period_credit')::numeric <> 30
     or (st ->> 'closing_balance')::numeric <> 20 or jsonb_array_length(st -> 'lines') <> 3 then
    raise exception 'FAIL C2 statement %', st;
  end if;
  if (st -> 'lines' -> 2 ->> 'balance')::numeric <> 20 or (st -> 'lines' -> 0 ->> 'balance')::numeric not in (35, 45) then  -- the two lines of one payment share a moment; either may come first
    raise exception 'FAIL running balance %', st -> 'lines';
  end if;
  if (st -> 'partner' ->> 'payment_terms_days')::int <> 0 then raise exception 'FAIL payment terms default'; end if;

  -- CB: both sides.
  if (public.get_partner_statement(cb, null, d0, 'receivable') ->> 'closing_balance')::numeric <> 80
     or (public.get_partner_statement(cb, null, d0, 'payable') ->> 'closing_balance')::numeric <> -40
     or (public.get_partner_statement(cb, null, d0) ->> 'closing_balance')::numeric <> 40 then
    raise exception 'FAIL both-sides statement';
  end if;

  -- SU: per-currency subtotal; the USD still owed is 1,000 - 300 - 400 = 300.
  st := public.get_partner_statement(su, '2026-01-01', d0);
  select x into usd from jsonb_array_elements(st -> 'currencies') x where x ->> 'currency_code' = 'USD';
  if usd is null or (usd ->> 'net_fc')::numeric <> -300 then raise exception 'FAIL USD subtotal %', st -> 'currencies'; end if;
  if (st ->> 'closing_balance')::numeric <> -510 then raise exception 'FAIL SU closing %', st ->> 'closing_balance'; end if;

  begin
    perform public.get_partner_statement(su, d0, d0, 'both');
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a bad side was accepted'; end if;

  -- Balances as of today and as of a date before the payments.
  select * into r from public.get_partner_balances(d0) where partner_id = cb;
  if r.receivable <> 80 or r.payable <> 40 or r.net <> 40 or r.last_payment_amount <> 10 then raise exception 'FAIL CB balances %', r; end if;
  select * into r from public.get_partner_balances('2026-10-05') where partner_id = su;
  if r.net <> -1190 or r.last_payment_date <> '2026-10-02' or r.last_payment_amount <> 480 then raise exception 'FAIL SU as-of balance %', r; end if;
  if exists (select 1 from public.get_partner_balances(d0) where partner_id = pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c1', null)) then
    raise exception 'FAIL a zero balance is listed';
  end if;
  select * into r from public.get_partner_balances(d0) where partner_id = pg_temp.partner_of(null, '00000000-0000-0000-0ed1-0000000000d2');
  if r.payable <> 75 or r.receivable <> 0 or r.net <> -75 or r.last_payment_amount <> 5 then raise exception 'FAIL S2 refund balances %', r; end if;
  select * into r from public.get_partner_balances(d0) where partner_id = (select id from led_ids where k = 'cm_partner');
  if r.net <> 25 or not r.is_deleted then raise exception 'FAIL deleted partner balance %', r; end if;

  -- Integrity: imports post their partner to the GL, so ledger and GL agree for them.
  select * into r from public.check_partner_ledger_integrity() where partner_id = su;
  if r.ledger_balance <> -510 or r.gl_balance <> -510 or r.delta_gl <> 0 then raise exception 'FAIL SU integrity %', r; end if;
  select * into r from public.check_partner_ledger_integrity() where partner_id = br;
  if r.delta_gl <> 0 then raise exception 'FAIL BR integrity %', r; end if;
  select * into r from public.check_partner_ledger_integrity() where partner_id = c2;
  if r.ledger_balance <> 20 then raise exception 'FAIL C2 integrity %', r; end if;
end $$;
reset role;

-- ── Permissions ─────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed1-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_n int := 0;
begin
  begin perform public.get_partner_statement(pg_temp.partner_of('00000000-0000-0000-0ed1-0000000000c2', null), null, null);
  exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform * from public.get_partner_balances(null);
  exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform * from public.check_partner_ledger_integrity();
  exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform * from public.partner_ledger_movements;
  exception when insufficient_privilege then v_n := v_n + 1; end;
  if v_n <> 4 then raise exception 'FAIL a user without can_view_financial_reports read the ledger (% of 4 refused)', v_n; end if;
end $$;
rollback;

begin;
set local role anon;
do $$
declare
  v_ok boolean := false;
begin
  begin perform * from public.get_partner_balances(null);
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL anon read balances'; end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed1-00000000000d","role":"authenticated"}', true);
do $$
declare
  v_ok boolean := false;
begin
  begin perform * from public.get_partner_balances(null);
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a deactivated admin read balances'; end if;
end $$;
rollback;

-- A reversed payment is not the last payment (the rule in get_partner_balances).
do $$
begin
  if pg_get_functiondef('public.get_partner_balances(date)'::regprocedure) !~ 'reference_type = ''storno'' AND r.reference_id = m.source_id' then
    raise exception 'FAIL last payment ignores reversals';
  end if;
end $$;

-- ── Read-only: the reports changed nothing ──────────────────────────────────
do $$
begin
  if (select provolatile from pg_proc where proname = 'get_partner_statement') <> 's'
     or (select provolatile from pg_proc where proname = 'get_partner_balances') <> 's'
     or (select provolatile from pg_proc where proname = 'check_partner_ledger_integrity') <> 's' then
    raise exception 'FAIL report functions must be STABLE';
  end if;
end $$;

-- The migration runs twice without errors.
\ir ../migrations/20261111100000_partner_ledger.sql

select 'ALL CHECKS PASSED';
