"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import Select from "@/components/ui/select";
import MetricStockIntakeFields, {
  type MetricIntakeValue,
} from "@/components/polywood/MetricStockIntakeFields";
import ProductCombobox from "@/components/products/ProductCombobox";
import { fetchProductsCatalog } from "@/lib/products/api";
import {
  applyMetricStockReceipt,
  isMetricProduct,
  resolveStandardBarLengthM,
} from "@/lib/polywood/metricReceive";
import { POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";
import type { Product, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import { PackagePlus } from "lucide-react";

export default function WarehouseIncomingPageClient() {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [intake, setIntake] = useState<MetricIntakeValue>({
    mode: "full_bars",
    fullBarCount: 0,
    customLengths: "",
  });
  const [totalMeters, setTotalMeters] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    const data = await fetchProductsCatalog();
    const metricProducts = data.products.filter((product) => isMetricProduct(product));
    setProducts(metricProducts);
    setWarehouses(data.warehouses);
    const polywoodWarehouse = data.warehouses.find(
      (row) => row.warehouse_type === POLYWOOD_WAREHOUSE_TYPE
    );
    setWarehouseId(polywoodWarehouse?.id || data.warehouses[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId) || null,
    [products, productId]
  );
  const standardLengthM = resolveStandardBarLengthM(selectedProduct);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProduct || !warehouseId) {
      showError(t("metricIntake.selectProductWarehouse"));
      return;
    }
    if (totalMeters <= 0) {
      showError(t("metricIntake.emptyLengths"));
      return;
    }

    setSaving(true);
    try {
      const lengths =
        intake.mode === "full_bars"
          ? Array.from({ length: Math.max(0, Math.floor(intake.fullBarCount)) }, () => standardLengthM)
          : intake.customLengths
              .split(/[,;]+/)
              .map((part) => Math.round((parseFloat(part.trim()) || 0) * 1000) / 1000)
              .filter((length) => length > 0);

      const inserted = await applyMetricStockReceipt(
        selectedProduct.id,
        warehouseId,
        lengths,
        standardLengthM
      );
      showSuccess(t("metricIntake.success", { count: inserted, meters: totalMeters.toFixed(2) }));
      setIntake({ mode: "full_bars", fullBarCount: 0, customLengths: "" });
      setTotalMeters(0);
      void loadData();
    } catch (error) {
      showError(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout>
      <PageHeader
        icon={<PackagePlus className="h-6 w-6 text-app-accent" />}
        title={t("metricIntake.pageTitle")}
        subtitle={t("metricIntake.pageDescription")}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <Card className="mx-auto max-w-2xl">
          {loading ? (
            <p className="text-sm text-app-muted">{t("common.loading")}</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-app-muted">{t("metricIntake.noMetricProducts")}</p>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div>
                <label className="mb-1 block text-xs font-semibold text-app">
                  {t("dashboard.product")}
                </label>
                <ProductCombobox
                  instanceId="warehouse-incoming-product"
                  products={products}
                  selectedId={productId}
                  selectedName={selectedProduct?.name || ""}
                  onSelect={(product) => setProductId(product?.id || "")}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-app">
                  {t("common.warehouse")}
                </label>
                <Select
                  value={warehouseId}
                  onChange={(event) => setWarehouseId(event.target.value)}
                >
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>

              {selectedProduct ? (
                <MetricStockIntakeFields
                  value={intake}
                  standardLengthM={standardLengthM}
                  disabled={saving}
                  onChange={setIntake}
                  onTotalMetersChange={setTotalMeters}
                />
              ) : null}

              <div className="flex justify-end gap-2 border-t border-app pt-4">
                <Button type="submit" loading={saving} disabled={!selectedProduct || totalMeters <= 0}>
                  {t("metricIntake.receiveStock")}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </main>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
