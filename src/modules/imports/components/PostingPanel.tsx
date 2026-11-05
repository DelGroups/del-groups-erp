"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, HandCoins, Lock, PackageCheck, Plus, Printer, RefreshCw, RotateCcw, Split, Trash2, Wallet } from "lucide-react";
import { Chip, RowActionsMenu, TypeToConfirmDialog, useToast, useUiStandard } from "@/design-system/components";
import { StandardGrid } from "@/components/lists/StandardGrid";
import { codeName } from "@/components/lists/standardGridLogic";
import { EntityLookup } from "@/components/lookups";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { IMPORT_CURRENCIES, type ImportCurrency } from "@/lib/imports/cbar";
import { methodsFor, type ImportsConfig } from "@/lib/imports/config";
import { fxPayment } from "@/lib/imports/fx";
import { COST_TYPES, round2, type CostType, type SplitMethod } from "@/lib/imports/landedCost";
import { ACTION_PARAM, invalidateModel, figure, useFormatter } from "@/views";
import { forgetRowAction, hasRowActionIntent } from "@/views/rowActions";
import {
  addCostAction,
  clearShipmentAction,
  logEventAction,
  updateTrackingAction,
  cancelShipmentAction,
  closeShipmentAction,
  deleteDraftShipmentAction,
  confirmShipmentAction,
  finalizeCostAction,
  getPostingViewAction,
  payPayableAction,
  prepayAction,
  receiveShipmentAction,
  reopenShipmentAction,
  type PayableView,
  type PostingResult,
  type PostingView,
} from "../actions/posting";
import { cbarRateAction, type ImportLookups, type ShipmentTracking } from "../actions/imports";
import {
  actionsFor,
  removalFor,
  checkReceipt,
  costTotalAzn,
  initialReceiveRows,
  newSplit,
  payTotals,
  paySplitsPayload,
  receiveLines,
  receivingSheetPages,
  sheetsOf,
  splitReceiveRow,
  type PaySplit,
  type ReceiveRow,
} from "../lib/posting";
import { differsFromPlan } from "../lib/lineWarehouses";
import { newCost, suggestedVat, type CostLineDraft, type ImportProduct, type ShipmentDraft } from "../lib/shipment";
import { IMPORTS_VIEW_KEY } from "../views/imports";
import { DialogField, ImportDialog } from "./ImportDialog";
import { PaymentDialog } from "@/components/payments/PaymentDialog";
import { ImportStageBar, type StageBarFact } from "./ImportStageBar";
import { ImportTimeline } from "./ImportTimeline";
import { ClearDialog, MilestoneDialog, TrackingDialog } from "./ImportStageDialogs";
import { daysInTransit, etaOverdue, nextAction, stageViews } from "../lib/stages";
import { costTypeLabel } from "./LandedCostPanel";
import ReceivingSheet, { type ReceivingSheetData } from "./ReceivingSheet";

const today = () => new Date().toISOString().slice(0, 10);
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

type Dialogs = "confirm" | "receive" | "addCost" | "close" | "cancel" | "prepay" | "delete" | "clear" | null;

export type ImportTab = "general" | "landed" | "payments" | "receipts" | "journal" | "history";

/** IMP-5: what the form gives the stage layout. */
export interface PostingStage {
  tab: ImportTab;
  tabKeys: readonly ImportTab[];
  onTabChange: (tab: ImportTab) => void;
  tracking?: ShipmentTracking;
  createdAt?: string | null;
  /** The general and landed-cost tabs (the form's own content). */
  children: React.ReactNode;
  /** Under the timeline in "Tarixçə": notes and attachments. */
  history?: React.ReactNode;
}

/**
 * Posting of an import shipment (IMP-2): Confirm, Receive, + Add cost, Pay, Close, Reopen and
 * Cancel, and the tabs with payables, receipts and the journal. Buttons follow the status and the
 * user's permissions; the database checks both again.
 */
export function PostingPanel({
  draft,
  lookups,
  config,
  dirty,
  stage,
}: {
  draft: ShipmentDraft;
  lookups: ImportLookups;
  config: ImportsConfig;
  /** The form has unsaved changes: Confirm waits for a save. */
  dirty: boolean;
  /** IMP-5 (UI_STANDARD): the stage layout: stage bar, the page's tabs and their content. */
  stage?: PostingStage;
}) {
  const { t, formatDate } = useI18n();
  const fmt = useFormatter();
  const { can, isAdmin } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const id = draft.id as string;
  const posted = draft.status !== "draft";
  const view = useQuery({
    queryKey: ["imports", "posting", id],
    queryFn: async () => {
      const r = await getPostingViewAction(id);
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
    // Drafts too: their supplier prepayments (IMP-3).
    enabled: !!draft.id,
  });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [opKey, setOpKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"payables" | "receipts" | "journal">("payables");
  const [paying, setPaying] = useState<PayableView | null>(null);
  const [settling, setSettling] = useState<CostLineDraft | null>(null);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [milestone, setMilestone] = useState<"departed" | "arrived_customs" | "note" | null>(null);
  const uiStandard = useUiStandard();
  const { printData, setPrintData } = useDocumentPrint<ReceivingSheetData>(700);

  const products = useMemo(() => new Map(lookups.products.map((p) => [p.id, p])), [lookups.products]);
  const warehouseNames = useMemo(() => Object.fromEntries(lookups.warehouses.map((w) => [w.id, w.name])), [lookups.warehouses]);
  const supplierName = lookups.suppliers.find((s) => s.id === draft.supplierId)?.name ?? "";
  const money = (n: number) => `${figure(n, fmt, 2)} ${t("common.currency")}`;

  const open = (d: Dialogs) => {
    setOpKey(newKey());
    setDialog(d);
  };
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["imports", "shipment", id] }),
      client.invalidateQueries({ queryKey: ["imports", "posting", id] }),
      invalidateModel(client, IMPORTS_VIEW_KEY),
    ]);
  };
  /** Runs a posting action; a database error shows its translated reason and detail. */
  const run = async (work: () => Promise<PostingResult<Record<string, unknown>>>, done: string) => {
    setBusy(true);
    const r = await work();
    setBusy(false);
    if (!r.success) {
      const known = t(r.error);
      toast(t("importPosting.failed"), [known !== r.error ? known : null, r.detail].filter(Boolean).join(" "), "error");
      return false;
    }
    toast(done, undefined, "success");
    setDialog(null);
    await refresh();
    return true;
  };

  const canApprove = can("can_approve_imports");
  const canManage = can("can_manage_imports");
  const actions = actionsFor(draft.status).filter((a) =>
    a === "reopen" ? isAdmin : a === "addCost" || a === "pay" ? canManage : canApprove
  );
  // UI-5: a draft with nothing posted is deleted; a prepaid draft and anything confirmed are
  // cancelled with a reason (removalFor). The database checks both again.
  const removal = view.data ? removalFor(draft.status, view.data.prepayments.length > 0) : null;
  const canDelete = removal === "delete" && canManage;
  const canCancel = removal === "cancel" && canApprove;
  const router = useRouter();
  // The list's row menu opens the shipment with ?do=delete or ?do=cancel (views/rowActions.ts):
  // open that dialog once, only right after the user picked it there.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current || !view.data) return;
    const { pathname, search, hash } = window.location;
    const params = new URLSearchParams(search);
    const key = params.get(ACTION_PARAM);
    if (!key) return;
    requested.current = true;
    params.delete(ACTION_PARAM);
    window.history.replaceState(window.history.state, "", `${pathname}${params.size ? `?${params}` : ""}${hash}`);
    const store = window.sessionStorage;
    if (!hasRowActionIntent(store, pathname, key, Date.now())) return;
    forgetRowAction(store);
    if (!((key === "delete" && canDelete) || (key === "cancel" && canCancel))) return;
    // Opened after this render (a dialog is state, not something to set while rendering).
    const timer = window.setTimeout(() => open(key), 0);
    return () => window.clearTimeout(timer);
  }, [view.data, canDelete, canCancel]);
  const received = (view.data?.receipts ?? []).flatMap((r) => r.lines.map((l) => ({ shipmentLineId: l.shipmentLineId, qtyStockUnit: l.qtyStockUnit, warehouseId: l.warehouseId })));
  const lines = receiveLines(draft, products, received);
  const estimates = draft.costs.filter((c) => c.isEstimate);
  // IMP-5: the goods still open for a supplier prepayment (the shipment's currency).
  const goodsFc = Math.round(draft.lines.reduce((sum, l) => sum + l.qtyPurchase * l.unitPriceFc, 0) * 100) / 100;
  const goodsOpenFc = Math.max(0, Math.round((goodsFc - (view.data?.prepayments ?? []).filter((p) => !p.costLineId && p.status === "open").reduce((sum, p) => sum + p.amountFc, 0)) * 100) / 100);
  const fetchCbar = async (currency: string, day: string) => {
    const r = await cbarRateAction(currency, day);
    return r.success ? r.data.rate : null;
  };
  const postingError = (r: { error: string; detail?: string }) => {
    const known = t(r.error);
    return [known !== r.error ? known : null, r.detail].filter(Boolean).join(" ") || t("importPosting.failed");
  };
  const afterPosting = async (done: string) => {
    toast(done, undefined, "success");
    await refresh();
  };

  const printSheet = (rows: { shipmentLineId: string; warehouseId: string | null; qtyStock: number }[], receiptNumber: string | null, onDate: string) =>
    setPrintData({
      pages: receivingSheetPages(rows, draft, products),
      shipmentNumber: draft.number ?? "",
      receiptNumber,
      supplierName,
      invoiceNo: draft.invoiceNo,
      customsDeclarationNo: draft.customsDeclarationNo,
      date: onDate,
      warehouseNames,
    });

  /** IMP-5: the page's stage bar, tabs and the posting tabs (payments, receipt, journal, history). */
  function stageLayout() {
    const tr = stage?.tracking;
    const facts = { status: draft.status, arrivedOn: tr?.arrivedOn ?? null };
    const views = stageViews({
      status: draft.status,
      createdAt: stage?.createdAt ?? null,
      confirmDate: tr?.confirmDate ?? null,
      departedOn: tr?.departedOn ?? null,
      arrivedOn: tr?.arrivedOn ?? null,
      clearedOn: tr?.clearedOn ?? null,
      firstReceiptDate: view.data?.receipts[0]?.receiptDate ?? null,
      closedAt: tr?.closedAt ?? null,
    });
    const next = nextAction(facts);
    const allowed =
      next === "confirm" ? actions.includes("confirm") : next === "receive" ? actions.includes("receive") : next === "close" ? actions.includes("close") : next === "clear" ? canApprove : next === "arrived" ? canManage : false;
    const onNext = () => {
      if (next === "confirm") open("confirm");
      else if (next === "arrived") setMilestone("arrived_customs");
      else if (next === "clear") open("clear");
      else if (next === "receive") open("receive");
      else if (next === "close") open("close");
    };
    const today = new Date().toISOString().slice(0, 10);
    const transit = tr ? daysInTransit({ ...tr, status: draft.status }, today) : null;
    const overdue = tr ? etaOverdue({ eta: tr.eta, status: draft.status, arrivedOn: tr.arrivedOn }, today) : false;
    const carrier = tr?.carrierId ? lookups.suppliers.find((s) => s.id === tr.carrierId)?.name ?? null : null;
    const factsList: StageBarFact[] = ([
      tr?.transportMode || carrier ? { key: "carrier", label: t("imports.tracking.carrierMode"), value: [carrier, tr?.transportMode ? t(`imports.transportModes.${tr.transportMode}`) : null].filter(Boolean).join(" · ") } : null,
      tr?.trackingNo ? { key: "no", label: t("imports.tracking.trackingNo"), value: <span className="ds-mono">{tr.trackingNo}</span> } : null,
      tr?.vehicleNo ? { key: "vehicle", label: t("imports.tracking.vehicleNo"), value: <span className="ds-mono">{tr.vehicleNo}</span> } : null,
      tr?.departedOn ? { key: "dep", label: t("imports.tracking.departedOn"), value: formatDate(tr.departedOn) } : null,
      tr?.eta ? { key: "eta", label: t("imports.tracking.eta"), value: <span style={overdue ? { color: "var(--ds-danger-strong)", fontWeight: 600 } : undefined}>{formatDate(tr.eta)}{overdue ? ` · ${t("imports.tracking.overdue")}` : ""}</span> } : null,
      transit !== null ? { key: "transit", label: t("imports.tracking.inTransit"), value: t("imports.tracking.days", { count: transit }) } : null,
    ] as (StageBarFact | null)[]).filter((x): x is StageBarFact => !!x);
    const closedOrCancelled = draft.status === "closed" || draft.status === "cancelled";
    const menu = [
      draft.status === "draft" && canManage && draft.supplierId ? { key: "prepay", label: t("importPosting.prepay"), icon: <HandCoins className="h-4 w-4" />, onSelect: () => open("prepay"), disabled: busy || dirty } : null,
      draft.status === "confirmed" && actions.includes("receive") ? { key: "receive", label: t("imports.stages.receiveBeforeClear"), icon: <PackageCheck className="h-4 w-4" />, onSelect: () => open("receive") } : null,
      !closedOrCancelled && canManage ? { key: "milestone", label: t("imports.stages.addMilestone"), onSelect: () => setMilestone("note") } : null,
      !closedOrCancelled && canManage && stage?.tracking ? { key: "tracking", label: t("imports.tracking.edit"), onSelect: () => setTrackingOpen(true) } : null,
      actions.includes("reopen") ? { key: "reopen", label: t("importPosting.reopen"), icon: <RotateCcw className="h-4 w-4" />, onSelect: () => void run(() => reopenShipmentAction(id), t("importPosting.reopened")) } : null,
      canCancel ? { key: "cancel", label: t("importPosting.cancel"), icon: <Ban className="h-4 w-4" />, destructive: true, onSelect: () => open("cancel") } : null,
      canDelete ? { key: "delete", label: t("importPosting.deleteDraft"), icon: <Trash2 className="h-4 w-4" />, destructive: true, disabled: dirty, onSelect: () => open("delete") } : null,
    ].filter((x): x is NonNullable<typeof x> => !!x);
    const tab = stage?.tab ?? "general";
    const tabKeys = stage?.tabKeys ?? [];
    return (
      <div className="flex flex-col gap-4">
        <ImportStageBar
          stages={views}
          cancelled={draft.status === "cancelled"}
          nextLabel={next && allowed ? t(`imports.stageNext.${next}`) : null}
          onNext={onNext}
          nextDisabled={busy || (next === "confirm" && dirty)}
          nextHint={next === "confirm" && dirty ? t("importPosting.saveFirst") : undefined}
          menu={menu}
          facts={factsList}
          onEditTracking={!closedOrCancelled && canManage && stage?.tracking ? () => setTrackingOpen(true) : undefined}
        />
        <div className="ds-doc-tabs" role="tablist" aria-label={t("imports.tabs.label")}>
          {tabKeys.map((k) => (
            <button key={k} type="button" role="tab" id={`imports-tab-${k}`} aria-selected={tab === k} aria-controls={`imports-panel-${k}`} className="ds-tab" onClick={() => stage?.onTabChange(k)}>
              {t(`imports.tabs.${k}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`imports-panel-${tab}`} aria-labelledby={`imports-tab-${tab}`} className="flex flex-col gap-4">
          {tab === "general" || tab === "landed" ? stage?.children : null}
          {tab === "payments" ? (
            <section className="ds-card ds-card-pad flex flex-col gap-3" aria-label={t("imports.tabs.payments")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{t("imports.tabs.payments")}</h2>
                {draft.status === "draft" && canManage && draft.supplierId ? (
                  <button type="button" className="ds-btn ds-btn-sm" disabled={busy || dirty} onClick={() => open("prepay")}>
                    <HandCoins className="h-4 w-4" aria-hidden />
                    {t("importPosting.prepay")}
                  </button>
                ) : null}
              </div>
              {posted && estimates.length ? (
                <ul className="flex flex-col gap-1">
                  {estimates.map((c) => (
                    <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 text-[length:var(--ds-text-sm)]">
                      <span>{t("importPosting.estimateOpen", { cost: c.description || costTypeLabel(c.costType, config, t), amount: money(costTotalAzn(c)) })}</span>
                      <button type="button" className="ds-btn ds-btn-sm" onClick={() => { setOpKey(newKey()); setSettling(c); }}>
                        {t("importPosting.setActual")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {view.data?.prepayments.length ? (
                <ul className="flex flex-col gap-1 text-[length:var(--ds-text-sm)]" aria-label={t("importPosting.prepayments")}>
                  {view.data.prepayments.map((p) => (
                    <li key={p.id} className="tabular-nums">
                      {p.costLineId ? `${t("imports.costPay.advanceFor", { cost: (() => { const c = draft.costs.find((x) => x.key === p.costLineId); return c ? c.description || costTypeLabel(c.costType, config, t) : "—"; })() })} · ` : ""}
                      {t("importPosting.prepaymentLine", { date: formatDate(p.paymentDate), amount: `${p.amountFc} ${p.currencyCode}`, rate: p.rate, azn: money(p.amountAzn) })}
                      <span className="ms-2 ds-chip ds-chip-flat">{t(`importPosting.prepaymentStatus.${p.status}`)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {view.data && posted ? (
                <PayablesTab view={view.data} money={money} config={config} canPay={actions.includes("pay")} onPay={(p) => { setOpKey(newKey()); setPaying(p); }} formatDate={formatDate} />
              ) : !posted ? (
                <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("imports.costPay.draftHint")}</p>
              ) : null}
            </section>
          ) : null}
          {tab === "receipts" ? (
            <section className="ds-card ds-card-pad flex flex-col gap-3" aria-label={t("imports.tabs.receipts")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{t("imports.tabs.receipts")}</h2>
                {actions.includes("receive") ? (
                  <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy || !view.data} onClick={() => open("receive")}>
                    <PackageCheck className="h-4 w-4" aria-hidden />
                    {t("importPosting.receive")}
                  </button>
                ) : null}
              </div>
              {draft.status === "confirmed" && actions.includes("receive") ? <p className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-warning)" }}>{t("imports.stages.notClearedWarning")}</p> : null}
              {view.data && posted ? (
                <ReceiptsTab view={view.data} draft={draft} products={products} warehouseNames={warehouseNames} formatDate={formatDate} onPrint={(r) => printSheet(r.lines.map((l) => ({ shipmentLineId: l.shipmentLineId, warehouseId: l.warehouseId, qtyStock: l.qtyStockUnit })), r.number, r.receiptDate)} />
              ) : (
                <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("imports.stages.receiptAfterConfirm")}</p>
              )}
            </section>
          ) : null}
          {tab === "journal" ? (
            <section className="ds-card ds-card-pad flex flex-col gap-3" aria-label={t("imports.tabs.journal")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{t("imports.tabs.journal")}</h2>
                {posted && view.data ? <span className="text-[length:var(--ds-text-xs)] ds-muted tabular-nums">{t("importPosting.transit", { amount: money(view.data.transitBalance) })}</span> : null}
              </div>
              {view.data ? <JournalTab view={view.data} money={money} formatDate={formatDate} /> : null}
            </section>
          ) : null}
          {tab === "history" ? (
            <>
              <section className="ds-card ds-card-pad flex flex-col gap-3" aria-label={t("imports.tabs.history")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{t("imports.tabs.history")}</h2>
                  {!closedOrCancelled && canManage ? (
                    <button type="button" className="ds-btn ds-btn-sm" onClick={() => setMilestone("note")}>
                      {t("imports.stages.addMilestone")}
                    </button>
                  ) : null}
                </div>
                <ImportTimeline events={view.data?.events ?? []} config={config} />
              </section>
              {stage?.history}
            </>
          ) : null}
        </div>
        {dialogs}
      </div>
    );
  }

  const dialogs = (
    <>
      {/* Confirm */}
      <ConfirmDialog
        open={dialog === "confirm"}
        busy={busy}
        onOpenChange={(o) => setDialog(o ? "confirm" : null)}
        defaultDate={draft.invoiceDate ?? today()}
        onSubmit={(d) => run(() => confirmShipmentAction(id, d, opKey), t("importPosting.confirmed"))}
      />

      {view.data?.prepayments.length ? (
        <ul className="flex flex-col gap-1 text-[length:var(--ds-text-sm)]" aria-label={t("importPosting.prepayments")}>
          {view.data.prepayments.map((p) => (
            <li key={p.id} className="tabular-nums">
              {t("importPosting.prepaymentLine", { date: formatDate(p.paymentDate), amount: `${p.amountFc} ${p.currencyCode}`, rate: p.rate, azn: money(p.amountAzn) })}
              <span className="ms-2 ds-chip ds-chip-flat">{t(`importPosting.prepaymentStatus.${p.status}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {dialog === "prepay" && uiStandard ? (
        <PaymentDialog
          open
          onClose={() => setDialog(null)}
          direction="out"
          title={t("importPosting.prepayTitle")}
          counterpartyLabel={t("imports.fields.supplier")}
          counterpartyName={supplierName}
          documentLabel={t("imports.sheet.file")}
          documentNumber={draft.number}
          currency={draft.currencyCode}
          openBalance={goodsOpenFc}
          defaultRate={draft.currencyCode === "AZN" ? 1 : draft.invoiceRate}
          onFetchRate={draft.currencyCode === "AZN" ? undefined : (d) => fetchCbar(draft.currencyCode, d)}
          onSubmit={async (p) => {
            const r = await prepayAction(id, p.paymentDate, p.note, p.amountFc ?? p.totalAzn, p.rate ?? 1, p.lines, opKey);
            if (!r.success) return { success: false, error: postingError(r) };
            await afterPosting(t("importPosting.prepaid"));
            setDialog(null);
            return { success: true };
          }}
        />
      ) : dialog === "prepay" ? (
        <PrepayDialog
          draft={draft}
          busy={busy}
          accounts={lookups.accounts}
          money={money}
          onClose={() => setDialog(null)}
          onSubmit={(d, note, amountFc, rate, splits) => run(() => prepayAction(id, d, note, amountFc, rate, splits, opKey), t("importPosting.prepaid"))}
        />
      ) : null}

      {dialog === "receive" && view.data ? (
        <ReceiveDialog
          busy={busy}
          lines={lines}
          products={products}
          warehouses={lookups.warehouses}
          onClose={() => setDialog(null)}
          onPrint={(rows, d) => printSheet(rows.map((r) => ({ shipmentLineId: r.shipmentLineId, warehouseId: r.warehouseId, qtyStock: r.expected })), null, d)}
          onSubmit={(payload, d, note) => run(() => receiveShipmentAction(id, payload, d, note, opKey), t("importPosting.received"))}
        />
      ) : null}

      {dialog === "addCost" ? (
        <CostDialog
          mode="add"
          busy={busy}
          config={config}
          lookups={lookups}
          initial={newCost("other", config)}
          onClose={() => setDialog(null)}
          onSubmit={(cost, splits, d) => run(() => addCostAction(id, cost, splits, d, opKey), t("importPosting.costAdded"))}
        />
      ) : null}

      {settling ? (
        <CostDialog
          mode="settle"
          busy={busy}
          config={config}
          lookups={lookups}
          initial={settling}
          onClose={() => setSettling(null)}
          onSubmit={async (cost, _splits, d) => {
            const ok = await run(
              () => finalizeCostAction(id, settling.key, { amount: cost.amount, currencyCode: cost.currencyCode, rateToAzn: cost.rateToAzn, vatAmountAzn: cost.vatAmountAzn }, d, opKey),
              t("importPosting.costSettled")
            );
            if (ok) setSettling(null);
            return ok;
          }}
        />
      ) : null}

      {paying && uiStandard ? (
        // IMP-5: the one payment dialog; several accounts, the exchange difference in the preview.
        <PaymentDialog
          open
          onClose={() => setPaying(null)}
          direction="out"
          title={t("importPosting.payTitle")}
          counterpartyLabel={t("importPosting.partner")}
          counterpartyName={paying.partnerName}
          documentLabel={t("imports.sheet.file")}
          documentNumber={draft.number}
          currency={paying.currencyCode}
          openBalance={paying.currencyCode === "AZN" ? paying.openAzn : paying.openFc}
          bookingRate={paying.currencyCode === "AZN" ? null : paying.bookingRate}
          minDate={paying.documentDate}
          onFetchRate={paying.currencyCode === "AZN" ? undefined : (d) => fetchCbar(paying.currencyCode, d)}
          onSubmit={async (p) => {
            const r = await payPayableAction(paying.id, p.paymentDate, p.note, p.lines, opKey, p.amountFc, p.rate);
            if (!r.success) return { success: false, error: postingError(r) };
            await afterPosting(t("importPosting.paid"));
            setPaying(null);
            return { success: true };
          }}
        />
      ) : paying ? (
        <PayDialog
          payable={paying}
          busy={busy}
          accounts={lookups.accounts}
          money={money}
          onClose={() => setPaying(null)}
          onSubmit={async (d, note, splits, amountFc, rate) => {
            const ok = await run(() => payPayableAction(paying.id, d, note, splits, opKey, amountFc, rate), t("importPosting.paid"));
            if (ok) setPaying(null);
            return ok;
          }}
        />
      ) : null}

      <ImportDialog
        open={dialog === "close"}
        onOpenChange={(o) => setDialog(o ? "close" : null)}
        title={t("importPosting.closeTitle")}
        description={t("importPosting.closeHint")}
        closeLabel={t("common.close")}
        cancelLabel={t("common.cancel")}
        submitLabel={t("importPosting.close")}
        busy={busy}
        onSubmit={() => void run(() => closeShipmentAction(id, opKey), t("importPosting.closed"))}
      >
        {null}
      </ImportDialog>

      <TypeToConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
        confirmText={draft.number ?? ""}
        consequences={[t("importPosting.deleteHint")]}
        labels={{
          title: t("importPosting.deleteTitle"),
          description: t("importPosting.deleteHint"),
          instruction: t("importPosting.deleteType"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("importPosting.deleteDraft"),
          working: t("common.loading"),
          audit: t("importPosting.deleteAudit"),
        }}
        onConfirm={async () => {
          const result = await deleteDraftShipmentAction(id);
          if (!result.success) {
            toast(t("common.error"), t(result.error) + (result.detail ? ` ${result.detail}` : ""), "error");
            return;
          }
          toast(t("importPosting.deleted"), undefined, "success");
          setDialog(null);
          await invalidateModel(client, IMPORTS_VIEW_KEY);
          router.push("/imports");
        }}
      />
      <CancelDialog open={dialog === "cancel"} busy={busy} onOpenChange={(o) => setDialog(o ? "cancel" : null)} onSubmit={(reason) => run(() => cancelShipmentAction(id, reason, opKey), t("importPosting.cancelled"))} />

      {printData ? createPortal(<div className="print-area"><ReceivingSheet data={printData} /></div>, document.body) : null}
      {trackingOpen && stage?.tracking ? (
        <TrackingDialog
          draft={draft}
          tracking={stage.tracking}
          lookups={lookups}
          busy={busy}
          onClose={() => setTrackingOpen(false)}
          onSubmit={(fields) => run(() => updateTrackingAction(id, fields), t("imports.tracking.saved"))}
        />
      ) : null}
      {dialog === "clear" ? (
        <ClearDialog
          draft={draft}
          busy={busy}
          estimates={draft.costs.filter((c) => c.isEstimate && ["customs_duty", "customs_fee", "customs_vat", "broker"].includes(c.costType))}
          costLabel={(c) => c.description || costTypeLabel(c.costType, config, t)}
          onClose={() => setDialog(null)}
          onSettle={(c) => {
            setOpKey(newKey());
            setSettling(c);
          }}
          onSubmit={async (input) => {
            if (input.changed) {
              const u = await updateTrackingAction(id, { customs_declaration_no: input.declarationNo, customs_declaration_date: input.declarationDate });
              if (!u.success) {
                toast(t("importPosting.failed"), postingError(u), "error");
                return false;
              }
            }
            return run(() => clearShipmentAction(id, input.date, opKey), t("imports.stages.cleared"));
          }}
        />
      ) : null}
      {milestone ? (
        <MilestoneDialog
          kind={milestone}
          busy={busy}
          onClose={() => setMilestone(null)}
          onSubmit={(kind, d, note) => run(() => logEventAction(id, kind, d, note), t("imports.stages.milestoneSaved"))}
        />
      ) : null}
    </>
  );

  if (stage) {
    return stageLayout();
  }

  if (!draft.id) return null;

  return (
    <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="imports-posting">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="imports-posting" className="font-semibold">{t("importPosting.title")}</h2>
          {posted && view.data ? (
            <p className="text-[length:var(--ds-text-xs)] ds-muted tabular-nums">{t("importPosting.transit", { amount: money(view.data.transitBalance) })}</p>
          ) : (
            <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("importPosting.draftHint")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.includes("confirm") ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={dirty || busy} title={dirty ? t("importPosting.saveFirst") : undefined} onClick={() => open("confirm")}>
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t("importPosting.confirm")}
            </button>
          ) : null}
          {draft.status === "draft" && canManage ? (
            <button type="button" className="ds-btn ds-btn-sm" disabled={busy || dirty || !draft.supplierId} title={dirty ? t("importPosting.saveFirst") : undefined} onClick={() => open("prepay")}>
              <HandCoins className="h-4 w-4" aria-hidden />
              {t("importPosting.prepay")}
            </button>
          ) : null}
          {actions.includes("receive") ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy || !view.data} onClick={() => open("receive")}>
              <PackageCheck className="h-4 w-4" aria-hidden />
              {t("importPosting.receive")}
            </button>
          ) : null}
          {actions.includes("addCost") ? (
            <button type="button" className="ds-btn ds-btn-sm" disabled={busy} onClick={() => open("addCost")}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("imports.addCost")}
            </button>
          ) : null}
          {actions.includes("close") ? (
            <button type="button" className="ds-btn ds-btn-sm" disabled={busy} onClick={() => open("close")}>
              <Lock className="h-4 w-4" aria-hidden />
              {t("importPosting.close")}
            </button>
          ) : null}
          {actions.includes("reopen") ? (
            <button type="button" className="ds-btn ds-btn-sm" disabled={busy} onClick={() => void run(() => reopenShipmentAction(id), t("importPosting.reopened"))}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t("importPosting.reopen")}
            </button>
          ) : null}
          {canCancel ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy} onClick={() => open("cancel")}>
              <Ban className="h-4 w-4" aria-hidden />
              {t("importPosting.cancel")}
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" style={{ color: "var(--ds-danger-strong)" }} disabled={busy || dirty} title={dirty ? t("importPosting.saveFirst") : undefined} onClick={() => open("delete")}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("importPosting.deleteDraft")}
            </button>
          ) : null}
        </div>
      </div>

      {posted && estimates.length && actions.includes("addCost") ? (
        <ul className="flex flex-col gap-1">
          {estimates.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 text-[length:var(--ds-text-sm)]">
              <span>
                {t("importPosting.estimateOpen", { cost: c.description || costTypeLabel(c.costType, config, t), amount: money(costTotalAzn(c)) })}
              </span>
              <button type="button" className="ds-btn ds-btn-sm" onClick={() => { setOpKey(newKey()); setSettling(c); }}>
                {t("importPosting.setActual")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {posted ? (
        <>
          <div role="tablist" aria-label={t("importPosting.title")} className="flex flex-wrap gap-1" style={{ borderBottom: "1px solid var(--ds-border)" }}>
            {(["payables", "receipts", "journal"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`imports-tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`imports-tabpanel-${k}`}
                className={`ds-btn ds-btn-sm ${tab === k ? "ds-btn-primary" : "ds-btn-ghost"}`}
                onClick={() => setTab(k)}
              >
                {t(`importPosting.tabs.${k}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`imports-tabpanel-${tab}`} aria-labelledby={`imports-tab-${tab}`}>
            {view.isLoading ? <p className="ds-muted">{t("common.loading")}</p> : null}
            {view.error ? <p className="ds-muted">{t("imports.errors.failed")}</p> : null}
            {view.data && tab === "payables" ? (
              <PayablesTab view={view.data} money={money} config={config} canPay={actions.includes("pay")} onPay={(p) => { setOpKey(newKey()); setPaying(p); }} formatDate={formatDate} />
            ) : null}
            {view.data && tab === "receipts" ? (
              <ReceiptsTab view={view.data} draft={draft} products={products} warehouseNames={warehouseNames} formatDate={formatDate} onPrint={(r) => printSheet(r.lines.map((l) => ({ shipmentLineId: l.shipmentLineId, warehouseId: l.warehouseId, qtyStock: l.qtyStockUnit })), r.number, r.receiptDate)} />
            ) : null}
            {view.data && tab === "journal" ? <JournalTab view={view.data} money={money} formatDate={formatDate} /> : null}
          </div>
        </>
      ) : null}

      {dialogs}
    </section>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function PayablesTab({ view, money, config, canPay, onPay, formatDate }: { view: PostingView; money: (n: number) => string; config: ImportsConfig; canPay: boolean; onPay: (p: PayableView) => void; formatDate: (d: string) => string }) {
  const { t } = useI18n();
  // UI_STANDARD (UI-6): the payables on the grid, Pay in the row menu; old table with the flag off.
  const standard = useUiStandard();
  if (!view.payables.length) return <p className="ds-muted">{t("importPosting.noPayables")}</p>;
  if (standard) {
    const col = (k: string) => t(`importPosting.payableCols.${k}`);
    return (
      <div className="flex flex-col gap-2">
        <StandardGrid<PayableView>
          id="imports.payables"
          label={t("importPosting.payableCols.partner")}
          rows={view.payables}
          rowKey={(p) => p.id}
          columns={[
            { key: "partner", header: col("partner"), className: "font-medium", cell: (p) => p.partnerName || "—", sortValue: (p) => p.partnerName },
            { key: "for", header: col("for"), cell: (p) => (p.source === "goods" ? t("importPosting.forGoods") : p.costType ? costTypeLabel(p.costType as CostType, config, t) : "—") },
            { key: "date", header: col("date"), type: "date", cell: (p) => formatDate(p.documentDate), sortValue: (p) => p.documentDate },
            { key: "original", header: col("original"), type: "money", width: 168, cell: (p) => (p.currencyCode !== "AZN" ? `${p.amountFc} ${p.currencyCode} × ${p.bookingRate}` : "—") },
            { key: "amount", header: col("amount"), type: "money", cell: (p) => money(p.amountAzn), sortValue: (p) => p.amountAzn },
            { key: "paid", header: col("paid"), type: "money", cell: (p) => money(p.paidAzn), sortValue: (p) => p.paidAzn },
            { key: "open", header: col("open"), type: "money", className: "font-semibold", cell: (p) => money(p.openAzn), sortValue: (p) => p.openAzn },
            { key: "status", header: col("status"), type: "status", cell: (p) => <Chip>{t(`importPosting.payableStatus.${p.status}`)}</Chip>, sortValue: (p) => p.status },
          ]}
          rowActions={(p) =>
            canPay && p.status === "open" ? (
              <RowActionsMenu
                label={t("common.actions")}
                items={[{ key: "pay", label: t("importPosting.payPartner", { name: p.partnerName }), icon: <Wallet className="h-4 w-4" />, onSelect: () => onPay(p) }]}
              />
            ) : null
          }
        />
        {view.payments.length ? <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("importPosting.paymentsCount", { count: view.payments.length })}</p> : null}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[44rem] border-collapse text-[length:var(--ds-text-sm)]">
        <thead>
          <tr>
            {["partner", "for", "date", "original", "amount", "paid", "open", "status"].map((k) => (
              <th key={k} scope="col" className={`px-2 py-1.5 font-semibold ${["original", "amount", "paid", "open"].includes(k) ? "text-end" : "text-start"}`}>{t(`importPosting.payableCols.${k}`)}</th>
            ))}
            <th scope="col"><span className="sr-only">{t("common.actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {view.payables.map((p) => (
            <tr key={p.id} style={{ borderTop: "1px solid var(--ds-border)" }}>
              <th scope="row" className="px-2 py-1.5 text-start font-medium">{p.partnerName || "—"}</th>
              <td className="px-2 py-1.5">{p.source === "goods" ? t("importPosting.forGoods") : p.costType ? costTypeLabel(p.costType as CostType, config, t) : "—"}</td>
              <td className="px-2 py-1.5">{formatDate(p.documentDate)}</td>
              <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{p.currencyCode !== "AZN" ? `${p.amountFc} ${p.currencyCode} × ${p.bookingRate}` : "—"}</td>
              <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(p.amountAzn)}</td>
              <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(p.paidAzn)}</td>
              <td className="px-2 py-1.5 text-end font-semibold ds-mono tabular-nums">{money(p.openAzn)}</td>
              <td className="px-2 py-1.5"><span className="ds-chip ds-chip-flat">{t(`importPosting.payableStatus.${p.status}`)}</span></td>
              <td className="px-2 py-1.5 text-end">
                {canPay && p.status === "open" ? (
                  <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => onPay(p)} aria-label={t("importPosting.payPartner", { name: p.partnerName })}>
                    <Wallet className="h-4 w-4" aria-hidden />
                    {t("importPosting.pay")}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.payments.length ? (
        <p className="mt-2 text-[length:var(--ds-text-xs)] ds-muted">{t("importPosting.paymentsCount", { count: view.payments.length })}</p>
      ) : null}
    </div>
  );
}

function ReceiptsTab({
  view,
  draft,
  products,
  warehouseNames,
  formatDate,
  onPrint,
}: {
  view: PostingView;
  draft: ShipmentDraft;
  products: ReadonlyMap<string, ImportProduct>;
  warehouseNames: Readonly<Record<string, string>>;
  formatDate: (d: string) => string;
  onPrint: (r: PostingView["receipts"][number]) => void;
}) {
  const { t } = useI18n();
  if (!view.receipts.length) return <p className="ds-muted">{t("importPosting.noReceipts")}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {view.receipts.map((r) => (
        <li key={r.id} className="flex flex-col gap-1 p-2" style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{r.number} · {formatDate(r.receiptDate)}{r.createdByName ? ` · ${r.createdByName}` : ""}</span>
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => onPrint(r)}>
              <Printer className="h-4 w-4" aria-hidden />
              {t("importPosting.printSheet")}
            </button>
          </div>
          <ul className="text-[length:var(--ds-text-sm)]">
            {r.lines.map((l) => {
              const line = draft.lines.find((x) => x.key === l.shipmentLineId);
              const p = line ? products.get(line.productId) : undefined;
              const sheets = sheetsOf(l.qtyStockUnit, p?.sheetLengthM ?? null);
              const diff = l.expectedQtyStockUnit !== null ? Math.round((l.qtyStockUnit - l.expectedQtyStockUnit) * 1000) / 1000 : 0;
              return (
                <li key={l.id} className="tabular-nums">
                  {p?.code} {p?.name} → {warehouseNames[l.warehouseId] ?? "—"}: {l.qtyStockUnit}
                  {p?.sheetLengthM ? ` ${t("imports.units.metre")} (${sheets} ${line?.purchaseUnit ?? ""})` : ""}
                  {diff !== 0 ? <span className="ms-2 ds-muted">{t("importPosting.differenceShort", { diff: diff > 0 ? `+${diff}` : String(diff) })}</span> : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function JournalTab({ view, money, formatDate }: { view: PostingView; money: (n: number) => string; formatDate: (d: string) => string }) {
  const { t } = useI18n();
  // UI_STANDARD (UI-6): each entry's lines on the grid ("code · account" on one line); old tables with the flag off.
  const standard = useUiStandard();
  if (!view.journal.length) return <p className="ds-muted">{t("importPosting.noJournal")}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {view.journal.map((e) => (
        <li key={e.id} className="flex flex-col gap-1">
          <p className="text-[length:var(--ds-text-sm)]">
            <span className="font-semibold">{e.entryNo}</span> · {formatDate(e.entryDate)} · {t(`importPosting.entryTypes.${e.documentType}`)}
            {e.reversalOf ? <span className="ms-2 ds-chip ds-chip-flat">{t("importPosting.storno")}</span> : null}
            {e.reversedBy ? <span className="ms-2 ds-chip ds-chip-flat">{t("importPosting.reversed")}</span> : null}
          </p>
          {e.description ? <p className="text-[length:var(--ds-text-xs)] ds-muted">{e.description}</p> : null}
          {standard ? (
            <StandardGrid<(typeof e.lines)[number]>
              id="imports.journal.lines"
              label={`${e.entryNo} · ${t(`importPosting.entryTypes.${e.documentType}`)}`}
              rows={e.lines}
              rowKey={(l) => String(e.lines.indexOf(l))}
              columns={[
                { key: "account", header: t("importPosting.journalCols.account"), width: 220, cell: (l) => codeName(l.code, l.name) },
                { key: "memo", header: t("importPosting.journalCols.memo"), cell: (l) => `${l.memo ?? ""}${l.partnerName ? ` · ${l.partnerName}` : ""}` || "—" },
                { key: "debit", header: t("importPosting.journalCols.debit"), type: "money", cell: (l) => (l.debit ? money(l.debit) : "") },
                { key: "credit", header: t("importPosting.journalCols.credit"), type: "money", cell: (l) => (l.credit ? money(l.credit) : "") },
              ]}
            />
          ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[36rem] border-collapse text-[length:var(--ds-text-xs)]">
              <thead>
                <tr>
                  <th scope="col" className="px-2 py-1 text-start">{t("importPosting.journalCols.account")}</th>
                  <th scope="col" className="px-2 py-1 text-start">{t("importPosting.journalCols.memo")}</th>
                  <th scope="col" className="px-2 py-1 text-end">{t("importPosting.journalCols.debit")}</th>
                  <th scope="col" className="px-2 py-1 text-end">{t("importPosting.journalCols.credit")}</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--ds-border)" }}>
                    <td className="px-2 py-1"><span className="ds-mono">{l.code}</span> {l.name}</td>
                    <td className="px-2 py-1">{l.memo}{l.partnerName ? ` · ${l.partnerName}` : ""}</td>
                    <td className="px-2 py-1 text-end ds-mono tabular-nums">{l.debit ? money(l.debit) : ""}</td>
                    <td className="px-2 py-1 text-end ds-mono tabular-nums">{l.credit ? money(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function ConfirmDialog({ open, busy, onOpenChange, defaultDate, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; defaultDate: string; onSubmit: (date: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [day, setDay] = useState(defaultDate);
  return (
    <ImportDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("importPosting.confirmTitle")}
      description={t("importPosting.confirmHint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("importPosting.confirm")}
      busy={busy}
      canSubmit={!!day}
      onSubmit={() => void onSubmit(day)}
    >
      <DialogField label={t("importPosting.date")}>
        <input type="date" className="ds-input" value={day} onChange={(e) => setDay(e.target.value)} required />
      </DialogField>
    </ImportDialog>
  );
}

function CancelDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <ImportDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("importPosting.cancelTitle")}
      description={t("importPosting.cancelHint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("importPosting.cancel")}
      danger
      busy={busy}
      canSubmit={reason.trim().length > 0}
      onSubmit={() => void onSubmit(reason.trim())}
    >
      <DialogField label={t("importPosting.cancelReason")}>
        <textarea className="ds-input min-h-[4rem]" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
      </DialogField>
    </ImportDialog>
  );
}

function ReceiveDialog({
  busy,
  lines,
  products,
  warehouses,
  onClose,
  onPrint,
  onSubmit,
}: {
  busy: boolean;
  lines: ReturnType<typeof receiveLines>;
  products: ReadonlyMap<string, ImportProduct>;
  warehouses: ImportLookups["warehouses"];
  onClose: () => void;
  onPrint: (rows: ReceiveRow[], date: string) => void;
  onSubmit: (payload: ReturnType<typeof checkReceipt>["payload"], date: string, note: string | null) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const uiStandard = useUiStandard();
  const [rows, setRows] = useState<ReceiveRow[]>(() => initialReceiveRows(lines));
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const byLine = new Map(lines.map((l) => [l.shipmentLineId, l]));
  const check = checkReceipt(rows, lines);
  const set = (key: string, patch: Partial<ReceiveRow>) => {
    setReviewed(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const showDifferences = check.differences.length > 0 && !reviewed;

  return (
    <ImportDialog
      open
      wide
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("importPosting.receiveTitle")}
      description={t("importPosting.receiveHint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={showDifferences ? t("importPosting.reviewDifferences") : t("importPosting.postReceipt")}
      busy={busy}
      canSubmit={check.issues.length === 0}
      extraActions={
        <button type="button" className="ds-btn" onClick={() => onPrint(rows, day)} disabled={busy}>
          <Printer className="h-4 w-4" aria-hidden />
          {t("importPosting.printSheet")}
        </button>
      }
      onSubmit={async () => {
        if (showDifferences) {
          setReviewed(true);
          return;
        }
        await onSubmit(check.payload, day, note.trim() || null);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DialogField label={t("importPosting.date")}>
          <input type="date" className="ds-input" value={day} onChange={(e) => setDay(e.target.value)} required />
        </DialogField>
        <DialogField label={t("importPosting.note")}>
          <input className="ds-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </DialogField>
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[46rem] border-collapse text-[length:var(--ds-text-sm)]">
          <thead>
            <tr>
              {["product", "left", "warehouse", "expected", "counted"].map((k) => (
                <th key={k} scope="col" className={`px-2 py-1.5 font-semibold ${k === "product" || k === "warehouse" ? "text-start" : "text-end"}`}>{t(`importPosting.receiveCols.${k}`)}</th>
              ))}
              <th scope="col"><span className="sr-only">{t("common.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const line = byLine.get(row.shipmentLineId);
              if (!line) return null;
              const p = products.get(line.productId);
              const name = `${p?.code ?? ""} ${p?.name ?? ""}`.trim();
              const both = (qty: number) => {
                const s = sheetsOf(qty, line.sheetLengthM);
                return s !== null ? `${s} ${line.purchaseUnit ?? ""} · ${qty} ${t("imports.units.metre")}` : `${qty} ${line.purchaseUnit ?? ""}`;
              };
              const rowIssues = check.issues.filter((i) => i.rowKey === row.key || (i.shipmentLineId === row.shipmentLineId && i.code === "over"));
              const diff = check.differences.find((d) => d.rowKey === row.key);
              return (
                <tr key={row.key} style={{ borderTop: "1px solid var(--ds-border)" }}>
                  <th scope="row" className="px-2 py-1.5 text-start font-medium">
                    {name}
                    {rowIssues.map((i) => (
                      <span key={i.code} className="block text-[length:var(--ds-text-xs)] font-normal" role="alert" style={{ color: "var(--ds-danger, #e11d48)" }}>
                        {t(`importPosting.receiveIssues.${i.code}`)}
                      </span>
                    ))}
                    {differsFromPlan(row) ? (
                      <span className="ms-1 inline-flex align-middle">
                        <Chip tone="warning">{t("importPosting.differsFromPlan")}</Chip>
                      </span>
                    ) : null}
                    {diff && showDifferences ? (
                      <span className="block text-[length:var(--ds-text-xs)] font-normal" style={{ color: "var(--ds-warning, #d97706)" }}>
                        {t("importPosting.difference", { diff: diff.difference > 0 ? `+${diff.difference}` : String(diff.difference) })}
                      </span>
                    ) : null}
                  </th>
                  <td className="px-2 py-1.5 text-end tabular-nums">{both(line.remaining)}</td>
                  <td className="px-2 py-1.5">
                    {uiStandard ? (
                      <EntityLookup
                        entity="warehouse"
                        size="sm"
                        value={row.warehouseId}
                        selectedLabel={warehouses.find((w) => w.id === row.warehouseId)?.name}
                        onChange={(id) => set(row.key, { warehouseId: id })}
                        aria-label={`${t("importPosting.receiveCols.warehouse")}: ${name}`}
                      />
                    ) : (
                    <select className="ds-input" aria-label={`${t("importPosting.receiveCols.warehouse")}: ${name}`} value={row.warehouseId ?? ""} onChange={(e) => set(row.key, { warehouseId: e.target.value || null })}>
                      <option value="">{t("common.select")}</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-end">
                    <QtyInput label={`${t("importPosting.receiveCols.expected")}: ${name}`} value={row.expected} sheetLength={line.sheetLengthM} onChange={(v) => set(row.key, { expected: v ?? 0 })} />
                  </td>
                  <td className="px-2 py-1.5 text-end">
                    <QtyInput label={`${t("importPosting.receiveCols.counted")}: ${name}`} value={row.actual} sheetLength={line.sheetLengthM} placeholder={String(sheetsOf(row.expected, line.sheetLengthM) ?? row.expected)} onChange={(v) => set(row.key, { actual: v })} />
                  </td>
                  <td className="px-2 py-1.5 text-end whitespace-nowrap">
                    <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" aria-label={t("importPosting.splitRow", { name })} onClick={() => setRows((rs) => splitReceiveRow(rs, row.key, line))}>
                      <Split className="h-4 w-4" aria-hidden />
                    </button>
                    {rows.filter((r) => r.shipmentLineId === row.shipmentLineId).length > 1 ? (
                      <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" aria-label={t("imports.removeLine", { name })} onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("importPosting.receiveFootnote")}</p>
      {check.issues.some((i) => i.code === "nothing") ? <p className="ds-muted">{t("importPosting.receiveIssues.nothing")}</p> : null}
    </ImportDialog>
  );
}

/** A quantity in the stock unit; sheet products are typed in sheets and stored in metres. */
function QtyInput({ label, value, sheetLength, placeholder, onChange }: { label: string; value: number | null; sheetLength: number | null; placeholder?: string; onChange: (v: number | null) => void }) {
  const shown = value === null ? "" : String(sheetLength ? Math.round((value / sheetLength) * 1000) / 1000 : value);
  return (
    <input
      className="ds-input ds-mono w-24 tabular-nums"
      type="number"
      min={0}
      step={sheetLength ? 1 : "any"}
      inputMode="decimal"
      aria-label={label}
      value={shown}
      placeholder={placeholder}
      onChange={(e) => {
        if (e.target.value === "") return onChange(null);
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n >= 0) onChange(sheetLength ? Math.round(n * sheetLength * 1000) / 1000 : n);
      }}
    />
  );
}

function PayDialog({
  payable,
  busy,
  accounts,
  money,
  onClose,
  onSubmit,
}: {
  payable: PayableView;
  busy: boolean;
  accounts: ImportLookups["accounts"];
  money: (n: number) => string;
  onClose: () => void;
  onSubmit: (date: string, note: string | null, splits: { account_id: string; amount: number }[], amountFc: number | null, rate: number | null) => Promise<boolean>;
}) {
  const { t, formatDate } = useI18n();
  const uiStandard = useUiStandard();
  const { toast } = useToast();
  const foreign = payable.currencyCode !== "AZN";
  const [day, setDay] = useState(() => (today() < payable.documentDate ? payable.documentDate : today()));
  const [note, setNote] = useState("");
  // IMP-3: a foreign-currency debt is paid in its currency at the payment-date rate.
  const [amountFc, setAmountFc] = useState<number | null>(foreign ? payable.openFc : null);
  const [rate, setRate] = useState<number | null>(foreign ? payable.bookingRate : null);
  const [rateBusy, setRateBusy] = useState(false);
  const fx = fxPayment({ currencyCode: payable.currencyCode, openFc: payable.openFc, openAzn: payable.openAzn, amountFc: foreign ? amountFc ?? 0 : 0, rate: rate ?? 0 });
  const [splits, setSplits] = useState<PaySplit[]>(() => [newSplit(null, foreign ? fx.paidAzn : payable.openAzn)]);
  const totals = payTotals(foreign ? fx.paidAzn : payable.openAzn, splits);
  const tooEarly = day < payable.documentDate;
  const fxMismatch = foreign && Math.abs(totals.thisPayment - fx.paidAzn) > 0.011;
  const set = (key: string, patch: Partial<PaySplit>) => setSplits((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  // One account: it follows the amount × rate as they change.
  const follow = (paid: number) => setSplits((s) => (s.length === 1 ? [{ ...s[0], amount: paid }] : s));

  const getRate = async () => {
    setRateBusy(true);
    const r = await cbarRateAction(payable.currencyCode, day);
    setRateBusy(false);
    if (!r.success) {
      toast(t("imports.rate.failed"), t(r.error), "error");
      return;
    }
    setRate(r.data.rate);
    follow(fxPayment({ currencyCode: payable.currencyCode, openFc: payable.openFc, openAzn: payable.openAzn, amountFc: amountFc ?? 0, rate: r.data.rate }).paidAzn);
    if (r.data.date !== day) toast(t("imports.rate.applied", { currency: payable.currencyCode, rate: r.data.rate }), t("imports.rate.otherDate", { date: formatDate(r.data.date) }), "success");
  };

  const canSubmit = foreign
    ? (amountFc ?? 0) > 0 && (rate ?? 0) > 0 && !fx.overpay && totals.complete && !totals.duplicateAccount && !fxMismatch && !tooEarly
    : totals.complete && !totals.overpay && !totals.duplicateAccount && totals.thisPayment > 0 && !tooEarly;

  return (
    <ImportDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("importPosting.payTitle", { name: payable.partnerName })}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("importPosting.pay")}
      busy={busy}
      canSubmit={canSubmit}
      onSubmit={() => void onSubmit(day, note.trim() || null, paySplitsPayload(splits), foreign ? amountFc : null, foreign ? rate : null)}
    >
      <p className="tabular-nums">
        {t("importPosting.openBalance")}: <strong>{foreign ? `${figureFc(payable.openFc)} ${payable.currencyCode} · ` : ""}{money(payable.openAzn)}</strong>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DialogField label={t("importPosting.paymentDate")} hint={t("importPosting.notBefore", { date: formatDate(payable.documentDate) })}>
          <input type="date" className="ds-input" min={payable.documentDate} value={day} onChange={(e) => setDay(e.target.value)} required aria-invalid={tooEarly || undefined} />
        </DialogField>
        <DialogField label={t("importPosting.note")}>
          <input className="ds-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </DialogField>
        {foreign ? (
          <>
            <DialogField label={t("importPosting.amountFc", { currency: payable.currencyCode })}>
              <input
                className="ds-input ds-mono tabular-nums"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={amountFc ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setAmountFc(v);
                  follow(fxPayment({ currencyCode: payable.currencyCode, openFc: payable.openFc, openAzn: payable.openAzn, amountFc: v ?? 0, rate: rate ?? 0 }).paidAzn);
                }}
              />
            </DialogField>
            <DialogField label={t("importPosting.paymentRate")} hint={t("importPosting.bookingRate", { rate: payable.bookingRate })}>
              <span className="flex gap-2">
                <input
                  className="ds-input ds-mono tabular-nums flex-1"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={rate ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    setRate(v);
                    follow(fxPayment({ currencyCode: payable.currencyCode, openFc: payable.openFc, openAzn: payable.openAzn, amountFc: amountFc ?? 0, rate: v ?? 0 }).paidAzn);
                  }}
                />
                <button type="button" className="ds-btn ds-btn-sm" onClick={() => void getRate()} disabled={rateBusy}>
                  <RefreshCw className={`h-4 w-4 ${rateBusy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                  {t("imports.rate.getCbar")}
                </button>
              </span>
            </DialogField>
          </>
        ) : null}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="ds-label mb-1">{t("importPosting.payFrom")}</legend>
        {splits.map((s, i) => (
          <div key={s.key} className="flex flex-wrap items-center gap-2">
            {uiStandard ? (
              <EntityLookup
                entity="account"
                className="min-w-[12rem] flex-1"
                value={s.accountId}
                selectedLabel={accounts.find((a) => a.id === s.accountId)?.name}
                onChange={(id) => set(s.key, { accountId: id })}
                aria-label={t("importPosting.splitAccount", { n: i + 1 })}
              />
            ) : (
            <select className="ds-input min-w-[12rem] flex-1" aria-label={t("importPosting.splitAccount", { n: i + 1 })} value={s.accountId ?? ""} onChange={(e) => set(s.key, { accountId: e.target.value || null })}>
              <option value="">{t("common.select")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            )}
            <input
              className="ds-input ds-mono w-32 tabular-nums"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              aria-label={t("importPosting.splitAmount", { n: i + 1 })}
              value={s.amount ?? ""}
              onChange={(e) => set(s.key, { amount: e.target.value === "" ? null : Number(e.target.value) })}
            />
            {splits.length > 1 ? (
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" aria-label={t("importPosting.removeSplit", { n: i + 1 })} onClick={() => setSplits((x) => x.filter((y) => y.key !== s.key))}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost self-start" onClick={() => setSplits((x) => [...x, newSplit(null, Math.max(0, round2(totals.remainingAfter)))])}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("importPosting.addAccount")}
        </button>
      </fieldset>
      <dl className="grid grid-cols-2 gap-2 tabular-nums" aria-live="polite">
        <dt className="ds-muted">{t("importPosting.thisPayment")}</dt>
        <dd className="text-end font-semibold">{money(totals.thisPayment)}</dd>
        {foreign ? (
          <>
            <dt className="ds-muted">{t("importPosting.settledBooking")}</dt>
            <dd className="text-end">{money(fx.settledAzn)}</dd>
            <dt className="ds-muted">{fx.differenceAzn > 0 ? t("importPosting.fxLoss") : t("importPosting.fxGain")}</dt>
            <dd className="text-end">{money(Math.abs(fx.differenceAzn))}</dd>
            <dt className="ds-muted">{t("importPosting.remainingAfter")}</dt>
            <dd className="text-end">{figureFc(Math.max(0, fx.remainingFc))} {payable.currencyCode} · {money(Math.max(0, fx.remainingAzn))}</dd>
          </>
        ) : (
          <>
            <dt className="ds-muted">{t("importPosting.remainingAfter")}</dt>
            <dd className="text-end">{money(Math.max(0, totals.remainingAfter))}</dd>
          </>
        )}
      </dl>
      {(foreign ? fx.overpay : totals.overpay) ? <p role="alert" style={{ color: "var(--ds-danger, #e11d48)" }}>{t("importPosting.overpay", { amount: foreign ? `${figureFc(payable.openFc)} ${payable.currencyCode}` : money(payable.openAzn) })}</p> : null}
      {fxMismatch ? <p role="alert" style={{ color: "var(--ds-danger, #e11d48)" }}>{t("importPosting.fxMismatch", { amount: money(fx.paidAzn) })}</p> : null}
      {totals.duplicateAccount ? <p role="alert" style={{ color: "var(--ds-danger, #e11d48)" }}>{t("importPosting.duplicateAccount")}</p> : null}
      {tooEarly ? <p role="alert" style={{ color: "var(--ds-danger, #e11d48)" }}>{t("importPosting.notBefore", { date: formatDate(payable.documentDate) })}</p> : null}
      {foreign ? <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("importPosting.fxNote", { currency: payable.currencyCode, rate: payable.bookingRate })}</p> : null}
    </ImportDialog>
  );
}

const figureFc = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** IMP-3: a supplier prepayment while the shipment is a draft, in the shipment currency. */
function PrepayDialog({
  draft,
  busy,
  accounts,
  money,
  onClose,
  onSubmit,
}: {
  draft: ShipmentDraft;
  busy: boolean;
  accounts: ImportLookups["accounts"];
  money: (n: number) => string;
  onClose: () => void;
  onSubmit: (date: string, note: string | null, amountFc: number, rate: number, splits: { account_id: string; amount: number }[]) => Promise<boolean>;
}) {
  const { t, formatDate } = useI18n();
  const uiStandard = useUiStandard();
  const { toast } = useToast();
  const foreign = draft.currencyCode !== "AZN";
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [amountFc, setAmountFc] = useState<number | null>(null);
  const [rate, setRate] = useState<number | null>(foreign ? draft.invoiceRate : 1);
  const [rateBusy, setRateBusy] = useState(false);
  const azn = round2((amountFc ?? 0) * (foreign ? rate ?? 0 : 1));
  const [splits, setSplits] = useState<PaySplit[]>(() => [newSplit()]);
  const totals = payTotals(azn, splits);
  const mismatch = Math.abs(totals.thisPayment - azn) > 0.011;
  const follow = (paid: number) => setSplits((s) => (s.length === 1 ? [{ ...s[0], amount: paid }] : s));
  const getRate = async () => {
    setRateBusy(true);
    const r = await cbarRateAction(draft.currencyCode, day);
    setRateBusy(false);
    if (!r.success) {
      toast(t("imports.rate.failed"), t(r.error), "error");
      return;
    }
    setRate(r.data.rate);
    follow(round2((amountFc ?? 0) * r.data.rate));
    if (r.data.date !== day) toast(t("imports.rate.applied", { currency: draft.currencyCode, rate: r.data.rate }), t("imports.rate.otherDate", { date: formatDate(r.data.date) }), "success");
  };
  return (
    <ImportDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("importPosting.prepayTitle")}
      description={t("importPosting.prepayHint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("importPosting.prepay")}
      busy={busy}
      canSubmit={(amountFc ?? 0) > 0 && (rate ?? 0) > 0 && totals.complete && !totals.duplicateAccount && !mismatch}
      onSubmit={() => void onSubmit(day, note.trim() || null, amountFc ?? 0, foreign ? rate ?? 0 : 1, paySplitsPayload(splits))}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DialogField label={t("importPosting.paymentDate")}>
          <input type="date" className="ds-input" value={day} onChange={(e) => setDay(e.target.value)} required />
        </DialogField>
        <DialogField label={t("importPosting.note")}>
          <input className="ds-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </DialogField>
        <DialogField label={t("importPosting.amountFc", { currency: draft.currencyCode })}>
          <input className="ds-input ds-mono tabular-nums" type="number" min={0} step="0.01" inputMode="decimal" value={amountFc ?? ""} onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            setAmountFc(v);
            follow(round2((v ?? 0) * (foreign ? rate ?? 0 : 1)));
          }} />
        </DialogField>
        {foreign ? (
          <DialogField label={t("importPosting.paymentRate")}>
            <span className="flex gap-2">
              <input className="ds-input ds-mono tabular-nums flex-1" type="number" min={0} step="any" inputMode="decimal" value={rate ?? ""} onChange={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                setRate(v);
                follow(round2((amountFc ?? 0) * (v ?? 0)));
              }} />
              <button type="button" className="ds-btn ds-btn-sm" onClick={() => void getRate()} disabled={rateBusy}>
                <RefreshCw className={`h-4 w-4 ${rateBusy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                {t("imports.rate.getCbar")}
              </button>
            </span>
          </DialogField>
        ) : null}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="ds-label mb-1">{t("importPosting.payFrom")}</legend>
        {splits.map((s, i) => (
          <div key={s.key} className="flex flex-wrap items-center gap-2">
            {uiStandard ? (
              <EntityLookup
                entity="account"
                className="min-w-[12rem] flex-1"
                value={s.accountId}
                selectedLabel={accounts.find((a) => a.id === s.accountId)?.name}
                onChange={(id) => setSplits((x) => x.map((y) => (y.key === s.key ? { ...y, accountId: id } : y)))}
                aria-label={t("importPosting.splitAccount", { n: i + 1 })}
              />
            ) : (
            <select className="ds-input min-w-[12rem] flex-1" aria-label={t("importPosting.splitAccount", { n: i + 1 })} value={s.accountId ?? ""} onChange={(e) => setSplits((x) => x.map((y) => (y.key === s.key ? { ...y, accountId: e.target.value || null } : y)))}>
              <option value="">{t("common.select")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            )}
            <input className="ds-input ds-mono w-32 tabular-nums" type="number" min={0} step="0.01" aria-label={t("importPosting.splitAmount", { n: i + 1 })} value={s.amount ?? ""} onChange={(e) => setSplits((x) => x.map((y) => (y.key === s.key ? { ...y, amount: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
          </div>
        ))}
        <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost self-start" onClick={() => setSplits((x) => [...x, newSplit(null, Math.max(0, round2(totals.remainingAfter)))])}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("importPosting.addAccount")}
        </button>
      </fieldset>
      <p className="tabular-nums" aria-live="polite">{t("importPosting.thisPayment")}: <strong>{money(azn)}</strong></p>
      {mismatch && totals.thisPayment > 0 ? <p role="alert" style={{ color: "var(--ds-danger, #e11d48)" }}>{t("importPosting.fxMismatch", { amount: money(azn) })}</p> : null}
    </ImportDialog>
  );
}

function CostDialog({
  mode,
  busy,
  config,
  lookups,
  initial,
  onClose,
  onSubmit,
}: {
  mode: "add" | "settle";
  busy: boolean;
  config: ImportsConfig;
  lookups: ImportLookups;
  initial: CostLineDraft;
  onClose: () => void;
  onSubmit: (cost: CostLineDraft, splits: { account_id: string; amount: number }[] | null, date: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const uiStandard = useUiStandard();
  const [cost, setCost] = useState<CostLineDraft>(initial);
  const [payNow, setPayNow] = useState(false);
  const [splits, setSplits] = useState<PaySplit[]>(() => [newSplit()]);
  const [day, setDay] = useState(today);
  const set = (patch: Partial<CostLineDraft>) => setCost((c) => ({ ...c, ...patch }));
  const total = costTotalAzn(cost);
  const totals = payTotals(total, splits);
  const settle = mode === "settle";
  const valid =
    cost.amount >= 0 &&
    (cost.currencyCode === "AZN" || cost.rateToAzn > 0) &&
    (settle || (payNow ? totals.complete && Math.abs(totals.remainingAfter) < 0.005 && !totals.duplicateAccount : !!cost.partnerId || total === 0));
  return (
    <ImportDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={settle ? t("importPosting.settleTitle") : t("importPosting.addCostTitle")}
      description={settle ? t("importPosting.settleHint") : t("importPosting.addCostHint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={settle ? t("importPosting.setActual") : t("imports.addCost")}
      busy={busy}
      canSubmit={valid}
      onSubmit={() => void onSubmit({ ...cost, isEstimate: settle ? false : cost.isEstimate }, !settle && payNow ? paySplitsPayload(splits) : null, day)}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!settle ? (
          <DialogField label={t("importPosting.costType")}>
            <select
              className="ds-input"
              value={cost.costType}
              onChange={(e) => {
                const type = e.target.value as CostType;
                const fresh = newCost(type, config);
                setCost((c) => ({ ...fresh, key: c.key, amount: c.amount, currencyCode: c.currencyCode, rateToAzn: c.rateToAzn, description: c.description }));
              }}
            >
              {COST_TYPES.filter((c) => c !== "customs_duty").map((c) => (
                <option key={c} value={c}>{costTypeLabel(c, config, t)}</option>
              ))}
            </select>
          </DialogField>
        ) : null}
        {!settle ? (
          <DialogField label={t("imports.costFields.description")}>
            <input className="ds-input" value={cost.description ?? ""} maxLength={500} onChange={(e) => set({ description: e.target.value || null })} />
          </DialogField>
        ) : null}
        <DialogField label={t("imports.costFields.amount")}>
          <input className="ds-input ds-mono tabular-nums" type="number" min={0} step="0.01" inputMode="decimal" value={cost.amount} onChange={(e) => set({ amount: Number(e.target.value) || 0 })} />
        </DialogField>
        <DialogField label={t("imports.costFields.currency")}>
          <select className="ds-input" value={cost.currencyCode} onChange={(e) => set({ currencyCode: e.target.value as ImportCurrency, ...(e.target.value === "AZN" ? { rateToAzn: 1 } : {}) })}>
            {IMPORT_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </DialogField>
        {cost.currencyCode !== "AZN" ? (
          <DialogField label={t("imports.costFields.rate")}>
            <input className="ds-input ds-mono tabular-nums" type="number" min={0} step="any" inputMode="decimal" value={cost.rateToAzn} onChange={(e) => set({ rateToAzn: Number(e.target.value) || 0 })} />
          </DialogField>
        ) : null}
        {cost.costType !== "customs_vat" ? (
          <DialogField label={t("imports.costFields.vat")} hint={config.costTypes[cost.costType].defaultVatRatePct ? t("imports.costFields.vatSuggest", { rate: config.costTypes[cost.costType].defaultVatRatePct }) : undefined}>
            <span className="flex gap-2">
              <input className="ds-input ds-mono tabular-nums flex-1" type="number" min={0} step="0.01" inputMode="decimal" value={cost.vatAmountAzn} onChange={(e) => set({ vatAmountAzn: Number(e.target.value) || 0 })} />
              {config.costTypes[cost.costType].defaultVatRatePct > 0 ? (
                <button type="button" className="ds-btn ds-btn-sm" onClick={() => set({ vatAmountAzn: suggestedVat(cost, config) })}>{t("importPosting.suggest")}</button>
              ) : null}
            </span>
          </DialogField>
        ) : null}
        {!settle && cost.costType !== "customs_vat" ? (
          <DialogField label={t("imports.costFields.method")}>
            <select className="ds-input" value={cost.splitMethod} onChange={(e) => set({ splitMethod: e.target.value as SplitMethod })} disabled={!cost.isCapitalized}>
              {methodsFor(cost.costType).filter((m) => m !== "manual").map((m) => (
                <option key={m} value={m}>{t(`imports.methods.${m}`)}</option>
              ))}
            </select>
          </DialogField>
        ) : null}
        {!settle ? (
          uiStandard ? (
            <DialogField label={t("lookup.audit.paidTo")} hint={t("lookup.audit.paidToHint")}>
              <EntityLookup
                entity="supplier"
                value={cost.partnerId}
                selectedLabel={lookups.suppliers.find((s) => s.id === cost.partnerId)?.name}
                onChange={(id) => set({ partnerId: id })}
                placeholder={t("imports.costFields.noPartner")}
                aria-label={t("lookup.audit.paidTo")}
              />
            </DialogField>
          ) : (
          <DialogField label={t("imports.costFields.partner")}>
            <select className="ds-input" value={cost.partnerId ?? ""} onChange={(e) => set({ partnerId: e.target.value || null })}>
              <option value="">{t("imports.costFields.noPartner")}</option>
              {lookups.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </DialogField>
          )
        ) : null}
        <DialogField label={t("importPosting.date")}>
          <input type="date" className="ds-input" value={day} onChange={(e) => setDay(e.target.value)} required />
        </DialogField>
      </div>
      {!settle ? (
        <div className="flex flex-wrap gap-4 text-[length:var(--ds-text-sm)]">
          {cost.costType !== "customs_vat" ? (
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={cost.isCapitalized} onChange={(e) => set({ isCapitalized: e.target.checked })} />
              {t("imports.costFields.capitalized")}
            </label>
          ) : null}
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={cost.isEstimate} onChange={(e) => set({ isEstimate: e.target.checked })} />
            {t("imports.costFields.estimate")}
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
            {t("imports.costFields.paidNow")}
          </label>
        </div>
      ) : null}
      {!settle && payNow ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="ds-label mb-1">{t("importPosting.payFrom")}</legend>
          {splits.map((s, i) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2">
              {uiStandard ? (
                <EntityLookup
                  entity="account"
                  className="min-w-[12rem] flex-1"
                  value={s.accountId}
                  selectedLabel={lookups.accounts.find((a) => a.id === s.accountId)?.name}
                  onChange={(id) => setSplits((x) => x.map((y) => (y.key === s.key ? { ...y, accountId: id } : y)))}
                  aria-label={t("importPosting.splitAccount", { n: i + 1 })}
                />
              ) : (
              <select className="ds-input min-w-[12rem] flex-1" aria-label={t("importPosting.splitAccount", { n: i + 1 })} value={s.accountId ?? ""} onChange={(e) => setSplits((x) => x.map((y) => (y.key === s.key ? { ...y, accountId: e.target.value || null } : y)))}>
                <option value="">{t("common.select")}</option>
                {lookups.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              )}
              <input className="ds-input ds-mono w-32 tabular-nums" type="number" min={0} step="0.01" aria-label={t("importPosting.splitAmount", { n: i + 1 })} value={s.amount ?? ""} onChange={(e) => setSplits((x) => x.map((y) => (y.key === s.key ? { ...y, amount: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
            </div>
          ))}
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost self-start" onClick={() => setSplits((x) => [...x, newSplit(null, Math.max(0, round2(totals.remainingAfter)))])}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("importPosting.addAccount")}
          </button>
          <p className="tabular-nums text-[length:var(--ds-text-sm)]" aria-live="polite">
            {t("importPosting.splitProgress", { paid: String(totals.thisPayment), total: String(total) })}
          </p>
        </fieldset>
      ) : null}
    </ImportDialog>
  );
}
