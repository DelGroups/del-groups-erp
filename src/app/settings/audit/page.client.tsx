"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, Filter, RefreshCw, Save, ScrollText, Search } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import AuditDiffModal from "@/components/settings/AuditDiffModal";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import { listAuditLogsAction } from "@/lib/actions/audit";
import {
  getAuditConfigAction,
  listAuditAlertsAction,
  saveAuditConfigAction,
  type AuditAlertRow,
} from "@/lib/actions/auditSettings";
import {
  AUDIT_RETENTION_DAYS,
  DEFAULT_AUDIT_CONFIG,
  parseAuditConfig,
  type AuditConfig,
  type AuditRetentionDays,
} from "@/lib/audit/config";
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
  if (action === "READ") return "bg-sky-500/15 text-sky-300";
  return "bg-amber-500/15 text-amber-300";
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-app bg-app px-3 py-2 text-sm">
      <span>
        <span className="block text-app">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-app-muted">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--app-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function AuditSettingsPage() {
  const { t, formatDateTime } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [config, setConfig] = useState<AuditConfig>(DEFAULT_AUDIT_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alerts, setAlerts] = useState<AuditAlertRow[]>([]);
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
    void Promise.all([
      getAuditConfigAction(),
      listAuditAlertsAction(20),
      listAuditLogsAction({ limit: PAGE_SIZE, offset: 0 }),
    ]).then(([configResult, alertsResult, logsResult]) => {
      if (configResult.success && configResult.data) setConfig(configResult.data);
      if (alertsResult.success && alertsResult.data) setAlerts(alertsResult.data);
      if (!logsResult.success) {
        setError(logsResult.error);
        setLoading(false);
        setConfigLoading(false);
        return;
      }
      setRows(logsResult.data?.rows ?? []);
      setTotal(logsResult.data?.total ?? 0);
      setOffset(0);
      setLoading(false);
      setConfigLoading(false);
    });
  }, []);

  const patchConfig = (partial: Partial<AuditConfig>) => {
    setConfig((current) => parseAuditConfig({ ...current, ...partial }));
  };

  const handleSaveRules = async () => {
    if (!canManage) return;
    setSaving(true);
    const result = await saveAuditConfigAction(config);
    setSaving(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (result.data) setConfig(result.data);
    showSuccess(t("auditSettings.saved"));
    void load(0);
    const alertsResult = await listAuditAlertsAction(20);
    if (alertsResult.success && alertsResult.data) setAlerts(alertsResult.data);
  };

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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={!canManage || saving || configLoading}
                  onClick={() => void handleSaveRules()}
                >
                  <Save className="h-4 w-4" />
                  {saving ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => void load(offset)}
                  disabled={loading}
                  className="btn-ghost inline-flex items-center gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  {t("common.refresh")}
                </button>
              </div>
            </header>

            <section className="app-card app-card-elevated space-y-4 p-5">
              <h2 className="text-sm font-bold text-app">{t("auditSettings.rulesTitle")}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block text-xs font-semibold text-app-muted">
                  {t("auditSettings.retention")}
                  <select
                    className="app-input mt-1 w-full"
                    value={config.log_retention_days}
                    disabled={!canManage}
                    onChange={(event) =>
                      patchConfig({
                        log_retention_days: Number(event.target.value) as AuditRetentionDays,
                      })
                    }
                  >
                    {AUDIT_RETENTION_DAYS.map((days) => (
                      <option key={days} value={days}>
                        {days === 0
                          ? t("auditSettings.retentionUnlimited")
                          : t("auditSettings.retentionDays", { days })}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-2">
                  <ToggleRow
                    label={t("auditSettings.trackReads")}
                    hint={t("auditSettings.trackReadsHint")}
                    checked={config.track_read_events}
                    disabled={!canManage}
                    onChange={(track_read_events) => patchConfig({ track_read_events })}
                  />
                  <ToggleRow
                    label={t("auditSettings.alertDeletion")}
                    hint={t("auditSettings.alertDeletionHint")}
                    checked={config.alert_on_record_deletion}
                    disabled={!canManage}
                    onChange={(alert_on_record_deletion) =>
                      patchConfig({ alert_on_record_deletion })
                    }
                  />
                </div>
              </div>
            </section>

            {alerts.length > 0 ? (
              <section className="app-card app-card-elevated overflow-hidden">
                <div className="flex items-center gap-2 border-b border-app px-4 py-3 text-sm font-bold text-app">
                  <Bell className="h-4 w-4 text-rose-400" />
                  {t("auditSettings.alertsTitle")}
                </div>
                <ul className="divide-y divide-app text-xs">
                  {alerts.map((alert) => (
                    <li key={alert.id} className="px-4 py-3">
                      <p className="font-semibold text-app">{alert.message}</p>
                      <p className="mt-1 text-[11px] text-app-muted">
                        {formatDateTime(alert.created_at)}
                        {alert.table_name ? ` · ${alert.table_name}` : ""}
                        {alert.email_to
                          ? ` · ${t("auditSettings.emailLogged", { email: alert.email_to })}`
                          : ` · ${t("auditSettings.emailSkipped")}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

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
        <ToastMessage message={toastMessage} variant={toastVariant} />
      </PermissionGuard>
    </PageLayout>
  );
}
