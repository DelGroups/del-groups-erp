-- Checks supabase/migrations/20261024100000_calendar.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Three users: an admin (A), a user without CRM access (B) and a non-admin with CRM access (C).
-- C plans a meeting with A and the customer from a CRM deal (the phase 20 "done when"), and a
-- private event with A; B sees the team calendar but not private events or the deal.

insert into public.roles (id, name, permissions, description, created_at, is_system, scopes) values
  ('00000000-0000-0000-00ca-0000000000b0', 'Calendar test: no CRM', '{}'::jsonb, null, now(), false, '{}'::jsonb),
  ('00000000-0000-0000-00ca-0000000000c0', 'Calendar test: CRM', '{"can_view_crm": true, "can_manage_crm": true}'::jsonb, null, now(), false, '{}'::jsonb)
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00ca-00000000000a', 'cal-a@example.test', '{"full_name": "Aynur Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00ca-00000000000b', 'cal-b@example.test', '{"full_name": "Bəxtiyar NoCRM", "role_name": "Calendar test: no CRM"}'),
  ('00000000-0000-0000-00ca-00000000000c', 'cal-c@example.test', '{"full_name": "Ceyhun CRM", "role_name": "Calendar test: CRM"}')
on conflict (id) do nothing;

insert into public.customers (id, full_name) values ('00000000-0000-0000-00ca-0000000000e1', 'Acme MMC') on conflict (id) do nothing;
insert into public.deals (id, title, client_id) values ('00000000-0000-0000-00ca-0000000000d1', 'Calendar test deal', '00000000-0000-0000-00ca-0000000000e1') on conflict (id) do nothing;

-- ── C: plans a meeting from the deal, and a private event ───────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00ca-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_activity uuid;
  v_event public.calendar_events;
  v_private uuid;
begin
  -- A meeting activity on the deal, assigned to A, creates its event.
  insert into public.activities (res_model, res_id, activity_type, summary, due_date, assigned_to)
  values ('deals', '00000000-0000-0000-00ca-0000000000d1', 'meeting', 'Showroom meeting', date '2026-11-10', '00000000-0000-0000-00ca-00000000000a')
  returning id into v_activity;
  select * into v_event from public.calendar_events where activity_id = v_activity;
  if v_event.id is null then raise exception 'FAIL meeting activity made no event'; end if;
  if v_event.organizer_id <> '00000000-0000-0000-00ca-00000000000c' or not v_event.all_day or v_event.res_model <> 'deals'
     or v_event.res_id <> '00000000-0000-0000-00ca-0000000000d1' or v_event.title <> 'Showroom meeting'
     or v_event.start_at <> timestamptz '2026-11-10 00:00:00+00' then
    raise exception 'FAIL meeting event has the wrong organizer, link, title or day: %', row_to_json(v_event);
  end if;
  if not exists (select 1 from public.calendar_attendees where event_id = v_event.id and user_id = '00000000-0000-0000-00ca-00000000000a') then
    raise exception 'FAIL the assignee was not invited';
  end if;

  -- The organizer sets the time, invites the deal's customer and sets a reminder.
  update public.calendar_events set all_day = false, start_at = timestamptz '2026-11-10 10:00:00+04', end_at = timestamptz '2026-11-10 11:00:00+04' where id = v_event.id;
  insert into public.calendar_attendees (event_id, partner_model, partner_id, display_name) values (v_event.id, 'customers', '00000000-0000-0000-00ca-0000000000e1', 'Acme MMC');
  insert into public.calendar_reminders (event_id, minutes_before) values (v_event.id, 30);
  -- Moving the activity keeps the time of day.
  update public.activities set due_date = date '2026-11-12' where id = v_activity;
  if (select start_at from public.calendar_events where id = v_event.id) <> timestamptz '2026-11-12 10:00:00+04' then
    raise exception 'FAIL moving the meeting lost its time: %', (select start_at from public.calendar_events where id = v_event.id);
  end if;

  -- Organizer, creation time and activity link cannot be changed.
  update public.calendar_events set organizer_id = '00000000-0000-0000-00ca-00000000000b', activity_id = null where id = v_event.id;
  if (select organizer_id <> '00000000-0000-0000-00ca-00000000000c' or activity_id is null from public.calendar_events where id = v_event.id) then
    raise exception 'FAIL organizer or activity link changed';
  end if;

  -- A private event with A, weekly.
  insert into public.calendar_events (title, start_at, end_at, privacy, recurrence)
  values ('Salary talk', timestamptz '2026-11-11 15:00:00+04', timestamptz '2026-11-11 15:30:00+04', 'private', 'FREQ=WEEKLY;COUNT=4')
  returning id into v_private;
  insert into public.calendar_attendees (event_id, user_id) values (v_private, '00000000-0000-0000-00ca-00000000000a');

  -- Events are created as yourself, never as an activity's event, with a supported rule.
  begin
    insert into public.calendar_events (title, start_at, end_at, organizer_id) values ('x', now(), now(), '00000000-0000-0000-00ca-00000000000a');
    raise exception 'FAIL created an event for someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.calendar_events (title, start_at, end_at, activity_id) values ('x', now(), now(), v_activity);
    raise exception 'FAIL created an activity''s event by hand';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    insert into public.calendar_events (title, start_at, end_at, recurrence) values ('x', now(), now(), 'FREQ=HOURLY');
    raise exception 'FAIL unsupported repeat rule';
  exception when check_violation then null;
  end;
  begin
    insert into public.calendar_events (title, start_at, end_at) values ('x', now(), now() - interval '1 hour');
    raise exception 'FAIL end before start';
  exception when check_violation then null;
  end;
  begin
    insert into public.calendar_attendees (event_id) values (v_private);
    raise exception 'FAIL attendee without a person';
  exception when check_violation then null;
  end;
end $$;
commit;

-- ── B: no CRM access ────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00ca-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_count integer;
  v_meeting uuid := (select id from public.calendar_events where title = 'Showroom meeting');
  v_private uuid;
begin
  -- The team calendar: the public meeting is visible, the private event is not.
  if v_meeting is null then raise exception 'FAIL public event hidden from the team'; end if;
  select count(*) into v_count from public.calendar_events where title = 'Salary talk';
  if v_count <> 0 then raise exception 'FAIL private event visible to a stranger'; end if;
  -- …but its time is: busy blocks for C and A, without title.
  select count(*) into v_count from public.calendar_busy(timestamptz '2026-11-01', timestamptz '2026-12-01')
   where user_id in ('00000000-0000-0000-00ca-00000000000c', '00000000-0000-0000-00ca-00000000000a') and recurrence = 'FREQ=WEEKLY;COUNT=4';
  if v_count <> 2 then raise exception 'FAIL busy blocks: % of 2', v_count; end if;
  -- Attendees of the public meeting are visible; nothing can be changed.
  select count(*) into v_count from public.calendar_attendees where event_id = v_meeting;
  if v_count <> 2 then raise exception 'FAIL attendees of a public event: % of 2', v_count; end if;
  update public.calendar_events set title = 'hijacked' where id = v_meeting;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL stranger changed an event'; end if;
  delete from public.calendar_events where id = v_meeting;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL stranger deleted an event'; end if;
  begin
    insert into public.calendar_attendees (event_id, user_id) values (v_meeting, '00000000-0000-0000-00ca-00000000000b');
    raise exception 'FAIL stranger invited themselves';
  exception when insufficient_privilege then null;
  end;
  update public.calendar_attendees set response = 'declined' where event_id = v_meeting;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL stranger answered for others'; end if;
  -- Reminders are personal; none on an event one cannot see.
  select count(*) into v_count from public.calendar_reminders;
  if v_count <> 0 then raise exception 'FAIL sees % reminders of others', v_count; end if;
  select id into v_private from public.calendar_events where title = 'Salary talk';
  begin
    insert into public.calendar_reminders (event_id, minutes_before)
    select e.id, 5 from public.calendar_events e where e.organizer_id = '00000000-0000-0000-00ca-00000000000c' and e.privacy = 'private';
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'FAIL reminder on a hidden event'; end if;
  exception when insufficient_privilege then null;
  end;
  -- Linking an event to a record needs read access to it.
  begin
    insert into public.calendar_events (title, start_at, end_at, res_model, res_id) values ('Spy', now(), now(), 'deals', '00000000-0000-0000-00ca-0000000000d1');
    raise exception 'FAIL linked an event to an unreadable record';
  exception when insufficient_privilege then null;
  end;
  -- B's own event is fine.
  insert into public.calendar_events (title, start_at, end_at) values ('B lunch', now(), now() + interval '1 hour');
end $$;
commit;

-- ── A: admin and attendee ───────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00ca-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_count integer;
  v_private uuid := (select id from public.calendar_events where title = 'Salary talk');
  v_mine uuid;
  v_reminder uuid;
begin
  if v_private is null then raise exception 'FAIL invited attendee cannot see a private event'; end if;
  -- A answers; the answer is the only thing that changes on their own row.
  select id into v_mine from public.calendar_attendees where event_id = v_private and user_id = '00000000-0000-0000-00ca-00000000000a';
  update public.calendar_attendees set response = 'accepted', user_id = '00000000-0000-0000-00ca-00000000000b', event_id = (select id from public.calendar_events where title = 'B lunch') where id = v_mine;
  if (select response <> 'accepted' or user_id <> '00000000-0000-0000-00ca-00000000000a' or event_id <> v_private from public.calendar_attendees where id = v_mine) then
    raise exception 'FAIL attendee row changed more than the answer';
  end if;
  -- Own reminder and its delivery.
  insert into public.calendar_reminders (event_id, minutes_before) values (v_private, 10) returning id into v_reminder;
  insert into public.calendar_reminder_deliveries (reminder_id, occurrence_start) values (v_reminder, timestamptz '2026-11-11 15:00:00+04');
  begin
    insert into public.calendar_reminder_deliveries (reminder_id, occurrence_start)
    select id, now() from public.calendar_reminders where user_id = '00000000-0000-0000-00ca-00000000000c';
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'FAIL marked someone else''s reminder'; end if;
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_count from public.calendar_reminders;
  if v_count <> 1 then raise exception 'FAIL sees % reminders, expected only their own', v_count; end if;
  -- The admin may change any event.
  update public.calendar_events set location = 'Showroom' where title = 'Showroom meeting';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'FAIL admin could not change an event'; end if;
end $$;
commit;

-- ── C deletes the meeting activity: its event goes with it ──────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00ca-00000000000c","role":"authenticated"}', true);
do $$
begin
  delete from public.activities where summary = 'Showroom meeting';
  if exists (select 1 from public.calendar_events where title = 'Showroom meeting') then raise exception 'FAIL meeting event outlived its activity'; end if;
  if (select count(*) from public.calendar_events where title = 'Salary talk') <> 1 then raise exception 'FAIL organizer lost their private event'; end if;
end $$;
commit;

-- Anonymous visitors have no access.
begin;
set local role anon;
do $$
begin
  begin
    perform 1 from public.calendar_events;
    raise exception 'FAIL anon can read events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.calendar_busy(now(), now() + interval '1 day');
    raise exception 'FAIL anon can read busy blocks';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

select 'ALL CHECKS PASSED';
