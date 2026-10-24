/**
 * Public API of the Calendar module (phase 20) for other parts of the app: the chatter plans a
 * meeting's event, the new shell shows reminders.
 */
export { planMeetingEvent, recordPartner } from "./lib/data";
export { checkEvent, REMINDER_CHOICES, type EventInput, type EventValue } from "./lib/calendar";
export { ReminderAlerts } from "./components/ReminderAlerts";
