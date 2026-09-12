"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Button from "@/components/ui/button";
import { fetchInitialBalanceListAction } from "@/lib/initialBalance/actions";
import type { InitialBalanceDocument } from "@/lib/initialBalance/types";
import { useI18n } from "@/i18n/I18nProvider";

export default function InitialBalanceListPageClient() {
  const { t } = useI18n();
  const [rows, setRows] = useState<InitialBalanceDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchInitialBalanceListAction();
    setRows(result.success ? result.data || [] : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageLayout>
      <PageHeader
        title={t("initialBalance.listTitle")}
        description={t("initialBalance.listDescription")}
        actions={
          <Link href="/warehouse/initial-balance/new">
            <Button className="inline-flex items-center gap-1">
              <Plus className="h-4 w-4" />
              {t("initialBalance.newDocument")}
            </Button>
          </Link>
        }
      />

      <div className="app-card overflow-x-auto rounded-xl">
        <table className="min-w-full text-xs">
          <thead className="bg-app-card-hover text-app-muted">
            <tr>
              <th className="px-3 py-2 text-left">{t("initialBalance.docNo")}</th>
              <th className="px-3 py-2 text-left">{t("common.date")}</th>
              <th className="px-3 py-2 text-left">{t("common.warehouse")}</th>
              <th className="px-3 py-2 text-right">{t("initialBalance.totalValue")}</th>
              <th className="px-3 py-2 text-left">{t("common.status")}</th>
              <th className="px-3 py-2 text-left">{t("initialBalance.createdBy")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-app-muted">
                  {t("common.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-app-muted">
                  {t("initialBalance.emptyList")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-app hover:bg-app-card-hover">
                  <td className="px-3 py-2">
                    <Link
                      href={`/warehouse/initial-balance/new?draft=${row.id}`}
                      className="font-semibold text-app-accent hover:underline"
                    >
                      {row.document_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.doc_date}</td>
                  <td className="px-3 py-2">{row.warehouse_name || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {Number(row.total_amount || 0).toFixed(2)} AZN
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "posted"
                      ? t("initialBalance.statusPosted")
                      : row.status === "cancelled"
                        ? t("initialBalance.statusCancelled")
                        : t("initialBalance.statusDraft")}
                  </td>
                  <td className="px-3 py-2">{row.created_by_name || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageLayout>
  );
}
