"use client";

import React, { useState } from "react";
import { CalendarClock } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useActivityTypeActions, useActivityTypes } from "@/views/chatter/data";
import { ACTIVITY_ICONS, activityTypeLabel, checkActivityType, isBuiltInType, type ActivityIcon } from "@/views/chatter/logic";

/**
 * Activity types of the chatter (phase 19), admin only and only with the new UI on: the
 * built-in to-do, call and meeting, and the company's own types. Types are switched off, never
 * deleted, so activities that use them keep their type.
 */
export default function ActivityTypesSettingsPage() {
  const { t } = useI18n();
  const { isAdmin, ready } = useAuth();
  const { active } = useNewUi();
  const types = useActivityTypes();
  const actions = useActivityTypeActions();
  const [draft, setDraft] = useState({ code: "", name: "", icon: "todo" as ActivityIcon, default_days: "0" });
  const [error, setError] = useState("");
  const rows = types.data ?? [];

  const add = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const checked = checkActivityType(draft, rows.map((r) => r.code));
    if (!checked.ok) {
      setError(t(checked.error));
      return;
    }
    setError("");
    const sequence = Math.max(0, ...rows.map((r) => r.sequence)) + 10;
    actions.add.mutate(
      { ...checked.value, sequence },
      {
        onSuccess: () => setDraft({ code: "", name: "", icon: "todo", default_days: "0" }),
        onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
      }
    );
  };

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="activity-types" />
        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-3xl space-y-6">
            <header>
              <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                <CalendarClock className="h-6 w-6 text-app-accent" />
                {t("views.chatter.typesAdmin.title")}
              </h1>
              <p className="mt-1 text-sm text-app-muted">{t("views.chatter.typesAdmin.description")}</p>
            </header>

            {ready && (!isAdmin || !active) ? (
              <div className="app-card p-6 text-sm text-app-muted">{t("views.chatter.typesAdmin.unavailable")}</div>
            ) : (
              <>
                <div className="app-card app-card-elevated overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-app text-xs uppercase text-app-muted">
                      <tr>
                        <th className="px-4 py-3">{t("views.chatter.typesAdmin.name")}</th>
                        <th className="px-4 py-3">{t("views.chatter.typesAdmin.icon")}</th>
                        <th className="px-4 py-3">{t("views.chatter.typesAdmin.defaultDays")}</th>
                        <th className="px-4 py-3">{t("views.chatter.typesAdmin.active")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.code} className="border-b border-app last:border-0">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-app">{activityTypeLabel(r.code, rows, t)}</div>
                            <div className="font-mono text-[11px] text-app-muted">
                              {r.code}
                              {isBuiltInType(r.code) ? ` · ${t("views.chatter.typesAdmin.builtIn")}` : ""}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">{t(`views.chatter.typesAdmin.icons.${r.icon}`)}</td>
                          <td className="px-4 py-3 text-xs">{r.default_days}</td>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={r.active}
                              aria-label={t("views.chatter.typesAdmin.toggle", { name: activityTypeLabel(r.code, rows, t) })}
                              onChange={(e) => actions.update.mutate({ code: r.code, patch: { active: e.target.checked } }, { onError: (err) => setError(err instanceof Error ? err.message : t("common.error")) })}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form onSubmit={add} className="app-card space-y-3 p-4">
                  <h2 className="text-sm font-semibold text-app">{t("views.chatter.typesAdmin.add")}</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-app-muted">
                      {t("views.chatter.typesAdmin.name")}
                      <input className="app-input" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-app-muted">
                      {t("views.chatter.typesAdmin.code")}
                      <input className="app-input font-mono" maxLength={32} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="site_visit" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-app-muted">
                      {t("views.chatter.typesAdmin.icon")}
                      <select className="app-input" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value as ActivityIcon })}>
                        {ACTIVITY_ICONS.map((i) => (
                          <option key={i} value={i}>
                            {t(`views.chatter.typesAdmin.icons.${i}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-app-muted">
                      {t("views.chatter.typesAdmin.defaultDays")}
                      <input className="app-input" type="number" min={0} max={365} value={draft.default_days} onChange={(e) => setDraft({ ...draft, default_days: e.target.value })} />
                    </label>
                  </div>
                  {error ? (
                    <p role="alert" className="text-xs text-rose-500">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary disabled:opacity-50" disabled={actions.add.isPending}>
                      {t("views.chatter.typesAdmin.add")}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}
