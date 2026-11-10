"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { motionPreset, panelVariants } from "../motion";
import { filterOptions } from "../logic";
import { useDesignScope } from "./DesignScope";
import { IconButton } from "./IconButton";
import { Truncate } from "./Truncate";
import { controlWidthStyle, type ControlWidth } from "./DateField";

export interface ComboOption {
  value: string;
  label: string;
  /** Second line / search text (a code, a phone number). */
  hint?: string;
  /** Short text at the end of the row, e.g. how many records have this value (INV-3). */
  meta?: string;
  disabled?: boolean;
}

export interface ComboboxLabels {
  placeholder: string;
  search: string;
  empty: string;
  loading: string;
  clear: string;
  /** Multiple mode: read after a picked option by screen readers ("selected"). */
  selected?: string;
}

/** Several values at once (INV-3 value filters): picking toggles and the list stays open. */
export interface ComboboxMultiple {
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** Trigger text; the number of picks is shown next to it. */
  triggerLabel: string;
}

export interface ComboboxProps {
  /** Single mode: the value and its change (leave out in multiple mode). */
  value?: string | null;
  onChange?: (value: string | null, option: ComboOption | null) => void;
  /** Multiple mode instead of value/onChange. */
  multiple?: ComboboxMultiple;
  /** Fixed options, filtered here as the user types. */
  options?: readonly ComboOption[];
  /** Options from the server for what is typed (debounced, the previous request aborted). */
  loadOptions?: (query: string, signal: AbortSignal) => Promise<ComboOption[]>;
  /** Label of the current value when it is not among the loaded options (async lookups). */
  selectedLabel?: string;
  labels: ComboboxLabels;
  locale?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  id?: string;
  width?: ControlWidth;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** Slot under the list, e.g. "+ Create “…”" (prompt UI-2); gets the typed text and a close(). */
  footer?: (ctx: { query: string; close: () => void }) => React.ReactNode;
  /** Opens the list on mount (a new line's product cell, UI-3). */
  defaultOpen?: boolean;
  /** Focuses the control on mount. */
  autoFocus?: boolean;
  /**
   * Enter in the search box before the list has loaded (a barcode scanner types and presses
   * Enter at once): return true to take the text yourself; the list then closes.
   */
  onQueryEnter?: (query: string) => boolean;
}

const DEBOUNCE_MS = 200;

/**
 * Select / lookup of the UI standard (docs/ui-standard.md: every lookup field uses Combobox).
 * Keyboard: typing on the closed control opens it and filters, arrows move, Enter picks, Esc
 * closes. Fixed or async options, an empty state, a clear button and an optional footer slot.
 */
export function Combobox({
  value = null,
  onChange,
  multiple,
  options,
  loadOptions,
  selectedLabel,
  labels,
  locale = "az",
  clearable = true,
  disabled,
  invalid,
  required,
  id,
  width,
  className,
  footer,
  defaultOpen = false,
  autoFocus,
  onQueryEnter,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<ComboOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const listId = useId();

  // Async options: debounced, the previous request aborted.
  useEffect(() => {
    if (!open || !loadOptions) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      loadOptions(query, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setRemote(rows);
        })
        .catch(() => {
          if (!controller.signal.aborted) setRemote([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, loadOptions]);

  const shown = useMemo(() => (loadOptions ? remote ?? [] : filterOptions(options ?? [], query, locale)), [loadOptions, remote, options, query, locale]);
  const current = (options ?? []).find((o) => o.value === value) ?? remote?.find((o) => o.value === value) ?? null;
  const currentLabel = current?.label ?? (value ? selectedLabel ?? value : "");

  // Radix returns the focus to the trigger when the popover closes.
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const picked = multiple ? new Set(multiple.values) : null;
  const isChecked = (o: ComboOption) => (picked ? picked.has(o.value) : o.value === value);
  const pick = (option: ComboOption) => {
    if (multiple) {
      // Toggle and keep the list open for the next pick.
      multiple.onChange(picked!.has(option.value) ? multiple.values.filter((v) => v !== option.value) : [...multiple.values, option.value]);
      return;
    }
    onChange?.(option.value, option);
    close();
  };
  const hasValue = multiple ? multiple.values.length > 0 : !!value;
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <div
          className={["ds-control ds-combobox", className].filter(Boolean).join(" ")}
          style={controlWidthStyle(width)}
          data-invalid={invalid ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
        >
          <Popover.Trigger asChild disabled={disabled}>
            <button
                id={id}
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-haspopup="listbox"
              aria-invalid={invalid || undefined}
              aria-required={required || undefined}
              aria-label={
                // Multiple mode: the name and how many are picked ("Salesperson, 2 selected").
                multiple && multiple.values.length && labels.selected
                  ? `${aria["aria-label"] ?? multiple.triggerLabel}, ${multiple.values.length} ${labels.selected}`
                  : aria["aria-label"]
              }
              aria-describedby={aria["aria-describedby"]}
              autoFocus={autoFocus}
              className="ds-combobox-trigger"
              onKeyDown={(e) => {
                // Type to search: a printable key opens the list with that letter typed.
                if (!open && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
                  e.preventDefault();
                  setQuery(e.key);
                  setOpen(true);
                } else if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
            >
              {multiple ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-start">
                  <Truncate className="min-w-0">{multiple.triggerLabel}</Truncate>
                  {multiple.values.length ? <span className="ds-chip ds-chip-std ds-mono shrink-0" data-tone="brand">{multiple.values.length}</span> : null}
                </span>
              ) : currentLabel ? (
                <Truncate className="min-w-0 flex-1 text-start">{currentLabel}</Truncate>
              ) : (
                <span className="ds-combobox-placeholder">{labels.placeholder}</span>
              )}
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            </button>
          </Popover.Trigger>
          {clearable && hasValue && !disabled ? (
            <IconButton size="sm" label={labels.clear} icon={<X className="h-3.5 w-3.5" />} onClick={() => (multiple ? multiple.onChange([]) : onChange?.(null, null))} className="ds-combobox-clear" />
          ) : null}
        </div>
      </Popover.Anchor>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[var(--ds-z-dropdown)] outline-none"
          style={{ minWidth: "var(--radix-popover-trigger-width)" }}
        >
          <motion.div className="ds-menu ds-combobox-panel" initial="initial" animate="enter" variants={motionPreset(panelVariants, reduced)}>
            <Command shouldFilter={false} loop label={aria["aria-label"] ?? labels.placeholder}>
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={labels.search}
                aria-label={labels.search}
                className="ds-control-input ds-combobox-search"
                onFocus={(e) => {
                  // Opened by typing: keep the caret after the letter already typed.
                  const end = e.currentTarget.value.length;
                  e.currentTarget.setSelectionRange(end, end);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  } else if (e.key === "Enter" && onQueryEnter && query.trim() && onQueryEnter(query.trim())) {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                  }
                }}
              />
              <Command.List id={listId} className="ds-combobox-list">
                {loading ? (
                  <Command.Loading>
                    <span className="flex items-center gap-2 px-3 py-2 ds-muted">
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                      {labels.loading}
                    </span>
                  </Command.Loading>
                ) : null}
                {!loading && shown.length === 0 ? <div className="px-3 py-2 ds-muted" role="status">{labels.empty}</div> : null}
                {shown.map((o) => (
                  <Command.Item
                    key={o.value}
                    value={o.value}
                    disabled={o.disabled}
                    onSelect={() => pick(o)}
                    className="ds-combobox-item"
                    // Multiple mode: picks are "checked"; aria-selected stays the keyboard highlight (cmdk).
                    aria-checked={multiple ? isChecked(o) : undefined}
                  >
                    <Check className="h-4 w-4 shrink-0" style={{ opacity: isChecked(o) ? 1 : 0 }} aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Truncate>{o.label}</Truncate>
                      {o.hint ? <Truncate className="ds-muted text-[length:var(--ds-text-xs)]">{o.hint}</Truncate> : null}
                    </span>
                    {o.meta ? <span className="shrink-0 ds-mono ds-muted text-[length:var(--ds-text-xs)]">{o.meta}</span> : null}
                  </Command.Item>
                ))}
              </Command.List>
              {footer ? <div className="ds-combobox-footer">{footer({ query, close })}</div> : null}
            </Command>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
