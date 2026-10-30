"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion, useReducedMotion } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { AZ_WEEKDAYS_SHORT, dateFormat } from "@/lib/dates/localeDate";
import { motionPreset, panelVariants } from "../motion";
import {
  addDays,
  addMonths,
  isoToDateText,
  isoToDateTimeText,
  maskDateText,
  maskDateTimeText,
  monthMatrix,
  parseDateText,
  parseDateTimeText,
  toIsoDate,
} from "../dateInput";
import { useDesignScope } from "./DesignScope";
import { IconButton } from "./IconButton";

export interface DateFieldLabels {
  /** Placeholder of the typed text, e.g. "gg.aa.iiii". */
  placeholder: string;
  openCalendar: string;
  previousMonth: string;
  nextMonth: string;
  today: string;
  clear: string;
}

export type ControlWidth = "xs" | "sm" | "md" | "lg" | "full";

interface BaseProps {
  /** ISO value: "yyyy-mm-dd" (DateField) or "yyyy-mm-ddTHH:mm" (DateTimeField); null when empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  locale: string;
  labels: DateFieldLabels;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  width?: ControlWidth;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

const WIDTH: Record<ControlWidth, string> = { xs: "var(--ds-w-xs)", sm: "var(--ds-w-sm)", md: "var(--ds-w-md)", lg: "var(--ds-w-lg)", full: "100%" };

/** Inline width of a control (beats every class rule, so an explicit width always wins). */
export function controlWidthStyle(width: ControlWidth | undefined): React.CSSProperties | undefined {
  return width ? { width: WIDTH[width] } : undefined;
}

/** Date typed as dd.mm.yyyy (masked) or picked in a calendar; the value stays ISO yyyy-mm-dd. */
export function DateField(props: BaseProps) {
  return <DateControl {...props} withTime={false} />;
}

/** Date and time typed as dd.mm.yyyy HH:mm; the value stays "yyyy-mm-ddTHH:mm" (local time). */
export function DateTimeField(props: BaseProps) {
  return <DateControl {...props} withTime />;
}

const toText = (value: string | null, withTime: boolean) => (withTime ? isoToDateTimeText(value) : isoToDateText(value));

function DateControl({ value, onChange, locale, labels, id, disabled, invalid, required, width, className, withTime, ...aria }: BaseProps & { withTime: boolean }) {
  const [text, setText] = useState(() => toText(value, withTime));
  const [shown, setShown] = useState(value);
  const [badText, setBadText] = useState(false);
  const [open, setOpen] = useState(false);
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  // A new value from outside (reset, another field) replaces what is typed.
  if (value !== shown) {
    setShown(value);
    setText(toText(value, withTime));
    setBadText(false);
  }
  const parse = withTime ? parseDateTimeText : parseDateText;

  const type = (raw: string) => {
    const masked = withTime ? maskDateTimeText(raw) : maskDateText(raw);
    setText(masked);
    setBadText(false);
    if (!masked.trim()) {
      setShown(null);
      onChange(null);
      return;
    }
    const parsed = parse(masked);
    if (parsed && parsed !== value) {
      setShown(parsed);
      onChange(parsed);
    }
  };
  const pick = (iso: string) => {
    const next = withTime ? `${iso}T${value?.slice(11, 16) || "00:00"}` : iso;
    setShown(next);
    setText(toText(next, withTime));
    setBadText(false);
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          className={["ds-control", withTime ? "ds-datetime-field" : "ds-date-field", className].filter(Boolean).join(" ")}
          style={controlWidthStyle(width)}
          data-invalid={invalid || badText ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
        >
          <input
            id={id}
            className="ds-control-input ds-mono"
            inputMode="numeric"
            autoComplete="off"
            placeholder={withTime ? `${labels.placeholder} --:--` : labels.placeholder}
            value={text}
            disabled={disabled}
            aria-invalid={invalid || badText || undefined}
            aria-required={required || undefined}
            aria-label={aria["aria-label"]}
            aria-describedby={aria["aria-describedby"]}
            onChange={(e) => type(e.target.value)}
            onBlur={() => setBadText(!!text.trim() && !parse(text))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && e.altKey) {
                e.preventDefault();
                setOpen(true);
              }
            }}
          />
          <Popover.Trigger asChild disabled={disabled}>
            <IconButton size="sm" label={labels.openCalendar} icon={<CalendarDays className="h-4 w-4" />} disabled={disabled} />
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="z-[70] outline-none">
          <motion.div className="ds-menu ds-calendar" initial="initial" animate="enter" variants={motionPreset(panelVariants, reduced)}>
            <Calendar value={value?.slice(0, 10) ?? null} locale={locale} labels={labels} onPick={pick} onClear={() => { setShown(null); setText(""); onChange(null); setOpen(false); }} />
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Mon … Sun short names in the language (az from our table: no ICU data needed). */
function weekdayNames(locale: string): string[] {
  if (/^az/i.test(locale)) return [...AZ_WEEKDAYS_SHORT.slice(1), AZ_WEEKDAYS_SHORT[0]];
  const f = dateFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 9, 5 + i))); // 5 Oct 2026 is a Monday
}

function Calendar({ value, locale, labels, onPick, onClear }: { value: string | null; locale: string; labels: DateFieldLabels; onPick: (iso: string) => void; onClear: () => void }) {
  const today = toIsoDate(new Date());
  const [focused, setFocused] = useState(value ?? today);
  const grid = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [y, m] = focused.split("-").map(Number);
  const weeks = monthMatrix(y, m - 1);
  const heading = dateFormat(locale, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  const names = weekdayNames(locale);

  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`button[data-iso="${focused}"]`)?.focus();
  }, [focused]);

  const onKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, e.shiftKey ? 12 : 1),
      Home: () => addDays(focused, -((new Date(y, m - 1, Number(focused.slice(8))).getDay() + 6) % 7)),
      End: () => addDays(focused, 6 - ((new Date(y, m - 1, Number(focused.slice(8))).getDay() + 6) % 7)),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setFocused(move());
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <IconButton size="sm" label={labels.previousMonth} icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setFocused(addMonths(focused, -1))} />
        <p id={headingId} className="min-w-0 flex-1 truncate text-center text-[length:var(--ds-text-sm)] font-semibold" aria-live="polite">
          {heading}
        </p>
        <IconButton size="sm" label={labels.nextMonth} icon={<ChevronRight className="h-4 w-4" />} onClick={() => setFocused(addMonths(focused, 1))} />
      </div>
      <div ref={grid} role="grid" aria-labelledby={headingId} onKeyDown={onKey} className="ds-calendar-grid">
        <div role="row" className="contents">
          {names.map((n) => (
            <span key={n} role="columnheader" className="ds-calendar-weekday">
              {n}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0].iso} className="contents">
            {week.map((d) => (
              <span role="gridcell" key={d.iso} aria-selected={d.iso === value}>
                <button
                  type="button"
                  data-iso={d.iso}
                  tabIndex={d.iso === focused ? 0 : -1}
                  className="ds-calendar-day"
                  data-outside={d.inMonth ? undefined : ""}
                  data-today={d.iso === today ? "" : undefined}
                  data-selected={d.iso === value ? "" : undefined}
                  aria-label={isoToDateText(d.iso)}
                  onClick={() => onPick(d.iso)}
                >
                  {d.day}
                </button>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={onClear}>
          {labels.clear}
        </button>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => onPick(today)}>
          {labels.today}
        </button>
      </div>
    </div>
  );
}
