"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ConsignmentDeliveryPrintTemplate from "@/components/consignment/ConsignmentDeliveryPrintTemplate";
import ConsignmentKpiCards from "@/components/consignment/ConsignmentKpiCards";
import ConsignmentRepPerformanceChart, {
  type ConsignmentRepPerformanceRow,
} from "@/components/consignment/ConsignmentRepPerformanceChart";
import ConsignmentReturnModal from "@/components/consignment/ConsignmentReturnModal";
import ConsignmentDocumentStatusBadge from "@/components/consignment/ConsignmentDocumentStatusBadge";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import { mapConsignmentReportToInvoicePrint } from "@/lib/print/mapConsignmentReportToInvoicePrint";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/lib/supabase";
import {
  createConsignmentReturnAction,
  fetchConsignmentLookupsAction,
  listConsignmentDispatchesAction,
  listConsignmentInventoryAction,
  listConsignmentReportsAction,
  listConsignmentReturnsAction,
  saveConsignmentPartnerAction,
  type ConsignmentLookups,
} from "@/lib/actions/consignment";
import type {
  ConsignmentDispatch,
  ConsignmentDispatchItem,
  ConsignmentDocumentType,
  ConsignmentInventoryRow,
  ConsignmentMonthlyReport,
  ConsignmentReturn,
} from "@/lib/consignment/types";
import { Handshake, Printer, FileSpreadsheet, PackageMinus, PackagePlus, ReceiptText, RotateCcw, Plus } from "lucide-react";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

type TabId = "inventory" | "history" | "partners" | "alerts";

interface HistoryRow {
  id: string;
  document_type: ConsignmentDocumentType;
  doc_no: string;
  partner_name: string | null;
  sales_rep_name: string | null;
  date: string;
  total_value: number;
  created_at: string | null;
  raw: ConsignmentDispatch | ConsignmentReturn | ConsignmentMonthlyReport;
}

function downloadWorkbook(filename: string, sheetName: string, rows: (string | number)[][]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function dispatchValue(items: ConsignmentDispatchItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
}

export default function ConsignmentPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("can_manage_consignments");
  const { message: toastMessage, variant: toastVariant, showError } = useToast();
  const [tab, setTab] = useState<TabId>("inventory");
  const [lookups, setLookups] = useState<ConsignmentLookups | null>(null);
  const [dispatches, setDispatches] = useState<ConsignmentDispatch[]>([]);
  const [returns, setReturns] = useState<ConsignmentReturn[]>([]);
  const [inventory, setInventory] = useState<ConsignmentInventoryRow[]>([]);
  const [reports, setReports] = useState<ConsignmentMonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("DEL GROUPS MMC");
  const [returnModalOpen, setReturnModalOpen] = useState(false);

  const { printData: printDispatch, setPrintData: setPrintDispatch } =
    useDocumentPrint<ConsignmentDispatch>();
  const invoicePrint = useInvoicePrintSystem();

  const [partnerId, setPartnerId] = useState("");
  const [category, setCategory] = useState("all");

  const [partnerName, setPartnerName] = useState("");
  const [partnerCompany, setPartnerCompany] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [partnerCustomerId, setPartnerCustomerId] = useState("");

  const [returnWarehouseId, setReturnWarehouseId] = useState("");
  const [returnQtyByProduct, setReturnQtyByProduct] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [look, disp, ret, inv, reps, settings] = await Promise.all([
      fetchConsignmentLookupsAction(),
      listConsignmentDispatchesAction(),
      listConsignmentReturnsAction(),
      listConsignmentInventoryAction(),
      listConsignmentReportsAction(),
      supabase.from("settings").select("company_name").limit(1).maybeSingle(),
    ]);
    if (!look.success) setError(look.error || t("consignments.loadError"));
    else setLookups(look.data || null);
    if (disp.success) setDispatches(disp.data || []);
    if (ret.success) setReturns(ret.data || []);
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

  const categories = useMemo(() => {
    const set = new Set(inventory.map((row) => row.category).filter(Boolean) as string[]);
    return [...set];
  }, [inventory]);

  const agingRows = inventory.filter((row) => row.is_aging);

  const kpiStockValue = useMemo(
    () => inventory.reduce((sum, row) => sum + row.remaining_qty * row.unit_price, 0),
    [inventory]
  );
  const kpiSoldThisMonth = useMemo(() => {
    const thisMonth = currentPeriod();
    return reports
      .filter((r) => r.report_period === thisMonth)
      .reduce((sum, r) => sum + r.total_amount, 0);
  }, [reports]);
  const kpiPendingReturnsValue = useMemo(
    () => agingRows.reduce((sum, row) => sum + row.remaining_qty * row.unit_price, 0),
    [agingRows]
  );

  const repPerformance: ConsignmentRepPerformanceRow[] = useMemo(() => {
    const unassigned = t("consignments.unassignedRep");
    const map = new Map<string, ConsignmentRepPerformanceRow>();
    for (const d of dispatches) {
      if (d.status === "initial_balance") continue;
      const key = d.sales_rep_id || d.sales_rep_name || "unassigned";
      const repName = d.sales_rep_name || unassigned;
      const row = map.get(key) || { repName, dispatched: 0, sold: 0 };
      row.dispatched += dispatchValue(d.items);
      row.repName = repName;
      map.set(key, row);
    }
    for (const r of reports) {
      const key = r.sales_rep_id || r.sales_rep_name || "unassigned";
      const repName = r.sales_rep_name || unassigned;
      const row = map.get(key) || { repName, dispatched: 0, sold: 0 };
      row.sold += r.total_amount;
      row.repName = repName;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.dispatched - a.dispatched);
  }, [dispatches, reports, t]);

  const historyRows: HistoryRow[] = useMemo(() => {
    const fromDispatches: HistoryRow[] = dispatches.map((d) => ({
      id: `dispatch-${d.id}`,
      document_type: d.status === "initial_balance" ? "INITIAL_BALANCE" : "DISPATCH",
      doc_no: d.dispatch_no,
      partner_name: d.partner_name || null,
      sales_rep_name: d.sales_rep_name,
      date: d.dispatch_date,
      total_value: dispatchValue(d.items),
      created_at: d.created_at,
      raw: d,
    }));
    const fromReturns: HistoryRow[] = returns.map((r) => ({
      id: `return-${r.id}`,
      document_type: "RETURN",
      doc_no: r.return_no,
      partner_name: r.partner_name || null,
      sales_rep_name: null,
      date: r.return_date,
      total_value: dispatchValue(r.items),
      created_at: r.created_at,
      raw: r,
    }));
    const fromReports: HistoryRow[] = reports.map((rep) => ({
      id: `report-${rep.id}`,
      document_type: "ACTUAL_SALE",
      doc_no: rep.report_no,
      partner_name: rep.partner_name || null,
      sales_rep_name: rep.sales_rep_name,
      date: `${rep.report_period}-01`,
      total_value: rep.total_amount,
      created_at: rep.created_at,
      raw: rep,
    }));
    return [...fromDispatches, ...fromReturns, ...fromReports].sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );
  }, [dispatches, returns, reports]);

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

  const handleReturn = async () => {
    const warehouse = lookups?.warehouses.find((w) => w.id === returnWarehouseId);
    const items = Object.entries(returnQtyByProduct)
      .map(([product_id, qty]) => ({ product_id, quantity: Number(qty) || 0 }))
      .filter((item) => item.quantity > 0);
    setSaving(true);
    const result = await createConsignmentReturnAction({
      partner_id: partnerId,
      warehouse_id: returnWarehouseId,
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
    setReturnModalOpen(false);
    await load();
  };

  const handlePrintHistoryRow = (row: HistoryRow) => {
    if (row.document_type === "DISPATCH") setPrintDispatch(row.raw as ConsignmentDispatch);
    else if (row.document_type === "ACTUAL_SALE") {
      invoicePrint.requestPrint(mapConsignmentReportToInvoicePrint(row.raw as ConsignmentMonthlyReport));
    }
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
    { id: "history", label: t("consignments.tabHistory") },
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
            {canManage && (
              <>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => router.push("/consignments/initial-balance/new")}
                >
                  <PackagePlus className="h-3.5 w-3.5" />
                  {t("consignments.opTypeInitialBalance")}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => router.push("/consignments/dispatch/new")}
                >
                  <PackageMinus className="h-3.5 w-3.5" />
                  {t("consignments.opTypeDispatch")}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => router.push("/consignments/settlement/new")}
                >
                  <ReceiptText className="h-3.5 w-3.5" />
                  {t("consignments.opTypeActualSale")}
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => setReturnModalOpen(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("consignments.opTypeReturn")}
                </button>
              </>
            )}
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <ConsignmentKpiCards
          totalStockValue={kpiStockValue}
          soldThisMonth={kpiSoldThisMonth}
          pendingReturnsCount={agingRows.length}
          pendingReturnsValue={kpiPendingReturnsValue}
        />

        <ConsignmentRepPerformanceChart data={repPerformance} />

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

            {tab === "history" && (
              <section className="overflow-x-auto rounded-xl border border-app">
                <table className="min-w-full text-sm">
                  <thead className="bg-app-surface text-left text-xs uppercase text-app-muted">
                    <tr>
                      <th className="px-3 py-2">{t("consignments.docType")}</th>
                      <th className="px-3 py-2">{t("consignments.docNo")}</th>
                      <th className="px-3 py-2">{t("consignments.partner")}</th>
                      <th className="px-3 py-2">{t("consignments.salesRep")}</th>
                      <th className="px-3 py-2">{t("common.date")}</th>
                      <th className="px-3 py-2 text-right">{t("consignments.totalValue")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((row) => (
                      <tr key={row.id} className="border-t border-app">
                        <td className="px-3 py-2">
                          <ConsignmentDocumentStatusBadge documentType={row.document_type} />
                        </td>
                        <td className="px-3 py-2 font-semibold">{row.doc_no}</td>
                        <td className="px-3 py-2">{row.partner_name || "-"}</td>
                        <td className="px-3 py-2">{row.sales_rep_name || "-"}</td>
                        <td className="px-3 py-2">{row.date}</td>
                        <td className="px-3 py-2 text-right font-bold">
                          {row.total_value.toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row.document_type !== "RETURN" && row.document_type !== "INITIAL_BALANCE" && (
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => handlePrintHistoryRow(row)}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {historyRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-app-muted">
                          {t("consignments.historyEmpty")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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

      <ConsignmentReturnModal
        open={returnModalOpen}
        onOpenChange={setReturnModalOpen}
        lookups={lookups}
        saving={saving}
        partnerId={partnerId}
        setPartnerId={setPartnerId}
        partnerInventory={partnerInventory}
        returnWarehouseId={returnWarehouseId}
        setReturnWarehouseId={setReturnWarehouseId}
        returnQtyByProduct={returnQtyByProduct}
        setReturnQtyByProduct={setReturnQtyByProduct}
        onReturn={handleReturn}
      />

      {printDispatch && (
        <div className="print-area">
          <ConsignmentDeliveryPrintTemplate data={printDispatch} companyName={companyName} />
        </div>
      )}
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
