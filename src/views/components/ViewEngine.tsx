"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Inbox, Lock, SearchX } from "lucide-react";
import { EmptyState, SkeletonList } from "@/design-system/components";
import { applySearch, defaultFavorite, defaultSearchState, exportFileName, exportRows, sortRecords, type Formatter } from "../logic";
import { useFavorites, type ViewData } from "../data";
import type { FilterContext, SearchState, ViewRecord } from "../types";
import { SearchPanel } from "./SearchPanel";
import { ListView } from "./ListView";
import { KanbanView } from "./KanbanView";
import { PivotView } from "./PivotView";
import { GraphView } from "./GraphView";
import { CalendarView } from "./CalendarView";

export interface ViewEngineProps<R extends ViewRecord> {
  data: ViewData<R>;
  title: string;
  fmt: Formatter;
  ctx: FilterContext;
  openHref: (record: R) => string;
  /** Kanban drop (the screen calls its server action). */
  onMove?: (record: R, value: string) => void;
  /** Create button and other screen actions. */
  actions?: React.ReactNode;
}

/**
 * A screen of the view engine: the search panel over the chosen view (list, kanban, pivot,
 * graph or calendar), all fed by the same searched and filtered records. The user's default
 * favourite is applied when it loads, unless they already changed the search.
 */
export function ViewEngine<R extends ViewRecord>({ data, title, fmt, ctx, openHref, onMove, actions }: ViewEngineProps<R>) {
  const def = data.definition;
  const favorites = useFavorites(def, data.status === "ready");
  const [touched, setTouched] = useState<SearchState | null>(null);
  const fallback = useMemo(() => defaultFavorite(favorites.favorites)?.state ?? defaultSearchState(def), [favorites.favorites, def]);
  const state = touched ?? fallback;
  const filtered = useMemo(() => applySearch(data.records, def, state, ctx, fmt), [data.records, def, state, ctx, fmt]);
  const sorted = useMemo(() => sortRecords(filtered, def, state.sort), [filtered, def, state.sort]);

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet(exportRows(sorted, def, def.list.columns, fmt));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, title.slice(0, 31) || "Sheet1");
    XLSX.writeFile(book, exportFileName(title, new Date()));
  };

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
    body = <KanbanView definition={def} records={sorted} canMove={data.canWrite && !!onMove} onMove={(r, v) => onMove?.(r, v)} openHref={openHref} fmt={fmt} />;
  else if (state.view === "pivot" && def.pivot) body = <PivotView definition={def} records={sorted} fmt={fmt} />;
  else if (state.view === "graph" && def.graph) body = <GraphView definition={def} records={sorted} fmt={fmt} />;
  else if (state.view === "calendar" && def.calendar) body = <CalendarView definition={def} records={sorted} openHref={openHref} fmt={fmt} />;
  else body = <ListView definition={def} records={sorted} groupBy={state.groupBy} sort={state.sort} onSort={(sort) => setTouched({ ...state, sort })} openHref={openHref} fmt={fmt} />;

  return (
    <div className="flex flex-col gap-4">
      <SearchPanel definition={def} title={title} state={state} onChange={setTouched} fmt={fmt} count={sorted.length} favorites={favorites} onExport={() => void exportExcel()} actions={actions} />
      {data.capped ? (
        <p role="note" className="ds-chip self-start" style={{ background: "var(--ds-warning-soft)", color: "var(--ds-text)" }}>
          {fmt.t("views.capped", { count: data.records.length })}
        </p>
      ) : null}
      {body}
    </div>
  );
}
