"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import Link from "next/link";
import UniversalInvoiceForm from "@/components/InvoiceForm";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import SalesViewModal from "@/components/sales/SalesViewModal";
import SalesPrintTemplate from "@/components/sales/SalesPrintTemplate";
import DocumentPaymentModal from "@/components/documents/DocumentPaymentModal";
import { fetchSaleById, fetchSalesList, type SaleRecord } from "@/lib/sales/fetchSales";
import { recordSalePayment } from "@/lib/sales/recordSalePayment";
import { sendSaleToWarehouseAction } from "@/lib/actions/sendToWarehouse";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useWarehouseDocumentSend } from "@/hooks/useWarehouseDocumentSend";
import WarehouseSendBadge from "@/components/documents/WarehouseSendBadge";
import WarehouseResendModal from "@/components/documents/WarehouseResendModal";
import DeliveryTimeModal from "@/components/documents/DeliveryTimeModal";
import WarehouseSlipPrintTemplate from "@/components/warehouse/WarehouseSlipPrintTemplate";
import { FileSpreadsheet, ShoppingCart } from "lucide-react";

function getSaleRemaining(sale: SaleRecord): number {
  const stored = Number(sale.remaining_balance || 0);
  if (stored > 0) return stored;
  return Math.max(0, Number(sale.total_amount || 0) - Number(sale.paid_amount || 0));
}

export default function SalesListPage() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [viewingSale, setViewingSale] = useState<SaleRecord | null>(null);
  const [paymentSale, setPaymentSale] = useState<SaleRecord | null>(null);
  const { printData: printSale, setPrintData: setPrintSale } = useDocumentPrint<SaleRecord>();
  const { can } = useAuth();
  const { t } = useI18n();
  const canCreateInvoice = can("can_create_invoice");

  const loadData = useCallback(async () => {
    setLoading(true);
    setSales(await fetchSalesList());
    setLoading(false);
  }, []);

  const warehouseSend = useWarehouseDocumentSend(sendSaleToWarehouseAction, loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredSales = sales.filter(
    (s) =>
      (s.doc_no || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.customer_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.warehouse_name || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openView = async (row: SaleRecord) => {
    const full = await fetchSaleById(row.id);
    if (full) setViewingSale(full);
  };

  const openPrint = async (row: SaleRecord) => {
    const full = await fetchSaleById(row.id);
    if (full) setPrintSale(full);
  };

  const openPayment = async (row: SaleRecord) => {
    const full = await fetchSaleById(row.id);
    if (full) setPaymentSale(full);
  };

  const handleDownloadCSV = () => {
    if (filteredSales.length === 0) return;
    const headers = [
      t("sales.docNo"),
      t("common.date"),
      t("sales.customer"),
      t("sales.warehouse"),
      t("common.total"),
      t("sales.paid"),
      t("sales.remaining"),
    ];
    const rows = filteredSales.map((s) => [
      s.doc_no,
      s.doc_date,
      `"${s.customer_name || ""}"`,
      s.warehouse_name,
      s.total_amount,
      s.paid_amount,
      s.remaining_balance,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8,\uFEFF" +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `${t("sales.csvFilename")}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<ShoppingCart className="h-6 w-6 text-app-accent" />}
          title={t("sales.title")}
          description={t("sales.description")}
          createLabel={t("sales.createLabel")}
          onCreate={() => setIsFormOpen(true)}
          createDisabled={!canCreateInvoice}
          extraActions={
            <>
              <Link
                href="/sales/polywood/new"
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {t("sales.polywoodInvoice")}
              </Link>
              <button
                type="button"
                onClick={handleDownloadCSV}
                className="flex items-center gap-2 rounded-xl border border-app bg-app-card-hover px-4 py-2.5 text-xs font-semibold text-app hover:bg-app-card-hover"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                {t("common.csvDownload")}
              </button>
            </>
          }
        />

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
          <DocumentListSearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder={t("sales.searchPlaceholder")}
            onRefresh={() => void loadData()}
            loading={loading}
          />

          <div className="app-table-wrap">
            {loading ? (
              <div className="p-12 text-center text-xs text-app-muted">{t("sales.loading")}</div>
            ) : filteredSales.length === 0 ? (
              <div className="p-12 text-center text-xs text-app-muted">
                {t("sales.empty")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                    <tr>
                      <th className="px-4 py-3">{t("sales.docNo")}</th>
                      <th className="px-4 py-3">{t("common.date")}</th>
                      <th className="px-4 py-3">{t("sales.customer")}</th>
                      <th className="px-4 py-3">{t("sales.warehouse")}</th>
                      <th className="px-4 py-3">{t("sales.totalAmount")}</th>
                      <th className="px-4 py-3">{t("sales.paid")}</th>
                      <th className="px-4 py-3">{t("sales.remaining")}</th>
                      <th className="px-4 py-3">{t("sales.sendStatus")}</th>
                      <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filteredSales.map((sale) => (
                      <tr key={sale.id} className="transition-colors hover:bg-app-card-hover">
                        <td className="px-4 py-3 font-mono font-bold text-app-accent">
                          {sale.doc_no}
                        </td>
                        <td className="px-4 py-3">{sale.doc_date}</td>
                        <td className="px-4 py-3 font-semibold text-app">
                          {sale.customer_name || t("common.anonymousCustomer")}
                        </td>
                        <td className="px-4 py-3 text-app-muted">{sale.warehouse_name}</td>
                        <td className="px-4 py-3 font-mono font-bold">
                          {Number(sale.total_amount || 0).toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-4 py-3 font-mono text-emerald-600">
                          {Number(sale.paid_amount || 0).toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-4 py-3 font-mono text-rose-600">
                          {getSaleRemaining(sale).toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-4 py-3">
                          <WarehouseSendBadge
                            warehouseSent={sale.warehouse_sent}
                            warehouseSlipStatus={sale.warehouse_slip_status}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <DocumentListActions
                            onView={() => void openView(sale)}
                            onPrint={() => void openPrint(sale)}
                            onPayment={() => void openPayment(sale)}
                            paymentDisabled={getSaleRemaining(sale) <= 0}
                            onEdit={() => setIsFormOpen(true)}
                            showSendToWarehouse={warehouseSend.getSendButtonProps(sale).show}
                            sendToWarehouseDisabled={
                              warehouseSend.getSendButtonProps(sale).disabled
                            }
                            sendToWarehouseTitle={
                              warehouseSend.getSendButtonProps(sale).title
                            }
                            onSendToWarehouse={() =>
                              warehouseSend.handleSendClick({
                                id: sale.id,
                                warehouse_sent: sale.warehouse_sent,
                                documentLabel: t("sales.docNo"),
                                documentNumber: sale.doc_no || "-",
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>

      <UniversalInvoiceForm
        isOpen={isFormOpen}
        defaultType="sale"
        onClose={() => setIsFormOpen(false)}
        onSuccess={() => {
          setIsFormOpen(false);
          void loadData();
        }}
      />

      {viewingSale && (
        <SalesViewModal
          sale={viewingSale}
          onClose={() => setViewingSale(null)}
          onPayment={
            getSaleRemaining(viewingSale) > 0
              ? () => {
                  setViewingSale(null);
                  setPaymentSale(viewingSale);
                }
              : undefined
          }
        />
      )}

      {paymentSale && (
        <DocumentPaymentModal
          isOpen
          onClose={() => setPaymentSale(null)}
          documentLabel={t("sales.docNo")}
          documentNumber={paymentSale.doc_no || "-"}
          counterpartyLabel={t("sales.customer")}
          counterpartyName={paymentSale.customer_name || t("common.anonymousCustomer")}
          totalAmount={Number(paymentSale.total_amount || 0)}
          paidAmount={Number(paymentSale.paid_amount || 0)}
          remainingAmount={getSaleRemaining(paymentSale)}
          onSubmit={async (payload) => {
            const result = await recordSalePayment({
              saleId: paymentSale.id,
              docNo: paymentSale.doc_no || "",
              customerId: paymentSale.customer_id,
              amount: payload.amount,
              accountId: payload.accountId,
              method: payload.method,
              notes: payload.notes,
              currentPaid: Number(paymentSale.paid_amount || 0),
              totalAmount: Number(paymentSale.total_amount || 0),
              existingPayments: paymentSale.payments,
            });
            if (result.success) void loadData();
            return result;
          }}
        />
      )}

      {printSale && (
        <div className="print-area">
          <SalesPrintTemplate sale={printSale} />
        </div>
      )}

      {warehouseSend.printSlip && (
        <div className="print-area">
          <WarehouseSlipPrintTemplate slip={warehouseSend.printSlip} />
        </div>
      )}

      <WarehouseResendModal
        isOpen={!!warehouseSend.resendTarget}
        documentLabel={warehouseSend.resendTarget?.documentLabel || t("sales.docNo")}
        documentNumber={warehouseSend.resendTarget?.documentNumber || "-"}
        onCancel={() => warehouseSend.setResendTarget(null)}
        onConfirm={warehouseSend.confirmResend}
        loading={!!warehouseSend.sendingId}
      />

      <DeliveryTimeModal
        isOpen={!!warehouseSend.deliveryTarget}
        documentLabel={warehouseSend.deliveryTarget?.documentLabel || t("sales.docNo")}
        documentNumber={warehouseSend.deliveryTarget?.documentNumber || "-"}
        onCancel={warehouseSend.cancelDelivery}
        onConfirm={(iso) => void warehouseSend.confirmDelivery(iso)}
        loading={!!warehouseSend.sendingId}
      />
    </PageLayout>
  );
}
