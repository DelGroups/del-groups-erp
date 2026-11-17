-- Checks supabase/migrations/20261121140000_assistant_briefings.sql (AST-6): each person reads only their own
-- morning briefing, nobody but the server writes one, "seen" marks only one's own, one row per person and
-- day, and anon gets nothing. One transaction, rolled back; the last line prints ALL CHECKS PASSED.

begin;
set local client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0a56-00000000000a', 'ast6-a@example.test', '{"full_name": "Aysel Admin"}'),
  ('00000000-0000-0000-0a56-00000000000b', 'ast6-b@example.test', '{"full_name": "Bəhruz Manager"}')
on conflict (id) do nothing;
update public.profiles set is_active = true where id in ('00000000-0000-0000-0a56-00000000000a', '00000000-0000-0000-0a56-00000000000b');

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), true);
$$;

-- The server (this session's owner) writes one briefing each.
insert into public.assistant_briefings (id, user_id, day, language, body, all_well, links) values
  ('00000000-0000-0000-0a56-0000000000a1', '00000000-0000-0000-0a56-00000000000a', current_date, 'az', 'Sabahınız xeyir, Aysel.', true, '[{"label": "Satışlar", "href": "/sales"}]'),
  ('00000000-0000-0000-0a56-0000000000b1', '00000000-0000-0000-0a56-00000000000b', current_date, 'ru', 'Доброе утро.', false, '[]');

do $$
declare
  a uuid := '00000000-0000-0000-0a56-00000000000a';
  b uuid := '00000000-0000-0000-0a56-00000000000b';
  v_ok boolean;
  v_n int;
begin
  -- One per person and day.
  v_ok := false;
  begin insert into public.assistant_briefings (user_id, day, language, body) values (a, current_date, 'az', 'again'); exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL two briefings a day'; end if;
  v_ok := false;
  begin insert into public.assistant_briefings (user_id, day, language, body) values (a, current_date - 1, 'fa', 'x'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL language check'; end if;

  perform pg_temp.as_user(a);
  execute 'set local role authenticated';
  select count(*) into v_n from public.assistant_briefings;
  if v_n <> 1 then raise exception 'FAIL Aysel sees % briefings', v_n; end if;
  select count(*) into v_n from public.assistant_briefings where user_id = b;
  if v_n <> 0 then raise exception 'FAIL Aysel reads Bəhruz'; end if;

  v_ok := false;
  begin insert into public.assistant_briefings (user_id, day, language, body) values (a, current_date + 1, 'az', 'fake'); exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a user writes a briefing'; end if;
  v_ok := false;
  begin update public.assistant_briefings set body = 'changed' where user_id = a; exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a user changes a briefing'; end if;

  if not public.assistant_briefing_seen('00000000-0000-0000-0a56-0000000000a1') then raise exception 'FAIL seen own'; end if;
  if public.assistant_briefing_seen('00000000-0000-0000-0a56-0000000000b1') then raise exception 'FAIL seen someone else'; end if;
  execute 'reset role';

  select count(*) into v_n from public.assistant_briefings where seen_at is not null;
  if v_n <> 1 then raise exception 'FAIL seen marks % rows', v_n; end if;
  -- Inactive users read nothing.
  update public.profiles set is_active = false where id = b;
  perform pg_temp.as_user(b);
  execute 'set local role authenticated';
  select count(*) into v_n from public.assistant_briefings;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL an inactive user reads'; end if;
end $$;

do $$
declare v_ok boolean := false; v_n int;
begin
  execute 'set local role anon';
  begin select count(*) into v_n from public.assistant_briefings; exception when insufficient_privilege then v_ok := true; end;
  execute 'reset role';
  if not v_ok then raise exception 'FAIL anon'; end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
