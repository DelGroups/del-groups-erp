-- Checks 20261015100000_billing.sql after rls_and_audit.sql (which creates the platform
-- admin 1111…): invoice numbering per year, totals and snapshots, idempotent renewals and
-- payments, billing statuses (exempt tenants and admin-set statuses), the worklist, and that
-- the ERP functions answer only the service role and only about the asking tenant.
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.

-- Supabase grants the service role every public table and sequence by default; the shim does not.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- A non-admin sees no billing data and cannot issue invoices.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.billing_settings) then raise exception 'FAIL non-admin reads billing settings'; end if;
  begin
    perform public.erp_billing_overview(gen_random_uuid());
    raise exception 'FAIL a signed-in user may call erp_billing_overview';
  exception when insufficient_privilege then null; end;
  begin
    perform public.issue_invoice(jsonb_build_object('tenant_id', gen_random_uuid(), 'lines', '[{"kind":"other","description":"x","unit_price":1,"amount":1}]'::jsonb));
    raise exception 'FAIL non-admin issued an invoice';
  exception when no_data_found or insufficient_privilege then null; end;
end $$;
commit;

-- Admin: settings, numbering, totals, idempotent renewal, payments, statuses.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare
  v_plan uuid; v_tenant uuid; v_other uuid; v_exempt uuid; v_sub uuid;
  r jsonb; r2 jsonb; v_inv uuid; v_inv2 uuid; v_inv3 uuid; i public.invoices; t public.tenants; w jsonb;
  v_lines constant jsonb := '[{"kind":"base","description":"Platform base fee","quantity":1,"unit_price":50,"amount":50},
                             {"kind":"module","item_id":"sales","description":"Sales","quantity":5,"unit_price":8,"amount":40},
                             {"kind":"discount","description":"Discount","quantity":1,"unit_price":-0.1,"amount":-0.1}]';
begin
  if (select count(*) from public.billing_settings) <> 1 then raise exception 'FAIL settings row'; end if;
  update public.billing_settings set seller_name = 'Del Groups MMC', seller_tax_id = '1234567891', bank_name = 'Test Bank',
         bank_account = 'AZ00TEST', invoice_prefix = 'DG', tax_rate_pct = 18;
  begin
    update public.billing_settings set invoice_prefix = 'dg-1';
    raise exception 'FAIL lower-case prefix accepted';
  exception when check_violation then null; end;
  begin
    update public.billing_settings set grace_days = -1;
    raise exception 'FAIL negative grace accepted';
  exception when check_violation then null; end;

  insert into public.plans (code, name) values ('billing-test', 'Billing test') returning id into v_plan;
  insert into public.tenants (name, slug, status, billing_email, billing_tax_id, language)
    values ('Bill Co', 'bill-co', 'active', 'finance@bill.test', '9876543210', 'en') returning id into v_tenant;
  insert into public.tenants (name, slug, status) values ('Other Co', 'other-co', 'active') returning id into v_other;
  insert into public.tenants (name, slug, status, billing_exempt) values ('Exempt Co', 'exempt-co', 'active', true) returning id into v_exempt;
  insert into public.subscriptions (tenant_id, plan_id, status, user_count, current_period_start, current_period_end, auto_billing)
    values (v_tenant, v_plan, 'active', 5, '2026-10-01', '2026-11-01', true) returning id into v_sub;
  insert into public.subscriptions (tenant_id, plan_id, status, user_count, auto_billing) values (v_exempt, v_plan, 'active', 5, true);
  begin
    update public.tenants set billing_email = 'not-an-email' where id = v_tenant;
    raise exception 'FAIL bad billing email accepted';
  exception when check_violation then null; end;

  -- Numbering per year, totals with tax, snapshots of seller and buyer, lines in order.
  r := public.issue_invoice(jsonb_build_object('tenant_id', v_tenant, 'subscription_id', v_sub, 'kind', 'renewal',
        'billing_period', 'monthly', 'period_start', '2026-11-01', 'period_end', '2026-12-01',
        'issue_date', '2026-10-25', 'due_date', '2026-11-01', 'currency', 'AZN', 'lines', v_lines));
  if r ->> 'number' <> 'DG-2026-00001' or not (r ->> 'created')::boolean then raise exception 'FAIL first number %', r; end if;
  v_inv := (r ->> 'id')::uuid;
  select * into i from public.invoices where id = v_inv;
  if i.subtotal <> 89.90 or i.tax <> 16.18 or i.total <> 106.08 or i.status <> 'issued' or i.language <> 'en' then
    raise exception 'FAIL totals % % % %', i.subtotal, i.tax, i.total, i.status;
  end if;
  if i.seller ->> 'name' <> 'Del Groups MMC' or i.seller ->> 'bank_account' <> 'AZ00TEST' or i.buyer ->> 'tax_id' <> '9876543210' then
    raise exception 'FAIL snapshots % %', i.seller, i.buyer;
  end if;
  if (select string_agg(description, ',' order by position) from public.invoice_lines where invoice_id = v_inv) <> 'Platform base fee,Sales,Discount' then
    raise exception 'FAIL lines';
  end if;

  -- The same renewal again returns the same invoice.
  r2 := public.issue_invoice(jsonb_build_object('tenant_id', v_tenant, 'subscription_id', v_sub, 'kind', 'renewal',
        'period_start', '2026-11-01', 'issue_date', '2026-10-26', 'due_date', '2026-11-01', 'lines', v_lines));
  if (r2 ->> 'id')::uuid <> v_inv or (r2 ->> 'created')::boolean then raise exception 'FAIL renewal not idempotent %', r2; end if;

  r := public.issue_invoice(jsonb_build_object('tenant_id', v_tenant, 'kind', 'manual', 'issue_date', '2026-12-30',
        'lines', '[{"kind":"other","description":"Setup","unit_price":10,"amount":10}]'::jsonb));
  v_inv2 := (r ->> 'id')::uuid;
  if r ->> 'number' <> 'DG-2026-00002' then raise exception 'FAIL second number %', r; end if;
  if (select due_date from public.invoices where id = v_inv2) <> '2027-01-06' then raise exception 'FAIL default due date'; end if;
  r := public.issue_invoice(jsonb_build_object('tenant_id', v_tenant, 'kind', 'manual', 'issue_date', '2027-01-02',
        'lines', '[{"kind":"other","description":"New year","unit_price":5,"amount":5}]'::jsonb));
  v_inv3 := (r ->> 'id')::uuid;
  if r ->> 'number' <> 'DG-2027-00001' then raise exception 'FAIL numbering restarts each year: %', r; end if;
  begin
    perform public.issue_invoice(jsonb_build_object('tenant_id', v_tenant, 'lines', '[]'::jsonb));
    raise exception 'FAIL empty invoice issued';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.issue_invoice(jsonb_build_object('tenant_id', v_tenant, 'lines', '[{"kind":"credit","description":"x","unit_price":-1,"amount":-1}]'::jsonb));
    raise exception 'FAIL negative invoice issued';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.invoices (tenant_id, number) values (v_tenant, 'DG-2026-00001');
    raise exception 'FAIL duplicate invoice number';
  exception when unique_violation then null; end;

  -- Overdue marking.
  if public.mark_overdue_invoices('2026-11-01') <> 0 then raise exception 'FAIL due today is not overdue'; end if;
  if public.mark_overdue_invoices('2026-11-02') <> 1 then raise exception 'FAIL overdue marking'; end if;

  -- Payments: partial, a repeated gateway report, then the rest.
  r := public.record_payment(jsonb_build_object('invoice_id', v_inv, 'amount', 50, 'method', 'card', 'provider', 'testpay', 'provider_reference', 'pay_1'));
  if (r ->> 'duplicate')::boolean or r ->> 'invoice_status' <> 'overdue' then raise exception 'FAIL partial %', r; end if;
  r := public.record_payment(jsonb_build_object('invoice_id', v_inv, 'amount', 50, 'method', 'card', 'provider', 'testpay', 'provider_reference', 'pay_1'));
  if not (r ->> 'duplicate')::boolean then raise exception 'FAIL duplicate not detected'; end if;
  if (select amount_paid from public.invoices where id = v_inv) <> 50 then raise exception 'FAIL duplicate counted'; end if;
  r := public.record_payment(jsonb_build_object('invoice_id', v_inv, 'amount', 56.08, 'method', 'bank_transfer', 'paid_at', '2026-11-20T09:00:00Z'));
  select * into i from public.invoices where id = v_inv;
  if i.status <> 'paid' or i.amount_paid <> 106.08 or i.paid_at <> '2026-11-20T09:00:00Z' then raise exception 'FAIL paid % % %', i.status, i.amount_paid, i.paid_at; end if;
  begin
    perform public.record_payment(jsonb_build_object('invoice_id', v_inv, 'amount', 1, 'method', 'cash'));
    raise exception 'FAIL payment on a paid invoice';
  exception when invalid_parameter_value then null; end;
  r := public.record_payment(jsonb_build_object('invoice_id', v_inv2, 'amount', 11.8, 'method', 'card', 'provider', 'testpay', 'provider_reference', 'pay_2', 'status', 'failed', 'failure_reason', 'declined'));
  if r ->> 'invoice_status' <> 'issued' then raise exception 'FAIL failed payment changed the invoice'; end if;

  -- Billing statuses: recorded as billing, subscription follows; an admin change is an admin's.
  if not public.set_billing_status(v_tenant, 'read_only') then raise exception 'FAIL set read_only'; end if;
  select * into t from public.tenants where id = v_tenant;
  if t.status <> 'read_only' or t.status_source <> 'billing' or t.status_changed_at is null then raise exception 'FAIL status % %', t.status, t.status_source; end if;
  if (select status from public.subscriptions where id = v_sub) <> 'past_due' then raise exception 'FAIL subscription not past_due'; end if;
  if public.set_billing_status(v_tenant, 'read_only') then raise exception 'FAIL same status reported as a change'; end if;
  if not public.set_billing_status(v_tenant, 'active') then raise exception 'FAIL reactivate'; end if;
  if (select status from public.subscriptions where id = v_sub) <> 'active' then raise exception 'FAIL subscription not active again'; end if;
  update public.tenants set status = 'suspended' where id = v_tenant;
  if (select status_source from public.tenants where id = v_tenant) <> 'admin' then raise exception 'FAIL admin change not recorded as admin'; end if;
  update public.tenants set status = 'active' where id = v_tenant;
  if public.set_billing_status(v_exempt, 'suspended') then raise exception 'FAIL exempt tenant suspended'; end if;
  update public.tenants set status = 'provisioning' where id = v_other;
  if public.set_billing_status(v_other, 'suspended') then raise exception 'FAIL provisioning tenant suspended'; end if;
  update public.tenants set status = 'active' where id = v_other;
  begin
    perform public.set_billing_status(v_tenant, 'cancelled');
    raise exception 'FAIL billing cancelled a tenant';
  exception when invalid_parameter_value then null; end;

  -- Periods move once.
  if not public.advance_subscription_period(v_sub, '2026-11-01', '2026-12-01') then raise exception 'FAIL advance'; end if;
  if public.advance_subscription_period(v_sub, '2026-11-01', '2026-12-01') then raise exception 'FAIL advanced twice'; end if;

  -- Worklist: auto-billed tenants only, never exempt ones; open invoices listed.
  w := public.billing_worklist();
  if jsonb_array_length(w) <> 1 or w -> 0 ->> 'slug' <> 'bill-co' then raise exception 'FAIL worklist %', w; end if;
  if jsonb_array_length(w -> 0 -> 'open_invoices') <> 2 or w -> 0 -> 'subscription' ->> 'current_period_end' <> '2026-12-01' then
    raise exception 'FAIL work item %', w -> 0;
  end if;
  if (public.billing_work_item(v_exempt) ->> 'billing_exempt')::boolean is not true then raise exception 'FAIL exempt flag in work item'; end if;

  -- Emails once per invoice and step.
  insert into public.billing_emails (tenant_id, invoice_id, kind, recipient) values (v_tenant, v_inv, 'past_due', 'finance@bill.test');
  begin
    insert into public.billing_emails (tenant_id, invoice_id, kind) values (v_tenant, v_inv, 'past_due');
    raise exception 'FAIL email twice';
  exception when unique_violation then null; end;

  -- Saved cards are written only by the webhook (service role).
  begin
    insert into public.payment_methods (tenant_id, provider, vault_secret_id) values (v_tenant, 'testpay', gen_random_uuid());
    raise exception 'FAIL admin inserted a card token';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.platform_audit_log where entity_table = 'invoices') < 3 then raise exception 'FAIL invoices not audited'; end if;
end $$;
commit;

-- The ERP (service role): the asking tenant's billing only; plan change requests.
begin;
set local role service_role;
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'bill-co');
  v_other uuid := (select id from public.tenants where slug = 'other-co');
  v_plan uuid := (select id from public.plans where code = 'billing-test');
  v_inv uuid := (select id from public.invoices where number = 'DG-2026-00001');
  o jsonb; v_req uuid; v_req2 uuid; v_card uuid;
begin
  o := public.erp_billing_overview(v_tenant);
  if o -> 'subscription' ->> 'plan_code' <> 'billing-test' or jsonb_array_length(o -> 'invoices') <> 3 then raise exception 'FAIL overview %', o; end if;
  if o -> 'bank' ->> 'bank_account' <> 'AZ00TEST' or o -> 'entitlements' ->> 'seat_limit' <> '5' then raise exception 'FAIL overview bank/limits %', o; end if;
  if jsonb_array_length(public.erp_billing_overview(v_other) -> 'invoices') <> 0 then raise exception 'FAIL other tenant sees invoices'; end if;
  if public.erp_billing_overview(gen_random_uuid()) is not null then raise exception 'FAIL unknown tenant'; end if;

  update public.invoices set pdf_path = v_tenant || '/DG-2026-00001.pdf' where id = v_inv;
  if public.erp_invoice_pdf_path(v_tenant, v_inv) is null then raise exception 'FAIL own pdf path'; end if;
  if public.erp_invoice_pdf_path(v_other, v_inv) is not null then raise exception 'FAIL another tenant gets the pdf path'; end if;

  v_req := public.erp_request_plan_change(v_tenant, jsonb_build_object('plan_id', v_plan, 'billing_period', 'yearly', 'user_count', 8, 'note', 'More users', 'requested_by_email', 'boss@bill.test'));
  v_req2 := public.erp_request_plan_change(v_tenant, jsonb_build_object('plan_id', v_plan, 'billing_period', 'monthly', 'user_count', 9));
  if (select status from public.plan_change_requests where id = v_req) <> 'cancelled' then raise exception 'FAIL old request not replaced'; end if;
  if (public.erp_billing_overview(v_tenant) -> 'pending_request' ->> 'id')::uuid <> v_req2 then raise exception 'FAIL pending request'; end if;
  update public.plans set is_active = false where id = v_plan;
  begin
    perform public.erp_request_plan_change(v_tenant, jsonb_build_object('plan_id', v_plan, 'billing_period', 'monthly', 'user_count', 1));
    raise exception 'FAIL inactive plan requested';
  exception when invalid_parameter_value then null; end;
  update public.plans set is_active = true where id = v_plan;

  v_card := public.save_payment_method(v_tenant, 'testpay', 'tok_secret_1', 'visa', '4242', 12, 2030);
  if public.payment_method_token(v_card) <> 'tok_secret_1' then raise exception 'FAIL card token'; end if;
  if exists (select 1 from public.payment_methods where id = v_card and vault_secret_id is null) then raise exception 'FAIL token not in Vault'; end if;
end $$;
commit;

-- Signed-in users (platform admins included) never get card tokens.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.payment_method_token((select id from public.payment_methods limit 1));
    raise exception 'FAIL admin read a card token';
  exception when insufficient_privilege then null; end;
end $$;
commit;

select 'ALL CHECKS PASSED' as result;
