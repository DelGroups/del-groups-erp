-- Checks supabase/migrations/20261121100000_assistant_core.sql (AST-1): the context column (a user writes it on
-- their own conversation only), the usage source column (old rows default to assistant_v1), and
-- assistant_month_cost() (only this month's assistant_v2 rows; admins and the server only, not even a user with
-- can_manage_settings; never anon). One transaction, rolled back; the last line prints ALL CHECKS PASSED.

begin;

insert into public.roles (name, permissions, description, is_system)
select 'Assistant test: settings', '{"can_manage_settings": true}'::jsonb, 'AST-1 test', false
where not exists (select 1 from public.roles where name = 'Assistant test: settings');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a51-00000000000a', 'ast1-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0a51-00000000000b', 'ast1-s@example.test', '{"full_name": "Samir Settings", "role_name": "Assistant test: settings"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0a51-00000000000a';
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Assistant test: settings' limit 1)
where id = '00000000-0000-0000-0a51-00000000000b';

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;

delete from public.ai_usage_log;
insert into public.ai_conversations (id, user_id, title) values
  ('00000000-0000-0000-0a51-0000000000c1', '00000000-0000-0000-0a51-00000000000a', 'Admin chat'),
  ('00000000-0000-0000-0a51-0000000000c2', '00000000-0000-0000-0a51-00000000000b', 'User chat');
insert into public.ai_usage_log (user_id, cost_usd, created_at) values ('00000000-0000-0000-0a51-00000000000b', 9.00, now());
insert into public.ai_usage_log (user_id, cost_usd, source, created_at) values
  ('00000000-0000-0000-0a51-00000000000b', 0.40, 'assistant_v2', now()),
  ('00000000-0000-0000-0a51-00000000000a', 0.10, 'assistant_v2', now()),
  ('00000000-0000-0000-0a51-00000000000a', null, 'assistant_v2', now()),
  ('00000000-0000-0000-0a51-00000000000a', 7.00, 'assistant_v2', date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' - interval '1 day');

do $$
begin
  if (select source from public.ai_usage_log where cost_usd = 9.00) <> 'assistant_v1' then raise exception 'FAIL source default'; end if;
  perform set_config('request.jwt.claims', '', true);
  if public.assistant_month_cost() <> 0.50 then raise exception 'FAIL month cost (server) %', public.assistant_month_cost(); end if;
end $$;

-- An admin reads the cost; a user with can_manage_settings and anon cannot.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0a51-00000000000a');
do $$ begin if public.assistant_month_cost() <> 0.50 then raise exception 'FAIL month cost (admin)'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0a51-00000000000b');
do $$
begin
  begin perform public.assistant_month_cost(); raise exception 'FAIL non-admin cost'; exception when insufficient_privilege then null; end;
  -- The user saves the context of their own conversation, not someone else's.
  update public.ai_conversations set context = '{"page": "/sales", "recordType": "sale"}' where id = '00000000-0000-0000-0a51-0000000000c2';
  if (select context ->> 'page' from public.ai_conversations where id = '00000000-0000-0000-0a51-0000000000c2') <> '/sales' then raise exception 'FAIL own context'; end if;
  update public.ai_conversations set context = '{"page": "/x"}' where id = '00000000-0000-0000-0a51-0000000000c1';
end $$;
reset role;
do $$
begin
  if (select context from public.ai_conversations where id = '00000000-0000-0000-0a51-0000000000c1') is not null then raise exception 'FAIL wrote another user''s context'; end if;
end $$;
set local role anon;
do $$ begin begin perform public.assistant_month_cost(); raise exception 'FAIL anon cost'; exception when insufficient_privilege then null; end; end $$;
reset role;

select 'ALL CHECKS PASSED';
rollback;
