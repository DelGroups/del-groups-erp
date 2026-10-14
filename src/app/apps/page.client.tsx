"use client";

import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { DesignScope } from "@/design-system/components";
import { formatFigure } from "@/design-system/logic";
import { AppGrid } from "@/components/shell/NewShell";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useShellApps } from "@/components/shell/useShell";
import type { AppKpi, AppKpiId, AppKpis } from "@/lib/shell/kpis";

const KPI_APPS = new Set<AppKpiId>(["dashboard", "trade", "inventory", "production", "crm", "finance", "hr", "settings"]);

/**
 * App Launcher (prompt 16, reference nav/nav-multi-product-launcher-nav): every app the user
 * may open, each with a live figure. Every existing page is reached from here through its app.
 */
export default function AppsPageClient() {
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const { apps } = useShellApps();
  const [query, setQuery] = useState("");
  const [kpis, setKpis] = useState<AppKpis | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/shell/kpis", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AppKpis>) : null))
      .then((data) => {
        if (active) setKpis(data ?? {});
      })
      .catch(() => {
        if (active) setKpis({});
      });
    return () => {
      active = false;
    };
  }, []);

  const figure = (kpi: AppKpi | undefined) => {
    if (!kpi || kpi.value === null) return "—";
    return kpi.kind === "money" ? `${formatFigure(kpi.value, 0, locale)} AZN` : formatFigure(kpi.value, 0, locale);
  };

  return (
    <PageLayout permission={null}>
      <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="mx-auto max-w-5xl rounded-[var(--ds-radius-xl)] p-4 md:p-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[length:var(--ds-text-2xl)] font-semibold">{t("newShell.launcherTitle")}</h1>
            <p className="ds-muted">{t("newShell.launcherSubtitle")}</p>
          </div>
          <label className="flex w-full max-w-xs items-center gap-2">
            <Search className="h-4 w-4 ds-muted" aria-hidden />
            <input className="ds-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("newShell.searchApps")} aria-label={t("newShell.searchApps")} />
          </label>
        </header>
        <AppGrid
          apps={apps}
          query={query}
          renderExtra={(app) =>
            KPI_APPS.has(app.id as AppKpiId) ? (
              <span className="mt-auto flex items-baseline justify-between gap-2 border-t pt-2 text-[length:var(--ds-text-xs)]" style={{ borderColor: "var(--ds-border)" }}>
                <span className="ds-muted">{t(`newShell.kpi_${app.id}`)}</span>
                <span className="ds-mono font-semibold" aria-live="polite">
                  {kpis === null ? "…" : figure(kpis[app.id as AppKpiId])}
                </span>
              </span>
            ) : null
          }
        />
      </DesignScope>
    </PageLayout>
  );
}
