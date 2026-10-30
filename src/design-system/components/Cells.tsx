"use client";

import React from "react";
import { formatFigure, formatGridDate, formatGridDateTime, formatLongDate, formatMoney, formatQuantity, type DateValue } from "@/lib/dates/localeDate";
import { Truncate } from "./Truncate";

/*
 * Chips and table cells of the UI standard (UI-1, docs/ui-standard.md): one line, never wrapped.
 * Numbers right-aligned with tabular figures; formatting only from src/lib/dates/localeDate.ts.
 */

export type ChipTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

/** Status pill: one line, centred, ellipsis past --ds-chip-max with the full text in a tooltip. */
export function Chip({ tone = "neutral", icon, children, className }: { tone?: ChipTone; icon?: React.ReactNode; children: string; className?: string }) {
  return (
    <span className={["ds-chip ds-chip-std", className].filter(Boolean).join(" ")} data-tone={tone}>
      {icon ? (
        <span aria-hidden className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      <Truncate>{children}</Truncate>
    </span>
  );
}

const EMPTY = "—";

/** Amount with two decimals and the currency code, right-aligned. */
export function MoneyCell({ value, locale, currency = "AZN", decimals = 2, className }: { value: number | null | undefined; locale: string; currency?: string | null; decimals?: number; className?: string }) {
  return (
    <span className={["ds-num-cell", className].filter(Boolean).join(" ")} data-ui-check="single-line">
      {formatMoney(value, locale, { currency, decimals, empty: EMPTY })}
    </span>
  );
}

/**
 * Number, right-aligned. `decimals` fixes the decimals (2 → 1.234,50); without it, quantities
 * keep up to three decimals and drop trailing zeros (12 · 12,5).
 */
export function NumberCell({ value, locale, decimals, unit, className }: { value: number | null | undefined; locale: string; decimals?: number; unit?: string; className?: string }) {
  const text =
    value === null || value === undefined || !Number.isFinite(Number(value))
      ? EMPTY
      : decimals === undefined
        ? formatQuantity(value, locale)
        : formatFigure(Number(value), decimals, locale);
  return (
    <span className={["ds-num-cell", className].filter(Boolean).join(" ")} data-ui-check="single-line">
      {text}
      {unit && text !== EMPTY ? ` ${unit}` : null}
    </span>
  );
}

/** dd.mm.yyyy (or dd.mm.yyyy HH:mm with `time`); the long date in the tooltip. */
export function DateCell({ value, locale, time = false, timeZone, className }: { value: DateValue; locale: string; time?: boolean; timeZone?: string; className?: string }) {
  const text = time ? formatGridDateTime(value, { timeZone, empty: EMPTY }) : formatGridDate(value, { timeZone, empty: EMPTY });
  return (
    <span
      className={["ds-date-cell", className].filter(Boolean).join(" ")}
      data-ui-check="single-line"
      title={text === EMPTY ? undefined : formatLongDate(locale, value, { timeZone })}
    >
      {text}
    </span>
  );
}
