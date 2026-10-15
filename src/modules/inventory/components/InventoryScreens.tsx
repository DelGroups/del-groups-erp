"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CheckCircle2, ExternalLink, History, PencilLine, Plus, Printer, Trash2, Undo2, XCircle } from "lucide-react";
import { TypeToConfirmDialog, useToast } from "@/design-system/components";
import { formatFigure } from "@/design-system/logic";
import { useAuth } from "@/components/auth/AuthProvider";
import WarehouseSlipPrintTemplate, { warehouseSlipToPrintData } from "@/components/warehouse/WarehouseSlipPrintTemplate";
import { useI18n } from "@/i18n/I18nProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { fetchProductsCatalog } from "@/lib/products/api";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import type { WarehouseSlip, WarehouseSlipItem } from "@/types/database.types";
import { EngineScreen, FormView, invalidateModel, RecordPanel, useFormatter, type FormAction } from "@/views";
import { fetchWarehouseStockDashboard } from "../lib/fetchWarehouseStockDashboard";
import { approveWarehouseSlipAction, fetchWarehouseSlipsAction, rejectWarehouseSlipAction } from "../actions/warehouseSlips";
import { deleteInventoryCountAction, fetchInventoryCountsAction } from "../actions/inventoryCount";
import { deleteInitialBalanceDraftAction, fetchInitialBalanceListAction, unpostInitialBalanceDocumentAction } from "../actions/initialBalance";
import { fetchInventoryWriteoffs, type WriteoffRecord } from "../lib/writeoff";
import DamagedGoodsForm from "./DamagedGoodsForm";
import { CreateCountModal } from "./InventoryCountsPage";
import DamagedGoodsPrintTemplate, { type DamagedGoodsPrintData } from "./DamagedGoodsPrintTemplate";
import {
  countKpis,
  countsDefinition,
  COUNTS_VIEW_KEY,
  intakeDefinition,
  intakeKpis,
  INTAKE_VIEW_KEY,
  slipKpis,
  slipsDefinition,
  SLIPS_VIEW_KEY,
  stockDefinition,
  stockKpis,
  writeoffKpis,
  writeoffsDefinition,
  WRITEOFFS_VIEW_KEY,
  type CountRecord,
  type IntakeRecord,
  type SlipRecord,
  type StockRecord,
  type WriteoffViewRecord,
} from "../views/inventory";

type Row = Record<string, unknown>;
const rows = (list: unknown) => (list ?? []) as Row[];

// The module's own reads (same data and permission checks as the classic pages).
const STOCK = stockDefinition({ fetchAll: async () => rows((await fetchWarehouseStockDashboard()).rows) });
const SLIPS = slipsDefinition({
  fetchAll: async () => {
    const r = await fetchWarehouseSlipsAction();
    if (!r.success) throw new Error(r.error);
    return rows(r.slips);
  },
});
const COUNTS = countsDefinition({
  fetchAll: async () => {
    const r = await fetchInventoryCountsAction();
    if (!r.success) throw new Error(r.error);
    return rows(r.data);
  },
});
const INTAKE = intakeDefinition({
  fetchAll: async () => {
    const r = await fetchInitialBalanceListAction();
    if (!r.success) throw new Error(r.error);
    return rows(r.data);
  },
});
const WRITEOFFS = writeoffsDefinition({
  fetchAll: async () => {
    const [catalog, list] = await Promise.all([fetchProductsCatalog(), fetchInventoryWriteoffs()]);
    const names = new Map(catalog.warehouses.map((w) => [w.id, w.name]));
    return list.map((w) => ({ ...w, warehouse_name: (w.warehouse_id && names.get(w.warehouse_id)) || null })) as unknown as Row[];
  },
});

function Lines({ items, extra }: { items: readonly { product_name: string; product_code?: string; quantity: number; unit: string }[]; extra?: (i: number) => React.ReactNode }) {
  const { t, locale } = useI18n();
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th scope="col" className="px-2 py-1.5 ds-label">{t("dashboard.product")}</th>
          <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("modals.salesView.quantity")}</th>
          {extra ? <th scope="col" className="px-2 py-1.5 ds-label">{t("inventoryCount.notes")}</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--ds-border)" }}>
            <td className="px-2 py-1.5">
              {item.product_name}
              {item.product_code ? <span className="ml-2 ds-mono ds-subtle text-[length:var(--ds-text-xs)]">{item.product_code}</span> : null}
            </td>
            <td className="px-2 py-1.5 text-right ds-mono">{`${formatFigure(item.quantity, 2, locale)} ${item.unit}`}</td>
            {extra ? <td className="px-2 py-1.5 ds-muted">{extra(i)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Stock ────────────────────────────────────────────────────────────────────

export function InventoryStockScreen() {
  const { t } = useI18n();
  return (
    <EngineScreen
      definition={STOCK}
      title={t("inventory.pageTitle")}
      kpis={(records, fmt) => stockKpis(records, fmt)}
      actions={
        <Link href="/products" className="ds-btn ds-btn-sm">
          {t("inventory.openFullCatalog")}
        </Link>
      }
      recordTitle={(r) => r.name}
      renderRecord={(r) => <StockRecordView record={r} />}
    />
  );
}

function StockRecordView({ record }: { record: StockRecord }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const actions: FormAction[] = [
    { key: "transfer", label: t("inventory.actions.transfer"), primary: true, icon: <ArrowRightLeft className="h-4 w-4" aria-hidden />, onClick: () => router.push(`/inventory/transfers/new?from=${record.warehouse_id ?? ""}&productId=${record.product_id}`) },
    { key: "kardex", label: t("inventory.actions.kardex"), icon: <History className="h-4 w-4" aria-hidden />, onClick: () => router.push(`/dashboard/reports/inventory-turnover?productId=${record.product_id}`) },
  ];
  return <FormView definition={STOCK} record={record} canWrite={false} fmt={fmt} actions={actions} />;
}

// ── Warehouse slips ──────────────────────────────────────────────────────────

export function WarehouseSlipsScreen() {
  const { t } = useI18n();
  return (
    <EngineScreen
      definition={SLIPS}
      title={t("warehouseSlips.title")}
      kpis={(records, fmt, ctx) => slipKpis(records, fmt, ctx.now)}
      recordTitle={(r) => r.slip_number}
      renderRecord={(r) => <SlipRecordView record={r} />}
    />
  );
}

function SlipRecordView({ record }: { record: SlipRecord }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const { printData, setPrintData } = useDocumentPrint<ReturnType<typeof warehouseSlipToPrintData>>();
  const slips = useQuery({ queryKey: ["views", SLIPS_VIEW_KEY, "full"], queryFn: async () => {
    const r = await fetchWarehouseSlipsAction();
    if (!r.success) throw new Error(r.error);
    return r.slips;
  } });
  const slip: WarehouseSlip | undefined = slips.data?.find((s) => s.id === record.id);
  const canApprove = can("can_approve_warehouse_slips");
  const run = async (action: () => Promise<{ success: true; slip: WarehouseSlip } | { success: false; error: string }>, print: boolean) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.success) {
      toast(t("common.error"), formatRpcError(result.error, t), "error");
      return;
    }
    await invalidateModel(client, SLIPS_VIEW_KEY);
    if (print) setPrintData(warehouseSlipToPrintData(result.slip));
  };
  const actions: FormAction[] = [
    ...(record.status === "pending" && canApprove
      ? [
          { key: "approve", label: t("warehouseSlips.approveAndPrint"), primary: true, disabled: busy, icon: <CheckCircle2 className="h-4 w-4" aria-hidden />, onClick: () => void run(() => approveWarehouseSlipAction(record.id), true) },
          { key: "reject", label: t("warehouseSlips.reject"), disabled: busy, icon: <XCircle className="h-4 w-4" aria-hidden />, onClick: () => setRejecting(true) },
        ]
      : []),
    ...(record.status === "approved" && slip ? [{ key: "reprint", label: t("warehouseSlips.reprint"), icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => setPrintData(warehouseSlipToPrintData(slip)) }] : []),
  ];
  const items: WarehouseSlipItem[] = slip?.items ?? [];
  return (
    <>
      <FormView
        definition={SLIPS}
        record={record}
        canWrite={false}
        fmt={fmt}
        actions={actions}
        extraTabs={[{ key: "lines", label: t("sales.engine.tabs.lines", { count: items.length }), content: <Lines items={items} extra={(i) => items[i].issue_description || ""} /> }]}
      />
      <TypeToConfirmDialog
        open={rejecting}
        onOpenChange={setRejecting}
        confirmText={record.slip_number}
        labels={{
          title: t("warehouseSlips.reject"),
          description: t("warehouseSlips.rejectConfirm", { slipNo: record.slip_number }),
          instruction: t("inventory.engine.typeSlipNo"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("warehouseSlips.reject"),
          working: t("common.loading"),
          audit: t("inventory.engine.rejectAudit"),
        }}
        onConfirm={() => run(() => rejectWarehouseSlipAction(record.id), false)}
      />
      {printData ? createPortal(<div className="print-area"><WarehouseSlipPrintTemplate slip={printData} /></div>, document.body) : null}
    </>
  );
}

// ── Inventory counts ─────────────────────────────────────────────────────────

export function InventoryCountsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  return (
    <EngineScreen
      definition={COUNTS}
      title={t("inventoryCount.listTitle")}
      kpis={(records, fmt) => countKpis(records, fmt)}
      actions={
        <>
          <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("inventoryCount.newCount")}
          </button>
          {/* The classic create dialog, unchanged: warehouse and category scope, then the count opens. */}
          {creating ? (
            <CreateCountModal
              onClose={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                router.push(`/inventory/counts/${id}`);
              }}
            />
          ) : null}
        </>
      }
      recordTitle={(r) => r.document_number}
      renderRecord={(r, { close }) => <CountRecordView record={r} close={close} />}
    />
  );
}

function CountRecordView({ record, close }: { record: CountRecord; close: () => void }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const actions: FormAction[] = [
    { key: "open", label: t("inventory.engine.openCount"), primary: true, icon: <ExternalLink className="h-4 w-4" aria-hidden />, onClick: () => router.push(`/inventory/counts/${record.id}`) },
    ...(record.status !== "posted" ? [{ key: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" aria-hidden />, onClick: () => setDeleting(true) }] : []),
  ];
  return (
    <>
      <FormView definition={COUNTS} record={record} canWrite={false} fmt={fmt} actions={actions} />
      <TypeToConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        confirmText={record.document_number}
        labels={{
          title: t("common.delete"),
          description: t("inventoryCount.deleteConfirm", { docNo: record.document_number }),
          instruction: t("inventory.engine.typeDocNo"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("common.delete"),
          working: t("common.loading"),
          audit: t("inventory.engine.deleteAudit"),
        }}
        onConfirm={async () => {
          const result = await deleteInventoryCountAction(record.id);
          if (!result.success) {
            toast(t("common.error"), formatRpcError(result.error, t), "error");
            return;
          }
          toast(t("inventoryCount.deleted"), undefined, "success");
          await invalidateModel(client, COUNTS_VIEW_KEY);
          close();
        }}
      />
    </>
  );
}

// ── Stock intake / opening balance ───────────────────────────────────────────

const intakeHref = (id: string) => `/warehouse/initial-balance/new?draft=${id}`;

export function InitialBalanceScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <EngineScreen
      definition={INTAKE}
      title={t("initialBalance.listTitle")}
      kpis={(records, fmt, ctx) => intakeKpis(records, fmt, ctx.now)}
      actions={
        can("can_manage_products") ? (
          <>
            <Link href="/warehouse/initial-balance/new?type=opening_balance" className="ds-btn ds-btn-sm">
              <Plus className="h-4 w-4" aria-hidden />
              {t("initialBalance.entryTypeOpeningBalance")}
            </Link>
            <Link href="/warehouse/initial-balance/new?type=receipt" className="ds-btn ds-btn-sm ds-btn-primary">
              <Plus className="h-4 w-4" aria-hidden />
              {t("initialBalance.entryTypeReceipt")}
            </Link>
          </>
        ) : null
      }
      recordTitle={(r) => r.document_number}
      renderRecord={(r, { close }) => <IntakeRecordView record={r} close={close} />}
    />
  );
}

function IntakeRecordView({ record, close }: { record: IntakeRecord; close: () => void }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = can("can_manage_products");
  const isDraft = record.status === "draft";
  const isPosted = record.status === "posted";
  const done = async () => {
    await invalidateModel(client, INTAKE_VIEW_KEY);
    close();
  };
  const actions: FormAction[] = [
    { key: "open", label: isDraft && canManage ? t("common.edit") : t("common.view"), primary: true, icon: isDraft && canManage ? <PencilLine className="h-4 w-4" aria-hidden /> : <ExternalLink className="h-4 w-4" aria-hidden />, onClick: () => router.push(intakeHref(record.id)) },
    ...(isPosted && can("can_unpost_inventory") ? [{ key: "unpost", label: t("initialBalance.revertToDraft"), icon: <Undo2 className="h-4 w-4" aria-hidden />, onClick: () => setUnposting(true) }] : []),
    ...(isDraft && canManage ? [{ key: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" aria-hidden />, onClick: () => setDeleting(true) }] : []),
  ];
  return (
    <>
      <FormView definition={INTAKE} record={record} canWrite={false} fmt={fmt} actions={actions} />
      {unposting ? (
        <form
          className="ds-card ds-card-pad mt-4 flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const result = await unpostInitialBalanceDocumentAction(record.id, reason.trim() || undefined);
            setBusy(false);
            if (!result.success) {
              toast(t("common.error"), formatRpcError(result.error, t), "error");
              return;
            }
            toast(t("initialBalance.unposted", { docNo: record.document_number }), undefined, "success");
            await done();
          }}
        >
          <h3 className="font-semibold">{t("initialBalance.unpostConfirmTitle")}</h3>
          <p className="ds-muted">{t("initialBalance.unpostConfirmMessage")}</p>
          <label className="flex flex-col gap-1">
            <span className="ds-label">{t("initialBalance.unpostReason")}</span>
            <textarea className="ds-input min-h-20 py-2" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setUnposting(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="ds-btn ds-btn-sm ds-btn-danger" disabled={busy}>
              {busy ? t("initialBalance.unposting") : t("initialBalance.revertToDraft")}
            </button>
          </div>
        </form>
      ) : null}
      <TypeToConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        confirmText={record.document_number}
        labels={{
          title: t("common.delete"),
          description: t("initialBalance.deleteDraftConfirm", { docNo: record.document_number }),
          instruction: t("inventory.engine.typeDocNo"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("common.delete"),
          working: t("common.loading"),
          audit: t("inventory.engine.deleteAudit"),
        }}
        onConfirm={async () => {
          const result = await deleteInitialBalanceDraftAction(record.id);
          if (!result.success) {
            toast(t("common.error"), formatRpcError(result.error, t), "error");
            return;
          }
          toast(t("initialBalance.draftDeleted"), undefined, "success");
          await done();
        }}
      />
    </>
  );
}

// ── Damage write-offs ────────────────────────────────────────────────────────

export function DamagedGoodsScreen() {
  const { t } = useI18n();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const catalog = useQuery({ queryKey: ["inventory", "catalog"], queryFn: fetchProductsCatalog });
  const warehouses = catalog.data?.warehouses ?? [];
  return (
    <EngineScreen
      definition={WRITEOFFS}
      title={t("damagedGoods.pageTitle")}
      kpis={(records, fmt, ctx) => writeoffKpis(records, fmt, ctx.now)}
      actions={
        <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={!warehouses.length} title={!warehouses.length ? t("damagedGoods.createWarehouseFirst") : undefined} onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("damagedGoods.createDoc")}
        </button>
      }
      header={
        <RecordPanel open={creating} onClose={() => setCreating(false)} title={t("damagedGoods.createDoc")} closeLabel={t("common.close")}>
          <DamagedGoodsForm
            warehouses={warehouses}
            mode="create"
            onCancel={() => setCreating(false)}
            onSuccess={() => {
              setCreating(false);
              void invalidateModel(client, WRITEOFFS_VIEW_KEY);
            }}
          />
        </RecordPanel>
      }
      recordTitle={(r) => r.document_number}
      renderRecord={(r) => <WriteoffRecordView record={r} />}
    />
  );
}

function WriteoffRecordView({ record }: { record: WriteoffViewRecord }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { printData, setPrintData } = useDocumentPrint<DamagedGoodsPrintData>();
  const catalog = useQuery({ queryKey: ["inventory", "catalog"], queryFn: fetchProductsCatalog });
  const full = useQuery({ queryKey: ["views", WRITEOFFS_VIEW_KEY, "full"], queryFn: fetchInventoryWriteoffs });
  const writeoff: WriteoffRecord | undefined = full.data?.find((w) => w.id === record.id);
  if (editing && writeoff && catalog.data) {
    return (
      <DamagedGoodsForm
        key={writeoff.id}
        warehouses={catalog.data.warehouses}
        mode="edit"
        initialWriteoff={writeoff}
        onCancel={() => setEditing(false)}
        onSuccess={() => {
          setEditing(false);
          void invalidateModel(client, WRITEOFFS_VIEW_KEY);
        }}
      />
    );
  }
  const items = writeoff?.items ?? [];
  const actions: FormAction[] = writeoff
    ? [
        { key: "edit", label: t("common.edit"), primary: true, icon: <PencilLine className="h-4 w-4" aria-hidden />, onClick: () => setEditing(true) },
        {
          key: "print",
          label: t("common.print"),
          icon: <Printer className="h-4 w-4" aria-hidden />,
          onClick: () => setPrintData({ document_number: writeoff.document_number, writeoff_date: writeoff.writeoff_date || "-", warehouse_name: record.warehouse_name || "-", checker_name: writeoff.checker_name, items: writeoff.items, notes: writeoff.notes }),
        },
      ]
    : [];
  return (
    <>
      <FormView
        definition={WRITEOFFS}
        record={record}
        canWrite={false}
        fmt={fmt}
        actions={actions}
        extraTabs={[{ key: "lines", label: t("sales.engine.tabs.lines", { count: items.length }), content: <Lines items={items} extra={(i) => items[i].issue_description} /> }]}
      />
      {printData ? createPortal(<div className="print-area"><DamagedGoodsPrintTemplate writeoff={printData} /></div>, document.body) : null}
    </>
  );
}
