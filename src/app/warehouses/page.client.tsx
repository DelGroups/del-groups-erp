"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import type { Warehouse, Product } from "@/types/database.types";
import {
  RefreshCw,
  Plus,
  Pencil,
  X,
} from "lucide-react";

export default function WarehousesPage() {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError } = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    location: "",
  });

  const fetchData = async () => {
    setLoading(true);
    const { data: whData } = await supabase.from("warehouses").select("*").order("created_at", { ascending: true });
    const { data: prdData } = await supabase.from("products").select("*");

    setWarehouses(whData || []);
    setProducts(prdData || []);
    setLoading(false);
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    const newWh = {
      code: formData.code || `WH-${Math.floor(100 + Math.random() * 900)}`,
      name: formData.name,
      location: formData.location,
      is_default: false,
    };

    const isEdit = Boolean(editingWarehouseId);
    const { data, error } = isEdit
      ? await supabase
          .from("warehouses")
          .update({
            code: newWh.code,
            name: newWh.name,
            location: newWh.location,
          })
          .eq("id", editingWarehouseId)
          .select("*")
          .single()
      : await supabase.from("warehouses").insert([newWh]).select("*").single();

    if (error) {
      showError(t("common.errorOccurred", { message: error.message }));
    } else {
      const row = data as Warehouse;
      setWarehouses((prev) =>
        isEdit ? prev.map((item) => (item.id === row.id ? row : item)) : [...prev, row]
      );
      setIsModalOpen(false);
      setEditingWarehouseId(null);
      setFormData({ code: "", name: "", location: "" });
    }
  };

  const openCreateModal = () => {
    setEditingWarehouseId(null);
    setFormData({ code: "", name: "", location: "" });
    setIsModalOpen(true);
  };

  const openEditModal = (warehouse: Warehouse) => {
    setEditingWarehouseId(warehouse.id);
    setFormData({
      code: warehouse.code || "",
      name: warehouse.name || "",
      location: warehouse.location || "",
    });
    setIsModalOpen(true);
  };

  const totalStockValuation = products.reduce(
    (sum, p) => sum + (p.stock * p.buy_price),
    0
  );

  return (
    <PageLayout>
        <header className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-app">{t("warehouses.pageTitle")}</h2>
            <p className="text-sm text-app-muted">{t("warehouses.pageDescription")}</p>
          </div>
          <button
            onClick={openCreateModal}
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
              <button onClick={fetchData} className="p-1.5 hover:bg-app-card-hover rounded-lg text-app-muted">
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
                    <th className="px-6 py-3">{t("common.actions")}</th>
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
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => openEditModal(w)}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t("common.edit")}
                        </button>
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
              <h3 className="font-bold text-app">
                {editingWarehouseId ? t("common.edit") : t("warehouses.addModalTitle")}
              </h3>
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
                  className="px-4 py-2 bg-[image:var(--app-gradient)] text-white rounded-lg text-xs font-semibold hover:brightness-110"
                >
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
