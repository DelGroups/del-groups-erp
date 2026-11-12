"use client";

import React, { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ChevronRight, Filter, Search, X } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { filterOptions } from "@/design-system/logic";
import { motionPreset, overlayVariants, transitions } from "@/design-system/motion";
import { activeFilterCount, clearAllFilters, nameOfValueKey, pickedFirst, setValuePicks, toggleIn, togglePick, type Formatter, type ValueFilterOption } from "../logic";
import type { FilterDef, SearchState, ValueFilterDef, ViewDefinition } from "../types";
import { MenuCheck } from "./Menu";

/** RESP-1: phones (< 768 px) get the filters as a bottom sheet. */
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

/** The fixed filters in their groups (the order groups first appear), for separators. */
function filterGroups(filters: readonly FilterDef[]): FilterDef[][] {
  const groups = [...new Set(filters.map((f) => f.group))];
  return groups.map((g) => filters.filter((f) => f.group === g));
}

/**
 * A value filter's people: the ones picked when the list opened first (the order then stays, so
 * a tick never moves the row under the pointer), a picked person no loaded row has kept, then
 * searched. Call it in a component that mounts when the list opens.
 */
function usePeople(vf: ValueFilterDef, options: readonly ValueFilterOption[], state: SearchState, query: string, fmt: Formatter) {
  const picked = useMemo(() => state.values?.[vf.field] ?? [], [state.values, vf.field]);
  const [pickedAtOpen] = useState(picked);
  return useMemo(() => {
    const known = new Set(options.map((o) => o.value));
    const extra = pickedAtOpen.filter((v) => !known.has(v)).map((v): ValueFilterOption => ({ value: v, label: nameOfValueKey(v) ?? fmt.t("views.valueFilters.notLoaded"), count: 0 }));
    const all = pickedFirst([...options, ...extra], pickedAtOpen);
    return { picked, shown: query.trim() ? filterOptions(all, query, fmt.locale) : all };
  }, [options, picked, pickedAtOpen, query, fmt]);
}

/** "Satıcı" or "Satıcı (2)": the value filter's name with how many are picked. */
function itemLabel(vf: ValueFilterDef, state: SearchState, fmt: Formatter): string {
  const name = fmt.t(vf.labelKey);
  const count = state.values?.[vf.field]?.length ?? 0;
  return count ? fmt.t("views.valueFilters.itemCount", { name, count }) : name;
}

/**
 * FLT-2: the "Filters" control of the list toolbar (LIST-1). On wider screens the menu of
 * before FLT-1: the fixed filters as checkbox items by group, then one item per value filter
 * ("Satıcı ›") that opens a submenu with a search box and the people; "Filtri təmizlə" last.
 * On phones a bottom sheet with the same list; a value filter opens a second screen (RESP-1).
 * Every tick applies at once and keeps the menu open.
 */
export function FilterPanel(props: FilterPanelProps) {
  const { definition: def, state, fmt } = props;
  const phone = useIsPhone();
  const active = activeFilterCount(def, state);
  const name = fmt.t("views.filters");
  const trigger = (
    <button type="button" className="ds-btn ds-btn-sm" aria-label={active ? fmt.t("views.filtersActive", { count: active }) : name}>
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
  return phone ? <FilterSheet {...props} trigger={trigger} active={active} /> : <FilterMenu {...props} trigger={trigger} active={active} />;
}

// ── Desktop: the dropdown menu with submenus ────────────────────────────────

function FilterMenu({ definition: def, state, onChange, fmt, choices, trigger, active }: FilterPanelProps & { trigger: React.ReactNode; active: number }) {
  const { portalContainer } = useDesignScope();
  const groups = filterGroups(def.filters ?? []);
  const valueFilters = def.valueFilters ?? [];
  const set = (patch: Partial<SearchState>) => onChange({ ...state, ...patch });
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal container={portalContainer ?? undefined}>
        <Dropdown.Content align="start" sideOffset={6} collisionPadding={12} className="ds-menu min-w-56" data-filter-menu="">
          <Dropdown.Label className="px-2.5 pb-1 pt-1.5 ds-label">{fmt.t("views.filters")}</Dropdown.Label>
          {groups.map((group, i) => (
            <React.Fragment key={group[0].group}>
              {i ? <Dropdown.Separator className="ds-menu-sep" /> : null}
              {group.map((f) => (
                <MenuCheck key={f.key} checked={state.filters.includes(f.key)} onCheckedChange={() => set({ filters: toggleIn(state.filters, f.key) })}>
                  {fmt.t(f.labelKey)}
                </MenuCheck>
              ))}
            </React.Fragment>
          ))}
          {valueFilters.length ? (
            <>
              {groups.length ? <Dropdown.Separator className="ds-menu-sep" /> : null}
              {valueFilters.map((vf) => (
                <ValueSubmenu key={vf.field} vf={vf} state={state} onChange={onChange} fmt={fmt} options={choices.get(vf.field) ?? []} />
              ))}
            </>
          ) : null}
          {active ? (
            <>
              <Dropdown.Separator className="ds-menu-sep" />
              <Dropdown.Item className="ds-menu-item" data-clear-filters="" onSelect={() => onChange(clearAllFilters(state))}>
                <X className="h-4 w-4" aria-hidden />
                {fmt.t("views.clearFilters")}
              </Dropdown.Item>
            </>
          ) : null}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Keys the search box keeps: the menu's typeahead must not eat letters, spaces or Home/End. */
const MENU_KEYS = new Set(["ArrowDown", "Escape", "Tab"]);

function ValueSubmenu({ vf, state, onChange, fmt, options }: { vf: ValueFilterDef; state: SearchState; onChange: (next: SearchState) => void; fmt: Formatter; options: readonly ValueFilterOption[] }) {
  const { t } = fmt;
  const { portalContainer } = useDesignScope();
  const searchRef = useRef<HTMLInputElement>(null);
  const viaKeyboard = useRef(false);
  const name = t(vf.labelKey);
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger
        className="ds-menu-item"
        data-value-filter={vf.field}
        onPointerMove={() => (viaKeyboard.current = false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") viaKeyboard.current = true;
        }}
      >
        <span className="min-w-0 flex-1 truncate">{itemLabel(vf, state, fmt)}</span>
        <ChevronRight className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
      </Dropdown.SubTrigger>
      <Dropdown.Portal container={portalContainer ?? undefined}>
        <Dropdown.SubContent
          sideOffset={4}
          collisionPadding={12}
          aria-label={t("views.valueFilters.menu", { name })}
          className="ds-menu flex w-72 max-w-[calc(100vw-1.5rem)] flex-col p-0"
          // OVL-2: never taller than the free space; only the list scrolls.
          style={{ overflow: "hidden", maxHeight: "min(28rem, var(--radix-dropdown-menu-content-available-height, 28rem))" }}
          data-value-submenu={vf.field}
          onFocus={(e) => {
            // Opened from the keyboard, Radix focuses the submenu itself: go straight into the
            // search box. Opened by pointer, focus stays where it is.
            if (e.target === e.currentTarget && viaKeyboard.current) searchRef.current?.focus();
          }}
        >
          <SubmenuBody vf={vf} state={state} onChange={onChange} fmt={fmt} options={options} searchRef={searchRef} />
        </Dropdown.SubContent>
      </Dropdown.Portal>
    </Dropdown.Sub>
  );
}

/** The submenu's search, people and "Clear all"; mounted each time the submenu opens. */
function SubmenuBody({
  vf,
  state,
  onChange,
  fmt,
  options,
  searchRef,
}: {
  vf: ValueFilterDef;
  state: SearchState;
  onChange: (next: SearchState) => void;
  fmt: Formatter;
  options: readonly ValueFilterOption[];
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = fmt;
  const [query, setQuery] = useState("");
  const { picked, shown } = usePeople(vf, options, state, query, fmt);
  const name = t(vf.labelKey);
  // While the user types in the search, a pointer move must not move the focus to a row (the
  // next letters would go to the menu's typeahead).
  const keepSearchFocus = (e: React.PointerEvent) => {
    if (document.activeElement === searchRef.current) e.preventDefault();
  };
  return (
    <>
      <div className="flex-none border-b p-1.5" style={{ borderColor: "var(--ds-border)" }}>
        <div className="ds-control w-full" style={{ paddingInlineStart: "0.5rem" }}>
          <Search className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="ds-control-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("views.valueFilters.search")}
            aria-label={t("views.valueFilters.searchIn", { name })}
            autoComplete="off"
            onKeyDown={(e) => {
              if (!MENU_KEYS.has(e.key)) e.stopPropagation();
            }}
          />
        </div>
      </div>
      <div className="ds-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5" data-value-list="">
        {shown.length ? (
          shown.map((o) => (
            <MenuCheck
              key={o.value}
              checked={picked.includes(o.value)}
              onCheckedChange={() => onChange({ ...state, values: togglePick(state.values, vf.field, o.value) })}
              hint={o.hint}
              count={o.count}
              countLabel={t("views.records", { count: o.count })}
              onPointerMove={keepSearchFocus}
            >
              {o.label}
            </MenuCheck>
          ))
        ) : (
          <p className="px-2.5 py-1.5 ds-muted" role="status">
            {t("views.valueFilters.empty")}
          </p>
        )}
      </div>
      {picked.length ? (
        <div className="flex-none border-t p-1.5" style={{ borderColor: "var(--ds-border)" }}>
          <Dropdown.Item
            className="ds-menu-item"
            data-clear-value-filter=""
            onSelect={(e) => {
              e.preventDefault();
              onChange({ ...state, values: setValuePicks(state.values, vf.field, []) });
            }}
          >
            <X className="h-4 w-4" aria-hidden />
            {t("views.valueFilters.clearAll")}
          </Dropdown.Item>
        </div>
      ) : null}
    </>
  );
}

// ── Phones: the bottom sheet with a second screen per value filter ──────────

function FilterSheet({ definition: def, state, onChange, fmt, choices, trigger, active }: FilterPanelProps & { trigger: React.ReactNode; active: number }) {
  const { t } = fmt;
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<string | null>(null);
  const backTo = useRef<string | null>(null);
  const titleId = useId();
  const groups = filterGroups(def.filters ?? []);
  const valueFilters = def.valueFilters ?? [];
  const current = valueFilters.find((vf) => vf.field === screen) ?? null;
  const set = (patch: Partial<SearchState>) => onChange({ ...state, ...patch });

  const back = () => {
    backTo.current = screen;
    setScreen(null);
    // Focus goes back to the row that opened the screen.
    requestAnimationFrame(() => (document.querySelector(`[data-sheet-value-filter="${backTo.current}"]`) as HTMLElement | null)?.focus());
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setScreen(null);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount container={portalContainer ?? undefined}>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" exit="exit" />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-labelledby={titleId} aria-describedby={undefined}>
              <motion.div
                className="ds-sheet"
                data-filter-panel="sheet"
                initial={reduced ? { opacity: 0 } : { y: "100%" }}
                animate={reduced ? { opacity: 1 } : { y: 0 }}
                exit={reduced ? { opacity: 0 } : { y: "100%" }}
                transition={reduced ? transitions.instant : transitions.base}
              >
                <div className="ds-dialog-header">
                  {current ? (
                    <button type="button" className="ds-icon-btn" onClick={back} aria-label={t("views.valueFilters.back")} data-sheet-back="">
                      <ArrowLeft className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                  <Dialog.Title id={titleId} className="ds-dialog-title min-w-0 flex-1 truncate">
                    {current ? t(current.labelKey) : t("views.filters")}
                  </Dialog.Title>
                  <Dialog.Close className="ds-icon-btn" aria-label={t("common.close")}>
                    <X className="h-5 w-5" aria-hidden />
                  </Dialog.Close>
                </div>
                {current ? (
                  <SheetPeople key={current.field} vf={current} state={state} onChange={onChange} fmt={fmt} options={choices.get(current.field) ?? []} />
                ) : (
                  <div className="ds-dialog-body ds-scroll-quiet flex flex-col p-2" data-sheet-screen="main">
                    {groups.map((group, i) => (
                      <React.Fragment key={group[0].group}>
                        {i ? <hr className="ds-menu-sep border-0" /> : null}
                        {group.map((f) => (
                          <SheetCheck key={f.key} checked={state.filters.includes(f.key)} onToggle={() => set({ filters: toggleIn(state.filters, f.key) })}>
                            {t(f.labelKey)}
                          </SheetCheck>
                        ))}
                      </React.Fragment>
                    ))}
                    {valueFilters.length ? (
                      <>
                        {groups.length ? <hr className="ds-menu-sep border-0" /> : null}
                        {valueFilters.map((vf) => (
                          <button key={vf.field} type="button" className="ds-menu-item min-h-10 w-full text-start" data-sheet-value-filter={vf.field} onClick={() => setScreen(vf.field)}>
                            <span className="min-w-0 flex-1 truncate">{itemLabel(vf, state, fmt)}</span>
                            <ChevronRight className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
                          </button>
                        ))}
                      </>
                    ) : null}
                    {active ? (
                      <>
                        <hr className="ds-menu-sep border-0" />
                        <button
                          type="button"
                          className="ds-menu-item min-h-10 w-full text-start"
                          data-clear-filters=""
                          onClick={() => {
                            onChange(clearAllFilters(state));
                            // The button goes away with the last filter: keep the focus in the list.
                            requestAnimationFrame(() => (document.querySelector('[data-sheet-screen="main"] input, [data-sheet-screen="main"] button') as HTMLElement | null)?.focus());
                          }}
                        >
                          <X className="h-4 w-4" aria-hidden />
                          {t("views.clearFilters")}
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** A checkbox row of the sheet: 40 px tall on phones (A11Y-3, RESP-1). */
function SheetCheck({ checked, onToggle, children, hint, count, countLabel }: { checked: boolean; onToggle: () => void; children: React.ReactNode; hint?: string; count?: number; countLabel?: string }) {
  return (
    <label className="ds-menu-item min-h-10">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0" style={{ accentColor: "var(--ds-brand)" }} />
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="truncate">{children}</span>
        {hint ? <span className="truncate text-[length:var(--ds-text-xs)] ds-muted">{hint}</span> : null}
      </span>
      {count ? (
        <>
          <span className="ms-2 shrink-0 tabular-nums text-[length:var(--ds-text-xs)] ds-muted" aria-hidden>
            {count}
          </span>
          {countLabel ? <span className="sr-only">{countLabel}</span> : null}
        </>
      ) : null}
    </label>
  );
}

/** The second screen of the sheet: search and the people of one value filter. */
function SheetPeople({ vf, state, onChange, fmt, options }: { vf: ValueFilterDef; state: SearchState; onChange: (next: SearchState) => void; fmt: Formatter; options: readonly ValueFilterOption[] }) {
  const { t } = fmt;
  const [query, setQuery] = useState("");
  const { picked, shown } = usePeople(vf, options, state, query, fmt);
  const name = t(vf.labelKey);
  return (
    <>
      <div className="flex-none border-b px-3 py-2" style={{ borderColor: "var(--ds-border)" }}>
        <div className="ds-control w-full" style={{ paddingInlineStart: "0.5rem" }}>
          <Search className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
          <input
            type="search"
            className="ds-control-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("views.valueFilters.search")}
            aria-label={t("views.valueFilters.searchIn", { name })}
            autoComplete="off"
            autoFocus
          />
        </div>
      </div>
      <div className="ds-dialog-body ds-scroll-quiet flex flex-col p-2" role="group" aria-label={name} data-sheet-screen={vf.field}>
        {shown.length ? (
          shown.map((o) => (
            <SheetCheck
              key={o.value}
              checked={picked.includes(o.value)}
              onToggle={() => onChange({ ...state, values: togglePick(state.values, vf.field, o.value) })}
              hint={o.hint}
              count={o.count}
              countLabel={t("views.records", { count: o.count })}
            >
              {o.label}
            </SheetCheck>
          ))
        ) : (
          <p className="px-2.5 py-1.5 ds-muted" role="status">
            {t("views.valueFilters.empty")}
          </p>
        )}
      </div>
      {picked.length ? (
        <div className="flex-none border-t p-2" style={{ borderColor: "var(--ds-border)" }}>
          <button type="button" className="ds-menu-item min-h-10 w-full text-start" data-clear-value-filter="" onClick={() => onChange({ ...state, values: setValuePicks(state.values, vf.field, []) })}>
            <X className="h-4 w-4" aria-hidden />
            {t("views.valueFilters.clearAll")}
          </button>
        </div>
      ) : null}
    </>
  );
}
