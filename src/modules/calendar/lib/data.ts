"use client";

/**
 * Calendar data (phase 20) on TanStack Query, through the browser Supabase client with the user's
 * session: row level security decides which events each user sees and may change.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import type { CalendarAttendee, CalendarEventRow, EventValue } from "./calendar";

// The generated database types do not know the calendar tables yet.
const db = typedClient as unknown as SupabaseClient;

const EVENT_SELECT =
  "id, title, start_at, end_at, all_day, location, description, organizer_id, recurrence, privacy, res_model, res_id, activity_id, " +
  "calendar_attendees (id, user_id, partner_model, partner_id, display_name, response), " +
  "calendar_reminders (id, user_id, minutes_before, channel)";

export const calendarKeys = {
  all: ["calendar"] as const,
  events: (from: string, to: string) => ["calendar", "events", from, to] as const,
  busy: (from: string, to: string) => ["calendar", "busy", from, to] as const,
  event: (id: string) => ["calendar", "event", id] as const,
  deliveries: (userId: string) => ["calendar", "deliveries", userId] as const,
};

type Result = PromiseLike<{ error: { message: string } | null }>;
async function check(result: Result): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(error.message);
}

/** Events that may show in [from, to): starting before `to`, and ending after `from` or recurring. */
export async function fetchEvents(from: Date, to: Date): Promise<CalendarEventRow[]> {
  const { data, error } = await db
    .from("calendar_events")
    .select(EVENT_SELECT)
    .lt("start_at", to.toISOString())
    .or(`recurrence.not.is.null,end_at.gte.${from.toISOString()}`)
    .order("start_at")
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CalendarEventRow[];
}

export function useCalendarEvents(from: Date, to: Date, enabled = true) {
  return useQuery({
    queryKey: calendarKeys.events(from.toISOString(), to.toISOString()),
    enabled,
    queryFn: () => fetchEvents(from, to),
  });
}

/** Busy blocks of colleagues' private events (no titles), for the team calendar. */
export function useBusy(from: Date, to: Date, enabled: boolean) {
  return useQuery({
    queryKey: calendarKeys.busy(from.toISOString(), to.toISOString()),
    enabled,
    queryFn: async () => {
      const { data, error } = await db.rpc("calendar_busy", { p_from: from.toISOString(), p_to: to.toISOString() });
      if (error) throw new Error(error.message);
      return (data ?? []) as { user_id: string; start_at: string; end_at: string; all_day: boolean; recurrence: string | null }[];
    },
  });
}

export function useCalendarEvent(id: string | null) {
  return useQuery({
    queryKey: calendarKeys.event(id ?? ""),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db.from("calendar_events").select(EVENT_SELECT).eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as CalendarEventRow | null;
    },
  });
}

/** The customer or supplier of a record, to invite them to a meeting about it. */
export async function recordPartner(model: string, id: string): Promise<{ partner_model: "customers" | "suppliers"; partner_id: string; display_name: string } | null> {
  const one = async (table: string, select: string) => {
    const { data, error } = await db.from(table).select(select).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as Record<string, unknown> | null;
  };
  const customer = async (customerId: unknown) => {
    if (typeof customerId !== "string") return null;
    const { data } = await db.from("customers").select("id, full_name").eq("id", customerId).maybeSingle();
    const row = data as { id: string; full_name: string | null } | null;
    return row ? { partner_model: "customers" as const, partner_id: row.id, display_name: row.full_name ?? "" } : null;
  };
  if (model === "customers") return customer(id);
  if (model === "deals") return customer((await one("deals", "client_id"))?.client_id);
  if (model === "sales") return customer((await one("sales", "customer_id"))?.customer_id);
  if (model === "suppliers" || model === "purchases") {
    const supplierId = model === "suppliers" ? id : (await one("purchases", "supplier_id"))?.supplier_id;
    if (typeof supplierId !== "string") return null;
    const { data } = await db.from("suppliers").select("id, full_name").eq("id", supplierId).maybeSingle();
    const row = data as { id: string; full_name: string | null } | null;
    return row ? { partner_model: "suppliers", partner_id: row.id, display_name: row.full_name ?? "" } : null;
  }
  return null;
}

export interface EventSave {
  value: EventValue & { res_model?: string | null; res_id?: string | null };
  /** Colleagues to invite (user ids), the organizer excluded. */
  users: string[];
  partner: { partner_model: "customers" | "suppliers"; partner_id: string; display_name: string } | null;
  /** The organizer's own in-app reminders, minutes before. */
  reminders: number[];
}

/** Makes the attendee list and the user's reminders match the form (adds and removes). */
async function syncPeople(eventId: string, userId: string, save: Omit<EventSave, "value">, current: { attendees: CalendarAttendee[]; reminders: { id: string; user_id: string; minutes_before: number; channel: string }[] }) {
  const wantUsers = new Set(save.users.filter((u) => u !== userId));
  const haveUsers = current.attendees.filter((a) => a.user_id);
  const removeIds = [
    ...haveUsers.filter((a) => !wantUsers.has(a.user_id!)).map((a) => a.id),
    ...current.attendees.filter((a) => a.partner_id && !(save.partner && save.partner.partner_id === a.partner_id && save.partner.partner_model === a.partner_model)).map((a) => a.id),
  ];
  if (removeIds.length) await check(db.from("calendar_attendees").delete().in("id", removeIds));
  const addUsers = [...wantUsers].filter((u) => !haveUsers.some((a) => a.user_id === u));
  const rows: Record<string, unknown>[] = addUsers.map((user_id) => ({ event_id: eventId, user_id }));
  if (save.partner && !current.attendees.some((a) => a.partner_id === save.partner!.partner_id && a.partner_model === save.partner!.partner_model)) {
    rows.push({ event_id: eventId, ...save.partner });
  }
  if (rows.length) await check(db.from("calendar_attendees").insert(rows));

  const mine = current.reminders.filter((r) => r.user_id === userId && r.channel === "in_app");
  const want = new Set(save.reminders);
  const drop = mine.filter((r) => !want.has(r.minutes_before)).map((r) => r.id);
  if (drop.length) await check(db.from("calendar_reminders").delete().in("id", drop));
  const add = [...want].filter((m) => !mine.some((r) => r.minutes_before === m)).map((minutes_before) => ({ event_id: eventId, minutes_before, channel: "in_app" }));
  if (add.length) await check(db.from("calendar_reminders").insert(add));
}

export function useCalendarActions(userId: string | null) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: calendarKeys.all });
  const create = useMutation({
    mutationFn: async (save: EventSave): Promise<string> => {
      if (!userId) throw new Error("not signed in");
      const { data, error } = await db.from("calendar_events").insert({ ...save.value, organizer_id: userId }).select("id").single();
      if (error) throw new Error(error.message);
      const id = (data as { id: string }).id;
      await syncPeople(id, userId, save, { attendees: [], reminders: [] });
      return id;
    },
    onSettled,
  });
  const update = useMutation({
    mutationFn: async ({ event, save }: { event: CalendarEventRow; save: EventSave }) => {
      if (!userId) throw new Error("not signed in");
      await check(db.from("calendar_events").update(save.value).eq("id", event.id));
      await syncPeople(event.id, userId, save, { attendees: event.calendar_attendees ?? [], reminders: event.calendar_reminders ?? [] });
    },
    onSettled,
  });
  const remove = useMutation({ mutationFn: (id: string) => check(db.from("calendar_events").delete().eq("id", id)), onSettled });
  const respond = useMutation({
    mutationFn: (v: { attendeeId: string; response: CalendarAttendee["response"] }) => check(db.from("calendar_attendees").update({ response: v.response }).eq("id", v.attendeeId)),
    onSettled,
  });
  /** Reminders only (an attendee sets their own on someone else's event). */
  const setReminders = useMutation({
    mutationFn: async ({ event, minutes }: { event: CalendarEventRow; minutes: number[] }) => {
      if (!userId) throw new Error("not signed in");
      const mine = (event.calendar_reminders ?? []).filter((r) => r.user_id === userId && r.channel === "in_app");
      const drop = mine.filter((r) => !minutes.includes(r.minutes_before)).map((r) => r.id);
      if (drop.length) await check(db.from("calendar_reminders").delete().in("id", drop));
      const add = minutes.filter((m) => !mine.some((r) => r.minutes_before === m)).map((minutes_before) => ({ event_id: event.id, minutes_before, channel: "in_app" }));
      if (add.length) await check(db.from("calendar_reminders").insert(add));
    },
    onSettled,
  });
  return { create, update, remove, respond, setReminders };
}

/**
 * After the chatter scheduled a meeting activity, the database created its event (all day). This
 * sets the time, colleagues, the record's customer and the reminder chosen in the chatter.
 */
export async function planMeetingEvent(activityId: string, userId: string, plan: { value: EventValue; users: string[]; partner: EventSave["partner"]; reminders: number[] }): Promise<void> {
  const { data, error } = await db.from("calendar_events").select(EVENT_SELECT).eq("activity_id", activityId).maybeSingle();
  if (error) throw new Error(error.message);
  const event = data as unknown as CalendarEventRow | null;
  if (!event) return;
  const { title, start_at, end_at, all_day, location, privacy } = plan.value;
  await check(db.from("calendar_events").update({ title, start_at, end_at, all_day, location, privacy }).eq("id", event.id));
  await syncPeople(event.id, userId, { users: plan.users, partner: plan.partner, reminders: plan.reminders }, { attendees: event.calendar_attendees ?? [], reminders: event.calendar_reminders ?? [] });
}

/** Occurrences the user's reminders were already shown for ("reminderId|ISO"). */
export function useDeliveries(userId: string | null) {
  return useQuery({
    queryKey: calendarKeys.deliveries(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const { data, error } = await db.from("calendar_reminder_deliveries").select("reminder_id, occurrence_start").gte("occurrence_start", since).limit(1000);
      if (error) throw new Error(error.message);
      return new Set(((data ?? []) as { reminder_id: string; occurrence_start: string }[]).map((d) => `${d.reminder_id}|${new Date(d.occurrence_start).toISOString()}`));
    },
  });
}

export async function markDelivered(reminderId: string, occurrenceStart: string): Promise<void> {
  const { error } = await db.from("calendar_reminder_deliveries").insert({ reminder_id: reminderId, occurrence_start: occurrenceStart });
  // Already shown in another tab: fine.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}
