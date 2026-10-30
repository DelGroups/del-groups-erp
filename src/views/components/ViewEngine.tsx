"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Inbox, Lock, SearchX } from "lucide-react";
import { EmptyState, SkeletonList, useDesignScope, useUiStandard } from "@/design-system/components";
import { ColumnPicker, ColumnPickerPanel } from "@/components/lists/ColumnPicker";
import { useColumnPrefs } from "@/components/lists/useColumnPrefs";
import { useListColumnsEnabled } from "@/components/lists/ListColumnsFlag";
import { exportXlsx } from "@/lib/export/exportXlsx";
import { clearColumnWidths, setColumnWidth } from "@/lib/lists/columns";
import { applySearch, defaultFavorite, defaultSearchState, exportColumns, exportFileName, fieldMap, listColumnDefs, listFieldLabel, shownListColumns, sortRecords, type Formatter } from "../logic";
import { useFavorites, type ViewData } from "../data";
import type { FilterContext, SearchState, ViewRecord } from "../types";
import { SearchPanel } from "./SearchPanel";
import { ListView, type ListGridSettings } from "./ListView";
import { KanbanView } from "./KanbanView";
import { PivotView } from "./PivotView";
import { GraphView } from "./GraphView";
import { CalendarView } from "./CalendarView";

const noHref = () => "#";

export interface ViewEngineProps<R extends ViewRecord> {
  data: ViewData<R>;
  title: string;
  fmt: Formatter;
  ctx: FilterContext;
  /** Where a record opens (form); without it list rows are plain (reports). */
  openHref?: (record: R) => string;
  /** Kanban drop (the screen calls its server action). */
  onMove?: (record: R, value: string) => void;
  /** Create button and other screen actions. */
  actions?: React.ReactNode;
  /**
   * Filters applied from outside (dashboard cards): each new `id` replaces the active filters
   * and shows the list.
   */
  preset?: { id: number; filters: readonly string[] };
}

/**
 * A screen of the view engine: the search panel over the chosen view (list, kanban, pivot,
 * graph or calendar), all fed by the same searched and filtered records. The user's default
 * favourite is applied when it loads, unless they already changed the search.
 */
export function ViewEngine<R extends ViewRecord>({ data, title, fmt, ctx, openHref, onMove, actions, preset }: ViewEngineProps<R>) {
  const def = data.definition;
  const favorites = useFavorites(def, data.status === "ready");
  const [touched, setTouched] = useState<SearchState | null>(null);
  const fallback = useMemo(() => defaultFavorite(favorites.favorites)?.state ?? defaultSearchState(def), [favorites.favorites, def]);
  const state = touched ?? fallback;
  const [presetId, setPresetId] = useState<number | null>(null);
  if (preset && preset.id !== presetId) {
    // Adjusting state while rendering (React's pattern for "state from a changed prop").
    setPresetId(preset.id);
    setTouched({ ...state, filters: [...preset.filters], view: def.views.includes("list") ? "list" : state.view });
  }
  const filtered = useMemo(() => applySearch(data.records, def, state, ctx, fmt), [data.records, def, state, ctx, fmt]);
  const sorted = useMemo(() => sortRecords(filtered, def, state.sort), [filtered, def, state.sort]);

  // Columns (prompt 24c): a favourite's own columns, else the user's choice for this view. With
  // LIST_COLUMNS off the list keeps its definition's columns and no picker shows.
  const listColumns = useListColumnsEnabled();
  const { portalContainer } = useDesignScope();
  const columnDefs = useMemo(() => listColumnDefs(def), [def]);
  const userColumns = useColumnPrefs(def.model.key, columnDefs);
  const columnPrefs = listColumns ? (state.columns ?? userColumns.prefs) : undefined;
  const shown = useMemo(() => shownListColumns(def, listColumns, columnPrefs), [def, listColumns, columnPrefs]);
  // A favourite saved now keeps the columns on screen.
  const panelState = columnPrefs ? { ...state, columns: columnPrefs } : state;
  const fields = useMemo(() => fieldMap(def), [def]);
  const pickerProps = listColumns && columnPrefs
    ? {
        columns: columnDefs.map((c) => ({ key: c.key, label: fields.get(c.key) ? listFieldLabel(fields.get(c.key)!, def, true, fmt) : c.key, defaultVisible: c.defaultVisible, required: c.required })),
        prefs: columnPrefs,
        onChange: (next: typeof columnPrefs) => {
          userColumns.setPrefs({ ...next, widths: userColumns.prefs.widths, density: userColumns.prefs.density });
          setTouched({ ...state, columns: next });
        },
        onReset: () => {
          userColumns.reset();
          setTouched({ ...state, columns: undefined });
        },
      }
    : null;
  // UI_STANDARD (UI-2): the picker opens from the grid toolbar, never as a header cell; widths and
  // density are kept with the user's column choice for this view.
  const standard = useUiStandard();
  const picker = pickerProps && !standard ? <ColumnPicker variant="ds" compact portalContainer={portalContainer} {...pickerProps} /> : null;
  const grid: ListGridSettings | undefined = standard
    ? {
        widths: userColumns.prefs.widths,
        onWidthChange: (key, width) =>
          userColumns.setPrefs(width === null ? clearColumnWidths(userColumns.prefs) : setColumnWidth(userColumns.prefs, key, width)),
        density: userColumns.prefs.density ?? "comfortable",
        onDensityChange: (density) => userColumns.setPrefs({ ...userColumns.prefs, density }),
        columnsMenu: pickerProps ? <ColumnPickerPanel variant="ds" {...pickerProps} /> : undefined,
      }
    : undefined;

  // All searched and filtered rows (not a page), in the columns the user sees.
  const exportExcel = () =>
    exportXlsx(exportFileName(title, new Date()), {
      sheetName: title,
      columns: exportColumns(def, shown, fmt, listColumns),
      rows: sorted,
      rtl: typeof document !== "undefined" && document.documentElement.dir === "rtl",
    });

  let body: React.ReactNode;
  if (data.status === "forbidden") body = <EmptyState icon={Lock} title={fmt.t("views.forbidden")} description={fmt.t("views.forbiddenHint")} />;
  else if (data.status === "error")
    body = (
      <EmptyState
        icon={AlertTriangle}
        title={fmt.t("views.error")}
        description={data.error ?? undefined}
        action={
          <button type="button" className="ds-btn ds-btn-sm" onClick={data.refetch}>
            {fmt.t("views.retry")}
          </button>
        }
      />
    );
  else if (data.status === "loading") body = <SkeletonList loading rows={6} label={fmt.t("common.loading")}>{null}</SkeletonList>;
  else if (!data.records.length) body = <EmptyState icon={Inbox} title={fmt.t("views.empty")} action={actions} />;
  else if (!sorted.length && state.view !== "kanban" && state.view !== "calendar")
    body = (
      <EmptyState
        icon={SearchX}
        title={fmt.t("views.noMatch")}
        action={
          <button type="button" className="ds-btn ds-btn-sm" onClick={() => setTouched({ ...state, search: "", filters: [] })}>
            {fmt.t("views.clearSearch")}
          </button>
        }
      />
    );
  else if (state.view === "kanban" && def.kanban)
    body = <KanbanView definition={def} records={sorted} canMove={data.canWrite && !!onMove} onMove={(r, v) => onMove?.(r, v)} openHref={openHref ?? noHref} fmt={fmt} />;
  else if (state.view === "pivot" && def.pivot) body = <PivotView definition={def} records={sorted} fmt={fmt} />;
  else if (state.view === "graph" && def.graph) body = <GraphView definition={def} records={sorted} fmt={fmt} />;
  else if (state.view === "calendar" && def.calendar) body = <CalendarView definition={def} records={sorted} openHref={openHref ?? noHref} fmt={fmt} />;
  else body = <ListView definition={def} records={sorted} groupBy={state.groupBy} sort={state.sort} onSort={(sort) => setTouched({ ...state, sort })} openHref={openHref} fmt={fmt} columns={shown} picker={picker} listColumns={listColumns} grid={grid} />;

  return (
    <div className="flex flex-col gap-4">
      <SearchPanel definition={def} title={title} state={panelState} onChange={setTouched} fmt={fmt} count={sorted.length} favorites={favorites} onExport={() => void exportExcel()} actions={actions} />
      {data.capped ? (
        <p role="note" className="ds-chip self-start" style={{ background: "var(--ds-warning-soft)", color: "var(--ds-text)" }}>
          {fmt.t("views.capped", { count: data.records.length })}
        </p>
      ) : null}
      {body}
    </div>
  );
}
