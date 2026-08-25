"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import PageLayout from "@/components/layout/PageLayout";
import { ArrowLeft, Plus, Trash2, Layers } from "lucide-react";
import type { CommissionRule } from "@/types/database.types";
import { normalizeCommissionRule, parseNullableMaxSales } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

export default function CommissionsSettingsPage() {
  const { t } = useI18n();
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [categoryName, setCategoryName] = useState("");
  const [minSales, setMinSales] = useState<string>("0");
  const [maxSales, setMaxSales] = useState<string>("");
  const [commissionPercentage, setCommissionPercentage] = useState<string>("");

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("commission_rules")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setRules(data.map((row) => normalizeCommissionRule(row as Record<string, unknown>)));
    }
    setLoading(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName.trim() || commissionPercentage.trim() === "") return;

    setSaving(true);
    const payload = {
      category_name: categoryName.trim(),
      min_sales: parseFloat(minSales) || 0,
      max_sales: parseNullableMaxSales(maxSales),
      commission_percentage: parseFloat(commissionPercentage) || 0,
    };

    const { error } = await supabase.from("commission_rules").insert([payload]);

    if (!error) {
      setCategoryName("");
      setMinSales("0");
      setMaxSales("");
      setCommissionPercentage("");
      fetchRules();
    } else {
      alert(t("common.errorOccurred", { message: error.message }));
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("commissions.confirmDeleteRule"))) return;
    const { error } = await supabase.from("commission_rules").delete().eq("id", id);
    if (!error) {
      fetchRules();
    }
  };

  return (
    <PageLayout>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md">
          <div className="flex items-center space-x-4">
            <Link
              href="/settings"
              className="p-2 hover:bg-app-card-hover rounded-lg transition-colors text-app-muted"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-app">
                {t("commissions.settingsTitle")}
              </h1>
              <p className="text-xs text-app-muted mt-0.5">
                {t("commissions.settingsDescription")}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 max-w-6xl">
          {/* Add Rule Form */}
          <div className="app-card app-card-elevated p-6">
            <h2 className="text-sm font-semibold text-app-accent flex items-center gap-1.5 mb-4">
              <Plus className="w-4 h-4" />
              {t("commissions.addRule")}
            </h2>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-app mb-1">
                    {t("commissions.categoryName")} *
                  </label>
                  <input
                    type="text"
                    required
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder={t("commissions.categoryPlaceholder")}
                    className="app-input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-app mb-1">
                    {t("commissions.minMonthlySales")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={minSales}
                    onChange={(e) => setMinSales(e.target.value)}
                    className="app-input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-app mb-1">
                    {t("commissions.maxSales")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={maxSales}
                    onChange={(e) => setMaxSales(e.target.value)}
                    placeholder={t("commissions.maxSalesPlaceholder")}
                    className="app-input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-app mb-1">
                    {t("commissions.commissionRate")}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={commissionPercentage}
                      onChange={(e) => setCommissionPercentage(e.target.value)}
                      placeholder="3.0"
                      className="app-input pr-8 font-semibold text-app-accent"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-app-muted font-bold">%</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  {saving ? t("common.saving") : t("commissions.saveRule")}
                </button>
              </div>
            </form>
          </div>

          {/* Rules List Table */}
          <div className="app-table-wrap">
            <div className="px-6 py-4 border-b border-app bg-app-card-hover flex items-center gap-2">
              <Layers className="w-4 h-4 text-app-muted" />
              <h3 className="text-sm font-semibold text-app">
                {t("commissions.rulesList")}
              </h3>
            </div>

            {loading ? (
              <div className="p-8 text-center text-app-muted text-xs">{t("common.loading")}</div>
            ) : rules.length === 0 ? (
              <div className="p-12 text-center text-app-muted text-sm">
                {t("commissions.emptyRules")}
              </div>
            ) : (
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="px-6 py-3">{t("commissions.categoryName")}</th>
                    <th className="px-6 py-3">{t("commissions.minSalesCol")}</th>
                    <th className="px-6 py-3">{t("commissions.maxSalesCol")}</th>
                    <th className="px-6 py-3">{t("commissions.commissionRate")}</th>
                    <th className="px-6 py-3 text-right">{t("common.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {rules.map((rule) => (
                    <tr key={rule.id} >
                      <td className="px-6 py-3.5 font-medium text-app">
                        {rule.category_name}
                      </td>
                      <td className="px-6 py-3.5">{rule.min_sales.toFixed(2)} AZN</td>
                      <td className="px-6 py-3.5">
                        {rule.max_sales != null
                          ? `${rule.max_sales.toFixed(2)} AZN`
                          : t("common.limitNone")}
                      </td>
                      <td className="px-6 py-3.5 font-bold text-app-accent">
                        %{rule.commission_percentage}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <button
                          onClick={() => handleDelete(rule.id)}
                          className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                          title={t("common.delete")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
    </PageLayout>
  );
}