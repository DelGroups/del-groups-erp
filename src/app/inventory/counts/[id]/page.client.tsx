"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Eraser,
  Play,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import ToastMessage from "@/components/ui/ToastMessage";
import BarcodeScanField from "@/components/documents/BarcodeScanField";
import { ResizableTh } from "@/components/ui/table";
import { InventoryCountStatusBadge, VarianceAmount } from "@/components/inventoryCount/InventoryCountStatusBadge";
import { useAuth } from "@/components/auth/AuthProvider";
import { useTableResize, type TableColumnSpecs } from "@/hooks/useTableResize";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import {
  deleteInventoryCountAction,
  fetchInventoryCountAction,
  markUncountedAsZeroAction,
  postInventoryCountAction,
  reopenInventoryCountAction,
  resyncInventoryCountBookAction,
  scanInventoryCountAction,
  startInventoryCountAction,
  submitInventoryCountAction,
  updateInventoryCountLineAction,
  type InventoryCountLineInput,
} from "@/lib/inventoryCount/actions";
import {
  INVENTORY_COUNT_STATUSES,
  type InventoryCountDetail,
  type InventoryCountLine,
} from "@/lib/inventoryCount/types";

const PAGE_SIZE = 100;
const EPS = 0.0005;

/** Product name is the fluid column; the numeric columns are content-fit. */
const COUNT_GRID_COLUMNS: TableColumnSpecs = {
  no: { width: 52, minWidth: 40 },
  product: { width: 300, minWidth: 180, grow: 1 },
  expected: { width: 140, minWidth: 100 },
  actual: { width: 220, minWidth: 140 },
  difference: { width: 120, minWidth: 90 },
  value: { width: 160, minWidth: 110 },
};

type LineFilter = "all" | "uncounted" | "variance" | "drift";

function fmtQty(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined) return "—";
  return Number(value.toFixed(digits)).toString();
}

function parseLengths(raw: string): number[] {
  return raw
    .split(/[,;\s]+/)
    .map((part) => Number(part.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function pieceSummary(full: number | null, cuts: number[] | null, len: number | null): string {
  const parts: string[] = [];
  if (full) parts.push(`${full} × ${fmtQty(len)} m`);
  if (cuts && cuts.length) parts.push(cuts.map((c) => fmtQty(c)).join(", "));
  return parts.join(" + ") || "0";
}

function hasVariance(line: InventoryCountLine): boolean {
  return line.difference !== null && Math.abs(line.difference) > EPS;
}

// ─── Editable cells ─────────────────────────────────────────────────────────

/** Counted quantity input. Enter commits and jumps to the next row, like a count sheet. */
function QtyInput({
  line,
  index,
  onCommit,
}: {
  line: InventoryCountLine;
  index: number;
  onCommit: (line: InventoryCountLine, input: InventoryCountLineInput) => void;
}) {
  // Parent keys this input by the saved value, so a server update remounts it.
  const [draft, setDraft] = useState(line.actual_qty === null ? "" : String(line.actual_qty));

  const commit = () => {
    const trimmed = draft.trim().replace(",", ".");
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setDraft(line.actual_qty === null ? "" : String(line.actual_qty));
      return;
    }
    if (next === line.actual_qty) return;
    onCommit(line, { kind: "qty", actual_qty: next });
  };

  return (
    <input
      data-count-input={index}
      inputMode="decimal"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const next = document.querySelector<HTMLInputElement>(`[data-count-input="${index + 1}"]`);
          if (next) next.focus();
          else e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(line.actual_qty === null ? "" : String(line.actual_qty));
        }
      }}
      className="app-input h-8 w-full py-0 text-right font-mono text-sm tabular-nums"
    />
  );
}

/** Polywood lines are counted as full sheets plus a list of cut lengths. */
function PieceInput({
  line,
  index,
  onCommit,
}: {
  line: InventoryCountLine;
  index: number;
  onCommit: (line: InventoryCountLine, input: InventoryCountLineInput) => void;
}) {
  const { t } = useI18n();
  const fullOf = (l: InventoryCountLine) => (l.actual_full_sheets === null ? "" : String(l.actual_full_sheets));
  const cutsOf = (l: InventoryCountLine) => (l.actual_cut_pieces || []).join(", ");
  const [full, setFull] = useState(fullOf(line));
  const [cuts, setCuts] = useState(cutsOf(line));

  const commit = () => {
    const fullTrim = full.trim();
    const fullNum = fullTrim === "" ? null : Number(fullTrim);
    if (fullNum !== null && (!Number.isInteger(fullNum) || fullNum < 0)) {
      setFull(fullOf(line));
      return;
    }
    const cutList = parseLengths(cuts);
    if (fullNum === line.actual_full_sheets && cutList.join(",") === (line.actual_cut_pieces || []).join(",")) return;
    onCommit(line, { kind: "pieces", full_sheets: fullNum, cut_pieces: cutList });
  };

  return (
    <div
      className="flex items-center gap-1"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
      }}
    >
      <input
        data-count-input={index}
        inputMode="numeric"
        value={full}
        placeholder={t("inventoryCount.fullSheets")}
        title={t("inventoryCount.fullSheets")}
        onChange={(e) => setFull(e.target.value)}
        onFocus={(e) => e.target.select()}
        className="app-input h-8 w-16 py-0 text-right font-mono text-sm"
      />
      <input
        value={cuts}
        placeholder={t("inventoryCount.cutPieces")}
        title={t("inventoryCount.cutPieces")}
        onChange={(e) => setCuts(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const next = document.querySelector<HTMLInputElement>(`[data-count-input="${index + 1}"]`);
            if (next) next.focus();
            else e.currentTarget.blur();
          }
        }}
        className="app-input h-8 min-w-0 flex-1 py-0 font-mono text-xs"
      />
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

type PendingConfirm = "post" | "resync" | "zero" | null;

export default function InventoryCountDocumentPageClient() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const countId = params.id;
  const { can } = useAuth();
  const canPost = can("can_post_inventory_count");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [doc, setDoc] = useState<InventoryCountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LineFilter>("all");
  const [page, setPage] = useState(0);
  const [lastScan, setLastScan] = useState<{ lineId: string; text: string } | null>(null);
  const flashTimer = useRef<number | null>(null);

  const { containerRef, tableProps, columnProps } = useTableResize(COUNT_GRID_COLUMNS, {
    storageKey: "inventory-count-grid-columns-v1",
  });

  const load = useCallback(async () => {
    const result = await fetchInventoryCountAction(countId);
    if (result.success && result.data) setDoc(result.data);
    else if (!result.success) showError(result.error);
    setLoading(false);
  }, [countId, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchLine = useCallback((line: InventoryCountLine) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const exists = prev.lines.some((l) => l.id === line.id);
      return {
        ...prev,
        lines: exists ? prev.lines.map((l) => (l.id === line.id ? line : l)) : [...prev.lines, line],
      };
    });
  }, []);

  const lines = useMemo(() => doc?.lines ?? [], [doc]);
  const status = doc?.status ?? "draft";
  const editable = status === "in_progress";
  const isPosted = status === "posted";

  const summary = useMemo(() => {
    let counted = 0;
    let surplus = 0;
    let shortage = 0;
    let drift = 0;
    for (const line of lines) {
      if (line.actual_qty !== null) counted += 1;
      const value = isPosted ? line.applied_value : line.variance_value;
      if (value && value > 0) surplus += value;
      if (value && value < 0) shortage -= value;
      if (line.actual_qty !== null && Math.abs(line.drift_qty) > EPS) drift += 1;
    }
    return { counted, surplus, shortage, net: surplus - shortage, drift, uncounted: lines.length - counted };
  }, [lines, isPosted]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (filter === "uncounted" && line.actual_qty !== null) return false;
      if (filter === "variance" && !hasVariance(line)) return false;
      if (filter === "drift" && Math.abs(line.drift_qty) <= EPS) return false;
      if (!q) return true;
      return (
        line.product_name.toLowerCase().includes(q) ||
        (line.product_code || "").toLowerCase().includes(q) ||
        (line.barcode || "").toLowerCase().includes(q)
      );
    });
  }, [lines, query, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, onOk?: () => void) => {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (!result.success) {
      showError(result.error || t("common.error"));
      return false;
    }
    onOk?.();
    await load();
    return true;
  };

  const handleStart = async () => {
    setBusy(true);
    const result = await startInventoryCountAction(countId);
    setBusy(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    showSuccess(t("inventoryCount.started", { lines: result.data?.lines ?? 0 }));
    await load();
  };

  const handleSubmit = async () => {
    setBusy(true);
    const result = await submitInventoryCountAction(countId);
    setBusy(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    const driftLines = result.data?.drift_lines ?? 0;
    showSuccess(
      driftLines > 0
        ? t("inventoryCount.submittedDrift", { count: driftLines })
        : t("inventoryCount.submitted")
    );
    if (driftLines > 0) {
      setFilter("drift");
      setPage(0);
    }
    await load();
  };

  const handleConfirm = async () => {
    const action = confirm;
    if (!action) return;
    if (action === "post") {
      setBusy(true);
      const result = await postInventoryCountAction(countId);
      setBusy(false);
      if (!result.success) {
        showError(result.error);
        return;
      }
      setConfirm(null);
      showSuccess(t("inventoryCount.posted", { docNo: result.data?.document_number || doc?.document_number || "" }));
      await load();
      return;
    }
    const ok = await run(
      () => (action === "resync" ? resyncInventoryCountBookAction(countId) : markUncountedAsZeroAction(countId)),
      () => {
        if (action === "resync") showSuccess(t("inventoryCount.resynced"));
      }
    );
    if (ok) setConfirm(null);
  };

  const handleDelete = async () => {
    setBusy(true);
    const result = await deleteInventoryCountAction(countId);
    setBusy(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    router.push("/inventory/counts");
  };

  const handleCommit = useCallback(
    async (line: InventoryCountLine, input: InventoryCountLineInput) => {
      const result = await updateInventoryCountLineAction(countId, line.id, input);
      if (!result.success || !result.data) {
        showError(result.success ? t("common.error") : result.error);
        return;
      }
      patchLine(result.data);
    },
    [countId, patchLine, showError, t]
  );

  const handleScan = async (code: string) => {
    const result = await scanInventoryCountAction(countId, code);
    if (!result.success || !result.data) {
      showError(result.success ? t("common.error") : result.error);
      return;
    }
    const { line, piece_length } = result.data;
    patchLine(line);
    setLastScan({
      lineId: line.id,
      text:
        piece_length !== null
          ? t("inventoryCount.scannedPiece", { name: line.product_name, length: fmtQty(piece_length) })
          : t("inventoryCount.scanned", {
              name: line.product_name,
              qty: fmtQty(line.actual_qty),
              unit: line.unit || "",
            }),
    });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setLastScan((s) => (s?.lineId === line.id ? { ...s, lineId: "" } : s)), 1500);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <PageLayout>
        <p className="py-12 text-center text-sm text-app-muted">{t("common.loading")}</p>
      </PageLayout>
    );
  }

  if (!doc) {
    return (
      <PageLayout>
        <Link href="/inventory/counts" className="inline-flex items-center gap-1 text-sm text-app-accent">
          <ArrowLeft className="h-4 w-4" />
          {t("inventoryCount.back")}
        </Link>
      </PageLayout>
    );
  }

  const stepIndex = INVENTORY_COUNT_STATUSES.indexOf(status);

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "posted" ? (
        <Button appearance="outline" color="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
          <Trash2 className="h-4 w-4" />
          {t("common.delete")}
        </Button>
      ) : null}
      {status === "draft" ? (
        <Button onClick={() => void handleStart()} loading={busy}>
          <Play className="h-4 w-4" />
          {t("inventoryCount.startCounting")}
        </Button>
      ) : null}
      {status === "in_progress" ? (
        <>
          <Button
            appearance="outline"
            color="secondary"
            onClick={() => setConfirm("zero")}
            disabled={busy || summary.uncounted === 0}
          >
            <Eraser className="h-4 w-4" />
            {t("inventoryCount.markUncountedZero")}
          </Button>
          <Button onClick={() => void handleSubmit()} loading={busy} disabled={summary.counted === 0}>
            <Send className="h-4 w-4" />
            {t("inventoryCount.submitForReview")}
          </Button>
        </>
      ) : null}
      {status === "review" ? (
        <>
          <Button
            appearance="outline"
            color="secondary"
            onClick={() => void run(() => reopenInventoryCountAction(countId), () => showSuccess(t("inventoryCount.reopened")))}
            disabled={busy}
          >
            <Undo2 className="h-4 w-4" />
            {t("inventoryCount.reopen")}
          </Button>
          {canPost ? (
            <Button color="success" onClick={() => setConfirm("post")} disabled={busy}>
              <CheckCircle2 className="h-4 w-4" />
              {t("inventoryCount.validateApply")}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return (
    <PageLayout>
      <Link
        href="/inventory/counts"
        className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-app-muted hover:text-app"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("inventoryCount.back")}
      </Link>
      <div className="mb-1">
        <InventoryCountStatusBadge status={status} />
      </div>

      <PageHeader
        title={`${t("inventoryCount.listTitle")} — ${doc.document_number}`}
        subtitle={[
          doc.warehouse_name,
          doc.category_name || t("inventoryCount.allCategories"),
          doc.count_date,
          doc.responsible_name,
        ]
          .filter(Boolean)
          .join(" · ")}
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={headerActions}
      />

      {/* Lifecycle stepper */}
      <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {INVENTORY_COUNT_STATUSES.map((step, i) => {
          const done = i < stepIndex || isPosted;
          const current = i === stepIndex && !isPosted;
          return (
            <li
              key={step}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold",
                current && "border-[color:var(--erp-color-primary)] bg-[color:var(--erp-color-primary)]/10 text-app",
                done && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                !current && !done && "border-app text-app-muted"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  done ? "border-emerald-500 bg-emerald-500 text-white" : "border-current"
                )}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {t(`inventoryCount.status_${step}`)}
            </li>
          );
        })}
      </ol>

      {status === "draft" ? (
        <div className="rounded-xl border border-dashed border-app bg-app-card p-8 text-center">
          <p className="text-sm text-app">{t("inventoryCount.draftInfo")}</p>
          <p className="mt-1 text-xs text-app-muted">{t("inventoryCount.startHint")}</p>
          <Button className="mt-4" onClick={() => void handleStart()} loading={busy}>
            <Play className="h-4 w-4" />
            {t("inventoryCount.startCounting")}
          </Button>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: t("inventoryCount.summaryLines"), value: String(lines.length) },
              { label: t("inventoryCount.summaryCounted"), value: `${summary.counted} / ${lines.length}` },
              { label: t("inventoryCount.summarySurplus"), node: <VarianceAmount value={summary.surplus} /> },
              { label: t("inventoryCount.summaryShortage"), node: <VarianceAmount value={-summary.shortage} /> },
              { label: t("inventoryCount.summaryNet"), node: <VarianceAmount value={summary.net} /> },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-app bg-app-card px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted">{card.label}</p>
                <p className="mt-0.5 text-lg font-bold text-app">{card.node ?? card.value}</p>
              </div>
            ))}
          </div>

          {status === "review" ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-app">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                {t("inventoryCount.reviewInfo")}
              </span>
              {summary.drift > 0 ? (
                <Button size="sm" appearance="outline" color="warning" onClick={() => setConfirm("resync")} disabled={busy}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("inventoryCount.resyncBook")} ({summary.drift})
                </Button>
              ) : null}
            </div>
          ) : null}

          {isPosted ? (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-app">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {t("inventoryCount.postedInfo", { date: (doc.posted_at || "").slice(0, 16).replace("T", " ") })}
            </div>
          ) : null}

          {/* Scanner + filters */}
          <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {editable ? (
              <div>
                <BarcodeScanField
                  onScan={handleScan}
                  autoFocus
                  label={t("inventoryCount.scanLabel")}
                  placeholder={t("inventoryCount.scanPlaceholder")}
                />
                {lastScan ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    {lastScan.text}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className={cn("flex flex-col justify-end gap-2", !editable && "lg:col-span-2")}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" />
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder={t("inventoryCount.searchPlaceholder")}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", t("inventoryCount.filterAll"), lines.length],
                    ["uncounted", t("inventoryCount.filterUncounted"), summary.uncounted],
                    ["variance", t("inventoryCount.filterVariance"), lines.filter(hasVariance).length],
                    ...(summary.drift > 0 ? [["drift", t("inventoryCount.filterDrift"), summary.drift]] : []),
                  ] as [LineFilter, string, number][]
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFilter(key);
                      setPage(0);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      filter === key
                        ? "border-[color:var(--erp-color-primary)] bg-[color:var(--erp-color-primary)] text-white"
                        : "border-app bg-app-card text-app-muted hover:bg-app-card-hover"
                    )}
                  >
                    {label}
                    <span className="ms-1.5 opacity-70">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Counting grid */}
          <div
            ref={containerRef}
            className="w-full overflow-x-auto rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-panel)]"
          >
            <table {...tableProps} className="app-table text-left text-sm">
              <thead className="border-b-2 border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)]">
                <tr>
                  <ResizableTh {...columnProps("no")} className="px-3 py-2.5 text-xs font-semibold uppercase text-app">
                    #
                  </ResizableTh>
                  <ResizableTh {...columnProps("product")} className="px-3 py-2.5 text-xs font-semibold uppercase text-app">
                    {t("inventoryCount.colProduct")}
                  </ResizableTh>
                  <ResizableTh {...columnProps("expected")} className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-app">
                    {t("inventoryCount.colExpected")}
                  </ResizableTh>
                  <ResizableTh {...columnProps("actual")} className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-app">
                    {t("inventoryCount.colActual")}
                  </ResizableTh>
                  <ResizableTh {...columnProps("difference")} className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-app">
                    {t("inventoryCount.colDifference")}
                  </ResizableTh>
                  <ResizableTh {...columnProps("value")} className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-app">
                    {t("inventoryCount.colVarianceValue")}
                  </ResizableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-app-muted">
                      {t("inventoryCount.noLines")}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((line, i) => {
                    const index = page * PAGE_SIZE + i;
                    const drifted = line.actual_qty !== null && Math.abs(line.drift_qty) > EPS;
                    const diff = isPosted ? line.applied_qty : line.difference;
                    const value = isPosted ? line.applied_value : line.variance_value;
                    return (
                      <tr
                        key={line.id}
                        className={cn(
                          "transition-colors hover:bg-app-card-hover",
                          lastScan?.lineId === line.id && "bg-emerald-500/15"
                        )}
                      >
                        <td className="px-3 py-1.5 font-mono text-xs text-app-muted">{line.line_no}</td>
                        <td className="overflow-hidden px-3 py-1.5">
                          <p className="truncate font-medium text-app" title={line.product_name}>
                            {line.product_name}
                          </p>
                          <p className="truncate text-[11px] text-app-muted">
                            {[line.product_code, line.unit, line.is_metric ? t("inventoryCount.metricHint") : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                          <span>{fmtQty(line.expected_qty)}</span>
                          {line.is_metric ? (
                            <p className="truncate text-[11px] text-app-muted">
                              {pieceSummary(line.expected_full_sheets, line.expected_cut_pieces, line.full_sheet_length_m)}
                            </p>
                          ) : null}
                          {drifted ? (
                            <p
                              className="flex items-center justify-end gap-1 text-[11px] font-semibold text-amber-600"
                              title={t("inventoryCount.driftHint", { qty: fmtQty(line.drift_qty) })}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {line.drift_qty > 0 ? "+" : ""}
                              {fmtQty(line.drift_qty)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {editable ? (
                            line.is_metric ? (
                              <PieceInput
                                key={`${line.id}:${line.actual_full_sheets}:${(line.actual_cut_pieces || []).join(",")}`}
                                line={line}
                                index={index}
                                onCommit={handleCommit}
                              />
                            ) : (
                              <QtyInput
                                key={`${line.id}:${line.actual_qty}`}
                                line={line}
                                index={index}
                                onCommit={handleCommit}
                              />
                            )
                          ) : line.actual_qty === null ? (
                            <span className="text-xs italic text-app-muted">{t("inventoryCount.notCounted")}</span>
                          ) : (
                            <span className="font-mono tabular-nums">
                              {fmtQty(line.actual_qty)}
                              {line.is_metric ? (
                                <span className="block truncate text-[11px] text-app-muted">
                                  {pieceSummary(line.actual_full_sheets, line.actual_cut_pieces, line.full_sheet_length_m)}
                                </span>
                              ) : null}
                            </span>
                          )}
                          {editable && line.is_metric && line.actual_qty !== null ? (
                            <p className="mt-0.5 text-[11px] text-app-muted">= {fmtQty(line.actual_qty)} m</p>
                          ) : null}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-right font-mono font-semibold tabular-nums",
                            diff !== null && diff > EPS && "text-emerald-600",
                            diff !== null && diff < -EPS && "text-rose-600",
                            (diff === null || Math.abs(diff) <= EPS) && "text-app-muted"
                          )}
                        >
                          {diff === null ? "—" : `${diff > EPS ? "+" : ""}${fmtQty(diff)}`}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <VarianceAmount value={value} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > PAGE_SIZE ? (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs">
              <span className="text-app-muted">
                {t("inventoryCount.showingRange", {
                  from: page * PAGE_SIZE + 1,
                  to: Math.min((page + 1) * PAGE_SIZE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              <Button size="sm" appearance="outline" color="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                {t("inventoryCount.prev")}
              </Button>
              <Button
                size="sm"
                appearance="outline"
                color="secondary"
                disabled={page >= pageCount - 1}
                onClick={() => setPage(page + 1)}
              >
                {t("inventoryCount.next")}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={confirm !== null}
        onOpenChange={(next) => (next || busy ? undefined : setConfirm(null))}
        title={
          confirm === "post"
            ? t("inventoryCount.postConfirmTitle")
            : confirm === "resync"
              ? t("inventoryCount.resyncBook")
              : t("inventoryCount.markUncountedZero")
        }
        className="max-w-md"
        footer={
          <>
            <Button appearance="outline" color="secondary" onClick={() => setConfirm(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button color={confirm === "post" ? "success" : "warning"} onClick={() => void handleConfirm()} loading={busy}>
              {confirm === "post" ? t("inventoryCount.validateApply") : t("common.confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-muted">
          {confirm === "post"
            ? t("inventoryCount.postConfirmMessage", {
                count: summary.counted,
                surplus: summary.surplus.toFixed(2),
                shortage: summary.shortage.toFixed(2),
              })
            : confirm === "resync"
              ? t("inventoryCount.resyncConfirm")
              : t("inventoryCount.markUncountedZeroConfirm", { count: summary.uncounted })}
        </p>
      </Modal>

      <ConfirmDeleteModal
        open={deleteOpen}
        message={t("inventoryCount.deleteConfirm", { docNo: doc.document_number })}
        loading={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
