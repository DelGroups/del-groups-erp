"use client";

import React, { useId, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  BarChart3,
  CalendarDays,
  Download,
  Filter,
  Kanban,
  Layers,
  List,
  Search,
  Star,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { fieldLabel, fieldMap, parseGroupBy, toggleGroupBy, toggleIn, type Formatter } from "../logic";
import type { FavoritesApi } from "../data";
import type { SearchState, ViewDefinition, ViewType } from "../types";
import { MenuCheck, MenuItem, MenuLabel, MenuSeparator, ViewMenu } from "./Menu";

const VIEW_ICONS: Record<Exclude<ViewType, "form">, React.ComponentType<{ className?: string }>> = {
  list: List,
  kanban: Kanban,
  pivot: Table2,
  graph: BarChart3,
  calendar: CalendarDays,
};

export function groupByLabel(def: ViewDefinition, spec: string, fmt: Formatter): string {
  const { field, granularity } = parseGroupBy(spec);
  const f = fieldMap(def).get(field);
  const name = f ? fieldLabel(f, fmt) : field;
  return granularity ? `${name}: ${fmt.t(`views.granularity.${granularity}`)}` : name;
}

export interface SearchPanelProps {
  definition: ViewDefinition;
  title: string;
  state: SearchState;
  onChange: (next: SearchState) => void;
  fmt: Formatter;
  /** Records after search and filters. */
  count: number;
  favorites: FavoritesApi;
  onExport: () => void;
  /** Create button and other screen actions, at the end of the title row. */
  actions?: React.ReactNode;
}

/**
 * Search panel shared by every view (reference dashboards/dashboards-data-table-with-toolbar):
 * title with the record count, live search, filters, group by, favourites saved per user,
 * Excel export and the view switcher. Active filters and groupings show as removable chips.
 */
export function SearchPanel({ definition: def, title, state, onChange, fmt, count, favorites, onExport, actions }: SearchPanelProps) {
  const { t } = fmt;
  const searchId = useId();
  const set = (patch: Partial<SearchState>) => onChange({ ...state, ...patch });
  const filters = def.filters ?? [];
  const groups = [...new Set(filters.map((f) => f.group))];
  const groupBys = def.groupBys ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[length:var(--ds-text-xl)] font-semibold">{title}</h1>
          <span className="ds-muted text-[length:var(--ds-text-xs)]" aria-live="polite">
            {t("views.records", { count })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-h-[var(--ds-control-h)] min-w-0 flex-1 basis-64 flex-wrap items-center gap-1.5 rounded-[var(--ds-radius-md)] border px-2" style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}>
          <Search className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
          {state.filters.map((key) => {
            const f = filters.find((x) => x.key === key);
            if (!f) return null;
            return (
              <Facet key={key} icon={<Filter className="h-3 w-3" aria-hidden />} label={t(f.labelKey)} removeLabel={t("views.removeFacet", { name: t(f.labelKey) })} onRemove={() => set({ filters: state.filters.filter((k) => k !== key) })} />
            );
          })}
          {state.groupBy.length ? (
            <Facet icon={<Layers className="h-3 w-3" aria-hidden />} label={state.groupBy.map((g) => groupByLabel(def, g, fmt)).join(" › ")} removeLabel={t("views.removeFacet", { name: t("views.groupBy") })} onRemove={() => set({ groupBy: [] })} />
          ) : null}
          <label htmlFor={searchId} className="sr-only">
            {t("views.search")}
          </label>
          <input
            id={searchId}
            type="search"
            value={state.search}
            onChange={(e) => set({ search: e.target.value })}
            onKeyDown={(e) => {
              // Backspace in an empty box removes the last chip, as in most search panels.
              if (e.key === "Backspace" && !state.search) {
                if (state.groupBy.length) set({ groupBy: state.groupBy.slice(0, -1) });
                else if (state.filters.length) set({ filters: state.filters.slice(0, -1) });
              }
            }}
            placeholder={t("views.searchPlaceholder")}
            className="min-w-32 flex-1 bg-transparent py-1.5 outline-none"
          />
        </div>

        {filters.length ? (
          <ViewMenu
            label={t("views.filters")}
            trigger={
              <button type="button" className="ds-btn ds-btn-sm" aria-label={t("views.filters")}>
                <Filter className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t("views.filters")}</span>
              </button>
            }
          >
            {groups.map((g, i) => (
              <React.Fragment key={g}>
                {i ? <MenuSeparator /> : null}
                {filters
                  .filter((f) => f.group === g)
                  .map((f) => (
                    <MenuCheck key={f.key} checked={state.filters.includes(f.key)} onCheckedChange={() => set({ filters: toggleIn(state.filters, f.key) })}>
                      {t(f.labelKey)}
                    </MenuCheck>
                  ))}
              </React.Fragment>
            ))}
          </ViewMenu>
        ) : null}

        {groupBys.length ? (
          <ViewMenu
            label={t("views.groupBy")}
            trigger={
              <button type="button" className="ds-btn ds-btn-sm" aria-label={t("views.groupBy")}>
                <Layers className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t("views.groupBy")}</span>
              </button>
            }
          >
            {groupBys.map((g) => (
              <MenuCheck key={g} checked={state.groupBy.includes(g)} onCheckedChange={() => set({ groupBy: toggleGroupBy(state.groupBy, g) })}>
                {groupByLabel(def, g, fmt)}
                {state.groupBy.includes(g) && state.groupBy.length > 1 ? <span className="ml-auto ds-mono ds-muted">{state.groupBy.indexOf(g) + 1}</span> : null}
              </MenuCheck>
            ))}
          </ViewMenu>
        ) : null}

        <FavoritesMenu state={state} onApply={onChange} favorites={favorites} fmt={fmt} />

        <button type="button" className="ds-btn ds-btn-sm" onClick={onExport} aria-label={t("views.export")}>
          <Download className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t("views.export")}</span>
        </button>

        {def.views.length > 1 ? <ViewSwitcher views={def.views} value={state.view} onChange={(view) => set({ view })} fmt={fmt} /> : null}
      </div>
    </div>
  );
}

function Facet({ icon, label, removeLabel, onRemove }: { icon: React.ReactNode; label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="ds-chip max-w-full" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-text)" }}>
      {icon}
      <span className="truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={removeLabel} className="-mr-1 grid h-4 w-4 place-items-center rounded-full hover:opacity-70">
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

/** View switcher: a radio group, arrow keys move between views. */
function ViewSwitcher({ views, value, onChange, fmt }: { views: readonly Exclude<ViewType, "form">[]; value: string; onChange: (v: Exclude<ViewType, "form">) => void; fmt: Formatter }) {
  const move = (dir: 1 | -1, target: HTMLElement) => {
    const i = views.indexOf(value as Exclude<ViewType, "form">);
    const next = views[(i + dir + views.length) % views.length];
    onChange(next);
    const group = target.closest("[role=radiogroup]");
    requestAnimationFrame(() => (group?.querySelector(`[data-view="${next}"]`) as HTMLElement | null)?.focus());
  };
  return (
    <div role="radiogroup" aria-label={fmt.t("views.switchView")} className="flex rounded-[var(--ds-radius-md)] border p-0.5" style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface-sunken)" }}>
      {views.map((v) => {
        const Icon = VIEW_ICONS[v];
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            data-view={v}
            tabIndex={active ? 0 : -1}
            title={fmt.t(`views.viewTypes.${v}`)}
            aria-label={fmt.t(`views.viewTypes.${v}`)}
            onClick={() => onChange(v)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(1, e.currentTarget);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(-1, e.currentTarget);
              }
            }}
            className="grid h-7 w-8 place-items-center rounded-[var(--ds-radius-sm)]"
            style={active ? { background: "var(--ds-surface)", boxShadow: "var(--ds-elevation-1)" } : undefined}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

function FavoritesMenu({ state, onApply, favorites, fmt }: { state: SearchState; onApply: (s: SearchState) => void; favorites: FavoritesApi; fmt: Formatter }) {
  const { t } = fmt;
  const { portalContainer } = useDesignScope();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await favorites.save(name, state, isDefault);
    if (!result.ok) {
      setError(t(result.error ?? "views.favorites.saveFailed"));
      return;
    }
    setSaving(false);
    setName("");
    setIsDefault(false);
    setError(null);
  };

  return (
    <Popover.Root open={saving} onOpenChange={setSaving}>
      <Popover.Anchor asChild>
        <span className="inline-flex">
          <ViewMenu
            label={t("views.favorites.title")}
            trigger={
              <button type="button" className="ds-btn ds-btn-sm" aria-label={t("views.favorites.title")}>
                <Star className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t("views.favorites.title")}</span>
              </button>
            }
          >
            {favorites.favorites.length === 0 ? <p className="px-2.5 py-1.5 ds-muted">{t("views.favorites.empty")}</p> : null}
            {favorites.favorites.map((f) => (
              <MenuItem key={f.id} onSelect={() => onApply(f.state)}>
                <Star className="h-4 w-4" aria-hidden style={f.isDefault ? { fill: "currentColor", color: "var(--ds-warning)" } : undefined} />
                <span className="flex-1 truncate">{f.name}</span>
                {f.isDefault ? <span className="ds-label">{t("views.favorites.default")}</span> : null}
              </MenuItem>
            ))}
            {favorites.favorites.length ? (
              <>
                <MenuSeparator />
                <MenuLabel>{t("views.favorites.manage")}</MenuLabel>
                {favorites.favorites.map((f) => (
                  <React.Fragment key={f.id}>
                    <MenuItem onSelect={() => void favorites.setDefault(f.isDefault ? null : f.id)}>
                      <Star className="h-4 w-4" aria-hidden />
                      {f.isDefault ? t("views.favorites.unsetDefault", { name: f.name }) : t("views.favorites.setDefault", { name: f.name })}
                    </MenuItem>
                    <MenuItem danger onSelect={() => void favorites.remove(f.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                      {t("views.favorites.delete", { name: f.name })}
                    </MenuItem>
                  </React.Fragment>
                ))}
              </>
            ) : null}
            <MenuSeparator />
            <MenuItem onSelect={() => setSaving(true)}>
              <Star className="h-4 w-4" aria-hidden />
              {t("views.favorites.saveCurrent")}
            </MenuItem>
          </ViewMenu>
        </span>
      </Popover.Anchor>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content sideOffset={6} align="start" className="ds-panel z-50 w-72 p-3" onOpenAutoFocus={(e) => {
          e.preventDefault();
          (document.getElementById(nameId) as HTMLInputElement | null)?.focus();
        }}>
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor={nameId} className="ds-label">
              {t("views.favorites.name")}
            </label>
            <input id={nameId} className="ds-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${nameId}-err` : undefined} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              {t("views.favorites.makeDefault")}
            </label>
            {error ? (
              <p id={`${nameId}-err`} role="alert" style={{ color: "var(--ds-danger-strong)" }}>
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setSaving(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary">
                {t("common.save")}
              </button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
