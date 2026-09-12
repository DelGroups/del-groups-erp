"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import Button from "@/components/ui/button";
import Card, { CardMeta } from "@/components/ui/card";
import Input from "@/components/ui/input";
import PageHeader from "@/components/ui/page-header";
import StatusBadge from "@/components/ui/status-badge";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Th, Td } from "@/components/ui/table";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import type { Warehouse, Product } from "@/types/database.types";
import { RefreshCw, Plus, Pencil, Warehouse as WarehouseIcon, X } from "lucide-react";

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
        <PageHeader
          icon={<WarehouseIcon className="h-6 w-6 text-app-accent" />}
          title={t("warehouses.pageTitle")}
          subtitle={t("warehouses.pageDescription")}
          actions={
            <Button type="button" onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              {t("warehouses.createLabel")}
            </Button>
          }
        />

        <main className="app-page-content flex-1 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardMeta>{t("warehouses.activeCount")}</CardMeta>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-app">
                {t("warehouses.warehouseCount", { count: warehouses.length })}
              </div>
            </Card>
            <Card>
              <CardMeta>{t("warehouses.totalProductTypes")}</CardMeta>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-app-accent">
                {t("warehouses.productTypeCount", { count: products.length })}
              </div>
            </Card>
            <Card>
              <CardMeta>{t("warehouses.totalStockValue")}</CardMeta>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-600">
                {totalStockValuation.toFixed(2)} AZN
              </div>
            </Card>
          </div>

          <Card padding={false}>
            <div className="flex items-center justify-between border-b border-app bg-app-card-hover p-4">
              <h3 className="font-bold text-app">{t("warehouses.listTitle")}</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => void fetchData()} loading={loading}>
                {loading ? null : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            {loading ? (
              <div className="p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>
            ) : warehouses.length === 0 ? (
              <div className="p-8 text-center text-sm text-app-muted">{t("warehouses.empty")}</div>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <Th>{t("common.code")}</Th>
                      <Th>{t("warehouses.warehouseName")}</Th>
                      <Th>{t("common.location")}</Th>
                      <Th>{t("common.status")}</Th>
                      <ActionsTh>{t("common.actions")}</ActionsTh>
                    </tr>
                  </THead>
                  <tbody>
                    {warehouses.map((w) => (
                      <tr key={w.id} className="hover:bg-app-card-hover">
                        <Td className="font-mono text-xs font-bold text-app">{w.code}</Td>
                        <Td className="font-semibold text-app">{w.name}</Td>
                        <Td className="text-app-muted">{w.location || "-"}</Td>
                        <Td>
                          {w.is_default ? (
                            <StatusBadge tone="posted">{t("warehouses.mainWarehouse")}</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">{t("warehouses.secondaryWarehouse")}</StatusBadge>
                          )}
                        </Td>
                        <ActionsTd>
                          <TableRowActionsMenu
                            items={[
                              {
                                key: "edit",
                                label: t("common.edit"),
                                icon: <Pencil className="h-4 w-4" />,
                                onClick: () => openEditModal(w),
                              },
                            ]}
                          />
                        </ActionsTd>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </main>

      {isModalOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex items-center justify-between">
              <h3 className="font-bold text-app">
                {editingWarehouseId ? t("common.edit") : t("warehouses.addModalTitle")}
              </h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <form onSubmit={handleCreateWarehouse} className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-app">{t("warehouses.warehouseCode")}</label>
                <Input
                  type="text"
                  placeholder={t("warehouses.warehouseCodePlaceholder")}
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-app">{t("warehouses.warehouseNameRequired")}</label>
                <Input
                  type="text"
                  required
                  placeholder={t("warehouses.warehouseNamePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-app">{t("warehouses.locationLabel")}</label>
                <Input
                  type="text"
                  placeholder={t("warehouses.locationPlaceholder")}
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit">
                  {t("common.save")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
