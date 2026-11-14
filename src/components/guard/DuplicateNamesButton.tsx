"use client";

import React, { useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import Button from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { FIELD_CLASS } from "@/components/ui/input";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { DesignScope, ToastProvider, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { formatGridDate, formatQuantity } from "@/lib/dates/localeDate";
import { markNotDuplicateAction, scanProductNamesAction, type ProductNameScan } from "@/lib/actions/accountingGuard";
import { guardFindingHref, normalizeReason, productCardHref, type NameFinding, type NameProductCard } from "@/lib/guard/nameFindings";
import { useAccountingGuard } from "./AccountingGuardFlag";

/**
 * GUARD-2: "Find duplicate or wrong names". Admins only, only with ACCOUNTING_GUARD=true.
 * It runs guard_scan(['products']) and lists what the name rules found (same name, similar names,
 * a name or code that looks wrong, the same code or barcode), one block per group of products.
 * Nothing here changes, merges or deletes a product: "Not a duplicate" only closes the finding
 * (with a reason), and "Open in Accounting Guard" opens it in the guard section (GUARD-3).
 *
 * It sits on classic pages (the product list, Stock integrity), so it uses the classic side panel
 * and dialog like those pages, with the rulebook's grid (StandardGrid) and toast (OVL-3).
 */
export default function DuplicateNamesButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const active = useAccountingGuard();
  const { t } = useI18n();
  const { theme } = useTheme();
  const { brand } = useNewUi();
  if (!active) return null;
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="ds-scope-transparent">
      <ToastProvider closeLabel={t("common.close")}>
        <NamesPanel size={size} />
      </ToastProvider>
    </DesignScope>
  );
}

function NamesPanel({ size }: { size: "sm" | "md" }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const reasonId = useId();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ProductNameScan | null>(null);
  const [findings, setFindings] = useState<NameFinding[]>([]);
  const [target, setTarget] = useState<NameFinding | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Server messages are i18n keys when they come from our own checks.
  const message = useCallback((text: string) => (text.startsWith("accountingGuard.") ? t(text) : text), [t]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await scanProductNamesAction();
    setLoading(false);
    if (!result.success) {
      setScan(null);
      setFindings([]);
      setError(message(result.error));
      return;
    }
    setScan(result.data);
    setFindings(result.data.findings);
  }, [message]);

  const columns = useMemo<StandardColumn<NameProductCard>[]>(
    () => [
      { key: "code", header: t("accountingGuard.names.colCode"), type: "code", cell: (p) => p.code || "—" },
      {
        key: "name",
        header: t("accountingGuard.names.colName"),
        width: 220,
        className: "font-medium",
        cell: (p) => (
          <Link href={productCardHref(p.id)} onClick={() => setOpen(false)} aria-label={t("accountingGuard.names.openProduct", { name: p.name })} className="text-app-accent hover:underline">
            {p.name || "—"}
          </Link>
        ),
      },
      { key: "unit", header: t("accountingGuard.names.colUnit"), width: 80, cell: (p) => p.unit ?? "—" },
      { key: "category", header: t("accountingGuard.names.colCategory"), width: 140, cell: (p) => p.category ?? "—" },
      { key: "stock", header: t("accountingGuard.names.colStock"), type: "number", cell: (p) => formatQuantity(p.stock, locale) },
      {
        key: "lastMovement",
        header: t("accountingGuard.names.colLastMovement"),
        type: "date",
        cell: (p) => (p.lastMovement ? formatGridDate(p.lastMovement) : <span className="ds-muted">{t("accountingGuard.names.neverMoved")}</span>),
      },
    ],
    [t, locale]
  );

  const openDrawer = () => {
    setOpen(true);
    void run();
  };

  const closeReason = () => {
    if (saving) return;
    setTarget(null);
    setReason("");
    setReasonError(null);
  };

  const submitReason = async () => {
    if (!target) return;
    const text = normalizeReason(reason);
    if (!text) {
      setReasonError(t("accountingGuard.names.reasonRequired"));
      return;
    }
    setSaving(true);
    const result = await markNotDuplicateAction(target.id, text);
    setSaving(false);
    if (!result.success) {
      setReasonError(message(result.error));
      return;
    }
    setFindings((list) => list.filter((f) => f.id !== target.id));
    setTarget(null);
    setReason("");
    setReasonError(null);
    toast(t("accountingGuard.names.marked"), undefined, "success");
  };

  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={openDrawer}>
        <Search className="h-4 w-4" />
        {t("accountingGuard.names.button")}
      </Button>

      <Drawer open={open} onClose={() => setOpen(false)} title={t("accountingGuard.names.title")}>
        <div className="space-y-4">
          <p className="text-sm text-app-muted">{t("accountingGuard.names.description")}</p>

          {loading ? (
            <p role="status" className="text-sm text-app-muted">
              {t("accountingGuard.names.scanning")}
            </p>
          ) : null}

          {error ? (
            <Alert variant="danger" role="alert" className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void run()}>
                {t("accountingGuard.names.retry")}
              </Button>
            </Alert>
          ) : null}

          {scan && !loading ? (
            <>
              <p role="status" className="text-sm font-semibold text-app">
                {findings.length === 0 ? t("accountingGuard.names.summaryNone") : t("accountingGuard.names.summaryCount", { count: findings.length })}
              </p>
              {scan.failedRules.length > 0 ? <Alert variant="warning">{t("accountingGuard.names.failedRules", { rules: scan.failedRules.join(", ") })}</Alert> : null}
              {scan.truncated ? <Alert variant="info">{t("accountingGuard.names.truncated", { count: findings.length })}</Alert> : null}

              {findings.map((finding) => (
                <section key={finding.id} aria-labelledby={`finding-${finding.id}`} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id={`finding-${finding.id}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-app">
                      {t(`accountingGuard.nameKinds.${finding.kind}`)}
                      <Badge variant={finding.severity === "high" || finding.severity === "critical" ? "danger" : "warning"}>
                        {t("accountingGuard.names.products", { count: finding.products.length })}
                      </Badge>
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setTarget(finding)}>
                        {t("accountingGuard.names.notDuplicate")}
                      </Button>
                      <Button href={guardFindingHref(finding.id)} variant="ghost" size="sm">
                        {t("accountingGuard.names.openInGuard")}
                      </Button>
                    </div>
                  </div>
                  <StandardGrid<NameProductCard>
                    id="guard-duplicate-names"
                    label={t(`accountingGuard.nameKinds.${finding.kind}`)}
                    rows={finding.products}
                    rowKey={(p) => p.id}
                    columns={columns}
                  />
                </section>
              ))}
            </>
          ) : null}
        </div>
      </Drawer>

      <Modal
        open={target !== null}
        onOpenChange={(next) => (next ? undefined : closeReason())}
        title={t("accountingGuard.names.reasonTitle")}
        className="max-w-md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeReason} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={() => void submitReason()} loading={saving}>
              {t("accountingGuard.names.reasonSubmit")}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label htmlFor={reasonId} className="block text-sm font-medium text-app">
            {t("accountingGuard.names.reasonLabel")}
          </label>
          <textarea
            id={reasonId}
            className={FIELD_CLASS}
            rows={3}
            value={reason}
            maxLength={500}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={`${reasonId}-hint`}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(null);
            }}
          />
          <p id={`${reasonId}-hint`} className="text-xs text-app-muted">
            {t("accountingGuard.names.reasonHint")}
          </p>
          {reasonError ? (
            <p role="alert" className="text-sm text-[color:var(--erp-color-danger)]">
              {reasonError}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
