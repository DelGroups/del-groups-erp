"use client";

import React from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import {
  ArrowRight,
  BarChart3,
  FileSpreadsheet,
  PieChart,
  ShoppingCart,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export default function ReportsHubPage() {
  const { t } = useI18n();

  const reportModules = [
    {
      title: t("reports.sales"),
      description: t("reports.salesDescription"),
      href: "/reports/sales",
      icon: ShoppingCart,
      accent: "bg-[color:var(--app-success-soft)] text-[color:var(--app-success-text)] border-[color:var(--app-success-border)]",
    },
    {
      title: t("reports.financial"),
      description: t("reports.financialDescription"),
      href: "/reports/financial",
      icon: PieChart,
      accent: "bg-[color:var(--app-accent-soft)] text-app-accent border-[color:var(--app-accent-ring)]",
    },
  ];

  return (
    <PageLayout>
        <header className="border-b border-app app-glass px-6 py-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-app">
            <BarChart3 className="h-6 w-6 text-app-accent" />
            {t("reports.title")}
          </h1>
          <p className="mt-1 text-sm text-app-muted">{t("reports.hubDescription")}</p>
        </header>

        <main className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {reportModules.map((mod) => {
              const Icon = mod.icon;
              return (
                <Link
                  key={mod.href}
                  href={mod.href}
                  className="group rounded-2xl app-card p-6 shadow-sm transition-all hover:border-[color:var(--app-border-hover)] hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div
                      className={`rounded-xl border p-3 ${mod.accent}`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <ArrowRight className="h-5 w-5 text-app-muted transition-transform group-hover:translate-x-1 group-hover:text-app-accent" />
                  </div>
                  <h2 className="mt-4 text-lg font-bold text-app">{mod.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-app-muted">{mod.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-app-accent">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {t("reports.viewReport")}
                  </span>
                </Link>
              );
            })}
          </div>
        </main>
      </PageLayout>
  );
}
