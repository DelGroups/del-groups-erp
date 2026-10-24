/**
 * Calendar on the view engine (phase 20): occurrences of events (recurring ones expanded, busy
 * blocks of colleagues' private events) as records, coloured by person. Calendar first, list
 * second. Pure: the screen brings the records (lib/calendar.ts toCalendarRecords).
 */
import type { ViewDefinition } from "../../../views/types";
import { userColor, type CalendarRecord } from "../lib/calendar";

export const CALENDAR_VIEW_KEY = "calendar.events";

export function calendarDefinition(): ViewDefinition<CalendarRecord> {
  return {
    model: {
      key: CALENDAR_VIEW_KEY,
      table: "calendar_events",
      module: "calendar",
      readPermission: "can_view_dashboard",
      writePermission: "can_view_dashboard",
      select: "*",
      order: { field: "start_at", dir: "asc" },
      toRecord: (row) => row as CalendarRecord,
    },
    titleKey: "calendar.title",
    fields: [
      { name: "title", labelKey: "calendar.fields.title", type: "char", searchable: true, readonly: true },
      { name: "start_at", labelKey: "calendar.fields.start", type: "datetime", readonly: true },
      { name: "end_at", labelKey: "calendar.fields.end", type: "datetime", readonly: true },
      { name: "all_day", labelKey: "calendar.fields.allDay", type: "boolean", readonly: true },
      { name: "location", labelKey: "calendar.fields.location", type: "char", searchable: true, readonly: true },
      { name: "organizer_id", labelKey: "calendar.fields.organizer", type: "many2one", displayField: "organizer_name", groupable: true, readonly: true },
      { name: "attendee_count", labelKey: "calendar.fields.attendees", type: "integer", readonly: true },
      {
        name: "privacy",
        labelKey: "calendar.fields.privacy",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "public", labelKey: "calendar.privacy.public" },
          { value: "private", labelKey: "calendar.privacy.private" },
        ],
      },
      { name: "recurring", labelKey: "calendar.fields.recurring", type: "boolean", readonly: true },
    ],
    filters: [
      { key: "upcoming", labelKey: "calendar.filters.upcoming", group: "when", conditions: (ctx) => [{ field: "start_at", op: "gte", value: ctx.now.toISOString() }] },
      { key: "private", labelKey: "calendar.filters.private", group: "privacy", conditions: () => [{ field: "privacy", op: "eq", value: "private" }] },
    ],
    groupBys: ["organizer_id", "privacy", "start_at:week"],
    defaultSort: { field: "start_at", dir: "asc" },
    views: ["calendar", "list"],
    list: { columns: ["title", "start_at", "end_at", "location", "organizer_id", "attendee_count", "privacy"] },
    form: { title: "title", fields: ["start_at", "end_at", "all_day", "location", "organizer_id", "privacy"] },
    calendar: {
      dateField: "start_at",
      endField: "end_at",
      title: "title",
      allDayField: "all_day",
      colorOf: (r) => userColor((r as CalendarRecord).owner_id),
      defaultMinutes: 60,
    },
  };
}
