"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateModel, useViewData, type ViewData } from "../data";
import type { FilterContext, ViewDefinition, ViewRecord } from "../types";
import type { Formatter } from "../logic";
import { KpiCards, type Kpi } from "./KpiCards";
import { RecordPanel } from "./RecordPanel";
import { useFilterContext, useFormatter, ViewScope } from "./ViewScope";
import { ViewEngine } from "./ViewEngine";

export const RECORD_PARAM = "record";

export interface EngineScreenProps<R extends ViewRecord> {
  definition: ViewDefinition<R>;
  title: string;
  /** Dashboard cards from the loaded records (cards with filters filter the list). */
  kpis?: (records: readonly R[], fmt: Formatter, ctx: FilterContext) => Kpi[];
  /** More dashboard content under the cards (charts). */
  dashboard?: (records: readonly R[], fmt: Formatter) => React.ReactNode;
  /** Create button and other screen actions. */
  actions?: React.ReactNode;
  /** A record's own page; without it records open in a side panel (`?record=<id>`). */
  openHref?: (record: R) => string;
  /** Side panel content of the open record (usually a FormView with the module's actions). */
  renderRecord?: (record: R, ctx: { close: () => void; data: ViewData<R> }) => React.ReactNode;
  /** Title of the side panel. */
  recordTitle?: (record: R) => string;
  onMove?: (record: R, value: string) => void;
  /** Content above everything (tabs to sibling screens). */
  header?: React.ReactNode;
  /** Data passed in instead of read by the screen (reports with their own filters). */
  data?: ViewData<R>;
}

/**
 * A module screen of the new UI: page frame, dashboard cards, the view engine and a side panel
 * for the open record. The rows are read again whenever the screen opens, so changes made in
 * the module's forms show at once.
 */
export function EngineScreen<R extends ViewRecord>(props: EngineScreenProps<R>) {
  return (
    <ViewScope>
      <Suspense fallback={null}>
        <EngineScreenBody {...props} />
      </Suspense>
    </ViewScope>
  );
}

function EngineScreenBody<R extends ViewRecord>({ definition, title, kpis, dashboard, actions, openHref, renderRecord, recordTitle, onMove, header, data: given }: EngineScreenProps<R>) {
  const fmt = useFormatter();
  const ctx = useFilterContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const client = useQueryClient();
  const read = useViewData(definition, { enabled: !given });
  const data = given ?? read;
  const [preset, setPreset] = useState<{ id: number; filters: string[] } | undefined>(undefined);
  const openId = params.get(RECORD_PARAM);
  const open = useMemo(() => (openId ? (data.records.find((r) => r.id === openId) ?? null) : null), [openId, data.records]);
  const href = openHref ?? (renderRecord ? (r: R) => `${pathname}?${RECORD_PARAM}=${encodeURIComponent(r.id)}` : undefined);
  const close = () => router.replace(pathname, { scroll: false });
  const cards = useMemo(() => (kpis && data.status === "ready" ? kpis(data.records, fmt, ctx) : []), [kpis, data.status, data.records, fmt, ctx]);

  useEffect(() => {
    if (!given) void invalidateModel(client, definition.model.key);
  }, [client, definition.model.key, given]);

  return (
    <div className="flex flex-col gap-5">
      {header}
      {cards.length ? <KpiCards kpis={cards} label={fmt.t("views.dashboard")} onFilter={(filters) => setPreset((p) => ({ id: (p?.id ?? 0) + 1, filters }))} /> : null}
      {dashboard && data.status === "ready" && data.records.length ? dashboard(data.records, fmt) : null}
      <ViewEngine data={data} title={title} fmt={fmt} ctx={ctx} preset={preset} openHref={href} onMove={onMove} actions={actions} />
      {renderRecord ? (
        <RecordPanel open={!!open} onClose={close} title={open ? (recordTitle?.(open) ?? title) : title} closeLabel={fmt.t("common.close")}>
          {open ? renderRecord(open, { close, data }) : null}
        </RecordPanel>
      ) : null}
    </div>
  );
}
