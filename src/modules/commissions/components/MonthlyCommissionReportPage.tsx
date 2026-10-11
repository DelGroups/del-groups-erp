"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import PageLayout from "@/components/layout/PageLayout";
import { 
  Percent, 
  ArrowLeft, 
  UserCheck, 
  Calendar, 
  FileText 
} from "lucide-react";
import type { CommissionRule } from "@/types/database.types";
import { normalizeCommissionRule } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

interface SellerCommissionSummary {
  seller_name: string;
  category_sales: { [category: string]: number };
  total_sales: number;
  total_commission: number;
  details: {
    category: string;
    sales_amount: number;
    applied_rate: number;
    commission_earned: number;
  }[];
}

export default function MonthlyCommissionReportPage() {
  const { t } = useI18n();
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [loading, setLoading] = useState(false);
  const [summaries, setSummaries] = useState<SellerCommissionSummary[]>([]);

  useEffect(() => {
    calculateCommissions();
  }, [selectedMonth]);

  const calculateCommissions = async () => {
    setLoading(true);

    const { data: rulesData } = await supabase
      .from("commission_rules")
      .select("*");
    const loadedRules: CommissionRule[] = (rulesData || []).map((row) =>
      normalizeCommissionRule(row as Record<string, unknown>)
    );

    const startDate = `${selectedMonth}-01`;
    const endDate = `${selectedMonth}-31T23:59:59`;

    const { data: salesData } = await supabase
      .from("sales")
      .select("*")
      .gte("created_at", startDate)
      .lte("created_at", endDate);

    const salesList = salesData || [];

    const sellerGroup: { [seller: string]: { [category: string]: number } } = {};

    salesList.forEach((sale) => {
      const seller = sale.seller_name || t("commissions.unassignedSeller");
      const category = t("commissions.generalCategory");
      const amount = Number(sale.total_amount) || 0;

      if (!sellerGroup[seller]) {
        sellerGroup[seller] = {};
      }
      if (!sellerGroup[seller][category]) {
        sellerGroup[seller][category] = 0;
      }
      sellerGroup[seller][category] += amount;
    });

    const computedSummaries: SellerCommissionSummary[] = [];

    Object.keys(sellerGroup).forEach((seller) => {
      const catSales = sellerGroup[seller];
      let totalSales = 0;
      let totalCommission = 0;
      const details: SellerCommissionSummary["details"] = [];

      Object.keys(catSales).forEach((cat) => {
        const catAmount = catSales[cat];
        totalSales += catAmount;

        const matchingRule = loadedRules.find(
          (r) =>
            r.category_name.toLowerCase() === cat.toLowerCase() &&
            catAmount >= r.min_sales &&
            (r.max_sales === null || catAmount <= r.max_sales)
        );

        const rate = matchingRule ? Number(matchingRule.commission_percentage) : 0;
        const commissionEarned = catAmount * (rate / 100);
        totalCommission += commissionEarned;

        details.push({
          category: cat,
          sales_amount: catAmount,
          applied_rate: rate,
          commission_earned: commissionEarned,
        });
      });

      computedSummaries.push({
        seller_name: seller,
        category_sales: catSales,
        total_sales: totalSales,
        total_commission: totalCommission,
        details,
      });
    });

    setSummaries(computedSummaries);
    setLoading(false);
  };

  return (
    <PageLayout>
        <div className="border-b border-app app-glass px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/comissions"
              className="p-2 hover:bg-app-card-hover rounded-lg transition-colors text-app-muted"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-app flex items-center gap-2">
                <Percent className="w-6 h-6 text-app-accent" />
                {t("commissions.reportTitle")}
              </h1>
              <p className="text-xs text-app-muted mt-0.5">
                {t("commissions.reportDescription")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-app-card-hover p-1.5 rounded-xl border border-app">
            <Calendar className="w-4 h-4 text-app-muted ml-2" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent border-none text-xs font-bold text-app focus:outline-none pr-2"
            />
          </div>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <div className="p-12 text-center text-xs text-app-muted">
              {t("commissions.calculating")} {t("common.pleaseWait")}
            </div>
          ) : summaries.length === 0 ? (
            <div className="app-card p-12 text-center space-y-3 rounded-xl border border-app">
              <FileText className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-app-muted">
                {t("commissions.noSalesForMonth", { month: selectedMonth })}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {summaries.map((summary) => (
                <div
                  key={summary.seller_name}
                  className="app-table-wrap"
                >
                  <div className="app-toolbar p-5 flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-white/15 rounded-xl border border-blue-500/30">
                        <UserCheck className="w-6 h-6 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold">{summary.seller_name}</h3>
                        <p className="text-xs text-app-muted">
                          {t("commissions.monthlyActivity", { month: selectedMonth })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-[10px] uppercase text-app-muted font-semibold">
                          {t("commissions.totalSales")}
                        </p>
                        <p className="text-lg font-bold font-mono">
                          {summary.total_sales.toFixed(2)} AZN
                        </p>
                      </div>
                      <div className="text-right bg-[image:var(--app-gradient)] px-4 py-2 rounded-xl">
                        <p className="text-[10px] uppercase text-blue-100 font-semibold">
                          {t("commissions.calculatedCommission")}
                        </p>
                        <p className="text-lg font-bold font-mono text-white">
                          {summary.total_commission.toFixed(2)} AZN
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-app-muted mb-3">
                      {t("commissions.categoryBreakdown")}
                    </h4>
                    <table className="w-full text-left text-xs">
                      <thead className="bg-app-card-hover text-app uppercase font-bold border-b border-app">
                        <tr>
                          <th className="py-2.5 px-4">{t("commissions.categoryName")}</th>
                          <th className="py-2.5 px-4">{t("commissions.salesAmount")}</th>
                          <th className="py-2.5 px-4">{t("commissions.appliedRate")}</th>
                          <th className="py-2.5 px-4 text-right">{t("commissions.earnedCommission")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-app-muted">
                        {summary.details.map((detail, idx) => (
                          <tr key={idx} className="hover:bg-app-card-hover">
                            <td className="py-3 px-4 font-semibold text-app">
                              {detail.category}
                            </td>
                            <td className="py-3 px-4">{detail.sales_amount.toFixed(2)} AZN</td>
                            <td className="py-3 px-4 font-bold text-app-accent">
                              %{detail.applied_rate}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-app font-mono">
                              {detail.commission_earned.toFixed(2)} AZN
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    </PageLayout>
  );
}