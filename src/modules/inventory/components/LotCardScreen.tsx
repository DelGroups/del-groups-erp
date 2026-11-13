"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileDown, FileSpreadsheet, History, PencilLine, Printer, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Button,
  Chip,
  DateField,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormGrid,
  LoadingState,
  PageFrame,
  PageHeader,
  Section,
  Tabs,
  useToast,
  type HeaderAction,
} from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { useRecordCrumb } from "@/components/shell/useShell";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { dateFieldLabels } from "@/i18n/uiStandardLabels";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";
import { formatMoney, formatQuantity } from "@/lib/dates/localeDate";
import { invalidateModel, KpiCards, ViewScope } from "@/views";
import { RecordChatter } from "@/views/chatter/RecordChatter";
import { ACTION_PARAM, forgetRowAction, hasRowActionIntent, withoutAction } from "@/views/rowActions";
import { getLotCardAction, lotEventsAction, lotMovementsAction, lotTraceAction, setLotStatusAction, updateLotAction, type LotEventRow } from "../actions/lotScreens";
import {
  counterpartyHref,
  groupTrace,
  lotDocHref,
  lotEditChanges,
  lotStatusActions,
  MOVEMENTS_PAGE,
  nextMovementsOffset,
  productHref,
  statusOfAction,
  type LotCardData,
  type LotMovementRow,
  type TraceGroup,
} from "../lib/lotScreens";
import { lotExpiry } from "../lib/lotPicker";
import { LotLabelsSheet, type LotLabelData } from "./LotFields";
import { LOTS_VIEW_KEY } from "../views/lots";

type Card = LotCardData & { canManage: boolean; isAdmin: boolean };
type StatusAction = "quarantine" | "release" | "close";
type TabId = "trace" | "movements" | "history" | "chatter";

const today = () => new Date().toISOString().slice(0, 10);

async function unwrap<T>(p: Promise<{ success: true; data: T } | { success: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** LOT-4: one lot (LOT_TRACKING): header, key figures, balances, trace, movements, history, chatter. */
export default function LotCardScreen({ id }: { id: string }) {
  return (
    <ViewScope>
      <Loader id={id} />
    </ViewScope>
  );
}

function Loader({ id }: { id: string }) {
  const { t } = useI18n();
  const card = useQuery({ queryKey: ["lots", "card", id], queryFn: () => unwrap(getLotCardAction(id)) });
  if (card.isError) {
    const msg = card.error instanceof Error ? card.error.message : "";
    return <ErrorState title={t(msg.startsWith("lots.") ? msg : "lots.screens.errors.loadFailed")} description={msg.startsWith("lots.") ? undefined : msg} retryLabel={t("views.retry")} onRetry={() => void card.refetch()} />;
  }
  if (!card.data) return <LoadingState label={t("common.loading")} variant="form" />;
  return <LotCard card={card.data} />;
}

function LotCard({ card }: { card: Card }) {
  const { t, locale, formatDate } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [tab, setTab] = useState<TabId>("trace");
  const [editOpen, setEditOpen] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const { printData: labels, setPrintData: setLabels } = useDocumentPrint<LotLabelData[]>(400);
  const { printData: sheet, setPrintData: setSheet } = useDocumentPrint<{ trace: TraceGroup[]; movements: LotMovementRow[] }>(400);
  useRecordCrumb(card.lotNo);

  const unit = card.product.unit ?? "";
  const qty = (n: number) => `${formatQuantity(n, locale)} ${unit}`.trim();
  const expiry = lotExpiry(card.expDate, today());
  const statusActions = card.canManage && !card.isSystem ? lotStatusActions(card.status, card.kpis.onHand) : [];

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["lots"] });
    await invalidateModel(client, LOTS_VIEW_KEY);
  };

  const trace = useQuery({ queryKey: ["lots", "trace", card.id], queryFn: () => unwrap(lotTraceAction(card.id)) });
  const traceGroups = useMemo(() => (trace.data ? groupTrace(trace.data.rows, new Map(Object.entries(trace.data.names))) : []), [trace.data]);

  const printLabel = () =>
    setLabels([{ lotNo: card.lotNo, productName: card.product.name, productCode: card.product.code, supplierBatchNo: card.supplierBatchNo, expDate: card.expDate, receiptNo: card.originDocNo }]);

  /** Every movement (pages of the RPC), for the PDF sheet and the Excel file. */
  const allMovements = async (): Promise<LotMovementRow[]> => {
    const out: LotMovementRow[] = [];
    for (let offset = 0; offset < 20_000; ) {
      const page = await unwrap(lotMovementsAction(card.id, offset));
      out.push(...page.rows);
      const next = nextMovementsOffset(out.length, page.total);
      if (next === null || !page.rows.length) break;
      offset = next;
    }
    return out;
  };

  const exportPdf = async () => {
    try {
      setSheet({ trace: traceGroups, movements: await allMovements() });
    } catch (err) {
      toast(t("lots.screens.errors.exportFailed"), err instanceof Error ? t(err.message) : undefined, "error");
    }
  };

  const exportExcel = async () => {
    try {
      const rows = await allMovements();
      await exportXlsx(xlsxFileName(`${t("lots.screens.lot")} ${card.lotNo}`, new Date()), {
        sheetName: card.lotNo,
        columns: [
          { header: t("lots.screens.movements.date"), type: "datetime", value: (r: LotMovementRow) => r.date },
          { header: t("lots.screens.movements.document"), value: (r: LotMovementRow) => r.docNo ?? "" },
          { header: t("lots.screens.movements.kind"), value: (r: LotMovementRow) => t(`lots.screens.kinds.${r.kind}`) },
          { header: t("lots.screens.movements.warehouse"), value: (r: LotMovementRow) => r.warehouseName },
          { header: t("lots.screens.movements.qty"), type: "number", value: (r: LotMovementRow) => r.qty },
          { header: t("lots.screens.movements.balance"), type: "number", value: (r: LotMovementRow) => r.balance },
          { header: t("lots.screens.movements.pick"), value: (r: LotMovementRow) => (r.pickMode ? t(`lots.screens.pick.${r.pickMode}`) : "") },
          { header: t("lots.screens.movements.user"), value: (r: LotMovementRow) => r.userName ?? "" },
        ],
        rows,
      });
    } catch (err) {
      toast(t("lots.screens.errors.exportFailed"), err instanceof Error ? t(err.message) : undefined, "error");
    }
  };

  // UI-5: a list row's "…" menu opens the card with ?do=<action>; run it once when just picked.
  const actionsByKey: Record<string, (() => void) | undefined> = {
    print: printLabel,
    export: () => void exportPdf(),
    quarantine: statusActions.includes("quarantine") ? () => setStatusAction("quarantine") : undefined,
    release: statusActions.includes("release") ? () => setStatusAction("release") : undefined,
  };
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const { pathname, search, hash } = window.location;
    const key = new URLSearchParams(search).get(ACTION_PARAM);
    if (!key) return;
    const store = window.sessionStorage;
    const fresh = hasRowActionIntent(store, pathname, key, Date.now());
    window.history.replaceState(window.history.state, "", `${withoutAction(pathname, search)}${hash}`);
    if (!fresh) return;
    forgetRowAction(store);
    actionsByKey[key]?.();
    // Runs once on open, with the actions of the loaded card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusIcon = { quarantine: ShieldAlert, release: ShieldCheck, close: Archive } as const;
  const secondary: HeaderAction[] = [
    { id: "print", label: t("lots.screens.actions.printLabel"), icon: Printer, onSelect: printLabel },
    { id: "pdf", label: t("lots.screens.actions.exportPdf"), icon: FileDown, onSelect: () => void exportPdf() },
  ];
  const more: HeaderAction[] = [
    { id: "xlsx", label: t("lots.screens.actions.exportExcel"), icon: FileSpreadsheet, onSelect: () => void exportExcel() },
    ...statusActions.map((a) => ({ id: a, label: t(`lots.screens.actions.${a}`), icon: statusIcon[a], onSelect: () => setStatusAction(a), danger: a === "close" })),
  ];

  const kpis = [
    { key: "onHand", label: t("lots.screens.kpi.onHand"), value: qty(card.kpis.onHand) },
    { key: "received", label: t("lots.screens.kpi.received"), value: qty(card.kpis.received) },
    { key: "sold", label: t("lots.screens.kpi.sold"), value: qty(card.kpis.sold) },
    { key: "writtenOff", label: t("lots.screens.kpi.writtenOff"), value: qty(card.kpis.writtenOff) },
  ];

  const originHref = lotDocHref(card.originDocType, card.originDocId, { importShipmentId: card.importShipment?.id });
  const detail = (label: string, value: React.ReactNode) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="ds-label">{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    );

  return (
    <>
      <PageFrame
        header={
          <PageHeader
            title={card.lotNo}
            description={[card.product.code, card.product.name].filter(Boolean).join(" · ")}
            status={<LotStatusChips status={card.status} expiry={expiry} />}
            primary={
              card.canManage && !card.isSystem ? (
                <Button variant="primary" icon={PencilLine} onClick={() => setEditOpen(true)}>
                  {t("lots.screens.actions.edit")}
                </Button>
              ) : undefined
            }
            secondary={secondary}
            more={more}
          />
        }
        kpis={<KpiCards kpis={kpis} label={t("lots.screens.kpi.label")} />}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Section title={t("lots.screens.sections.details")}>
            <dl className="grid gap-4 sm:grid-cols-2">
              {detail(t("lots.screens.fields.product"), <Link className="underline-offset-2 hover:underline" href={productHref(card.product.id)}>{[card.product.code, card.product.name].filter(Boolean).join(" · ")}</Link>)}
              {detail(t("lots.fields.supplierBatchNo"), card.supplierBatchNo)}
              {detail(
                t("lots.screens.fields.origin"),
                <span>
                  {t(`lots.screens.origin.${card.originType}`)}
                  {card.originDocNo ? (
                    <>
                      {" · "}
                      {originHref ? <Link className="underline-offset-2 hover:underline" href={originHref}>{card.originDocNo}</Link> : card.originDocNo}
                    </>
                  ) : null}
                </span>,
              )}
              {detail(t("lots.screens.fields.supplier"), card.supplier ? <Link className="underline-offset-2 hover:underline" href={counterpartyHref("supplier", card.supplier.id) ?? "#"}>{card.supplier.name ?? "—"}</Link> : null)}
              {detail(t("lots.screens.fields.importShipment"), card.importShipment ? <Link className="underline-offset-2 hover:underline" href={`/imports/${encodeURIComponent(card.importShipment.id)}`}>{card.importShipment.number ?? "—"}</Link> : null)}
              {detail(t("lots.screens.fields.invoiceNo"), card.invoiceNo)}
              {detail(t("lots.screens.fields.customsNo"), card.customsDeclarationNo)}
              {detail(t("lots.fields.mfgDate"), card.mfgDate ? formatDate(card.mfgDate) : null)}
              {detail(t("lots.fields.expDate"), card.expDate ? formatDate(card.expDate) : null)}
              {detail(t("lots.screens.fields.receivedDate"), card.receivedDate ? formatDate(card.receivedDate) : null)}
              {detail(t("lots.screens.kpi.atPartners"), card.kpis.atPartners ? qty(card.kpis.atPartners) : null)}
              {detail(t("lots.screens.kpi.inProduction"), card.kpis.inProduction ? qty(card.kpis.inProduction) : null)}
              {card.unitCost !== undefined ? detail(t("lots.screens.fields.unitCost"), formatMoney(card.unitCost, locale)) : null}
              {detail(t("lots.screens.fields.notes"), card.notes)}
            </dl>
          </Section>
          <Section title={t("lots.screens.sections.balances")}>
            {card.balances.length ? (
              <ul className="flex flex-col gap-2" data-lot-balances="">
                {card.balances.map((b) => (
                  <li key={b.warehouseId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{b.warehouseName}</span>
                    <span className="ds-mono tabular-nums">{qty(b.qty)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ds-muted">{t("lots.screens.noStock")}</p>
            )}
          </Section>
        </div>

        <Tabs
          label={t("lots.screens.tabs.label")}
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          items={[
            { id: "trace", label: t("lots.screens.tabs.trace") },
            { id: "movements", label: t("lots.screens.tabs.movements"), count: card.kpis.movementCount },
            { id: "history", label: t("lots.screens.tabs.history") },
            { id: "chatter", label: t("lots.screens.tabs.chatter") },
          ]}
        >
          {tab === "trace" ? <TraceTab card={card} groups={traceGroups} loading={trace.isLoading} failed={trace.isError} qty={qty} /> : null}
          {tab === "movements" ? <MovementsTab card={card} qty={qty} /> : null}
          {tab === "history" ? <HistoryTab lotId={card.id} /> : null}
          {tab === "chatter" ? <RecordChatter model="stock_lots" recordId={card.id} /> : null}
        </Tabs>
      </PageFrame>

      {editOpen ? (
        <EditDialog
          card={card}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false);
            toast(t("lots.screens.saved"), undefined, "success");
            await refresh();
          }}
        />
      ) : null}
      {statusAction ? (
        <StatusDialog
          card={card}
          action={statusAction}
          onClose={() => setStatusAction(null)}
          onDone={async () => {
            setStatusAction(null);
            toast(t("lots.screens.statusChanged"), undefined, "success");
            await refresh();
          }}
        />
      ) : null}
      {labels ? createPortal(<div className="print-area"><LotLabelsSheet labels={labels} /></div>, document.body) : null}
      {sheet ? createPortal(<div className="print-area"><LotCardPrint card={card} trace={sheet.trace} movements={sheet.movements} /></div>, document.body) : null}
    </>
  );
}

function LotStatusChips({ status, expiry }: { status: LotCardData["status"]; expiry: ReturnType<typeof lotExpiry> }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap gap-1">
      <Chip tone={status === "active" ? "success" : status === "quarantine" ? "warning" : "neutral"}>{t(`lots.screens.status.${status}`)}</Chip>
      {expiry === "expired" ? <Chip tone="danger">{t("lots.picker.expired")}</Chip> : expiry === "near" ? <Chip tone="warning">{t("lots.picker.nearExpiry")}</Chip> : null}
    </span>
  );
}

// ── Trace ────────────────────────────────────────────────────────────────────

function TraceTab({ card, groups, loading, failed, qty }: { card: Card; groups: TraceGroup[]; loading: boolean; failed: boolean; qty: (n: number) => string }) {
  const { t, formatDate } = useI18n();
  const originHref = lotDocHref(card.originDocType, card.originDocId, { importShipmentId: card.importShipment?.id });
  const link = (href: string | null, text: React.ReactNode) => (href ? <Link className="underline-offset-2 hover:underline" href={href}>{text}</Link> : text);
  return (
    <div className="flex flex-col gap-6 pt-4">
      <Section title={t("lots.screens.trace.backward")} level={3}>
        <ol className="flex flex-col gap-2" data-lot-trace-back="">
          {card.supplier ? <li>{t("lots.screens.trace.fromSupplier")}: {link(counterpartyHref("supplier", card.supplier.id), card.supplier.name ?? "—")}</li> : null}
          {card.importShipment ? <li>{t("lots.screens.fields.importShipment")}: {link(`/imports/${encodeURIComponent(card.importShipment.id)}`, card.importShipment.number ?? "—")}</li> : null}
          <li>
            {t(`lots.screens.origin.${card.originType}`)}
            {card.originDocNo ? <> · {link(originHref, card.originDocNo)}</> : null}
            {card.receivedDate ? <span className="ds-muted"> · {formatDate(card.receivedDate)}</span> : null}
          </li>
          {card.materialLots.length ? (
            <li>
              {t("lots.screens.trace.madeFrom")}:{" "}
              <span className="inline-flex flex-wrap gap-1">
                {card.materialLots.map((m) => (
                  <Link key={m.lotId} href={`/inventory/lots/${encodeURIComponent(m.lotId)}`} className="ds-chip ds-chip-flat ds-mono">
                    {m.lotNo ?? t("lots.chipUnknown")}
                    {m.qty !== null ? ` × ${qty(m.qty)}` : ""}
                  </Link>
                ))}
              </span>
            </li>
          ) : null}
        </ol>
      </Section>
      <Section title={t("lots.screens.trace.forward")} level={3}>
        {loading ? (
          <LoadingState label={t("common.loading")} rows={3} />
        ) : failed ? (
          <p className="ds-muted">{t("lots.screens.errors.loadFailed")}</p>
        ) : !groups.length ? (
          <p className="ds-muted">{t("lots.screens.trace.none")}</p>
        ) : (
          <ul className="flex flex-col gap-4" data-lot-trace-forward="">
            {groups.map((g) => (
              <li key={g.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {link(counterpartyHref(g.counterpartyType, g.counterpartyId), g.name ?? t(`lots.screens.trace.unknown_${g.counterpartyType}`))}
                    <span className="ds-muted"> · {t(`lots.screens.trace.${g.counterpartyType}`)}</span>
                  </span>
                  <span className="ds-mono tabular-nums">{qty(g.qty)}</span>
                </div>
                <ul className="flex flex-col gap-0.5 ps-4">
                  {g.rows.map((r, i) => (
                    <li key={`${r.docId ?? r.docNo}-${i}`} className="flex flex-wrap justify-between gap-2 text-[length:var(--ds-text-sm)]">
                      <span>
                        {link(lotDocHref(r.docType, r.docId), r.docNo ?? "—")}
                        {r.firstDate ? <span className="ds-muted"> · {formatDate(r.firstDate)}</span> : null}
                      </span>
                      <span className="ds-mono tabular-nums">{qty(r.qty)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ── Movements ────────────────────────────────────────────────────────────────

function MovementsTab({ card, qty }: { card: Card; qty: (n: number) => string }) {
  const { t, formatDateTime } = useI18n();
  const pages = useInfiniteQuery({
    queryKey: ["lots", "movements", card.id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => unwrap(lotMovementsAction(card.id, pageParam)),
    getNextPageParam: (last, all) => nextMovementsOffset(all.reduce((n, p) => n + p.rows.length, 0), last.total),
  });
  const rows = useMemo(() => pages.data?.pages.flatMap((p) => p.rows) ?? [], [pages.data]);
  const names = useMemo(() => Object.assign({}, ...(pages.data?.pages.map((p) => p.counterparties) ?? [])) as Record<string, string>, [pages.data]);
  const total = pages.data?.pages[0]?.total ?? 0;
  if (pages.isError) return <p className="ds-muted pt-4">{t("lots.screens.errors.loadFailed")}</p>;

  const columns: StandardColumn<LotMovementRow>[] = [
    { key: "date", header: t("lots.screens.movements.date"), width: 150, cell: (r) => formatDateTime(r.date), sortValue: (r) => r.date },
    {
      key: "doc",
      header: t("lots.screens.movements.document"),
      width: 170,
      cell: (r) => {
        const href = lotDocHref(r.docType, r.docId, { importShipmentId: card.importShipment?.id });
        const text = r.docNo ?? (r.docType ? t(`lots.screens.docTypes.${r.docType}`) : "—");
        return href ? <Link className="underline-offset-2 hover:underline" href={href}>{text}</Link> : text;
      },
    },
    { key: "kind", header: t("lots.screens.movements.kind"), width: 130, cell: (r) => t(`lots.screens.kinds.${r.kind}`) },
    { key: "warehouse", header: t("lots.screens.movements.warehouse"), width: 150, cell: (r) => r.warehouseName },
    { key: "counterparty", header: t("lots.screens.movements.counterparty"), width: 170, cell: (r) => (r.counterpartyId ? (names[r.counterpartyId] ?? "—") : "") },
    { key: "qty", header: t("lots.screens.movements.qty"), type: "number", width: 110, cell: (r) => <span className={r.qty < 0 ? "text-[var(--ds-danger)]" : undefined}>{`${r.qty > 0 ? "+" : ""}${qty(r.qty)}`}</span>, sortValue: (r) => r.qty },
    { key: "balance", header: t("lots.screens.movements.balance"), type: "number", width: 110, cell: (r) => qty(r.balance) },
    { key: "pick", header: t("lots.screens.movements.pick"), width: 120, cell: (r) => (r.pickMode ? t(`lots.screens.pick.${r.pickMode}`) : "") },
    { key: "user", header: t("lots.screens.movements.user"), width: 140, cell: (r) => r.userName ?? "" },
  ];
  return (
    <div className="flex flex-col gap-3 pt-4">
      <StandardGrid<LotMovementRow>
        id="lot-movements"
        label={t("lots.screens.tabs.movements")}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pages.isLoading}
        empty={t("lots.screens.movements.none")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="ds-muted text-[length:var(--ds-text-sm)]">{t("lots.screens.movements.shown", { shown: rows.length, total })}</span>
        {pages.hasNextPage ? (
          <Button variant="secondary" size="sm" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {t("lots.screens.movements.more", { count: Math.min(MOVEMENTS_PAGE, total - rows.length) })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

const EVENT_FIELDS = ["lot_no", "supplier_batch_no", "mfg_date", "exp_date", "status", "notes"] as const;

function HistoryTab({ lotId }: { lotId: string }) {
  const { t, formatDateTime } = useI18n();
  const events = useQuery({ queryKey: ["lots", "events", lotId], queryFn: () => unwrap(lotEventsAction(lotId)) });
  if (events.isLoading) return <LoadingState label={t("common.loading")} rows={3} />;
  if (events.isError) return <p className="ds-muted pt-4">{t("lots.screens.errors.loadFailed")}</p>;
  if (!events.data?.length) return <EmptyState icon={History} title={t("lots.screens.history.none")} />;
  const change = (e: LotEventRow) =>
    EVENT_FIELDS.filter((f) => e.newValues && f in e.newValues)
      .map((f) => `${t(`lots.screens.history.fields.${f}`)}: ${String(e.oldValues?.[f] ?? "—")} → ${String(e.newValues?.[f] ?? "—")}`)
      .join("; ");
  return (
    <ol className="flex flex-col gap-3 pt-4" data-lot-history="">
      {events.data.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 border-b border-[var(--ds-border)] pb-3 last:border-b-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{t(`lots.screens.history.events.${e.event}`)}</span>
            <span className="ds-muted text-[length:var(--ds-text-sm)]">
              {formatDateTime(e.createdAt)}
              {e.userName ? ` · ${e.userName}` : ""}
            </span>
          </div>
          {change(e) ? <span className="text-[length:var(--ds-text-sm)]">{change(e)}</span> : null}
          {e.reason ? <span className="ds-muted text-[length:var(--ds-text-sm)]">{t("lots.screens.history.reason", { reason: e.reason })}</span> : null}
        </li>
      ))}
    </ol>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function EditDialog({ card, onClose, onSaved }: { card: Card; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const [lotNo, setLotNo] = useState(card.lotNo);
  const [batch, setBatch] = useState(card.supplierBatchNo ?? "");
  const [mfg, setMfg] = useState<string | null>(card.mfgDate?.slice(0, 10) ?? null);
  const [exp, setExp] = useState<string | null>(card.expDate?.slice(0, 10) ?? null);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = lotEditChanges(card, { lotNo, supplierBatchNo: batch, mfgDate: mfg, expDate: exp, notes });
  const changed = Object.keys(changes).length > 0;
  const datesBad = !!mfg && !!exp && exp < mfg;

  const save = async () => {
    if (!changed || datesBad || !reason.trim() || !lotNo.trim()) return;
    setBusy(true);
    setError(null);
    const r = await updateLotAction(card.id, changes, reason);
    setBusy(false);
    if (!r.success) {
      setError(t(r.error));
      return;
    }
    await onSaved();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("lots.screens.edit.title", { lot: card.lotNo })}
      description={t("lots.screens.edit.hint")}
      labels={{ close: t("common.close") }}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!changed || datesBad || !reason.trim() || !lotNo.trim()}>
            {t("lots.screens.edit.save")}
          </Button>
        </>
      }
    >
      <FormGrid columns={2}>
        <Field label={t("lots.fields.lotNo")} required error={!lotNo.trim() ? t("lots.screens.edit.lotNoRequired") : null}>
          {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="ds-input" value={lotNo} maxLength={80} onChange={(e) => setLotNo(e.target.value)} />}
        </Field>
        <Field label={t("lots.fields.supplierBatchNo")}>
          {({ id }) => <input id={id} className="ds-input" value={batch} maxLength={80} onChange={(e) => setBatch(e.target.value)} />}
        </Field>
        <Field label={t("lots.fields.mfgDate")}>
          {({ id }) => <DateField id={id} value={mfg} onChange={setMfg} locale={locale} labels={dateFieldLabels(t)} width="full" aria-label={t("lots.fields.mfgDate")} />}
        </Field>
        <Field label={t("lots.fields.expDate")} error={datesBad ? t("lots.issues.datesInvalid") : null}>
          {({ id }) => <DateField id={id} value={exp} onChange={setExp} locale={locale} labels={dateFieldLabels(t)} width="full" aria-label={t("lots.fields.expDate")} />}
        </Field>
        <Field label={t("lots.screens.fields.notes")} span={2}>
          {({ id }) => <textarea id={id} className="ds-input min-h-[4rem]" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <Field label={t("lots.screens.reason")} span={2} required hint={t("lots.screens.reasonHint")} error={error}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} className="ds-input min-h-[4rem]" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </FormGrid>
    </Dialog>
  );
}

function StatusDialog({ card, action, onClose, onDone }: { card: Card; action: StatusAction; onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    const r = await setLotStatusAction(card.id, statusOfAction(action), reason);
    setBusy(false);
    if (!r.success) {
      setError(t(r.error));
      return;
    }
    await onDone();
  };
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t(`lots.screens.statusDialog.${action}Title`, { lot: card.lotNo })}
      description={t(`lots.screens.statusDialog.${action}Hint`)}
      labels={{ close: t("common.close") }}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant={action === "close" ? "danger" : "primary"} onClick={() => void run()} loading={busy} disabled={!reason.trim()}>
            {t(`lots.screens.actions.${action}`)}
          </Button>
        </>
      }
    >
      <Field label={t("lots.screens.reason")} required error={error}>
        {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} className="ds-input min-h-[4rem]" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

// ── PDF (print) ──────────────────────────────────────────────────────────────

/** The card on A4 for "Export PDF" (the browser's print → Save as PDF), like the other report prints. */
function LotCardPrint({ card, trace, movements }: { card: Card; trace: TraceGroup[]; movements: LotMovementRow[] }) {
  const { t, locale, formatDate, formatDateTime } = useI18n();
  const unit = card.product.unit ?? "";
  const qty = (n: number) => `${formatQuantity(n, locale)} ${unit}`.trim();
  return (
    <div style={{ color: "#000", background: "#fff", fontSize: "9.5pt", padding: "8mm" }} data-lot-card-print="">
      <h2 style={{ fontSize: "14pt", fontWeight: 700, margin: 0 }}>
        {t("lots.screens.lot")} {card.lotNo}
      </h2>
      <p style={{ margin: "2mm 0" }}>
        {[card.product.code, card.product.name].filter(Boolean).join(" · ")} · {t(`lots.screens.status.${card.status}`)}
      </p>
      <p style={{ margin: "2mm 0" }}>
        {[
          card.supplierBatchNo ? `${t("lots.fields.supplierBatchNo")}: ${card.supplierBatchNo}` : null,
          card.expDate ? `${t("lots.fields.expDate")}: ${formatDate(card.expDate)}` : null,
          card.originDocNo ? `${t(`lots.screens.origin.${card.originType}`)}: ${card.originDocNo}` : null,
          card.supplier?.name ? `${t("lots.screens.fields.supplier")}: ${card.supplier.name}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p style={{ margin: "2mm 0" }}>
        {t("lots.screens.kpi.received")}: {qty(card.kpis.received)} · {t("lots.screens.kpi.onHand")}: {qty(card.kpis.onHand)} · {t("lots.screens.kpi.sold")}: {qty(card.kpis.sold)} · {t("lots.screens.kpi.writtenOff")}: {qty(card.kpis.writtenOff)}
      </p>
      {trace.length ? (
        <>
          <h3 style={{ fontSize: "11pt", margin: "4mm 0 2mm" }}>{t("lots.screens.trace.forward")}</h3>
          <div role="table" aria-label={t("lots.screens.trace.forward")}>
            {trace.flatMap((g) =>
              g.rows.map((r, i) => (
                <PrintRow key={`${g.key}-${i}`} columns={TRACE_COLUMNS} cells={[g.name ?? "—", r.docNo ?? "—", r.firstDate ? formatDate(r.firstDate) : "", qty(r.qty)]} />
              )),
            )}
          </div>
        </>
      ) : null}
      <h3 style={{ fontSize: "11pt", margin: "4mm 0 2mm" }}>{t("lots.screens.tabs.movements")}</h3>
      <div role="table" aria-label={t("lots.screens.tabs.movements")}>
        <PrintRow
          header
          columns={MOVEMENT_COLUMNS}
          cells={[t("lots.screens.movements.date"), t("lots.screens.movements.document"), t("lots.screens.movements.kind"), t("lots.screens.movements.warehouse"), t("lots.screens.movements.qty"), t("lots.screens.movements.balance")]}
        />
        {movements.map((m) => (
          <PrintRow key={m.id} columns={MOVEMENT_COLUMNS} cells={[formatDateTime(m.date), m.docNo ?? "", t(`lots.screens.kinds.${m.kind}`), m.warehouseName, qty(m.qty), qty(m.balance)]} />
        ))}
      </div>
    </div>
  );
}

/** Column widths of the print rows; the last `numeric` columns are end-aligned. */
const TRACE_COLUMNS = { template: "2fr 2fr 1fr 1fr", numeric: 1 };
const MOVEMENT_COLUMNS = { template: "1.4fr 1.4fr 1.2fr 1.4fr 1fr 1fr", numeric: 2 };

/** One row of the printed card (a grid of cells: the print sheet has no list grid). */
function PrintRow({ columns, cells, header }: { columns: { template: string; numeric: number }; cells: readonly React.ReactNode[]; header?: boolean }) {
  return (
    <div role="row" style={{ display: "grid", gridTemplateColumns: columns.template, breakInside: "avoid", fontWeight: header ? 700 : 400 }}>
      {cells.map((c, i) => (
        <div
          key={i}
          role={header ? "columnheader" : "cell"}
          style={{ border: "1px solid #999", marginTop: -1, marginInlineStart: i ? -1 : 0, padding: "2px 4px", fontSize: "8.5pt", textAlign: i >= cells.length - columns.numeric ? "end" : "start" }}
        >
          {c}
        </div>
      ))}
    </div>
  );
}
