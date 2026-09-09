"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Filter, RefreshCw, ScrollText, Search } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import AuditDiffModal from "@/components/settings/AuditDiffModal";
import { useI18n } from "@/i18n/I18nProvider";
import { listAuditLogsAction } from "@/lib/actions/audit";
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  type AuditAction,
  type AuditLogRow,
  type AuditModule,
} from "@/lib/audit/types";
import type { Json } from "@/types/database.types";

const PAGE_SIZE = 50;

function actionClass(action: AuditAction): string {
  if (action === "CREATE") return "bg-emerald-500/15 text-emerald-300";
  if (action === "DELETE") return "bg-rose-500/15 text-rose-300";
  return "bg-amber-500/15 text-amber-300";
}

export default function AuditSettingsPage() {
  const { t, formatDateTime } = useI18n();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<AuditModule | "">("");
  const [actionFilter, setActionFilter] = useState<AuditAction | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [diffRow, setDiffRow] = useState<AuditLogRow | null>(null);

  const load = useCallback(
    async (nextOffset = 0) => {
      setLoading(true);
      setError(null);
      const result = await listAuditLogsAction({
        search,
        module: moduleFilter,
        action: actionFilter,
        from,
        to,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.data?.rows ?? []);
      setTotal(result.data?.total ?? 0);
      setOffset(nextOffset);
    },
    [actionFilter, from, moduleFilter, search, to]
  );

  useEffect(() => {
    void listAuditLogsAction({ limit: PAGE_SIZE, offset: 0 }).then((result) => {
      if (!result.success) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setRows(result.data?.rows ?? []);
      setTotal(result.data?.total ?? 0);
      setOffset(0);
      setLoading(false);
    });
  }, []);

  const userLabel = (row: AuditLogRow) => {
    if (row.user_name) return row.user_name;
    if (row.user_email) return row.user_email;
    if (row.user_id) return row.user_id.slice(0, 8);
    return t("audit.systemUser");
  };

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="audit" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                  <ScrollText className="h-6 w-6 text-app-accent" />
                  {t("audit.title")}
                </h1>
                <p className="mt-1 text-sm text-app-muted">{t("audit.description")}</p>
              </div>
              <button
                type="button"
                onClick={() => void load(offset)}
                disabled={loading}
                className="btn-ghost inline-flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("common.refresh")}
              </button>
            </header>

            <section className="app-card app-card-elevated p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-app-muted">
                <Filter className="h-4 w-4" />
                {t("audit.filters")}
              </div>
              <form
                className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void load(0);
                }}
              >
                <label className="relative xl:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" />
                  <input
                    className="app-input w-full pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("audit.searchPlaceholder")}
                  />
                </label>
                <select
                  className="app-input"
                  value={moduleFilter}
                  onChange={(event) => setModuleFilter(event.target.value as AuditModule | "")}
                >
                  <option value="">{t("audit.allModules")}</option>
                  {AUDIT_MODULES.map((module) => (
                    <option key={module} value={module}>
                      {t(`audit.modules.${module}`)}
                    </option>
                  ))}
                </select>
                <select
                  className="app-input"
                  value={actionFilter}
                  onChange={(event) => setActionFilter(event.target.value as AuditAction | "")}
                >
                  <option value="">{t("audit.allActions")}</option>
                  {AUDIT_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {t(`audit.actions.${action}`)}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className="app-input"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
                <input
                  type="date"
                  className="app-input"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
                <div className="xl:col-span-6">
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {t("common.search")}
                  </button>
                </div>
              </form>
            </section>

            {error ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                {error}
              </div>
            ) : null}

            <section className="app-card app-card-elevated overflow-hidden">
              <div className="app-table-wrap">
                <table className="app-table text-xs">
                  <thead>
                    <tr>
                      <th>{t("audit.colTime")}</th>
                      <th>{t("audit.colUser")}</th>
                      <th>{t("audit.colAction")}</th>
                      <th>{t("audit.colModule")}</th>
                      <th>{t("audit.colRecord")}</th>
                      <th>{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-app-muted">
                          {t("common.loading")}
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-app-muted">
                          {t("audit.empty")}
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row.id}>
                          <td className="whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                          <td>
                            <div className="font-medium text-app">{userLabel(row)}</div>
                            {row.ip_address ? (
                              <div className="font-mono text-[10px] text-app-muted">
                                {row.ip_address}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${actionClass(row.action)}`}
                            >
                              {t(`audit.actions.${row.action}`)}
                            </span>
                          </td>
                          <td>
                            <div>{t(`audit.modules.${row.module}`)}</div>
                            {row.table_name ? (
                              <div className="font-mono text-[10px] text-app-muted">
                                {row.table_name}
                              </div>
                            ) : null}
                          </td>
                          <td className="font-mono text-[11px]">
                            {row.record_id ? row.record_id.slice(0, 8) : "—"}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-ghost !px-2 !py-1 text-[11px]"
                              onClick={() => setDiffRow(row)}
                            >
                              {t("audit.viewDiff")}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-app px-4 py-3 text-[11px] text-app-muted">
                <span>{t("audit.showing", { count: rows.length, total })}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={loading || offset <= 0}
                    onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
                  >
                    {t("audit.prev")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={loading || offset + PAGE_SIZE >= total}
                    onClick={() => void load(offset + PAGE_SIZE)}
                  >
                    {t("audit.next")}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>

        <AuditDiffModal
          open={Boolean(diffRow)}
          oldValues={(diffRow?.old_values_json ?? null) as Json | null}
          newValues={(diffRow?.new_values_json ?? null) as Json | null}
          onClose={() => setDiffRow(null)}
        />
      </PermissionGuard>
    </PageLayout>
  );
}
