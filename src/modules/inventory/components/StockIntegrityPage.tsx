"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import Button from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import ToastMessage from "@/components/ui/ToastMessage";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchStockIntegrityAction, fixStockIntegrityAction } from "../actions/stockIntegrity";
import {
  groupDuplicateNames,
  groupStockIssues,
  remainingAutoFixable,
  type StockIssue,
  type StockIssueGroup,
  type StockIssueKind,
} from "../lib/stockIntegrity";

type PendingFix = { kind: StockIssueKind; productIds: string[] | null; count: number };

function fmt(value: number | null): string {
  return value === null ? "—" : String(Math.round(value * 1000) / 1000);
}

/**
 * Settings > Stock integrity (admins, fix F2): the checks of
 * supabase/scripts/product_integrity_check.sql, grouped by issue. Safe kinds get "Fix" per row
 * and "Fix all of this kind"; the rest link to the product for a person to correct.
 */
export default function StockIntegrityPage() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [rows, setRows] = useState<StockIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingFix | null>(null);
  const [fixing, setFixing] = useState(false);

  // Server messages are i18n keys when they come from our own checks.
  const message = useCallback((error: string) => (error.startsWith("stockIntegrity.") ? t(error) : error), [t]);

  const load = useCallback(async () => {
    const result = await fetchStockIntegrityAction();
    setLoading(false);
    if (!result.success) {
      showError(message(result.error));
      return;
    }
    setRows(result.data || []);
  }, [message, showError]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const groups = useMemo(() => groupStockIssues(rows), [rows]);
  const leftToFix = remainingAutoFixable(rows);

  const runFix = async (fix: PendingFix) => {
    setFixing(true);
    const result = await fixStockIntegrityAction(fix.kind, fix.productIds);
    setFixing(false);
    setPending(null);
    if (!result.success) {
      showError(message(result.error));
      return;
    }
    showSuccess(t("stockIntegrity.fixed", { count: result.data?.fixed ?? 0 }));
    await load();
  };

  const statusBadge = (group: StockIssueGroup) =>
    group.autoFix ? (
      <Badge variant="success">{t("stockIntegrity.autoFix")}</Badge>
    ) : group.info ? (
      <Badge variant="neutral">{t("stockIntegrity.info")}</Badge>
    ) : (
      <Badge variant="warning">{t("stockIntegrity.needsReview")}</Badge>
    );

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="stock-integrity" />
        {!isAdmin ? (
          <Alert variant="warning" className="m-6">
            {t("permission.deniedBody")}
          </Alert>
        ) : (
          <div className="space-y-5 p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <h1 className="flex items-center gap-2 text-lg font-semibold text-app">
                  <ShieldCheck className="h-5 w-5 text-app-accent" />
                  {t("stockIntegrity.title")}
                </h1>
                <p className="mt-1 text-sm text-app-muted">{t("stockIntegrity.description")}</p>
              </div>
              <Button
                appearance="outline"
                color="secondary"
                onClick={() => {
                  setLoading(true);
                  void load();
                }}
                loading={loading}
              >
                <RefreshCw className="h-4 w-4" />
                {t("stockIntegrity.refresh")}
              </Button>
            </header>

            <Alert variant="info">{t("stockIntegrity.noLedgerNote")}</Alert>

            {!loading && leftToFix === 0 ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                {rows.length === 0 ? t("stockIntegrity.empty") : t("stockIntegrity.clean")}
              </p>
            ) : null}

            {groups.map((group) => (
              <section key={group.kind} aria-labelledby={`issue-${group.kind}`} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id={`issue-${group.kind}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-app">
                      {t(`stockIntegrity.kinds.${group.kind}`)}
                      <span className="tabular-nums text-app-muted">({group.rows.length})</span>
                      {statusBadge(group)}
                    </h2>
                    <p className="mt-0.5 text-xs text-app-muted">{t(`stockIntegrity.hints.${group.kind}`)}</p>
                  </div>
                  {group.autoFix && group.fixableCount > 0 ? (
                    <Button
                      size="sm"
                      onClick={() => setPending({ kind: group.kind, productIds: null, count: group.fixableCount })}
                      disabled={fixing}
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      {t("stockIntegrity.fixAll", { count: group.fixableCount })}
                    </Button>
                  ) : null}
                </div>

                {group.kind === "duplicate_name" ? (
                  <TableWrap>
                    <Table>
                      <THead>
                        <tr>
                          <Th>{t("stockIntegrity.colProduct")}</Th>
                          <Th>{t("stockIntegrity.colCode")}</Th>
                          <Th numeric>{t("stockIntegrity.colStock")}</Th>
                          <ActionsTh>{t("common.actions")}</ActionsTh>
                        </tr>
                      </THead>
                      {groupDuplicateNames(group.rows).map((names) => (
                        <tbody key={names.key} className="divide-y divide-app border-b-2 border-app">
                          {names.rows.map((row) => (
                            <Tr key={`${row.issue}-${row.product_id}`}>
                              <Td className="font-medium text-app">{row.product_name}</Td>
                              <Td className="font-mono text-xs">{row.product_code || "—"}</Td>
                              <Td numeric>{fmt(row.stock_before)}</Td>
                              <ActionsTd>
                                <Link
                                  href={`/products?highlight=${row.product_id}`}
                                  className="text-xs font-semibold text-app-accent hover:underline"
                                >
                                  {t("stockIntegrity.openProduct")}
                                </Link>
                              </ActionsTd>
                            </Tr>
                          ))}
                        </tbody>
                      ))}
                    </Table>
                  </TableWrap>
                ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <Th>{t("stockIntegrity.colProduct")}</Th>
                        <Th>{t("stockIntegrity.colDetails")}</Th>
                        {group.autoFix && group.kind !== "subcategory_lost" && group.kind !== "null_warehouse_row" ? (
                          <>
                            <Th numeric>{t("stockIntegrity.colBefore")}</Th>
                            <Th numeric>{t("stockIntegrity.colAfter")}</Th>
                          </>
                        ) : null}
                        <ActionsTh>{t("common.actions")}</ActionsTh>
                      </tr>
                    </THead>
                    <tbody className="divide-y divide-app">
                      {group.rows.map((row) => (
                        <Tr key={`${row.issue}-${row.product_id}`}>
                          <Td>
                            <span className="block font-medium text-app">{row.product_name}</span>
                            {row.product_code ? <span className="block text-xs text-app-muted">{row.product_code}</span> : null}
                          </Td>
                          <Td className="text-xs text-app-muted">{row.details}</Td>
                          {group.autoFix && group.kind !== "subcategory_lost" && group.kind !== "null_warehouse_row" ? (
                            <>
                              <Td numeric>{fmt(row.stock_before)}</Td>
                              <Td numeric className="font-semibold">{fmt(row.stock_after)}</Td>
                            </>
                          ) : null}
                          <ActionsTd>
                            {group.autoFix && row.fixable ? (
                              <Button
                                size="sm"
                                appearance="outline"
                                color="primary"
                                disabled={fixing}
                                onClick={() => void runFix({ kind: row.issue, productIds: [row.product_id], count: 1 })}
                              >
                                {t("stockIntegrity.fix")}
                              </Button>
                            ) : (
                              <Link
                                href={`/products?highlight=${row.product_id}`}
                                className="text-xs font-semibold text-app-accent hover:underline"
                              >
                                {t("stockIntegrity.openProduct")}
                              </Link>
                            )}
                          </ActionsTd>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
                )}
              </section>
            ))}
          </div>
        )}

        <Modal
          open={pending !== null}
          onOpenChange={(next) => (next || fixing ? undefined : setPending(null))}
          title={t("stockIntegrity.title")}
          className="max-w-md"
          footer={
            <>
              <Button appearance="outline" color="secondary" onClick={() => setPending(null)} disabled={fixing}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => pending && void runFix(pending)} loading={fixing}>
                {pending ? t("stockIntegrity.fixAll", { count: pending.count }) : t("stockIntegrity.fix")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-app">
            {pending
              ? t("stockIntegrity.confirmFixAll", { count: pending.count, kind: t(`stockIntegrity.kinds.${pending.kind}`) })
              : null}
          </p>
          {pending ? <p className="mt-2 text-xs text-app-muted">{t(`stockIntegrity.hints.${pending.kind}`)}</p> : null}
        </Modal>
        <ToastMessage message={toastMessage} variant={toastVariant} />
      </PermissionGuard>
    </PageLayout>
  );
}
