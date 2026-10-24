"use client";

import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { CalendarClock } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useDesignScope } from "@/design-system/components";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useMyDueTasks } from "@/modules/todo";
import { useActivityTypes, useMyActivities, useNow } from "@/views/chatter/data";
import { activityState, activityTypeLabel, counts, recordHref, type ActivityState } from "@/views/chatter/logic";
import { markShellNavigation } from "./useShell";

/** Marks a to-do task in the merged list (not an activity type code). */
const TASK_TYPE = "__todo_task";

const STATE_COLOR: Record<ActivityState, string> = { overdue: "var(--ds-danger-strong)", today: "var(--ds-warning)", planned: "var(--ds-success)", done: "var(--ds-text-subtle)" };

/**
 * "My activities" in the new shell's top bar (phase 19): open activities assigned to the user,
 * and (phase 22) the user's open to-do tasks with a due date, with overdue / today / planned
 * counts, each linking to its record where the record has a screen in the new UI. Row level
 * security limits the list to records the user can read.
 */
export function MyActivitiesButton() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { portalContainer } = useDesignScope();
  const now = useNow();
  const { isEnabled } = useEnabledModules();
  const mine = useMyActivities(user?.id ?? null);
  const tasks = useMyDueTasks(user?.id ?? null, isEnabled("todo"));
  const types = useActivityTypes().data ?? [];
  const list = [
    ...(mine.data ?? []),
    ...(tasks.data ?? []).map((task) => ({ id: `task-${task.id}`, activity_type: TASK_TYPE, summary: task.title, due_date: task.due_date, done_at: null, res_model: "todo_tasks", res_id: task.id })),
  ].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const c = counts(list, now);
  const urgent = c.overdue + c.today;
  const label = t("views.chatter.mine.button", { overdue: c.overdue, today: c.today, planned: c.planned });
  return (
    <Popover.Root>
      <Popover.Trigger className="ds-icon-btn relative" aria-label={label}>
        <CalendarClock className="h-5 w-5" aria-hidden />
        {urgent ? (
          <span
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold"
            style={{ background: c.overdue ? "var(--ds-danger-strong)" : "var(--ds-warning)", color: "var(--ds-on-brand, #fff)" }}
            aria-hidden
          >
            {urgent > 99 ? "99+" : urgent}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content align="end" sideOffset={8} className="ds-menu w-80 p-2">
          <p className="px-2 pb-1 pt-1 font-semibold">{t("views.chatter.mine.title")}</p>
          <p className="flex gap-2 px-2 pb-2 text-[length:var(--ds-text-xs)]">
            {(["overdue", "today", "planned"] as const).map((s) => (
              <span key={s} style={{ color: STATE_COLOR[s] }}>
                {t(`views.chatter.mine.${s}`, { count: c[s] })}
              </span>
            ))}
          </p>
          {mine.isLoading ? (
            <p className="px-2 py-3 ds-muted">{t("common.loading")}</p>
          ) : list.length ? (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {list.map((a) => {
                const state = activityState(a, now);
                const href = recordHref(a.res_model, a.res_id);
                const body = (
                  <>
                    <span className="block truncate font-medium">{a.summary}</span>
                    <span className="block text-[length:var(--ds-text-xs)]">
                      <span style={{ color: STATE_COLOR[state] }}>{a.due_date}</span>
                      <span className="ds-muted">{a.activity_type === TASK_TYPE ? ` · ${t("todo.task")}` : ` · ${activityTypeLabel(a.activity_type, types, t)} · ${t(`views.chatter.models.${a.res_model}`)}`}</span>
                    </span>
                  </>
                );
                return (
                  <li key={a.id}>
                    {href ? (
                      <Popover.Close asChild>
                        <Link href={href} onClick={markShellNavigation} className="block rounded-[var(--ds-radius-sm)] p-2 hover:bg-[color:var(--ds-surface-sunken)]">
                          {body}
                        </Link>
                      </Popover.Close>
                    ) : (
                      <div className="p-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-4 text-center ds-muted">{t("views.chatter.mine.empty")}</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
