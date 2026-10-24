-- Calendar (phase 20, module "calendar", depends on core): events, attendees and reminders.
--
--   calendar_events      title, start/end, all day, location, description, organizer, recurrence
--                        rule (RRULE subset: FREQ, INTERVAL, COUNT, UNTIL, BYDAY), privacy, and an
--                        optional link to any chatter record (res_model, res_id) or activity
--   calendar_attendees   a colleague (user_id) or a partner (customer / supplier) and the response
--   calendar_reminders   "remind me N minutes before", per user, in-app or e-mail
--   calendar_reminder_deliveries
--                        which occurrence a reminder was already shown for (recurring events)
--
-- Meeting activities (phase 19 chatter, type "meeting" or a type with the meeting icon) create and
-- keep an event in step: same title and day, linked to the activity and its record, the assignee
-- invited. Deleting the activity deletes its event.
--
-- Who sees what: public events are the team calendar (everyone signed in); private events only
-- their organizer and attendees, others get "busy" blocks from calendar_busy(). Only the
-- organizer (or an admin) changes an event and its attendee list; an attendee answers for
-- themselves. Reminders are personal.
--
-- Only the new UI (NEW_UI) reads or writes these tables; applying the migration changes nothing
-- for anyone except that new meeting activities also get an event. Safe to re-run.

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text check (location is null or length(location) <= 200),
  description text check (description is null or length(description) <= 5000),
  organizer_id uuid default auth.uid() references auth.users (id) on delete set null,
  recurrence text check (
    recurrence is null
    or (length(recurrence) <= 200 and recurrence ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;(INTERVAL=[1-9][0-9]{0,2}|COUNT=[1-9][0-9]{0,2}|UNTIL=[0-9]{8}(T[0-9]{6}Z)?|BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU)){0,6}))*$')
  ),
  privacy text not null default 'public' check (privacy in ('public', 'private')),
  res_model text check (res_model is null or res_model = any (public.chatter_models())),
  res_id uuid,
  activity_id uuid unique references public.activities (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at),
  check ((res_model is null) = (res_id is null))
);

create index if not exists calendar_events_start_idx on public.calendar_events (start_at);
create index if not exists calendar_events_organizer_idx on public.calendar_events (organizer_id, start_at);
create index if not exists calendar_events_record_idx on public.calendar_events (res_model, res_id) where res_model is not null;

comment on table public.calendar_events is
  'Calendar events (phase 20): team calendar (public) and private events, optionally linked to a record or a meeting activity.';

create table if not exists public.calendar_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  partner_model text check (partner_model is null or partner_model in ('customers', 'suppliers')),
  partner_id uuid,
  display_name text check (display_name is null or length(display_name) <= 200),
  response text not null default 'needs_action' check (response in ('needs_action', 'accepted', 'declined', 'tentative')),
  created_at timestamptz not null default now(),
  check ((user_id is not null) <> (partner_id is not null)),
  check ((partner_model is null) = (partner_id is null))
);

create unique index if not exists calendar_attendees_user_uq on public.calendar_attendees (event_id, user_id) where user_id is not null;
create unique index if not exists calendar_attendees_partner_uq on public.calendar_attendees (event_id, partner_model, partner_id) where partner_id is not null;
create index if not exists calendar_attendees_user_idx on public.calendar_attendees (user_id) where user_id is not null;

comment on table public.calendar_attendees is
  'People invited to a calendar event: a colleague (user_id) or a customer/supplier (partner), with their answer (phase 20).';

create table if not exists public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  minutes_before integer not null check (minutes_before between 0 and 40320),
  channel text not null default 'in_app' check (channel in ('in_app', 'email')),
  created_at timestamptz not null default now(),
  unique (event_id, user_id, minutes_before, channel)
);

create index if not exists calendar_reminders_user_idx on public.calendar_reminders (user_id);

comment on table public.calendar_reminders is
  'Personal reminders before a calendar event (minutes before, in-app or e-mail) (phase 20).';

create table if not exists public.calendar_reminder_deliveries (
  reminder_id uuid not null references public.calendar_reminders (id) on delete cascade,
  occurrence_start timestamptz not null,
  delivered_at timestamptz not null default now(),
  primary key (reminder_id, occurrence_start)
);

comment on table public.calendar_reminder_deliveries is
  'Occurrences a reminder was already shown for, so each fires once per occurrence (phase 20).';

-- ── Access helpers (security definer: no RLS recursion between events and attendees) ──

create or replace function public.calendar_is_organizer(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.calendar_events e where e.id = p_event and e.organizer_id = auth.uid());
$$;

-- The user may see the event: it is public, or they organise it or are invited.
create or replace function public.calendar_can_see(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_events e
     where e.id = p_event
       and auth.uid() is not null
       and (
         e.privacy = 'public'
         or e.organizer_id = auth.uid()
         or exists (select 1 from public.calendar_attendees a where a.event_id = e.id and a.user_id = auth.uid())
       )
  );
$$;

-- Busy blocks of private events in a period (no title, place or record), for the team calendar.
-- Recurring events are returned with their rule; the client expands them.
create or replace function public.calendar_busy(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, start_at timestamptz, end_at timestamptz, all_day boolean, recurrence text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, e.start_at, e.end_at, e.all_day, e.recurrence
    from public.calendar_events e
    cross join lateral (
      select e.organizer_id as user_id
      union
      select a.user_id from public.calendar_attendees a where a.event_id = e.id and a.user_id is not null and a.response <> 'declined'
    ) p
   where auth.uid() is not null
     and e.privacy = 'private'
     and p.user_id is not null
     and e.start_at < p_to
     and (e.recurrence is not null or e.end_at >= p_from);
$$;

-- ── Triggers ───────────────────────────────────────────────────────────────

-- The organizer and creation time never change; updated_at moves.
create or replace function public.calendar_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.organizer_id := old.organizer_id;
    new.created_at := old.created_at;
    new.activity_id := old.activity_id;
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_guard on public.calendar_events;
create trigger calendar_events_guard before insert or update on public.calendar_events
  for each row execute function public.calendar_events_guard();

-- An attendee may only change their answer; who and which event stay.
create or replace function public.calendar_attendees_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.event_id := old.event_id;
  new.user_id := old.user_id;
  new.partner_model := old.partner_model;
  new.partner_id := old.partner_id;
  new.created_at := old.created_at;
  if not public.calendar_is_organizer(old.event_id) and not public.is_admin() then
    new.display_name := old.display_name;
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_attendees_guard on public.calendar_attendees;
create trigger calendar_attendees_guard before update on public.calendar_attendees
  for each row execute function public.calendar_attendees_guard();

-- Meeting activities keep an event: created with the activity (all day on its due date, the
-- assignee invited), title and day follow the activity (a time set in the calendar is kept),
-- a new assignee is invited. Runs as the table owner so the event exists whatever the user
-- may write; the event belongs to the activity's creator.
create or replace function public.calendar_sync_meeting_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_meeting boolean;
  v_event public.calendar_events;
  v_day_start timestamptz := (new.due_date::timestamp) at time zone 'UTC';
begin
  select exists (
    select 1 from public.activity_types t where t.code = new.activity_type and (t.code = 'meeting' or t.icon = 'meeting')
  ) into v_is_meeting;
  if not v_is_meeting then
    return null;
  end if;

  select * into v_event from public.calendar_events e where e.activity_id = new.id;
  if v_event.id is null then
    insert into public.calendar_events (title, start_at, end_at, all_day, description, organizer_id, res_model, res_id, activity_id)
    values (new.summary, v_day_start, v_day_start, true, new.note, new.created_by, new.res_model, new.res_id, new.id)
    returning * into v_event;
  elsif tg_op = 'UPDATE' and (new.summary is distinct from old.summary or new.due_date is distinct from old.due_date) then
    update public.calendar_events e
       set title = new.summary,
           start_at = case when e.all_day then v_day_start else e.start_at + (new.due_date - (e.start_at at time zone 'UTC')::date) * interval '1 day' end,
           end_at = case when e.all_day then v_day_start + (e.end_at - e.start_at) else e.end_at + (new.due_date - (e.start_at at time zone 'UTC')::date) * interval '1 day' end
     where e.id = v_event.id;
  end if;

  if new.assigned_to is not null and new.assigned_to is distinct from v_event.organizer_id then
    insert into public.calendar_attendees (event_id, user_id, response)
    values (v_event.id, new.assigned_to, 'needs_action')
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists calendar_sync_meeting_activity on public.activities;
create trigger calendar_sync_meeting_activity after insert or update of activity_type, summary, due_date, assigned_to on public.activities
  for each row execute function public.calendar_sync_meeting_activity();

-- ── Row level security ─────────────────────────────────────────────────────

alter table public.calendar_events enable row level security;

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (privacy = 'public' or organizer_id = auth.uid() or public.calendar_can_see(id));

-- Users create events as themselves; a link to a record needs read access to that record.
drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events
  for insert to authenticated
  with check (
    organizer_id = auth.uid()
    and activity_id is null
    and (res_model is null or public.chatter_record_visible(res_model, res_id))
  );

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events
  for update to authenticated
  using (organizer_id = auth.uid() or public.is_admin())
  with check (res_model is null or public.chatter_record_visible(res_model, res_id));

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events
  for delete to authenticated
  using (organizer_id = auth.uid() or public.is_admin());

alter table public.calendar_attendees enable row level security;

drop policy if exists calendar_attendees_select on public.calendar_attendees;
create policy calendar_attendees_select on public.calendar_attendees
  for select to authenticated
  using (public.calendar_can_see(event_id));

drop policy if exists calendar_attendees_insert on public.calendar_attendees;
create policy calendar_attendees_insert on public.calendar_attendees
  for insert to authenticated
  with check (public.calendar_is_organizer(event_id) or public.is_admin());

-- The organizer edits the list; an attendee answers for themselves (the guard keeps the rest).
drop policy if exists calendar_attendees_update on public.calendar_attendees;
create policy calendar_attendees_update on public.calendar_attendees
  for update to authenticated
  using (user_id = auth.uid() or public.calendar_is_organizer(event_id) or public.is_admin())
  with check (user_id = auth.uid() or public.calendar_is_organizer(event_id) or public.is_admin());

drop policy if exists calendar_attendees_delete on public.calendar_attendees;
create policy calendar_attendees_delete on public.calendar_attendees
  for delete to authenticated
  using (public.calendar_is_organizer(event_id) or public.is_admin());

alter table public.calendar_reminders enable row level security;

drop policy if exists calendar_reminders_own on public.calendar_reminders;
create policy calendar_reminders_own on public.calendar_reminders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.calendar_can_see(event_id));

alter table public.calendar_reminder_deliveries enable row level security;

drop policy if exists calendar_reminder_deliveries_own on public.calendar_reminder_deliveries;
create policy calendar_reminder_deliveries_own on public.calendar_reminder_deliveries
  for all to authenticated
  using (exists (select 1 from public.calendar_reminders r where r.id = reminder_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.calendar_reminders r where r.id = reminder_id and r.user_id = auth.uid()));

revoke all on table public.calendar_events, public.calendar_attendees, public.calendar_reminders, public.calendar_reminder_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_events, public.calendar_attendees, public.calendar_reminders to authenticated;
grant select, insert, delete on table public.calendar_reminder_deliveries to authenticated;
grant all on table public.calendar_events, public.calendar_attendees, public.calendar_reminders, public.calendar_reminder_deliveries to service_role;
revoke all on function public.calendar_is_organizer(uuid), public.calendar_can_see(uuid), public.calendar_busy(timestamptz, timestamptz) from public, anon;
grant execute on function public.calendar_is_organizer(uuid), public.calendar_can_see(uuid), public.calendar_busy(timestamptz, timestamptz) to authenticated;
