"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import type { Warehouse, Product } from "@/types/database.types";
import {
  RefreshCw,
  Plus,
  X,
} from "lucide-react";

export default function WarehousesPage() {
  const { t } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    location: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: whData } = await supabase.from("warehouses").select("*").order("created_at", { ascending: true });
    const { data: prdData } = await supabase.from("products").select("*");

    setWarehouses(whData || []);
    setProducts(prdData || []);
    setLoading(false);
  };

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    const newWh = {
      code: formData.code || `WH-${Math.floor(100 + Math.random() * 900)}`,
      name: formData.name,
      location: formData.location,
      is_default: false,
    };

    const { error } = await supabase.from("warehouses").insert([newWh]);
    if (error) {
      alert(t("common.errorOccurred", { message: error.message }));
    } else {
      setIsModalOpen(false);
      setFormData({ code: "", name: "", location: "" });
      fetchData();
    }
  };

  const totalStockValuation = products.reduce(
    (sum, p) => sum + (p.stock * p.buy_price),
    0
  );

  return (
    <PageLayout>
        <header className="flex items-center justify-between border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md">
          <div>
            <h2 className="text-xl font-bold text-app">{t("warehouses.pageTitle")}</h2>
            <p className="text-sm text-app-muted">{t("warehouses.pageDescription")}</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            <span>{t("warehouses.createLabel")}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="app-card app-card-elevated p-5">
              <span className="text-xs font-semibold text-app-muted uppercase">{t("warehouses.activeCount")}</span>
              <div className="text-2xl font-bold text-app mt-1">{t("warehouses.warehouseCount", { count: warehouses.length })}</div>
            </div>
            <div className="app-card app-card-elevated p-5">
              <span className="text-xs font-semibold text-app-muted uppercase">{t("warehouses.totalProductTypes")}</span>
              <div className="text-2xl font-bold text-app-accent mt-1">{t("warehouses.productTypeCount", { count: products.length })}</div>
            </div>
            <div className="app-card app-card-elevated p-5">
              <span className="text-xs font-semibold text-app-muted uppercase">{t("warehouses.totalStockValue")}</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{totalStockValuation.toFixed(2)} AZN</div>
            </div>
          </div>

          <div className="app-table-wrap">
            <div className="p-4 border-b border-app flex justify-between items-center bg-app-card-hover">
              <h3 className="font-bold text-app">{t("warehouses.listTitle")}</h3>
              <button onClick={fetchData} className="p-1.5 hover:bg-slate-200 rounded-lg text-app-muted">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {loading ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("common.loading")}</div>
            ) : warehouses.length === 0 ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("warehouses.empty")}</div>
            ) : (
              <table className="app-table">
                <thead className="bg-app-card-hover text-xs text-app-muted uppercase border-b border-app">
                  <tr>
                    <th className="px-6 py-3">{t("common.code")}</th>
                    <th className="px-6 py-3">{t("warehouses.warehouseName")}</th>
                    <th className="px-6 py-3">{t("common.location")}</th>
                    <th className="px-6 py-3">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.id} className="hover:bg-app-card-hover">
                      <td className="px-6 py-4 font-mono text-xs font-bold text-app">{w.code}</td>
                      <td className="px-6 py-4 font-semibold text-app">{w.name}</td>
                      <td className="px-6 py-4 text-app-muted">{w.location || "-"}</td>
                      <td className="px-6 py-4">
                        {w.is_default ? (
                          <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-1 rounded-full">
                            {t("warehouses.mainWarehouse")}
                          </span>
                        ) : (
                          <span className="bg-app-card-hover text-app text-xs font-semibold px-2.5 py-1 rounded-full">
                            {t("warehouses.secondaryWarehouse")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>

      {/* Modal Add Warehouse */}
      {isModalOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex justify-between items-center">
              <h3 className="font-bold text-app">{t("warehouses.addModalTitle")}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-app-muted hover:text-app-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateWarehouse} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("warehouses.warehouseCode")}</label>
                <input
                  type="text"
                  placeholder={t("warehouses.warehouseCodePlaceholder")}
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("warehouses.warehouseNameRequired")}</label>
                <input
                  type="text"
                  required
                  placeholder={t("warehouses.warehouseNamePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("warehouses.locationLabel")}</label>
                <input
                  type="text"
                  placeholder={t("warehouses.locationPlaceholder")}
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-xs font-semibold text-app"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
                >
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
