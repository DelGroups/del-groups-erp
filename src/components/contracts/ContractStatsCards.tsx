"use client";

import React from "react";
import KpiCard from "@/components/dashboard/KpiCard";
import { computeContractStats, type Contract } from "@/lib/contracts/api";
import { useI18n } from "@/i18n/I18nProvider";
import { FileText, ShoppingCart, Truck, Wallet } from "lucide-react";

interface Props {
  contracts: Contract[];
}

export default function ContractStatsCards({ contracts }: Props) {
  const { t } = useI18n();
  const stats = computeContractStats(contracts);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <KpiCard
        label={t("official.kpiActiveContracts")}
        value={String(stats.activeCount)}
        sublabel={t("official.kpiActiveContractsHint")}
        icon={<FileText className="h-5 w-5" />}
        accent="blue"
      />
      <KpiCard
        label={t("official.kpiSaleVsPurchase")}
        value={`${stats.saleCount} / ${stats.purchaseCount}`}
        sublabel={t("official.kpiSaleVsPurchaseHint")}
        icon={
          <div className="flex gap-1">
            <ShoppingCart className="h-4 w-4" />
            <Truck className="h-4 w-4" />
          </div>
        }
        accent="indigo"
      />
      <KpiCard
        label={t("official.kpiTotalAdvance")}
        value={`${stats.totalPendingAdvance.toFixed(2)} ${t("common.currency")}`}
        sublabel={t("official.kpiTotalAdvanceHint")}
        icon={<Wallet className="h-5 w-5" />}
        accent="emerald"
      />
    </div>
  );
}
