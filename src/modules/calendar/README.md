# Calendar module (`calendar`, phase 20)

Depends on `core`. New UI only (NEW_UI): the page `/calendar` is a 404 while NEW_UI is off, and
there is no classic sidebar item; the new shell lists it under the CRM app.

## Goal

People plan meetings with colleagues and customers, see them in their own and the team's
calendar, and get reminded. Meetings planned in a record's chatter (phase 19) become calendar
events linked to that record.

## What it does

- **Events** (`calendar_events`): title, start/end or all day, place, notes, organizer, repeat
  rule, privacy (team / private), optional link to a record (deal, customer, sale, …) or a
  meeting activity.
- **Attendees** (`calendar_attendees`): colleagues (with their answer: going / maybe / not going)
  and the record's customer or supplier.
- **Reminders** (`calendar_reminders`): per user, minutes before; shown in the new shell for
  every occurrence (`calendar_reminder_deliveries` remembers which were shown).
- **Repeat**: RRULE subset `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `COUNT`, `UNTIL`,
  `BYDAY` (weekly), expanded in `lib/recurrence.ts`.
- **Views**: day / week / month and a list on the view engine, my calendar or the team calendar,
  one colour per person; colleagues' private events show as "Busy" (no title).
- **Meeting activities**: a chatter activity of type meeting (or a type with the meeting icon)
  creates an event (database trigger); the chatter's meeting fields set the time, colleagues, the
  record's customer and a reminder.
- **ICS export** of my or the team calendar (`.ics` file, recurring events keep their rule).

## Access

- Everyone signed in sees team (public) events; private events only their organizer and invited
  colleagues, everyone else gets a busy block.
- Only the organizer (or an admin) changes or deletes an event and its attendee list.
- An attendee changes only their own answer.
- Reminders and their deliveries are personal.
- Linking an event to a record needs read access to that record.

## Acceptance (prompt 20)

A user can plan a meeting with colleagues and a customer from a CRM deal, see it in their team
calendar and get a reminder. Recurrence expansion has tests (`tests/calendar.test.mjs`); the
access rules are checked in `supabase/tests/calendar.sql` (CI).

## Out of scope

- Email reminders: stored (`channel = 'email'`), not sent. The ERP has no e-mail provider yet.
- Google / Outlook sync (a later task), invitations by e-mail to customers.
- Editing a single occurrence of a repeating event (the whole series changes).

## Approval

New behaviour stays behind NEW_UI. Database changes go through one migration
(`supabase/migrations/20261024100000_calendar.sql`) that the owner runs after review; the
control plane gets the module row through
`control-panel/supabase/migrations/20261024100000_calendar_module.sql`.
