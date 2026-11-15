-- Checks supabase/migrations/20261121120000_assistant_actions.sql (AST-4): users read only their own proposals
-- and cannot write the table; a claim needs the owner, a proposal still open and not expired, the same
-- fingerprint, the kind's permission and, above the limit, a second confirm; a double claim fails (one draft);
-- finish writes the audit line "via: assistant"; reject; anon nothing.
-- One transaction, rolled back; the last line prints ALL CHECKS PASSED.

begin;
set local client_min_messages = warning;

insert into public.roles (name, permissions, description, is_system)
select 'Actions test: sales', '{"can_create_invoice": true, "can_view_sales": true}'::jsonb, 'AST-4 test', false
where not exists (select 1 from public.roles where name = 'Actions test: sales');
insert into public.roles (name, permissions, description, is_system)
select 'Actions test: none', '{}'::jsonb, 'AST-4 test', false
where not exists (select 1 from public.roles where name = 'Actions test: none');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a54-00000000000e', 'ast4-e@example.test', '{"full_name": "Elvin Sales", "role_name": "Actions test: sales"}'),
  ('00000000-0000-0000-0a54-00000000000f', 'ast4-f@example.test', '{"full_name": "Fidan None", "role_name": "Actions test: none"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Actions test: sales' limit 1)
where id = '00000000-0000-0000-0a54-00000000000e';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Actions test: none' limit 1)
where id = '00000000-0000-0000-0a54-00000000000f';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;

-- The server stores proposals (service role).
insert into public.assistant_proposals (id, user_id, kind, payload, payload_hash, summary, amount, second_confirm_required, idempotency_key, expires_at) values
  ('00000000-0000-0000-0a54-0000000000a1', '00000000-0000-0000-0a54-00000000000e', 'sale_draft', '{"customer_id":"x"}', repeat('a', 64), 'Sale', 30, false, 'k1', now() + interval '1 day'),
  ('00000000-0000-0000-0a54-0000000000a2', '00000000-0000-0000-0a54-00000000000e', 'sale_draft', '{"customer_id":"y"}', repeat('b', 64), 'Big sale', 25000, true, 'k2', now() + interval '1 day'),
  ('00000000-0000-0000-0a54-0000000000a3', '00000000-0000-0000-0a54-00000000000e', 'customer', '{"full_name":"Test"}', repeat('c', 64), 'Customer', 0, false, 'k3', now() + interval '1 day'),
  ('00000000-0000-0000-0a54-0000000000a4', '00000000-0000-0000-0a54-00000000000e', 'sale_draft', '{}', repeat('d', 64), 'Old', 10, false, 'k4', now() - interval '1 minute'),
  ('00000000-0000-0000-0a54-0000000000a5', '00000000-0000-0000-0a54-00000000000f', 'sale_draft', '{}', repeat('e', 64), 'Fidan''s', 10, false, 'k5', now() + interval '1 day'),
  ('00000000-0000-0000-0a54-0000000000a6', '00000000-0000-0000-0a54-00000000000e', 'sale_draft', '{}', repeat('f', 64), 'To cancel', 10, false, 'k6', now() + interval '1 day');

do $$
declare
  e uuid := '00000000-0000-0000-0a54-00000000000e';
  f uuid := '00000000-0000-0000-0a54-00000000000f';
  r jsonb;
  v_ok boolean;
  v_n int;
begin
  -- Users read only their own, and cannot write the table.
  perform pg_temp.as_user(e);
  execute 'set local role authenticated';
  select count(*) into v_n from public.assistant_proposals;
  if v_n <> 5 then raise exception 'FAIL own proposals: %', v_n; end if;
  v_ok := false;
  begin insert into public.assistant_proposals (user_id, kind, payload, payload_hash, idempotency_key) values (e, 'sale_draft', '{}', repeat('0', 64), 'forged'); exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a user forged a proposal'; end if;
  v_ok := false;
  begin update public.assistant_proposals set status = 'confirmed'; exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a user changed a proposal'; end if;
  execute 'reset role';

  -- A wrong fingerprint is refused and leaves the proposal open.
  v_ok := false;
  begin perform public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a1', repeat('0', 64)); exception when others then v_ok := sqlerrm = 'hash_mismatch'; end;
  if not v_ok then raise exception 'FAIL hash mismatch'; end if;
  if (select status from public.assistant_proposals where id = '00000000-0000-0000-0a54-0000000000a1') <> 'proposed' then raise exception 'FAIL still open'; end if;

  -- The right one claims once; the second claim fails (one draft).
  r := public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a1', upper(repeat('a', 64)));
  if r ->> 'kind' <> 'sale_draft' or r -> 'payload' ->> 'customer_id' <> 'x' then raise exception 'FAIL claim returns the stored payload: %', r; end if;
  v_ok := false;
  begin perform public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a1', repeat('a', 64)); exception when others then v_ok := sqlerrm = 'already_decided'; end;
  if not v_ok then raise exception 'FAIL double claim'; end if;

  -- Finish: confirmed with its result and an audit line via the assistant.
  perform public.assistant_proposal_finish('00000000-0000-0000-0a54-0000000000a1', true, '{"id":"00000000-0000-0000-0a54-0000000000d1","docNo":"SS-1","href":"/sales/1"}');
  if (select status from public.assistant_proposals where id = '00000000-0000-0000-0a54-0000000000a1') <> 'confirmed' then raise exception 'FAIL confirmed'; end if;
  if not exists (select 1 from public.audit_logs where table_name = 'assistant_proposals' and record_id = '00000000-0000-0000-0a54-0000000000a1'
                 and new_values_json ->> 'via' = 'assistant' and new_values_json ->> 'status' = 'draft' and user_id = e) then
    raise exception 'FAIL audit line';
  end if;
  v_ok := false;
  begin perform public.assistant_proposal_finish('00000000-0000-0000-0a54-0000000000a1', true, '{}'); exception when others then v_ok := sqlerrm = 'not_confirming'; end;
  if not v_ok then raise exception 'FAIL finish twice'; end if;

  -- Above the limit a second confirm is needed.
  v_ok := false;
  begin perform public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a2', repeat('b', 64)); exception when others then v_ok := sqlerrm = 'second_confirm_required'; end;
  if not v_ok then raise exception 'FAIL second confirm'; end if;
  r := public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a2', repeat('b', 64), true);
  perform public.assistant_proposal_finish('00000000-0000-0000-0a54-0000000000a2', false, null, 'Stock check failed');
  if (select status || '/' || error from public.assistant_proposals where id = '00000000-0000-0000-0a54-0000000000a2') <> 'failed/Stock check failed' then raise exception 'FAIL failed'; end if;

  -- The permission is checked again at confirm time.
  v_ok := false;
  begin perform public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a3', repeat('c', 64)); exception when others then v_ok := sqlerrm = 'forbidden'; end;
  if not v_ok then raise exception 'FAIL customer without can_manage_customers'; end if;

  -- Expired after 24 h.
  r := public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a4', repeat('d', 64));
  if r ->> 'error' <> 'expired' or (select status from public.assistant_proposals where id = '00000000-0000-0000-0a54-0000000000a4') <> 'expired' then raise exception 'FAIL expired'; end if;

  -- Someone else's proposal looks missing.
  v_ok := false;
  begin perform public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a5', repeat('e', 64)); exception when others then v_ok := sqlerrm = 'not_found'; end;
  if not v_ok then raise exception 'FAIL another user''s proposal'; end if;

  -- Cancel.
  perform public.assistant_proposal_reject('00000000-0000-0000-0a54-0000000000a6');
  if (select status from public.assistant_proposals where id = '00000000-0000-0000-0a54-0000000000a6') <> 'rejected' then raise exception 'FAIL reject'; end if;
  v_ok := false;
  begin perform public.assistant_proposal_reject('00000000-0000-0000-0a54-0000000000a6'); exception when others then v_ok := sqlerrm = 'already_decided'; end;
  if not v_ok then raise exception 'FAIL reject twice'; end if;

  -- Fidan (no permission) cannot confirm her own sale proposal.
  perform pg_temp.as_user(f);
  v_ok := false;
  begin perform public.assistant_proposal_claim('00000000-0000-0000-0a54-0000000000a5', repeat('e', 64)); exception when others then v_ok := sqlerrm = 'forbidden'; end;
  if not v_ok then raise exception 'FAIL claim without can_create_invoice'; end if;
end $$;

do $$
declare v_ok boolean := false;
begin
  execute 'set local role anon';
  begin perform public.assistant_proposal_reject('00000000-0000-0000-0a54-0000000000a6'); exception when insufficient_privilege then v_ok := true; end;
  execute 'reset role';
  if not v_ok then raise exception 'FAIL anon'; end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
