"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Panel from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";
import ToastMessage from "@/components/ui/ToastMessage";
import BarcodeScanField from "@/components/documents/BarcodeScanField";
import ProductCombobox from "@/components/products/ProductCombobox";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import {
  fetchConsignmentLookupsAction,
  resolveConsignmentProductBarcodeAction,
  setConsignmentInitialBalanceAtomicAction,
  type ConsignmentLookups,
} from "@/lib/actions/consignment";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { generateConsignmentDocNo } from "@/lib/consignment/types";
import type { Product } from "@/types/database.types";
import { ArrowLeft, PackagePlus, Trash2 } from "lucide-react";

interface InitialBalanceLine {
  id: string;
  product_id: string;
  product_code: string | null;
  product_name: string;
  category: string | null;
  unit: string;
  unit_price: number;
  quantity: number;
}

function createLineId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyLine(): InitialBalanceLine {
  return {
    id: createLineId(),
    product_id: "",
    product_code: null,
    product_name: "",
    category: null,
    unit: "Ədəd",
    unit_price: 0,
    quantity: 1,
  };
}

export default function ConsignmentInitialBalanceNewPageClient() {
  const { t } = useI18n();
  const router = useRouter();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [lookups, setLookups] = useState<ConsignmentLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [docNo] = useState(() => generateConsignmentDocNo("IB"));
  const [partnerId, setPartnerId] = useState("");
  const [balanceDate, setBalanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<InitialBalanceLine[]>([createEmptyLine()]);

  useEffect(() => {
    void fetchConsignmentLookupsAction().then((look) => {
      if (look.success) setLookups(look.data || null);
      else showError(look.error || t("common.error"));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLine = (id: string, patch: Partial<InitialBalanceLine>) => {
    setLines((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : [createEmptyLine()]));
  };

  const mergeOrSetLine = (
    lineId: string | null,
    fields: Omit<InitialBalanceLine, "id" | "quantity">,
    addQty: number
  ) => {
    setLines((prev) => {
      const existing = prev.find((row) => row.product_id === fields.product_id && row.id !== lineId);
      if (existing) {
        const merged = prev.map((row) =>
          row.id === existing.id ? { ...row, quantity: row.quantity + addQty } : row
        );
        return lineId ? merged.map((row) => (row.id === lineId ? createEmptyLine() : row)) : merged;
      }
      if (lineId) {
        return prev.map((row) => (row.id === lineId ? { ...row, ...fields, quantity: addQty || 1 } : row));
      }
      return [...prev, { ...fields, id: createLineId(), quantity: addQty || 1 }];
    });
  };

  const handleProductSelect = (lineId: string, product: Product | null) => {
    if (!product) {
      updateLine(lineId, createEmptyLine());
      return;
    }
    mergeOrSetLine(
      lineId,
      {
        product_id: product.id,
        product_code: product.code || null,
        product_name: product.name,
        category: product.category || null,
        unit: product.unit || "Ədəd",
        unit_price: Number(product.sell_price) || 0,
      },
      1
    );
  };

  const handleBarcodeScan = async (barcode: string) => {
    const result = await resolveConsignmentProductBarcodeAction(barcode);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (!result.data) {
      showError(t("common.error"));
      return;
    }
    const line = result.data;
    mergeOrSetLine(
      null,
      {
        product_id: line.product_id,
        product_code: line.product_code,
        product_name: line.product_name,
        category: line.category,
        unit: line.unit,
        unit_price: line.sell_price,
      },
      1
    );
  };

  const totalValue = useMemo(
    () => lines.reduce((sum, row) => sum + row.quantity * row.unit_price, 0),
    [lines]
  );

  const handleSubmit = async () => {
    if (!partnerId) return showError(t("consignments.partner"));
    const validLines = lines.filter((row) => row.product_id && row.quantity > 0);
    if (!validLines.length) return showError(t("consignments.linesRequired"));

    setSubmitting(true);
    const result = await setConsignmentInitialBalanceAtomicAction({
      dispatch_no: docNo,
      partner_id: partnerId,
      balance_date: balanceDate,
      notes,
      items: validLines.map((line) => ({
        product_id: line.product_id,
        product_code: line.product_code,
        product_name: line.product_name,
        category: line.category,
        unit: line.unit,
        quantity: line.quantity,
        unit_price: line.unit_price,
      })),
    });
    setSubmitting(false);

    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("consignments.initialBalanceSuccess"));
    setLines([createEmptyLine()]);
    setNotes("");
    setPartnerId("");
  };

  return (
    <PageLayout>
      <PageHeader
        icon={<PackagePlus className="h-6 w-6 text-app-accent" />}
        title={t("consignments.opTypeInitialBalance")}
        subtitle={t("consignments.initialBalanceDescription")}
        breadcrumbs={[
          { href: "/consignments", label: t("consignments.pageTitle") },
          { label: t("consignments.opTypeInitialBalance") },
        ]}
        actions={
          <Button type="button" appearance="text" color="secondary" onClick={() => router.push("/consignments")}>
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Button>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6 pb-28">
        {loading ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : (
          <div className="space-y-6">
            <Panel title={t("consignments.dispatchHeaderPanel")}>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-1">
                  <label className="erp-label">{t("consignments.docNo")}</label>
                  <Input value={docNo} readOnly disabled />
                </div>
                <div className="space-y-1">
                  <label className="erp-label">{t("common.date")}</label>
                  <Input type="date" value={balanceDate} onChange={(e) => setBalanceDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="erp-label">{t("consignments.partner")}</label>
                  <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">{t("consignments.partner")}</option>
                    {(lookups?.partners || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.company_name || p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1 lg:col-span-3">
                  <label className="erp-label">{t("common.notes")}</label>
                  <textarea
                    className="min-h-[64px] w-full rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-input)] px-3 py-2 text-sm"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            </Panel>

            <Panel title={t("consignments.linesPanel")}>
              <div className="mb-4 max-w-md">
                <BarcodeScanField onScan={handleBarcodeScan} label={t("consignments.scanBarcode")} />
              </div>

              <div className="overflow-x-auto rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)]">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[color:var(--erp-bg-table-header)]">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">{t("consignments.colProductBarcode")}</th>
                      <th className="px-3 py-2">{t("consignments.colUnit")}</th>
                      <th className="px-3 py-2 text-right">{t("consignments.colInitialQty")}</th>
                      <th className="px-3 py-2 text-right">{t("inventory.columns.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr key={line.id} className="border-t border-[color:var(--erp-border-default)]">
                        <td className="px-3 py-2">{index + 1}</td>
                        <td className="px-3 py-2 min-w-[260px]">
                          <ProductCombobox
                            products={lookups?.products || []}
                            selectedId={line.product_id}
                            selectedName={line.product_name}
                            onSelect={(product) => handleProductSelect(line.id, product)}
                            instanceId={line.id}
                          />
                        </td>
                        <td className="px-3 py-2">{line.unit}</td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            step={0.001}
                            className="ml-auto w-28 text-right font-mono tabular-nums"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button type="button" appearance="text" color="danger" size="sm" onClick={() => removeLine(line.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Button type="button" appearance="outline" onClick={() => setLines((prev) => [...prev, createEmptyLine()])}>
                  {t("forms.addRow")}
                </Button>
              </div>
            </Panel>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t border-app bg-app-card px-4 py-4 md:px-6">
        <p className="text-sm font-bold">
          {t("common.total")}: {totalValue.toFixed(2)} {t("common.currency")}
        </p>
        <div className="flex gap-2">
          <Button type="button" appearance="outline" onClick={() => router.push("/consignments")}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} loading={submitting}>
            {t("consignments.confirmInitialBalance")}
          </Button>
        </div>
      </div>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
