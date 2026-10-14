"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";
import { ChevronsLeftRight, GripVertical } from "lucide-react";
import { recordLayoutId, transitions } from "@/design-system/motion";
import { displayValue, fieldLabel, fieldMap, formatNumber, kanbanColumns, kanbanKeyTarget, type Formatter } from "../logic";
import type { FieldDef, ViewDefinition, ViewRecord } from "../types";

export interface KanbanViewProps<R extends ViewRecord> {
  definition: ViewDefinition<R>;
  records: readonly R[];
  canMove: boolean;
  onMove: (record: R, value: string) => void;
  openHref: (record: R) => string;
  fmt: Formatter;
}

interface Picked {
  id: string;
  from: string;
  to: string;
}

/**
 * Kanban (reference dashboards/dashboards-kanban-board-with-drag-and-drop, rebuilt in React):
 * one column per stage with count and sum, cards dragged between columns with the mouse, or
 * with the keyboard: Space picks a card up, ←/→ (Home/End) choose the column, Space drops,
 * Esc cancels; every step is announced. Enter opens the card. Columns can be folded.
 */
export function KanbanView<R extends ViewRecord>({ definition: def, records, canMove, onMove, openHref, fmt }: KanbanViewProps<R>) {
  const kanban = def.kanban!;
  const fields = useMemo(() => fieldMap(def), [def]);
  const groupField = fields.get(kanban.groupBy)!;
  const columns = useMemo(() => kanbanColumns(records, groupField, kanban.amount, fmt), [records, groupField, kanban.amount, fmt]);
  const columnKeys = columns.map((c) => c.key);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(kanban.folded ?? []));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [announce, setAnnounce] = useState("");
  const cards = useRef(new Map<string, HTMLElement>());
  const focusAfter = useRef<string | null>(null);
  const hintId = useId();
  const router = useRouter();

  const columnLabel = (key: string) => columns.find((c) => c.key === key)?.label ?? key;
  const titleOf = (r: R) => displayValue(fields.get(kanban.title)!, r, fmt);

  useEffect(() => {
    if (!focusAfter.current) return;
    cards.current.get(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  const drop = (record: R, to: string) => {
    if (String(record[kanban.groupBy]) === to) return;
    setFolded((prev) => {
      if (!prev.has(to)) return prev;
      const next = new Set(prev);
      next.delete(to);
      return next;
    });
    onMove(record, to);
  };

  const onCardKey = (e: React.KeyboardEvent, record: R, column: string) => {
    if (e.target !== e.currentTarget) return;
    if (picked?.id === record.id) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        focusAfter.current = record.id;
        setPicked(null);
        if (picked.to !== picked.from) {
          drop(record, picked.to);
          setAnnounce(fmt.t("views.kanban.dropped", { title: titleOf(record), column: columnLabel(picked.to) }));
        } else setAnnounce(fmt.t("views.kanban.cancelled", { title: titleOf(record) }));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        focusAfter.current = record.id;
        setPicked(null);
        setAnnounce(fmt.t("views.kanban.cancelled", { title: titleOf(record) }));
        return;
      }
      const target = kanbanKeyTarget(columnKeys, picked.to, e.key);
      if (target) {
        e.preventDefault();
        focusAfter.current = record.id;
        setPicked({ ...picked, to: target });
        setAnnounce(fmt.t("views.kanban.over", { column: columnLabel(target) }));
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      router.push(openHref(record));
    } else if (e.key === " " && canMove) {
      e.preventDefault();
      setPicked({ id: record.id, from: column, to: column });
      setAnnounce(fmt.t("views.kanban.picked", { title: titleOf(record), column: columnLabel(column) }));
    }
  };

  // While a card is picked up with the keyboard, it is shown in its target column.
  const shown = columns.map((c) => {
    if (!picked) return c;
    const record = records.find((r) => r.id === picked.id);
    let list = c.records.filter((r) => r.id !== picked.id);
    if (record && c.key === picked.to) list = [...list, record];
    return { ...c, records: list };
  });

  return (
    <LayoutGroup id={`kanban-${def.model.key}`}>
      <p id={hintId} className="sr-only">
        {canMove ? fmt.t("views.kanban.hint") : fmt.t("views.kanban.hintReadOnly")}
      </p>
      <div className="sr-only" aria-live="assertive" role="status">
        {announce}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollSnapType: "x proximity" }}>
        {shown.map((column) => {
          const isFolded = folded.has(column.key) && !(picked && picked.to === column.key);
          const isOver = over === column.key || (picked?.to === column.key && picked.to !== picked.from);
          const toggleFold = () =>
            setFolded((prev) => {
              const next = new Set(prev);
              if (next.has(column.key)) next.delete(column.key);
              else next.add(column.key);
              return next;
            });
          return (
            <section
              key={column.key}
              aria-label={column.label}
              className={["flex shrink-0 flex-col rounded-[var(--ds-radius-lg)] border transition-colors", isFolded ? "w-12" : "w-72"].join(" ")}
              style={{
                scrollSnapAlign: "start",
                background: isOver ? "var(--ds-brand-soft)" : "var(--ds-surface-sunken)",
                borderColor: isOver ? "var(--ds-brand)" : "var(--ds-border)",
                boxShadow: isOver ? "0 0 0 2px var(--ds-focus-ring)" : undefined,
              }}
              onDragOver={(e) => {
                if (!canMove || !dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== column.key) setOver(column.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === column.key ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/x-record-id") || dragging;
                const record = records.find((r) => r.id === id);
                setOver(null);
                setDragging(null);
                if (record && canMove) drop(record, column.key);
              }}
            >
              <header className="flex items-center gap-2 border-t-4 px-3 pb-2 pt-2" style={{ borderTopColor: column.color ?? "var(--ds-border-strong)", borderTopLeftRadius: "var(--ds-radius-lg)", borderTopRightRadius: "var(--ds-radius-lg)" }}>
                {isFolded ? (
                  <button type="button" onClick={toggleFold} aria-expanded={false} className="flex w-full flex-col items-center gap-2" title={column.label}>
                    <ChevronsLeftRight className="h-4 w-4" aria-hidden />
                    <span className="ds-mono text-[length:var(--ds-text-xs)]">{column.records.length}</span>
                    <span className="font-semibold [writing-mode:vertical-rl]">{column.label}</span>
                  </button>
                ) : (
                  <>
                    <h2 className="truncate font-semibold">{column.label}</h2>
                    <span className="ds-chip ds-chip-flat ds-mono">{column.records.length}</span>
                    {column.sum !== null && kanban.amount ? (
                      <span className="ml-auto ds-mono ds-muted text-[length:var(--ds-text-xs)]">{formatNumber(column.sum, 0, fmt.locale)}</span>
                    ) : (
                      <span className="ml-auto" />
                    )}
                    <button type="button" onClick={toggleFold} aria-expanded className="ds-icon-btn h-7 w-7" aria-label={fmt.t("views.kanban.fold", { column: column.label })}>
                      <ChevronsLeftRight className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                )}
              </header>
              {isFolded ? null : (
                <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2" aria-label={column.label}>
                  {column.records.map((record) => (
                    <motion.li key={record.id} layout="position" layoutId={recordLayoutId(def.model.key, record.id)} transition={transitions.base}>
                      <Card
                        record={record}
                        kanbanFields={fields}
                        def={def}
                        fmt={fmt}
                        href={openHref(record)}
                        canMove={canMove}
                        dragging={dragging === record.id}
                        picked={picked?.id === record.id}
                        hintId={hintId}
                        cardRef={(el) => {
                          if (el) cards.current.set(record.id, el);
                          else cards.current.delete(record.id);
                        }}
                        onKeyDown={(e) => onCardKey(e, record, column.key)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/x-record-id", record.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging(record.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      />
                    </motion.li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

function Card<R extends ViewRecord>({
  record,
  def,
  kanbanFields: fields,
  fmt,
  href,
  canMove,
  dragging,
  picked,
  hintId,
  cardRef,
  onKeyDown,
  onDragStart,
  onDragEnd,
}: {
  record: R;
  def: ViewDefinition<R>;
  kanbanFields: Map<string, FieldDef>;
  fmt: Formatter;
  href: string;
  canMove: boolean;
  dragging: boolean;
  picked: boolean;
  hintId: string;
  cardRef: (el: HTMLElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const kanban = def.kanban!;
  const title = displayValue(fields.get(kanban.title)!, record, fmt);
  const subtitle = kanban.subtitle ? displayValue(fields.get(kanban.subtitle)!, record, fmt) : "";
  const amountField = kanban.amount ? fields.get(kanban.amount) : undefined;
  return (
    <article
      ref={cardRef}
      tabIndex={0}
      aria-roledescription={fmt.t("views.kanban.card")}
      aria-label={title}
      aria-describedby={hintId}
      draggable={canMove}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      className="ds-card group flex flex-col gap-1 p-3 outline-none focus-visible:ring-2"
      style={{
        opacity: dragging ? 0.5 : 1,
        transform: dragging || picked ? "rotate(-1.5deg)" : undefined,
        boxShadow: picked ? "0 0 0 2px var(--ds-brand), var(--ds-elevation-2)" : undefined,
        cursor: canMove ? "grab" : undefined,
      }}
    >
      <div className="flex items-start gap-1">
        <Link href={href} tabIndex={-1} className="flex-1 font-semibold leading-snug hover:underline">
          {title || "—"}
        </Link>
        {canMove ? <GripVertical className="h-4 w-4 shrink-0 opacity-40 group-hover:opacity-80" aria-hidden /> : null}
      </div>
      {subtitle ? <p className="truncate ds-muted text-[length:var(--ds-text-xs)]">{subtitle}</p> : null}
      {(kanban.fields ?? []).map((name) => {
        const f = fields.get(name);
        const text = f ? displayValue(f, record, fmt) : "";
        return text ? (
          <p key={name} className="truncate text-[length:var(--ds-text-xs)]">
            <span className="ds-muted">{fieldLabel(f!, fmt)}: </span>
            {text}
          </p>
        ) : null;
      })}
      {amountField ? <p className="mt-1 ds-mono font-semibold">{displayValue(amountField, record, fmt)}</p> : null}
    </article>
  );
}
