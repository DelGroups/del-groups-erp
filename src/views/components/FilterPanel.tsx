"use client";

import React, { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Filter, Search, X } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { filterOptions } from "@/design-system/logic";
import { motionPreset, overlayVariants, panelVariants, transitions } from "@/design-system/motion";
import { activeFilterCount, clearAllFilters, nameOfValueKey, rovingIndex, setValuePicks, toggleIn, type Formatter, type ValueFilterOption } from "../logic";
import type { SearchState, ValueFilterDef, ViewDefinition } from "../types";

/** RESP-1: phones (< 768 px) get the panel as a bottom sheet. */
const PHONE = "(max-width: 767.98px)";
function subscribePhone(cb: () => void) {
  const q = window.matchMedia(PHONE);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}
function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
}

export interface FilterPanelProps {
  definition: ViewDefinition;
  state: SearchState;
  onChange: (next: SearchState) => void;
  fmt: Formatter;
  /** Choices of each value filter (valueFilterOptions over the loaded records), by field. */
  choices: ReadonlyMap<string, readonly ValueFilterOption[]>;
}

/**
 * FLT-1: the one "Filters" panel of the list toolbar (LIST-1). Fixed filters as a checkbox list,
 * then one searchable checkbox list per value filter (INV-3). Every tick applies at once and the
 * panel stays open. A popover on wider screens, a bottom sheet on phones (RESP-1).
 */
export function FilterPanel({ definition: def, state, onChange, fmt, choices }: FilterPanelProps) {
  const { t } = fmt;
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(def, state);
  const name = t("views.filters");

  const trigger = (
    <button type="button" className="ds-btn ds-btn-sm" aria-label={active ? t("views.filtersActive", { count: active }) : name}>
      <Filter className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">{name}</span>
      {active ? (
        <span
          aria-hidden
          data-filter-badge
          className="inline-grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full px-1 text-[length:var(--ds-text-xs)] font-semibold tabular-nums leading-none"
          style={{ background: "var(--ds-brand)", color: "var(--ds-brand-fg)" }}
        >
          {active}
        </span>
      ) : null}
    </button>
  );

  const body = <FilterPanelBody definition={def} state={state} onChange={onChange} fmt={fmt} choices={choices} />;

  if (phone) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <AnimatePresence>
          {open ? (
            <Dialog.Portal forceMount container={portalContainer ?? undefined}>
              <Dialog.Overlay asChild forceMount>
                <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" exit="exit" />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="ds-sheet"
                  data-filter-panel="sheet"
                  initial={reduced ? { opacity: 0 } : { y: "100%" }}
                  animate={reduced ? { opacity: 1 } : { y: 0 }}
                  exit={reduced ? { opacity: 0 } : { y: "100%" }}
                  transition={reduced ? transitions.instant : transitions.base}
                >
                  <div className="ds-dialog-header">
                    <Dialog.Title className="ds-dialog-title min-w-0 flex-1 truncate">{name}</Dialog.Title>
                    <Dialog.Close className="ds-icon-btn" aria-label={t("common.close")}>
                      <X className="h-5 w-5" aria-hidden />
                    </Dialog.Close>
                  </div>
                  {body}
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          ) : null}
        </AnimatePresence>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} aria-label={name} className="z-[var(--ds-z-dropdown)] outline-none">
          {/* OVL-2: never taller than the free space; only the lists scroll. */}
          <motion.div
            className="ds-panel flex w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden"
            data-filter-panel="popover"
            style={{ maxHeight: "min(40rem, var(--radix-popover-content-available-height, 40rem))" }}
            initial="initial"
            animate="enter"
            variants={motionPreset(panelVariants, reduced)}
          >
            {body}
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FilterPanelBody({ definition: def, state, onChange, fmt, choices }: FilterPanelProps) {
  const { t } = fmt;
  const rootRef = useRef<HTMLDivElement>(null);
  const filters = def.filters ?? [];
  const valueFilters = def.valueFilters ?? [];
  const active = activeFilterCount(def, state);
  const set = (patch: Partial<SearchState>) => onChange({ ...state, ...patch });

  // Fixed filters: one list, each group together (in the order groups first appear) and split by
  // a line, as in the old menu: OR inside a group, AND between groups.
  const groups = [...new Set(filters.map((f) => f.group))];
  const ordered = groups.flatMap((g) => filters.filter((f) => f.group === g));
  const fixedItems: CheckItem[] = ordered.map((f, i) => ({
    id: f.key,
    label: t(f.labelKey),
    checked: state.filters.includes(f.key),
    onToggle: () => set({ filters: toggleIn(state.filters, f.key) }),
    separatorBefore: i > 0 && ordered[i - 1].group !== f.group,
  }));

  const clear = () => {
    onChange(clearAllFilters(state));
    // The button goes away with the last filter: keep the focus inside the panel.
    requestAnimationFrame(() => (rootRef.current?.querySelector('input[type="checkbox"][tabindex="0"]') as HTMLElement | null)?.focus());
  };

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className="ds-scroll-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-2">
        {fixedItems.length ? <CheckList items={fixedItems} label={t("views.filters")} fmt={fmt} /> : null}
        {valueFilters.map((vf, i) => (
          <React.Fragment key={vf.field}>
            {i || fixedItems.length ? <hr className="ds-menu-sep border-0" /> : null}
            <ValueFilterSection vf={vf} state={state} onChange={onChange} fmt={fmt} options={choices.get(vf.field) ?? []} />
          </React.Fragment>
        ))}
      </div>
      {active ? (
        <div className="flex flex-none justify-end border-t p-2" style={{ borderColor: "var(--ds-border)" }}>
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={clear} data-clear-filters>
            <X className="h-4 w-4" aria-hidden />
            {t("views.clearFilters")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ValueFilterSection({ vf, state, onChange, fmt, options }: { vf: ValueFilterDef; state: SearchState; onChange: (next: SearchState) => void; fmt: Formatter; options: readonly ValueFilterOption[] }) {
  const { t } = fmt;
  const headingId = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const name = t(vf.labelKey);
  const picked = useMemo(() => state.values?.[vf.field] ?? [], [state.values, vf.field]);
  // A pick no loaded row has (e.g. from a favourite) stays in the list so it can be unticked.
  const all = useMemo(() => {
    const known = new Set(options.map((o) => o.value));
    const extra = picked.filter((v) => !known.has(v)).map((v): ValueFilterOption => ({ value: v, label: nameOfValueKey(v) ?? t("views.valueFilters.notLoaded"), count: 0 }));
    return [...options, ...extra];
  }, [options, picked, t]);
  const shown = useMemo(() => filterOptions(all, query, fmt.locale), [all, query, fmt.locale]);
  const toggle = (value: string) =>
    onChange({ ...state, values: setValuePicks(state.values, vf.field, picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value]) });

  return (
    <section className="flex flex-col gap-1.5" aria-labelledby={headingId}>
      <h3 id={headingId} className="px-1 text-[length:var(--ds-text-sm)] font-semibold">
        {name}
      </h3>
      <div className="ds-control w-full" style={{ paddingInlineStart: "0.5rem" }}>
        <Search className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
        <label htmlFor={searchId} className="sr-only">
          {t("views.valueFilters.searchIn", { name })}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("views.valueFilters.search")}
          className="ds-control-input"
          autoComplete="off"
        />
      </div>
      {shown.length ? (
        <CheckList
          labelledBy={headingId}
          fmt={fmt}
          items={shown.map((o) => ({ id: o.value, label: o.label, count: o.count, checked: picked.includes(o.value), onToggle: () => toggle(o.value) }))}
        />
      ) : (
        <p className="px-1 py-1.5 text-[length:var(--ds-text-sm)] ds-muted" role="status">
          {t("views.valueFilters.empty")}
        </p>
      )}
    </section>
  );
}

interface CheckItem {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  /** Number of loaded rows with this value; shown at the end of the row. */
  count?: number;
  separatorBefore?: boolean;
}

/**
 * A checkbox list with one Tab stop: arrow keys (and Home/End) move inside it, Space ticks.
 * At most ~8 rows are visible, then the list scrolls (hidden scrollbar, OVL-2).
 */
function CheckList({ items, label, labelledBy, fmt }: { items: readonly CheckItem[]; label?: string; labelledBy?: string; fmt: Formatter }) {
  const [focus, setFocus] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const current = Math.min(focus, items.length - 1);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = rovingIndex(e.key, current, items.length);
    if (next === null) return;
    e.preventDefault();
    setFocus(next);
    (listRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[next])?.focus();
  };
  return (
    <div
      ref={listRef}
      role="group"
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="ds-scroll-quiet flex max-h-64 flex-col overflow-y-auto overscroll-contain max-md:max-h-80"
      data-check-list
    >
      {items.map((item, i) => (
        <React.Fragment key={item.id}>
          {item.separatorBefore ? <hr className="ds-menu-sep border-0" /> : null}
          <label className="ds-menu-item min-h-8 shrink-0 max-md:min-h-10">
            <input
              type="checkbox"
              checked={item.checked}
              onChange={item.onToggle}
              onFocus={() => setFocus(i)}
              tabIndex={i === current ? 0 : -1}
              className="h-4 w-4 shrink-0"
              style={{ accentColor: "var(--ds-brand)" }}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.count !== undefined && item.count > 0 ? (
              <>
                <span className="ds-muted tabular-nums text-[length:var(--ds-text-xs)]" aria-hidden>
                  {item.count}
                </span>
                <span className="sr-only">{fmt.t("views.records", { count: item.count })}</span>
              </>
            ) : null}
          </label>
        </React.Fragment>
      ))}
    </div>
  );
}
