"use client";

import React, { useId, useRef } from "react";
import { rovingIndex } from "../logic";

/** Most tabs in one row (NAV-5); more parts of a record belong in sections, not tabs. */
export const MAX_TABS = 6;

export interface TabItem {
  id: string;
  label: string;
  /** Small count after the label (e.g. lines, unread). */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  /** The parts of one record or report (NAV-5), at most MAX_TABS. */
  items: readonly TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  /** aria-label of the tab list. */
  label: string;
  /** Content of the selected tab (rendered in its tabpanel). */
  children?: React.ReactNode;
  className?: string;
}

function isRtl(el: HTMLElement | null): boolean {
  return !!el && getComputedStyle(el).direction === "rtl";
}

function useRoving(count: number, disabled: readonly boolean[], current: number, select: (i: number) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const next = rovingIndex(current, event.key, disabled, isRtl(event.currentTarget));
    if (next === null || next < 0 || next >= count) return;
    event.preventDefault();
    select(next);
    refs.current[next]?.focus();
  };
  return { refs, onKeyDown };
}

/**
 * In-page tabs (NAV-5, ARIA APG tabs with automatic activation): one row, underline style,
 * arrow keys / Home / End move and select, only the selected tab is in the tab order. Tabs switch
 * between parts of one thing; sibling pages belong in the app side menu.
 */
export function Tabs({ items, value, onValueChange, label, children, className }: TabsProps) {
  const base = useId();
  if (process.env.NODE_ENV !== "production" && items.length > MAX_TABS) {
    console.warn(`Tabs: ${items.length} tabs, at most ${MAX_TABS} (docs/ui-standard.md NAV-5).`);
  }
  const current = Math.max(0, items.findIndex((i) => i.id === value));
  const disabled = items.map((i) => !!i.disabled);
  const { refs, onKeyDown } = useRoving(items.length, disabled, current, (i) => onValueChange(items[i].id));
  const selected = items[current];

  return (
    <div className={["ds-tabs", className].filter(Boolean).join(" ")}>
      <div role="tablist" aria-label={label} className="ds-tabs-list" onKeyDown={onKeyDown}>
        {items.map((item, i) => {
          const active = i === current;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel`}
              tabIndex={active ? 0 : -1}
              disabled={item.disabled}
              className="ds-tabs-tab"
              onClick={() => onValueChange(item.id)}
            >
              <span className="truncate">{item.label}</span>
              {item.count !== undefined ? <span className="ds-tabs-count">{item.count}</span> : null}
            </button>
          );
        })}
      </div>
      {children !== undefined && selected ? (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${selected.id}`} tabIndex={0} className="ds-tabs-panel">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface SegmentOption {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  /** 2–4 options that filter one view (e.g. "My calendar / Team"). */
  options: readonly SegmentOption[];
  value: string;
  onValueChange: (id: string) => void;
  /** aria-label of the group. */
  label: string;
  size?: "md" | "sm";
  className?: string;
}

/**
 * Segmented control (NAV-5): a radio group drawn as joined buttons; arrow keys move and select,
 * only the selected option is in the tab order.
 */
export function SegmentedControl({ options, value, onValueChange, label, size = "md", className }: SegmentedControlProps) {
  const current = Math.max(0, options.findIndex((o) => o.id === value));
  const disabled = options.map((o) => !!o.disabled);
  const { refs, onKeyDown } = useRoving(options.length, disabled, current, (i) => onValueChange(options[i].id));
  return (
    <div role="radiogroup" aria-label={label} className={["ds-segmented", className].filter(Boolean).join(" ")} data-size={size} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const active = i === current;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            className="ds-segmented-option"
            onClick={() => onValueChange(o.id)}
          >
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
