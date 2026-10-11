"use client";

import React, { useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { getModuleOverviewAction, type ModuleOverview } from "@/lib/actions/tenantModules";
import type { ModuleState } from "@/modules/enabled";

const STATE_LABEL: Record<ModuleState, string> = {
  enabled: "settings.modules.stateEnabled",
  required: "settings.modules.stateRequired",
  disabled: "settings.modules.stateDisabled",
};

const STATE_CLASS: Record<ModuleState, string> = {
  enabled: "bg-emerald-500/15 text-emerald-600",
  required: "bg-amber-500/15 text-amber-600",
  disabled: "bg-slate-500/15 text-app-muted",
};

export default function ModulesSettingsPage() {
  const { t, formatDate } = useI18n();
  const { isAdmin, ready } = useAuth();
  const [overview, setOverview] = useState<ModuleOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !isAdmin) return;
    let active = true;
    void getModuleOverviewAction().then((result) => {
      if (!active) return;
      if (result.success && result.data) setOverview(result.data);
      else setError(result.success ? "" : result.error);
    });
    return () => {
      active = false;
    };
  }, [ready, isAdmin]);

  const moduleName = (id: string) => t(`modules.names.${id}`);

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="modules" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <header>
              <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                <Boxes className="h-6 w-6 text-app-accent" />
                {t("settings.modules.title")}
              </h1>
              <p className="mt-1 text-sm text-app-muted">{t("settings.modules.description")}</p>
            </header>

            {ready && !isAdmin ? (
              <div className="app-card p-6 text-sm text-app-muted">{t("settings.modules.adminOnly")}</div>
            ) : error ? (
              <div className="app-card p-6 text-sm text-rose-500">{error}</div>
            ) : !overview ? (
              <div className="app-card p-6 text-xs text-app-muted">{t("common.dataLoading")}</div>
            ) : (
              <>
                <p className="text-xs text-app-muted">
                  {overview.tableExists ? t("settings.modules.readOnlyNote") : t("settings.modules.migrationPending")}
                </p>
                <div className="app-card app-card-elevated overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-app text-xs uppercase text-app-muted">
                      <tr>
                        <th className="px-4 py-3">{t("settings.modules.colModule")}</th>
                        <th className="px-4 py-3">{t("settings.modules.colState")}</th>
                        <th className="px-4 py-3">{t("settings.modules.colDepends")}</th>
                        <th className="px-4 py-3">{t("settings.modules.colVersion")}</th>
                        <th className="px-4 py-3">{t("settings.modules.colInstalledAt")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.modules.map((m) => (
                        <tr key={m.id} className="border-b border-app last:border-0">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-app">{moduleName(m.id)}</div>
                            <div className="font-mono text-[11px] text-app-muted">{m.id}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CLASS[m.state]}`}>
                              {t(STATE_LABEL[m.state])}
                            </span>
                            {m.state === "required" ? (
                              <div className="mt-1 text-[11px] text-app-muted">
                                {t("settings.modules.requiredBy", {
                                  modules: m.requiredBy.map(moduleName).join(", "),
                                })}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-app-muted">
                            {m.depends.length ? m.depends.map(moduleName).join(", ") : t("settings.modules.none")}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{m.version}</td>
                          <td className="px-4 py-3 text-xs text-app-muted">
                            {m.installedAt ? formatDate(m.installedAt) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}
