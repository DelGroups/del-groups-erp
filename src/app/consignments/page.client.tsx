"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import PageLayout from "@/components/layout/PageLayout";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import type { ConsignmentOrder } from "@/types/database.types";
import {
  Handshake, 
  Plus, 
  FileCheck, 
  Building2, 
  TrendingUp, 
  PackageCheck, 
  Search,
  Filter
} from "lucide-react";

export default function ConsignmentPage() {
  const { t } = useI18n();
  const { displayName, isAdmin, loading: authLoading } = useAuth();
  /** Non-admins may only send consignments under their own name. */
  const lockSeller = !authLoading && !isAdmin;
  const [activeTab, setActiveTab] = useState<"list" | "stock" | "reports">("list");
  const [items, setItems] = useState<ConsignmentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchCustomer, setSearchCustomer] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Send Consignment Form Modal States
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [sendCustomer, setSendCustomer] = useState("");
  const [sendSeller, setSendSeller] = useState("");
  const [sendProduct, setSendProduct] = useState("");
  const [sendCategory, setSendCategory] = useState("Ümumi");
  const [sendQty, setSendQty] = useState<number>(1);
  const [sendPrice, setSendPrice] = useState<number>(0);
  const [savingSend, setSavingSend] = useState(false);

  // Settlement Modal States
  const [selectedItem, setSelectedItem] = useState<ConsignmentOrder | null>(null);
  const [inputSold, setInputSold] = useState<number>(0);
  const [inputReturned, setInputReturned] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSeller = lockSeller ? displayName : sendSeller;

  useEffect(() => {
    fetchConsignments();
  }, []);


  const fetchConsignments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("consignment_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setItems(data);
    }
    setLoading(false);
  };

  // 1. Submit New Consignment Delivery
  const handleSendConsignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendCustomer || !sendProduct || sendQty <= 0) return;

    setSavingSend(true);
    const payload = {
      customer_name: sendCustomer,
      seller_name: effectiveSeller || "Administrator",
      product_name: sendProduct,
      category_name: sendCategory,
      sent_qty: sendQty,
      sold_qty: 0,
      returned_qty: 0,
      remaining_qty: sendQty,
      unit_price: sendPrice,
    };

    const { error } = await supabase.from("consignment_orders").insert([payload]);

    if (!error) {
      alert(t("consignments.sendSuccess"));
      setIsSendModalOpen(false);
      setSendCustomer("");
      setSendProduct("");
      setSendQty(1);
      setSendPrice(0);
      fetchConsignments();
    } else {
      alert(t("common.errorOccurred", { message: error.message }));
    }
    setSavingSend(false);
  };

  // 2. Submit Monthly Settlement & Issue Final Invoice
  const handleProcessSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    const currentRemaining = selectedItem.remaining_qty ?? 0;
    if (inputSold + inputReturned > currentRemaining) {
      alert(t("consignments.qtyExceedsRemaining"));
      return;
    }

    setSubmitting(true);
    const unitPrice = selectedItem.unit_price || 0;
    const totalSaleAmount = inputSold * unitPrice;

    const newSold = (selectedItem.sold_qty || 0) + inputSold;
    const newReturned = (selectedItem.returned_qty || 0) + inputReturned;
    const newRemaining = (selectedItem.sent_qty || 0) - (newSold + newReturned);

    const { error: consError } = await supabase
      .from("consignment_orders")
      .update({
        sold_qty: newSold,
        returned_qty: newReturned,
        remaining_qty: newRemaining,
      })
      .eq("id", selectedItem.id);

    if (!consError) {
      if (inputSold > 0) {
        await supabase.from("sales").insert([
          {
            customer_name: selectedItem.customer_name,
            category_name: selectedItem.category_name,
            total_amount: totalSaleAmount,
            seller_name: selectedItem.seller_name || "Administrator",
            sale_type: "Consignment_Settlement",
            created_at: new Date().toISOString(),
          },
        ]);
      }

      alert(t("consignments.settlementSuccess"));
      setSelectedItem(null);
      fetchConsignments();
    } else {
      alert(t("common.errorOccurred", { message: consError.message }));
    }
    setSubmitting(false);
  };

  // Filtering Logic
  const filteredItems = items.filter((item) => {
    const matchesCustomer = item.customer_name
      .toLowerCase()
      .includes(searchCustomer.toLowerCase());
    const matchesCat =
      selectedCategory === "all" || item.category_name === selectedCategory;
    return matchesCustomer && matchesCat;
  });

  // Calculate Company-wise aggregated stocks
  const companyStocks = filteredItems.reduce((acc: any, item) => {
    if (!acc[item.customer_name]) {
      acc[item.customer_name] = {
        sent: 0,
        sold: 0,
        remaining: 0,
        value: 0,
      };
    }
    acc[item.customer_name].sent += item.sent_qty || 0;
    acc[item.customer_name].sold += item.sold_qty || 0;
    acc[item.customer_name].remaining += item.remaining_qty || 0;
    acc[item.customer_name].value +=
      (item.remaining_qty || 0) * (item.unit_price || 0);
    return acc;
  }, {});

  return (
    <PageLayout>
        {/* Header */}
        <div className="border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-app flex items-center gap-2">
              <Handshake className="w-6 h-6 text-app-accent" />
              {t("consignments.pageTitle")}
            </h1>
            <p className="text-xs text-app-muted mt-0.5">
              {t("consignments.pageDescription")}
            </p>
          </div>

          <button
            onClick={() => setIsSendModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {t("consignments.sendConsignment")}
          </button>
        </div>

        {/* Filter Bar & Tabs */}
        <div className="p-6 space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 app-card p-3 shadow-sm">
            {/* Tabs */}
            <div className="flex gap-2 w-full md:w-auto">
              <button
                onClick={() => setActiveTab("list")}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === "list"
                    ? "bg-blue-600 text-white"
                    : "text-app-muted hover:bg-app-card-hover"
                }`}
              >
                {t("consignments.tabList")}
              </button>
              <button
                onClick={() => setActiveTab("stock")}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === "stock"
                    ? "bg-blue-600 text-white"
                    : "text-app-muted hover:bg-app-card-hover"
                }`}
              >
                {t("consignments.tabStock")}
              </button>
              <button
                onClick={() => setActiveTab("reports")}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === "reports"
                    ? "bg-blue-600 text-white"
                    : "text-app-muted hover:bg-app-card-hover"
                }`}
              >
                {t("consignments.tabReports")}
              </button>
            </div>

            {/* Search Filters */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-app-muted" />
                <input
                  type="text"
                  placeholder={t("consignments.searchPlaceholder")}
                  value={searchCustomer}
                  onChange={(e) => setSearchCustomer(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 border border-app rounded-lg text-xs focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
            </div>
          </div>

          {/* TAB 1: Main Consignment List */}
          {activeTab === "list" && (
            <div className="app-table-wrap">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="px-6 py-3">{t("consignments.customerCompany")}</th>
                    <th className="px-6 py-3">{t("consignments.productCategory")}</th>
                    <th className="px-6 py-3">{t("consignments.seller")}</th>
                    <th className="px-6 py-3">{t("consignments.sent")}</th>
                    <th className="px-6 py-3 text-emerald-600">{t("consignments.sold")}</th>
                    <th className="px-6 py-3 text-amber-600">{t("consignments.returned")}</th>
                    <th className="px-6 py-3 text-app-accent">{t("consignments.remaining")}</th>
                    <th className="px-6 py-3">{t("consignments.price")}</th>
                    <th className="px-6 py-3 text-right">{t("common.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredItems.map((item) => (
                    <tr key={item.id} >
                      <td className="px-6 py-3.5 font-bold text-app">
                        {item.customer_name}
                      </td>
                      <td className="px-6 py-3.5">
                        <p className="font-semibold">{item.product_name}</p>
                        <span className="text-[10px] text-app-muted">{item.category_name}</span>
                      </td>
                      <td className="px-6 py-3.5">{item.seller_name}</td>
                      <td className="px-6 py-3.5 font-semibold">{item.sent_qty ?? 0}</td>
                      <td className="px-6 py-3.5 text-emerald-600 font-bold">{item.sold_qty ?? 0}</td>
                      <td className="px-6 py-3.5 text-amber-600 font-bold">{item.returned_qty ?? 0}</td>
                      <td className="px-6 py-3.5 text-app-accent font-bold">{item.remaining_qty ?? 0}</td>
                      <td className="px-6 py-3.5">{(item.unit_price || 0).toFixed(2)} AZN</td>
                      <td className="px-6 py-3.5 text-right">
                        <button
                          onClick={() => {
                            setSelectedItem(item);
                            setInputSold(0);
                            setInputReturned(0);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ml-auto shadow-sm"
                        >
                          <FileCheck className="w-3.5 h-3.5" />
                          {t("consignments.monthlyReport")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: Company Stock Cards */}
          {activeTab === "stock" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Object.keys(companyStocks).map((company) => (
                <div
                  key={company}
                  className="app-card app-card-elevated p-5 space-y-3"
                >
                  <div className="flex justify-between items-center border-b pb-3">
                    <h3 className="font-bold text-app text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-app-accent" />
                      {company}
                    </h3>
                    <span className="bg-[color:var(--app-accent-soft)] text-app-accent text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {t("consignments.activeCompany")}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-app-card-hover p-2 rounded-lg">
                      <p className="text-[10px] text-app-muted">{t("consignments.sent")}</p>
                      <p className="font-bold text-app">{companyStocks[company].sent}</p>
                    </div>
                    <div className="bg-emerald-50 p-2 rounded-lg">
                      <p className="text-[10px] text-emerald-600">{t("consignments.sold")}</p>
                      <p className="font-bold text-emerald-700">{companyStocks[company].sold}</p>
                    </div>
                    <div className="bg-[color:var(--app-accent-soft)] p-2 rounded-lg">
                      <p className="text-[10px] text-app-accent">{t("consignments.remaining")}</p>
                      <p className="font-bold text-app-accent">{companyStocks[company].remaining}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t flex justify-between items-center text-xs">
                    <span className="text-app-muted">{t("consignments.stockValue")}</span>
                    <span className="font-bold text-app">
                      {companyStocks[company].value.toFixed(2)} AZN
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: Growth & Sales Analytics */}
          {activeTab === "reports" && (
            <div className="app-card app-card-elevated p-6 space-y-4">
              <h3 className="text-sm font-bold text-app flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                {t("consignments.trendsTitle")}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredItems.map((item) => {
                  const saleRatio = item.sent_qty > 0 ? (item.sold_qty / item.sent_qty) * 100 : 0;
                  return (
                    <div key={item.id} className="p-4 border rounded-lg bg-app-card-hover space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-app">{item.product_name}</span>
                        <span className="text-app-muted">{item.customer_name}</span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full transition-all duration-500"
                          style={{ width: `${Math.min(saleRatio, 100)}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[11px] text-app-muted">
                        <span>{t("consignments.saleRatio", { ratio: saleRatio.toFixed(1) })}</span>
                        <span>
                          {t("consignments.soldRemaining", {
                            sold: item.sold_qty,
                            remaining: item.remaining_qty,
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Modal 1: Send Consignment Form */}
        {isSendModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="app-modal w-full max-w-lg space-y-4 p-6">
              <h3 className="text-base font-bold text-app border-b pb-2">
                {t("consignments.sendModalTitle")}
              </h3>

              <form onSubmit={handleSendConsignment} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("consignments.customerRequired")}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={t("consignments.customerPlaceholder")}
                      value={sendCustomer}
                      onChange={(e) => setSendCustomer(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("consignments.sellerRequired")}
                    </label>
                    <input
                      type="text"
                      required
                      readOnly={lockSeller}
                      placeholder={t("consignments.sellerPlaceholder")}
                      value={effectiveSeller}
                      onChange={(e) => setSendSeller(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-[color:var(--app-accent-ring)] ${
                        lockSeller ? "bg-app-card-hover text-app-muted" : ""
                      }`}
                    />
                    {lockSeller && (
                      <p className="mt-1 text-[10px] font-semibold text-app-muted">
                        {t("consignments.ownNameOnly")}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("consignments.productRequired")}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={t("consignments.productPlaceholder")}
                      value={sendProduct}
                      onChange={(e) => setSendProduct(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("consignments.categoryRequired")}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={t("consignments.categoryPlaceholder")}
                      value={sendCategory}
                      onChange={(e) => setSendCategory(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("consignments.qtyRequired")}
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={sendQty}
                      onChange={(e) => setSendQty(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app mb-1">
                      {t("consignments.unitPriceRequired")}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={sendPrice}
                      onChange={(e) => setSendPrice(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setIsSendModalOpen(false)}
                    className="px-4 py-2 border text-app-muted rounded-lg text-xs hover:bg-app-card-hover"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={savingSend}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
                  >
                    {savingSend ? t("auth.sending") : t("consignments.confirmSend")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal 2: Settlement Modal */}
        {selectedItem && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="app-modal w-full max-w-md space-y-4 p-6">
              <h3 className="text-base font-bold text-app border-b pb-2">
                {t("consignments.settlementTitle", { customer: selectedItem.customer_name })}
              </h3>

              <div className="text-xs text-app-muted space-y-1 bg-app-card-hover p-3 rounded-lg">
                <p><strong>{t("consignments.productLabel")}</strong> {selectedItem.product_name}</p>
                <p>
                  <strong>{t("consignments.remainingAtCustomer")}</strong>{" "}
                  <span className="text-app-accent font-bold">
                    {selectedItem.remaining_qty ?? 0} {t("common.units")}
                  </span>
                </p>
              </div>

              <form onSubmit={handleProcessSettlement} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-app mb-1">
                    {t("consignments.soldThisMonth")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={selectedItem.remaining_qty ?? 0}
                    value={inputSold}
                    onChange={(e) => setInputSold(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-app rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-app mb-1">
                    {t("consignments.returnedThisMonth")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={(selectedItem.remaining_qty ?? 0) - inputSold}
                    value={inputReturned}
                    onChange={(e) => setInputReturned(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-app rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                  />
                </div>

                <div className="bg-[color:var(--app-accent-soft)] p-3 rounded-lg text-xs text-blue-800 flex justify-between font-bold">
                  <span>{t("consignments.calculatedSale")}</span>
                  <span>{(inputSold * (selectedItem.unit_price || 0)).toFixed(2)} AZN</span>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="px-4 py-2 border text-app-muted rounded-lg text-xs hover:bg-app-card-hover"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
                  >
                    {submitting ? t("consignments.confirming") : t("consignments.confirmSettlement")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
    </PageLayout>
  );
}