"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { GripVertical, RotateCcw } from "lucide-react";
import type { Formatter } from "@/views";
import { dropIndex, dueState, moveItem, sequenceUpdates, type TodoRecord } from "../lib/todo";

const DUE_COLOR = { overdue: "var(--ds-danger-strong)", today: "var(--ds-warning)", soon: "var(--ds-text)", later: "var(--ds-text-subtle)", none: "var(--ds-text-subtle)" } as const;

/**
 * The priority stack (reference bonus/bonus-drag-to-reorder-priority-stack, rebuilt): the user's
 * open tasks in their own order, the top one marked "Up next". Drag a row by its handle (pointer)
 * or focus the handle and move it with the arrow keys; the new position is announced and saved.
 * "Reset" restores the order the stack had when it opened.
 */
export function PriorityStack({ records, fmt, onReorder, hrefOf }: { records: readonly TodoRecord[]; fmt: Formatter; onReorder: (updates: { task_id: string; sequence: number }[]) => void; hrefOf: (r: TodoRecord) => string }) {
  const { t } = fmt;
  const open = records.filter((r) => !r.done);
  const [order, setOrder] = useState<string[] | null>(null);
  const [initial] = useState(() => open.map((r) => r.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const now = new Date();

  // The local order while dragging; otherwise the stored one.
  const ids = (order ?? open.map((r) => r.id)).filter((id) => open.some((r) => r.id === id));
  for (const r of open) if (!ids.includes(r.id)) ids.push(r.id);
  const byId = new Map(open.map((r) => [r.id, r]));
  const current = new Map(open.map((r) => [r.id, r.sequence]));

  const commit = (next: string[]) => {
    setOrder(next);
    const updates = sequenceUpdates(next, current);
    if (updates.length) onReorder(updates);
  };
  const say = (id: string, next: string[]) => setAnnounce(t("todo.stack.moved", { title: byId.get(id)?.title ?? "", rank: next.indexOf(id) + 1, count: next.length }));

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(id);
    setOrder(ids);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (dragging !== id || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-task]")].filter((el) => el.dataset.task !== id);
    const mids = rows.map((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    const without = ids.filter((x) => x !== id);
    const next = [...without];
    next.splice(dropIndex(e.clientY, mids), 0, id);
    if (next.join() !== ids.join()) setOrder(next);
  };
  const onPointerUp = (id: string) => {
    if (dragging !== id) return;
    setDragging(null);
    commit(ids);
    say(id, ids);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = ids.indexOf(id);
    const next = moveItem(ids, from, from + dir);
    if (next.join() === ids.join()) return;
    commit(next);
    say(id, next);
    requestAnimationFrame(() => handles.current.get(id)?.focus());
  };

  if (!open.length) return null;
  return (
    <section className="ds-card ds-card-pad flex max-w-2xl flex-col gap-3" aria-labelledby="todo-stack-title">
      <header className="flex items-center gap-2">
        <h2 id="todo-stack-title" className="font-semibold">
          {t("todo.stack.title")}
        </h2>
        <span className="ds-chip">{open.length}</span>
        <button type="button" className="ml-auto ds-btn ds-btn-sm ds-btn-ghost" onClick={() => commit(initial.filter((id) => byId.has(id)).concat(ids.filter((id) => !initial.includes(id))))}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          {t("todo.stack.reset")}
        </button>
      </header>
      <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("todo.stack.hint")}</p>
      <ol ref={listRef} className="flex flex-col gap-1.5">
        {ids.slice(0, 15).map((id, i) => {
          const r = byId.get(id)!;
          const due = dueState(r.due_date, now);
          return (
            <li
              key={id}
              data-task={id}
              className="flex items-center gap-2 rounded-[var(--ds-radius-md)] border p-2 transition-shadow hover:shadow-sm"
              style={{ borderColor: "var(--ds-border)", opacity: dragging === id ? 0.55 : 1, boxShadow: dragging === id ? "0 0 0 2px var(--ds-text)" : undefined }}
            >
              <button
                ref={(el) => {
                  if (el) handles.current.set(id, el);
                  else handles.current.delete(id);
                }}
                type="button"
                className="ds-icon-btn h-8 w-6 cursor-grab touch-none"
                aria-label={t("todo.stack.handle", { title: r.title, rank: i + 1 })}
                onPointerDown={(e) => onPointerDown(e, id)}
                onPointerMove={(e) => onPointerMove(e, id)}
                onPointerUp={() => onPointerUp(id)}
                onPointerCancel={() => setDragging(null)}
                onKeyDown={(e) => onKeyDown(e, id)}
              >
                <GripVertical className="h-4 w-4" aria-hidden />
              </button>
              <span className="w-7 text-right ds-mono text-[length:var(--ds-text-lg)] font-semibold" aria-hidden>
                {i + 1}
              </span>
              <Link href={hrefOf(r)} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="block truncate text-[length:var(--ds-text-xs)]" style={{ color: DUE_COLOR[due] }}>
                  {r.due_date ? t(`todo.due.${due}`, { date: r.due_date }) : r.tags || "—"}
                </span>
              </Link>
              {i === 0 ? <span className="ds-chip" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }}>{t("todo.stack.upNext")}</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}
