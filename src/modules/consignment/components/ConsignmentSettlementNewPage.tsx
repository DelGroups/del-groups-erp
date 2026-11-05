"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import Panel from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";
import ToastMessage from "@/components/ui/ToastMessage";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import { mapConsignmentReportToInvoicePrint } from "../lib/mapConsignmentReportToInvoicePrint";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import {
  fetchConsignmentLookupsAction,
  listConsignmentInventoryAction,
  settleConsignmentPartnerAtomicAction,
  type ConsignmentLookups,
} from "../actions/consignment";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { generateConsignmentDocNo } from "../lib/types";
import type { ConsignmentInventoryRow } from "../lib/types";
import { EntityLookup } from "@/components/lookups";
import { useUiStandard } from "@/design-system/components";
import { LineGrid, LineNumberCell, LineText } from "@/components/line-grid";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatMoney, formatQuantity } from "@/lib/dates/localeDate";

/** A typed amount ("" while empty) as the number a LineNumberCell shows. */
const numberOrNull = (text: string): number | null => (text === "" || !Number.isFinite(Number(text)) ? null : Number(text));
/** Sold and returned together exceed what the customer still holds. */
const oversoldRow = (row: { quantity_sold: string; quantity_returned: string; remaining_qty: number }) =>
  (Number(row.quantity_sold) || 0) + (Number(row.quantity_returned) || 0) > row.remaining_qty;

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

interface SettlementRow {
  product_id: string;
  product_name: string;
  remaining_qty: number;
  quantity_sold: string;
  quantity_returned: string;
  unit_price: string;
}

export default function ConsignmentSettlementNewPage() {
  const { t, locale } = useI18n();
  // UI_STANDARD (UI-2 lookups, UI-6 lines on LineGrid): partner, sales rep and warehouse through EntityLookup.
  const uiStandard = useUiStandard();
  const [pickedRepName, setPickedRepName] = useState<string | null>(null);
  const router = useRouter();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const invoicePrint = useInvoicePrintSystem();

  const [lookups, setLookups] = useState<ConsignmentLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingInventory, setLoadingInventory] = useState(false);

  const [reportNo] = useState(() => generateConsignmentDocNo("CM"));
  const [partnerId, setPartnerId] = useState("");
  const [period, setPeriod] = useState(currentPeriod());
  const [salesRepId, setSalesRepId] = useState("");
  const [returnWarehouseId, setReturnWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<SettlementRow[]>([]);

  useEffect(() => {
    void (async () => {
      const look = await fetchConsignmentLookupsAction();
      if (look.success) setLookups(look.data || null);
      else showError(look.error || t("common.error"));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!partnerId) {
      setRows([]);
      return;
    }
    setLoadingInventory(true);
    void listConsignmentInventoryAction({ partnerId }).then((result) => {
      setLoadingInventory(false);
      if (!result.success) {
        showError(result.error || t("common.error"));
        return;
      }
      const inventory = (result.data || []).filter((row: ConsignmentInventoryRow) => row.remaining_qty > 0);
      setRows(
        inventory.map((row) => ({
          product_id: row.product_id,
          product_name: row.product_name,
          remaining_qty: row.remaining_qty,
          quantity_sold: "",
          quantity_returned: "",
          unit_price: String(row.unit_price),
        }))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  const updateRow = useCallback((productId: string, patch: Partial<SettlementRow>) => {
    setRows((prev) => prev.map((row) => (row.product_id === productId ? { ...row, ...patch } : row)));
  }, []);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const sold = Number(row.quantity_sold) || 0;
        const price = Number(row.unit_price) || 0;
        acc.totalAmount += sold * price;
        acc.anyReturned = acc.anyReturned || (Number(row.quantity_returned) || 0) > 0;
        return acc;
      },
      { totalAmount: 0, anyReturned: false }
    );
  }, [rows]);

  const handleSubmit = async () => {
    if (!partnerId) return showError(t("consignments.partner"));
    if (!/^\d{4}-\d{2}$/.test(period)) return showError(t("consignments.period"));

    const lines = rows
      .map((row) => ({
        product_id: row.product_id,
        quantity_sold: Number(row.quantity_sold) || 0,
        quantity_returned: Number(row.quantity_returned) || 0,
        unit_price: Number(row.unit_price) || 0,
      }))
      .filter((line) => line.quantity_sold > 0 || line.quantity_returned > 0);

    if (!lines.length) return showError(t("consignments.settlementNothingEntered"));

    for (const row of rows) {
      const sold = Number(row.quantity_sold) || 0;
      const returned = Number(row.quantity_returned) || 0;
      if (sold + returned > row.remaining_qty + 0.0001) {
        return showError(
          t("consignments.settlementQtyExceedsRemaining", { name: row.product_name })
        );
      }
    }
    if (totals.anyReturned && !returnWarehouseId) {
      return showError(t("consignments.returnWarehouse"));
    }

    const rep = lookups?.salesReps.find((r) => r.id === salesRepId);
    setSubmitting(true);
    const result = await settleConsignmentPartnerAtomicAction({
      report_no: reportNo,
      partner_id: partnerId,
      report_period: period,
      notes,
      return_warehouse_id: returnWarehouseId || null,
      sales_rep_id: salesRepId || null,
      sales_rep_name: rep?.full_name || pickedRepName || null,
      lines,
    });
    setSubmitting(false);

    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("consignments.settlementSuccess"));
    if (result.data) invoicePrint.requestPrint(mapConsignmentReportToInvoicePrint(result.data));
    setRows([]);
    setPartnerId("");
    setNotes("");
  };

  return (
    <PageLayout>
      <PageHeader
        icon={<ReceiptText className="h-6 w-6 text-app-accent" />}
        title={t("consignments.tabSettlement")}
        subtitle={t("consignments.pageDescription")}
        breadcrumbs={[
          { href: "/consignments", label: t("consignments.pageTitle") },
          { label: t("consignments.tabSettlement") },
        ]}
        actions={
          <Button type="button" appearance="text" color="secondary" onClick={() => router.push("/consignments")}>
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Button>
        }
      />
      <div className="p-4 md:p-6 pb-28">
        {loading ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : (
          <div className="space-y-6">
            <Panel title={t("consignments.settlementHeaderPanel")}>
              <div className="grid gap-4 lg:grid-cols-4">
                <div className="space-y-1">
                  <label className="erp-label">{t("consignments.reportNo")}</label>
                  <Input value={reportNo} readOnly disabled />
                </div>
                <div className="space-y-1">
                  <label className="erp-label">{t("consignments.partner")}</label>
                  {uiStandard ? (
                    <EntityLookup
                      entity="consignmentPartner"
                      value={partnerId}
                      selectedLabel={(() => {
                        const p = (lookups?.partners || []).find((x) => x.id === partnerId);
                        return p ? p.company_name || p.name : undefined;
                      })()}
                      placeholder={t("consignments.partner")}
                      aria-label={t("consignments.partner")}
                      onChange={(id) => setPartnerId(id ?? "")}
                    />
                  ) : (
                  <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">{t("consignments.partner")}</option>
                    {(lookups?.partners || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.company_name || p.name}
                      </option>
                    ))}
                  </Select>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="erp-label">{t("consignments.period")}</label>
                  <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="erp-label">{t("consignments.salesRep")}</label>
                  {uiStandard ? (
                    <EntityLookup
                      entity="employee"
                      value={salesRepId}
                      selectedLabel={(lookups?.salesReps || []).find((r) => r.id === salesRepId)?.full_name}
                      placeholder={t("consignments.selectSalesRep")}
                      aria-label={t("consignments.salesRep")}
                      onChange={(id, row) => {
                        setSalesRepId(id ?? "");
                        setPickedRepName(row ? String(row.full_name ?? "") : null);
                      }}
                    />
                  ) : (
                  <Select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}>
                    <option value="">{t("consignments.selectSalesRep")}</option>
                    {(lookups?.salesReps || []).map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.full_name}
                      </option>
                    ))}
                  </Select>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="erp-label">{t("consignments.returnWarehouse")}</label>
                  <Select value={returnWarehouseId} onChange={(e) => setReturnWarehouseId(e.target.value)}>
                    <option value="">{t("common.warehouse")}</option>
                    {(lookups?.warehouses || []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
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

            <Panel title={t("consignments.settlementLinesPanel")}>
              {!partnerId ? (
                <p className="text-sm text-app-muted">{t("consignments.settlementSelectPartnerFirst")}</p>
              ) : loadingInventory ? (
                <p className="text-sm text-app-muted">{t("common.loading")}</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-app-muted">{t("consignments.noAging")}</p>
              ) : uiStandard ? (
                <LineGrid<SettlementRow>
                  id="consignment-settlement-lines"
                  label={t("consignments.settlementLinesPanel")}
                  lines={rows}
                  lineKey={(row) => row.product_id}
                  lineLabel={(row) => row.product_name}
                  labels={lineGridLabels(t)}
                  columns={[
                    { key: "product", header: t("print.product"), width: 240, cell: (row) => <LineText>{row.product_name}</LineText> },
                    { key: "remaining", header: t("consignments.colRemaining"), type: "number", cell: (row) => <LineText>{formatQuantity(row.remaining_qty, locale)}</LineText> },
                    {
                      key: "sold",
                      header: t("consignments.colSold"),
                      type: "number",
                      width: 112,
                      error: (row) => (oversoldRow(row) ? t("consignments.qtyExceedsRemaining") : null),
                      cell: (row, ctx) => (
                        <LineNumberCell ctx={ctx} value={numberOrNull(row.quantity_sold)} max={row.remaining_qty} onChange={(value) => updateRow(row.product_id, { quantity_sold: value === null ? "" : String(value) })} />
                      ),
                    },
                    {
                      key: "returned",
                      header: t("consignments.colReturned"),
                      type: "number",
                      width: 112,
                      error: (row) => (oversoldRow(row) ? t("consignments.qtyExceedsRemaining") : null),
                      cell: (row, ctx) => (
                        <LineNumberCell ctx={ctx} value={numberOrNull(row.quantity_returned)} max={row.remaining_qty} onChange={(value) => updateRow(row.product_id, { quantity_returned: value === null ? "" : String(value) })} />
                      ),
                    },
                    {
                      key: "price",
                      header: t("consignments.colUnitPrice"),
                      type: "money",
                      width: 120,
                      cell: (row, ctx) => <LineNumberCell ctx={ctx} value={numberOrNull(row.unit_price)} onChange={(value) => updateRow(row.product_id, { unit_price: value === null ? "" : String(value) })} />,
                    },
                    {
                      key: "total",
                      header: t("consignments.colLineTotal"),
                      type: "money",
                      cell: (row) => <LineText className="font-semibold">{formatMoney((Number(row.quantity_sold) || 0) * (Number(row.unit_price) || 0), locale, { currency: null })}</LineText>,
                      total: <LineText>{formatMoney(totals.totalAmount, locale)}</LineText>,
                    },
                  ]}
                />
              ) : (
                <div className="overflow-x-auto rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[color:var(--erp-bg-table-header)]">
                      <tr>
                        <th className="px-3 py-2">{t("print.product")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.colRemaining")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.colSold")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.colReturned")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.colUnitPrice")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.colLineTotal")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const sold = Number(row.quantity_sold) || 0;
                        const returned = Number(row.quantity_returned) || 0;
                        const price = Number(row.unit_price) || 0;
                        const oversold = sold + returned > row.remaining_qty;
                        return (
                          <tr key={row.product_id} className="border-t border-[color:var(--erp-border-default)]">
                            <td className="px-3 py-2">{row.product_name}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{row.remaining_qty}</td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                type="number"
                                min={0}
                                max={row.remaining_qty}
                                className={`ml-auto w-24 text-right ${oversold ? "border-red-500" : ""}`}
                                value={row.quantity_sold}
                                onChange={(e) => updateRow(row.product_id, { quantity_sold: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                type="number"
                                min={0}
                                max={row.remaining_qty}
                                className={`ml-auto w-24 text-right ${oversold ? "border-red-500" : ""}`}
                                value={row.quantity_returned}
                                onChange={(e) => updateRow(row.product_id, { quantity_returned: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                type="number"
                                className="ml-auto w-24 text-right"
                                value={row.unit_price}
                                onChange={(e) => updateRow(row.product_id, { unit_price: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-bold">{(sold * price).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

            </Panel>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t border-app bg-app-card px-4 py-4 md:px-6">
        <p className="text-sm font-bold">
          {t("common.total")}: {totals.totalAmount.toFixed(2)} {t("common.currency")}
        </p>
        <div className="flex gap-2">
          <Button type="button" appearance="outline" onClick={() => router.push("/consignments")}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} loading={submitting}>
            {t("consignments.confirmSettlementAtomic")}
          </Button>
        </div>
      </div>

      <InvoicePrintSystem
        branding={invoicePrint.branding}
        modalOpen={invoicePrint.modalOpen}
        pendingData={invoicePrint.pendingData}
        printPayload={invoicePrint.printPayload}
        closeModal={invoicePrint.closeModal}
        confirmPrint={invoicePrint.confirmPrint}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
