"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, Package } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { LowStockProduct } from "@/types/database.types";

interface LowStockAlertsProps {
  products: LowStockProduct[];
}

export default function LowStockAlerts({ products }: LowStockAlertsProps) {
  const { t } = useI18n();

  return (
    <div className="app-card app-card-elevated">
      <div className="flex items-center justify-between border-b border-app px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-app">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {t("dashboard.lowStock")}
        </h3>
        <Link
          href="/products"
          className="text-[11px] font-semibold text-app-accent hover:underline"
        >
          {t("dashboard.goToProducts")}
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
          <Package className="mb-2 h-8 w-8 text-emerald-400" />
          <p className="text-sm font-semibold text-app">{t("dashboard.stockLevelsNormal")}</p>
          <p className="mt-1 text-xs text-app-muted">{t("dashboard.noBelowMinStock")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
              <tr>
                <th className="px-4 py-2.5">{t("common.code")}</th>
                <th className="px-4 py-2.5">{t("dashboard.product")}</th>
                <th className="px-4 py-2.5">{t("common.category")}</th>
                <th className="px-4 py-2.5 text-right">{t("products.stock")}</th>
                <th className="px-4 py-2.5 text-right">{t("dashboard.min")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-amber-50/50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-app">{p.code || "-"}</td>
                  <td className="px-4 py-2.5 font-medium text-app">{p.name}</td>
                  <td className="px-4 py-2.5 text-app-muted">{p.category || "-"}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-rose-600">
                    {p.stock} {p.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right text-app-muted">{p.min_stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
