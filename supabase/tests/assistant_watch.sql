-- Checks supabase/migrations/20261121130000_assistant_watch.sql (AST-5): the facts of a form only for a user
-- who may create that document (cost only with the products permission); the partner's usual price and
-- recent documents; closed months and the guard's thresholds; watch events are written for oneself and read
-- by admins; findings on a saved document only for the person who saved it (or an admin); anon nothing.
-- One transaction, rolled back; the last line prints ALL CHECKS PASSED.

begin;
set local client_min_messages = warning;

insert into public.roles (name, permissions, description, is_system)
select 'Watch test: sales', '{"can_create_invoice": true, "can_view_sales": true, "can_view_products": true}'::jsonb, 'AST-5 test', false
where not exists (select 1 from public.roles where name = 'Watch test: sales');
insert into public.roles (name, permissions, description, is_system)
select 'Watch test: no cost', '{"can_create_invoice": true}'::jsonb, 'AST-5 test', false
where not exists (select 1 from public.roles where name = 'Watch test: no cost');
insert into public.roles (name, permissions, description, is_system)
select 'Watch test: none', '{}'::jsonb, 'AST-5 test', false
where not exists (select 1 from public.roles where name = 'Watch test: none');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a55-00000000000e', 'ast5-e@example.test', '{"full_name": "Elvin Sales", "role_name": "Watch test: sales"}'),
  ('00000000-0000-0000-0a55-00000000000c', 'ast5-c@example.test', '{"full_name": "Cavid NoCost", "role_name": "Watch test: no cost"}'),
  ('00000000-0000-0000-0a55-00000000000f', 'ast5-f@example.test', '{"full_name": "Fidan None", "role_name": "Watch test: none"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Watch test: sales' limit 1) where id = '00000000-0000-0000-0a55-00000000000e';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Watch test: no cost' limit 1) where id = '00000000-0000-0000-0a55-00000000000c';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Watch test: none' limit 1) where id = '00000000-0000-0000-0a55-00000000000f';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;

-- A customer, a product, two posted sales by Elvin (12.00 and 13.00 a piece) and an open finding on one.
insert into public.customers (id, full_name, code) values ('00000000-0000-0000-0a55-0000000000c1', 'Watch customer', 'WC-1');
insert into public.products (id, name, code, unit, buy_price, sell_price, stock) values ('00000000-0000-0000-0a55-0000000000d1', 'Watch panel', 'WP-1', 'Ədəd', 9.5, 14, 100);
insert into public.sales (id, doc_no, customer_id, customer_name, doc_date, status, total_amount, paid_amount, created_by) values
  ('00000000-0000-0000-0a55-0000000000a1', 'WS-1', '00000000-0000-0000-0a55-0000000000c1', 'Watch customer', current_date - 3, 'posted', 120, 0, '00000000-0000-0000-0a55-00000000000e'),
  ('00000000-0000-0000-0a55-0000000000a2', 'WS-2', '00000000-0000-0000-0a55-0000000000c1', 'Watch customer', current_date - 60, 'posted', 130, 0, '00000000-0000-0000-0a55-00000000000e');
insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price) values
  ('00000000-0000-0000-0a55-0000000000a1', '00000000-0000-0000-0a55-0000000000d1', 'Watch panel', 10, 12),
  ('00000000-0000-0000-0a55-0000000000a2', '00000000-0000-0000-0a55-0000000000d1', 'Watch panel', 10, 13);
insert into public.accounting_periods (period_year, period_month, status) values (2020, 1, 'closed') on conflict (period_year, period_month) do update set status = 'closed';
insert into public.guard_findings (rule_code, severity, fingerprint, entity_type, entity_id, doc_no, status)
values ('B6', 'medium', 'watch-test:1', 'sale', '00000000-0000-0000-0a55-0000000000a1', 'WS-1', 'open');

do $$
declare
  e uuid := '00000000-0000-0000-0a55-00000000000e';
  c uuid := '00000000-0000-0000-0a55-00000000000c';
  f uuid := '00000000-0000-0000-0a55-00000000000f';
  cust uuid := '00000000-0000-0000-0a55-0000000000c1';
  prod uuid := '00000000-0000-0000-0a55-0000000000d1';
  r jsonb;
  v_ok boolean;
  v_n int;
begin
  perform pg_temp.as_user(e);
  r := public.assistant_watch_context('sale', cust, array[prod]);
  if (r -> 'products' -> prod::text ->> 'cost')::numeric <> 9.5 then raise exception 'FAIL cost: %', r; end if;
  if (r -> 'products' -> prod::text ->> 'usual_price')::numeric <> 12.5 then raise exception 'FAIL usual price: %', r -> 'products'; end if;
  if (r -> 'products' -> prod::text ->> 'times')::int <> 2 then raise exception 'FAIL times'; end if;
  if (r -> 'partner' ->> 'documents')::int <> 2 or (r -> 'partner' ->> 'median_total')::numeric <> 125 then raise exception 'FAIL partner: %', r -> 'partner'; end if;
  if jsonb_array_length(r -> 'partner' -> 'recent') <> 1 then raise exception 'FAIL recent (last 30 days only): %', r -> 'partner' -> 'recent'; end if;
  if not (r -> 'closed_months') ? '2020-01' then raise exception 'FAIL closed months'; end if;
  if (r -> 'rules' -> 'B6' -> 'params' ->> 'max_discount_pct')::numeric <> 30 then raise exception 'FAIL guard thresholds: %', r -> 'rules'; end if;

  -- Without the products permission there is no cost.
  perform pg_temp.as_user(c);
  r := public.assistant_watch_context('sale', cust, array[prod]);
  if r -> 'products' -> prod::text ->> 'cost' is not null then raise exception 'FAIL cost without can_view_products'; end if;
  if (r -> 'products' -> prod::text ->> 'usual_price')::numeric <> 12.5 then raise exception 'FAIL usual price still shown'; end if;

  -- Without the create permission, nothing.
  perform pg_temp.as_user(f);
  v_ok := false;
  begin perform public.assistant_watch_context('sale', cust, array[prod]); exception when others then v_ok := sqlerrm = 'forbidden'; end;
  if not v_ok then raise exception 'FAIL context without can_create_invoice'; end if;
  v_ok := false;
  begin perform public.assistant_watch_context('purchase', cust, array[prod]); exception when others then v_ok := sqlerrm = 'forbidden'; end;
  if not v_ok then raise exception 'FAIL purchase context without can_create_purchase'; end if;

  -- Findings: the person who saved it sees them; someone else does not.
  perform pg_temp.as_user(e);
  select count(*) into v_n from public.assistant_my_document_findings('sale', '00000000-0000-0000-0a55-0000000000a1');
  if v_n <> 1 then raise exception 'FAIL own document findings: %', v_n; end if;
  perform pg_temp.as_user(c);
  select count(*) into v_n from public.assistant_my_document_findings('sale', '00000000-0000-0000-0a55-0000000000a1');
  if v_n <> 0 then raise exception 'FAIL someone else''s document'; end if;

  -- Watch events: written for oneself, read only by admins.
  perform pg_temp.as_user(e);
  execute 'set local role authenticated';
  insert into public.assistant_watch_events (form, doc_type, code, action) values ('sales_invoice', 'sale', 'below_cost', 'shown');
  v_ok := false;
  begin insert into public.assistant_watch_events (user_id, form, doc_type, code, action) values (f, 'sales_invoice', 'sale', 'below_cost', 'fixed'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL an event for someone else'; end if;
  v_ok := false;
  begin insert into public.assistant_watch_events (form, doc_type, code, action) values ('sales_invoice', 'sale', 'below_cost', 'deleted'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL bad action'; end if;
  select count(*) into v_n from public.assistant_watch_events;
  if v_n <> 0 then raise exception 'FAIL an employee reads events'; end if;
  execute 'reset role';
end $$;

do $$
declare v_ok boolean := false;
begin
  execute 'set local role anon';
  begin perform public.assistant_watch_context('sale', null, '{}'); exception when insufficient_privilege then v_ok := true; end;
  execute 'reset role';
  if not v_ok then raise exception 'FAIL anon'; end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
