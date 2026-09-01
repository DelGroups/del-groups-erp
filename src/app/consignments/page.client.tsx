"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ConsignmentDeliveryPrintTemplate from "@/components/consignment/ConsignmentDeliveryPrintTemplate";
import ConsignmentSettlementPrintTemplate from "@/components/consignment/ConsignmentSettlementPrintTemplate";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/lib/supabase";
import {
  createConsignmentDispatchAction,
  createConsignmentReturnAction,
  fetchConsignmentLookupsAction,
  listConsignmentDispatchesAction,
  listConsignmentInventoryAction,
  listConsignmentReportsAction,
  saveConsignmentMonthlyReportAction,
  saveConsignmentPartnerAction,
  type ConsignmentLookups,
} from "@/lib/actions/consignment";
import type {
  ConsignmentDispatch,
  ConsignmentDispatchItem,
  ConsignmentInventoryRow,
  ConsignmentMonthlyReport,
} from "@/lib/consignment/types";
import { Handshake, Printer, FileSpreadsheet, Plus } from "lucide-react";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

type TabId = "partners" | "dispatch" | "inventory" | "settlement" | "alerts";

function downloadWorkbook(filename: string, sheetName: string, rows: (string | number)[][]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export default function ConsignmentPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_consignments");
  const { message: toastMessage, variant: toastVariant, showError } = useToast();
  const [tab, setTab] = useState<TabId>("inventory");
  const [lookups, setLookups] = useState<ConsignmentLookups | null>(null);
  const [dispatches, setDispatches] = useState<ConsignmentDispatch[]>([]);
  const [inventory, setInventory] = useState<ConsignmentInventoryRow[]>([]);
  const [reports, setReports] = useState<ConsignmentMonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("DEL GROUPS MMC");

  const { printData: printDispatch, setPrintData: setPrintDispatch } =
    useDocumentPrint<ConsignmentDispatch>();
  const { printData: printReport, setPrintData: setPrintReport } =
    useDocumentPrint<ConsignmentMonthlyReport>();

  const [partnerId, setPartnerId] = useState("");
  const [category, setCategory] = useState("all");
  const [period, setPeriod] = useState(currentPeriod());

  const [partnerName, setPartnerName] = useState("");
  const [partnerCompany, setPartnerCompany] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [partnerCustomerId, setPartnerCustomerId] = useState("");

  const [warehouseId, setWarehouseId] = useState("");
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [dispatchNotes, setDispatchNotes] = useState("");
  const [dispatchLines, setDispatchLines] = useState<{ product_id: string; quantity: string }[]>([
    { product_id: "", quantity: "1" },
  ]);

  const [returnWarehouseId, setReturnWarehouseId] = useState("");
  const [returnQtyByProduct, setReturnQtyByProduct] = useState<Record<string, string>>({});

  const [soldQtyByProduct, setSoldQtyByProduct] = useState<Record<string, string>>({});
  const [soldPriceByProduct, setSoldPriceByProduct] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [look, disp, inv, reps, settings] = await Promise.all([
      fetchConsignmentLookupsAction(),
      listConsignmentDispatchesAction(),
      listConsignmentInventoryAction(),
      listConsignmentReportsAction(),
      supabase.from("settings").select("company_name").limit(1).maybeSingle(),
    ]);
    if (!look.success) setError(look.error || t("consignments.loadError"));
    else setLookups(look.data || null);
    if (disp.success) setDispatches(disp.data || []);
    if (inv.success) setInventory(inv.data || []);
    if (reps.success) setReports(reps.data || []);
    if (settings.data?.company_name) setCompanyName(String(settings.data.company_name));
    setLoading(false);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredInventory = useMemo(() => {
    return inventory.filter((row) => {
      if (partnerId && row.partner_id !== partnerId) return false;
      if (category !== "all" && (row.category || "") !== category) return false;
      return true;
    });
  }, [inventory, partnerId, category]);

  const partnerInventory = useMemo(
    () => inventory.filter((row) => !partnerId || row.partner_id === partnerId),
    [inventory, partnerId]
  );

  const totals = useMemo(() => {
    return filteredInventory.reduce(
      (acc, row) => {
        acc.delivered += row.delivered_qty;
        acc.sold += row.sold_qty;
        acc.returned += row.returned_qty;
        acc.remaining += row.remaining_qty;
        acc.value += row.remaining_qty * row.unit_price;
        return acc;
      },
      { delivered: 0, sold: 0, returned: 0, remaining: 0, value: 0 }
    );
  }, [filteredInventory]);

  const agingRows = inventory.filter((row) => row.is_aging);
  const categories = useMemo(() => {
    const set = new Set(inventory.map((row) => row.category).filter(Boolean) as string[]);
    return [...set];
  }, [inventory]);

  const handleSavePartner = async () => {
    setSaving(true);
    const result = await saveConsignmentPartnerAction({
      name: partnerName,
      company_name: partnerCompany,
      phone: partnerPhone,
      customer_id: partnerCustomerId || null,
    });
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    setPartnerName("");
    setPartnerCompany("");
    setPartnerPhone("");
    setPartnerCustomerId("");
    await load();
  };

  const handleDispatch = async () => {
    const warehouse = lookups?.warehouses.find((w) => w.id === warehouseId);
    const items: ConsignmentDispatchItem[] = [];
    for (const line of dispatchLines) {
      const product = lookups?.products.find((p) => p.id === line.product_id);
      if (!product) continue;
      items.push({
        product_id: product.id,
        product_code: product.code,
        product_name: product.name,
        category: product.category,
        unit: product.unit,
        quantity: Number(line.quantity) || 0,
        unit_price: Number(product.sell_price) || 0,
      });
    }
    setSaving(true);
    const result = await createConsignmentDispatchAction({
      partner_id: partnerId,
      warehouse_id: warehouseId,
      warehouse_name: warehouse?.name || null,
      dispatch_date: dispatchDate,
      notes: dispatchNotes,
      items,
    });
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    if (!result.data) {
      showError(t("common.error"));
      return;
    }
    setDispatchLines([{ product_id: "", quantity: "1" }]);
    await load();
    setPrintDispatch(result.data);
  };

  const handleReturn = async () => {
    const warehouse = lookups?.warehouses.find((w) => w.id === (returnWarehouseId || warehouseId));
    const items = Object.entries(returnQtyByProduct)
      .map(([product_id, qty]) => ({ product_id, quantity: Number(qty) || 0 }))
      .filter((item) => item.quantity > 0);
    setSaving(true);
    const result = await createConsignmentReturnAction({
      partner_id: partnerId,
      warehouse_id: warehouse?.id || warehouseId,
      warehouse_name: warehouse?.name || null,
      return_date: new Date().toISOString().slice(0, 10),
      items,
    });
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    setReturnQtyByProduct({});
    await load();
  };

  const handleSettlement = async () => {
    const sold_items = partnerInventory
      .map((row) => ({
        product_id: row.product_id,
        quantity_sold: Number(soldQtyByProduct[row.product_id] || 0),
        unit_price: Number(soldPriceByProduct[row.product_id] || row.unit_price),
      }))
      .filter((item) => item.quantity_sold > 0);
    setSaving(true);
    const result = await saveConsignmentMonthlyReportAction({
      partner_id: partnerId,
      report_period: period,
      sold_items,
    });
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    if (!result.data) {
      showError(t("common.error"));
      return;
    }
    setSoldQtyByProduct({});
    await load();
    setPrintReport(result.data);
  };

  const exportInventory = () => {
    downloadWorkbook(
      `consignment-stock_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Stock",
      [
        [
          t("consignments.partner"),
          t("print.product"),
          t("consignments.sent"),
          t("consignments.sold"),
          t("consignments.returned"),
          t("consignments.remaining"),
          t("consignments.stockValue"),
        ],
        ...filteredInventory.map((row) => [
          row.partner_name || "",
          row.product_name,
          row.delivered_qty,
          row.sold_qty,
          row.returned_qty,
          row.remaining_qty,
          Number((row.remaining_qty * row.unit_price).toFixed(2)),
        ]),
      ]
    );
  };

  const exportReports = () => {
    downloadWorkbook(
      `consignment-settlements_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Settlements",
      [
        [
          t("consignments.reportNo"),
          t("consignments.partner"),
          t("consignments.period"),
          t("common.total"),
        ],
        ...reports.map((row) => [row.report_no, row.partner_name || "", row.report_period, row.total_amount]),
      ]
    );
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "inventory", label: t("consignments.tabStock") },
    { id: "dispatch", label: t("consignments.tabDispatch") },
    { id: "settlement", label: t("consignments.tabSettlement") },
    { id: "partners", label: t("consignments.tabPartners") },
    { id: "alerts", label: t("consignments.tabAlerts") },
  ];

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<Handshake className="h-6 w-6 text-app-accent" />}
        title={t("consignments.pageTitle")}
        description={t("consignments.pageDescription")}
        extraActions={
          <>
            <button type="button" className="btn-secondary text-xs" onClick={exportInventory}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {t("consignments.exportStock")}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={exportReports}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {t("consignments.exportSettlements")}
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {agingRows.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t("consignments.agingBanner", { count: agingRows.length, days: 90 })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                tab === item.id ? "bg-app-accent text-white" : "border border-app text-app"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : (
          <>
            {tab === "partners" && (
              <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                <div className="rounded-xl border border-app bg-app-surface p-4">
                  <h3 className="mb-3 font-semibold">{t("consignments.partners")}</h3>
                  <div className="space-y-2">
                    {(lookups?.partners || []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPartnerId(p.id)}
                        className={`block w-full rounded-lg border p-3 text-left ${
                          partnerId === p.id ? "border-app-accent bg-app-accent/10" : "border-app"
                        }`}
                      >
                        <p className="font-semibold">{p.company_name || p.name}</p>
                        <p className="text-xs text-app-muted">
                          {p.code} {p.phone ? `· ${p.phone}` : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
                {canManage && (
                  <div className="rounded-xl border border-app bg-app-surface p-4 space-y-3">
                    <h3 className="font-semibold">{t("consignments.newPartner")}</h3>
                    <input
                      className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                      placeholder={t("consignments.partnerName")}
                      value={partnerName}
                      onChange={(e) => setPartnerName(e.target.value)}
                    />
                    <input
                      className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                      placeholder={t("common.company")}
                      value={partnerCompany}
                      onChange={(e) => setPartnerCompany(e.target.value)}
                    />
                    <input
                      className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                      placeholder={t("common.phone")}
                      value={partnerPhone}
                      onChange={(e) => setPartnerPhone(e.target.value)}
                    />
                    <select
                      className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                      value={partnerCustomerId}
                      onChange={(e) => setPartnerCustomerId(e.target.value)}
                    >
                      <option value="">{t("consignments.linkCustomer")}</option>
                      {(lookups?.customers || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name || c.name || c.company_name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn-primary text-xs" disabled={saving} onClick={handleSavePartner}>
                      <Plus className="h-3.5 w-3.5" />
                      {t("common.save")}
                    </button>
                  </div>
                )}
              </section>
            )}

            {tab === "inventory" && (
              <section className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                  >
                    <option value="">{t("consignments.allPartners")}</option>
                    {(lookups?.partners || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.company_name || p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">{t("common.category")}</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <StatCard label={t("consignments.sent")} value={totals.delivered} />
                  <StatCard label={t("consignments.sold")} value={totals.sold} />
                  <StatCard label={t("consignments.remaining")} value={totals.remaining} />
                  <StatCard
                    label={t("consignments.stockValue")}
                    value={`${totals.value.toFixed(2)} ${t("common.currency")}`}
                  />
                </div>
                <div className="overflow-x-auto rounded-xl border border-app">
                  <table className="min-w-full text-sm">
                    <thead className="bg-app-surface text-left text-xs uppercase text-app-muted">
                      <tr>
                        <th className="px-3 py-2">{t("consignments.partner")}</th>
                        <th className="px-3 py-2">{t("print.product")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.sent")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.sold")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.returned")}</th>
                        <th className="px-3 py-2 text-right">{t("consignments.remaining")}</th>
                        <th className="px-3 py-2">{t("consignments.aging")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInventory.map((row) => (
                        <tr key={row.id} className="border-t border-app">
                          <td className="px-3 py-2">{row.partner_name}</td>
                          <td className="px-3 py-2">
                            {row.product_name}
                            <span className="block text-[10px] text-app-muted">{row.category}</span>
                          </td>
                          <td className="px-3 py-2 text-right">{row.delivered_qty}</td>
                          <td className="px-3 py-2 text-right text-emerald-600">{row.sold_qty}</td>
                          <td className="px-3 py-2 text-right text-amber-600">{row.returned_qty}</td>
                          <td className="px-3 py-2 text-right font-bold">{row.remaining_qty}</td>
                          <td className="px-3 py-2">
                            {row.is_aging ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                {row.aging_days} {t("consignments.days")}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {tab === "dispatch" && (
              <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-xl border border-app bg-app-surface p-4 space-y-3">
                  <h3 className="font-semibold">{t("consignments.sendModalTitle")}</h3>
                  <select
                    className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                  >
                    <option value="">{t("consignments.partner")}</option>
                    {(lookups?.partners || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.company_name || p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    <option value="">{t("common.warehouse")}</option>
                    {(lookups?.warehouses || []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={dispatchDate}
                    onChange={(e) => setDispatchDate(e.target.value)}
                  />
                  {dispatchLines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_90px] gap-2">
                      <select
                        className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                        value={line.product_id}
                        onChange={(e) =>
                          setDispatchLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, product_id: e.target.value } : row))
                          )
                        }
                      >
                        <option value="">{t("forms.selectProduct")}</option>
                        {(lookups?.products || []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name} ({p.stock})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0.001}
                        className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                        value={line.quantity}
                        onChange={(e) =>
                          setDispatchLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, quantity: e.target.value } : row))
                          )
                        }
                      />
                    </div>
                  ))}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary self-start text-xs"
                        onClick={() => setDispatchLines((prev) => [...prev, { product_id: "", quantity: "1" }])}
                      >
                        {t("forms.addRow")}
                      </button>
                      <textarea
                        className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                        rows={2}
                        placeholder={t("common.notes")}
                        value={dispatchNotes}
                        onChange={(e) => setDispatchNotes(e.target.value)}
                      />
                      <button type="button" className="btn-primary text-xs" disabled={saving} onClick={handleDispatch}>
                        {saving ? t("common.saving") : t("consignments.confirmSend")}
                      </button>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-app bg-app-surface p-4">
                  <h3 className="mb-3 font-semibold">{t("consignments.recentDispatches")}</h3>
                  <div className="space-y-2">
                    {dispatches.slice(0, 12).map((d) => (
                      <div key={d.id} className="flex items-center justify-between rounded-lg border border-app p-3">
                        <div>
                          <p className="font-semibold">{d.dispatch_no}</p>
                          <p className="text-xs text-app-muted">
                            {d.partner_name} · {d.dispatch_date}
                          </p>
                        </div>
                        <button type="button" className="btn-secondary text-xs" onClick={() => setPrintDispatch(d)}>
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {tab === "settlement" && (
              <section className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                  >
                    <option value="">{t("consignments.partner")}</option>
                    {(lookups?.partners || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.company_name || p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="month"
                    className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  />
                </div>
                {!partnerId ? (
                  <p className="text-sm text-app-muted">{t("consignments.selectPartnerFirst")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-app">
                    <table className="min-w-full text-sm">
                      <thead className="bg-app-surface text-left text-xs uppercase text-app-muted">
                        <tr>
                          <th className="px-3 py-2">{t("print.product")}</th>
                          <th className="px-3 py-2 text-right">{t("consignments.remaining")}</th>
                          <th className="px-3 py-2">{t("consignments.soldThisMonth")}</th>
                          <th className="px-3 py-2">{t("consignments.price")}</th>
                          <th className="px-3 py-2">{t("consignments.returnQty")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partnerInventory
                          .filter((row) => row.remaining_qty > 0)
                          .map((row) => {
                            const sold = Number(soldQtyByProduct[row.product_id] || 0);
                            const oversold = sold > row.remaining_qty;
                            return (
                              <tr key={row.id} className="border-t border-app">
                                <td className="px-3 py-2">{row.product_name}</td>
                                <td className="px-3 py-2 text-right font-bold">{row.remaining_qty}</td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={0}
                                    max={row.remaining_qty}
                                    className={`w-24 rounded-lg border px-2 py-1 ${
                                      oversold ? "border-red-500" : "border-app"
                                    }`}
                                    value={soldQtyByProduct[row.product_id] || ""}
                                    onChange={(e) =>
                                      setSoldQtyByProduct((prev) => ({ ...prev, [row.product_id]: e.target.value }))
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    className="w-24 rounded-lg border border-app px-2 py-1"
                                    value={soldPriceByProduct[row.product_id] ?? String(row.unit_price)}
                                    onChange={(e) =>
                                      setSoldPriceByProduct((prev) => ({ ...prev, [row.product_id]: e.target.value }))
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={0}
                                    max={row.remaining_qty}
                                    className="w-24 rounded-lg border border-app px-2 py-1"
                                    value={returnQtyByProduct[row.product_id] || ""}
                                    onChange={(e) =>
                                      setReturnQtyByProduct((prev) => ({ ...prev, [row.product_id]: e.target.value }))
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
                {canManage && partnerId && (
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                      value={returnWarehouseId || warehouseId}
                      onChange={(e) => setReturnWarehouseId(e.target.value)}
                    >
                      <option value="">{t("common.warehouse")}</option>
                      {(lookups?.warehouses || []).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={handleReturn}>
                      {t("consignments.confirmReturn")}
                    </button>
                    <button type="button" className="btn-primary text-xs" disabled={saving} onClick={handleSettlement}>
                      {saving ? t("consignments.confirming") : t("consignments.confirmSettlement")}
                    </button>
                  </div>
                )}
                <div className="rounded-xl border border-app bg-app-surface p-4">
                  <h3 className="mb-3 font-semibold">{t("consignments.recentSettlements")}</h3>
                  {reports.map((r) => (
                    <div key={r.id} className="flex items-center justify-between border-t border-app py-2 text-sm">
                      <span>
                        {r.report_no} · {r.partner_name} · {r.report_period} · {r.total_amount.toFixed(2)}{" "}
                        {t("common.currency")}
                      </span>
                      <button type="button" className="btn-secondary text-xs" onClick={() => setPrintReport(r)}>
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === "alerts" && (
              <section className="rounded-xl border border-app bg-app-surface p-4">
                <h3 className="mb-3 font-semibold">{t("consignments.agingTitle")}</h3>
                {agingRows.length === 0 ? (
                  <p className="text-sm text-app-muted">{t("consignments.noAging")}</p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase text-app-muted">
                      <tr>
                        <th className="py-2">{t("consignments.partner")}</th>
                        <th className="py-2">{t("print.product")}</th>
                        <th className="py-2 text-right">{t("consignments.remaining")}</th>
                        <th className="py-2">{t("consignments.aging")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agingRows.map((row) => (
                        <tr key={row.id} className="border-t border-app">
                          <td className="py-2">{row.partner_name}</td>
                          <td className="py-2">{row.product_name}</td>
                          <td className="py-2 text-right">{row.remaining_qty}</td>
                          <td className="py-2">
                            {row.aging_days} {t("consignments.days")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {printDispatch && (
        <div className="print-area">
          <ConsignmentDeliveryPrintTemplate data={printDispatch} companyName={companyName} />
        </div>
      )}
      {printReport && (
        <div className="print-area">
          <ConsignmentSettlementPrintTemplate data={printReport} companyName={companyName} />
        </div>
      )}
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-app bg-app-surface p-4">
      <p className="text-xs text-app-muted">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
