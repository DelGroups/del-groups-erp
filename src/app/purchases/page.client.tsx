"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import PurchaseViewModal from "@/components/purchases/PurchaseViewModal";
import PurchasePrintTemplate from "@/components/purchases/PurchasePrintTemplate";
import DocumentPaymentModal from "@/components/documents/DocumentPaymentModal";
import {
  fetchPurchaseById,
  fetchPurchaseFormData,
  fetchPurchaseList,
} from "@/lib/purchases/fetchPurchases";
import { recordPurchasePaymentAction } from "@/lib/actions/payments";
import { sendPurchaseToWarehouseAction } from "@/lib/actions/sendToWarehouse";
import type { Product, PurchaseRecord, Supplier, Warehouse } from "@/types/database.types";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useWarehouseDocumentSend } from "@/hooks/useWarehouseDocumentSend";
import WarehouseSendBadge from "@/components/documents/WarehouseSendBadge";
import WarehouseResendModal from "@/components/documents/WarehouseResendModal";
import DeliveryTimeModal from "@/components/documents/DeliveryTimeModal";
import WarehouseSlipPrintTemplate from "@/components/warehouse/WarehouseSlipPrintTemplate";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { ShoppingBag } from "lucide-react";

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRecord | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseRecord | null>(null);
  const [paymentPurchase, setPaymentPurchase] = useState<PurchaseRecord | null>(null);
  const { printData: printPurchase, setPrintData: setPrintPurchase } =
    useDocumentPrint<PurchaseRecord>();
  const { can } = useAuth();
  const { t } = useI18n();
  const canCreatePurchase = can("can_create_purchase");
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    const [list, formData] = await Promise.all([fetchPurchaseList(), fetchPurchaseFormData()]);
    setPurchases(list);
    setSuppliers(formData.suppliers);
    setProducts(formData.products);
    setWarehouses(formData.warehouses);
    setLoading(false);
  }, []);

  const warehouseSend = useWarehouseDocumentSend(sendPurchaseToWarehouseAction, loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = purchases.filter(
    (p) =>
      p.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.supplier_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.supplier_company || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openCreate = () => {
    setEditingPurchase(null);
    setIsFormOpen(true);
  };

  const openEdit = async (row: PurchaseRecord) => {
    const full = await fetchPurchaseById(row.id);
    if (!full) {
      showError(t("common.notFound"));
      return;
    }
    setEditingPurchase(full);
    setIsFormOpen(true);
  };

  const openView = async (row: PurchaseRecord) => {
    const full = await fetchPurchaseById(row.id);
    if (full) setViewingPurchase(full);
  };

  const openPrint = async (row: PurchaseRecord) => {
    const full = await fetchPurchaseById(row.id);
    if (full) setPrintPurchase(full);
  };

  const openPayment = async (row: PurchaseRecord) => {
    const full = await fetchPurchaseById(row.id);
    if (full) setPaymentPurchase(full);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingPurchase(null);
  };

  const handleFormSuccess = () => {
    closeForm();
    void loadData();
  };

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<ShoppingBag className="h-6 w-6 text-emerald-600" />}
          title={t("purchases.title")}
          description={t("purchases.description")}
          createLabel={t("purchases.createLabel")}
          onCreate={openCreate}
          createDisabled={!canCreatePurchase || warehouses.length === 0 || suppliers.length === 0}
        />

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
          <DocumentListSearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder={t("purchases.searchPlaceholder")}
            onRefresh={() => void loadData()}
            loading={loading}
          />

          <div className="app-table-wrap">
            {loading ? (
              <div className="p-12 text-center text-xs text-app-muted">{t("purchases.loading")}</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-xs text-app-muted">
                {t("purchases.empty")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                    <tr>
                      <th className="px-4 py-3">{t("purchases.invoiceNo")}</th>
                      <th className="px-4 py-3">{t("common.date")}</th>
                      <th className="px-4 py-3">{t("purchases.supplier")}</th>
                      <th className="px-4 py-3">{t("purchases.totalAmount")}</th>
                      <th className="px-4 py-3">{t("purchases.paid")}</th>
                      <th className="px-4 py-3">{t("purchases.debt")}</th>
                      <th className="px-4 py-3">{t("common.status")}</th>
                      <th className="px-4 py-3">{t("purchases.sendStatus")}</th>
                      <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filtered.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-app-card-hover">
                        <td className="px-4 py-3 font-mono font-bold text-emerald-600">
                          {row.invoice_number}
                        </td>
                        <td className="px-4 py-3">
                          {row.doc_date || row.created_at?.slice(0, 10) || "-"}
                        </td>
                        <td className="px-4 py-3 font-semibold text-app">
                          {row.supplier_name || "-"}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold">
                          {row.total_amount.toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-4 py-3 font-mono text-emerald-600">
                          {row.paid_amount.toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-4 py-3 font-mono text-rose-600">
                          {row.debt_amount.toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-4 py-3">{row.status || "-"}</td>
                        <td className="px-4 py-3">
                          <WarehouseSendBadge
                            warehouseSent={row.warehouse_sent === true}
                            warehouseSlipStatus={row.warehouse_slip_status ?? null}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <DocumentListActions
                            onView={() => void openView(row)}
                            onPrint={() => void openPrint(row)}
                            onPayment={() => void openPayment(row)}
                            paymentDisabled={row.debt_amount <= 0}
                            onEdit={() => void openEdit(row)}
                            showSendToWarehouse={warehouseSend.getSendButtonProps(row).show}
                            sendToWarehouseDisabled={
                              warehouseSend.getSendButtonProps(row).disabled
                            }
                            sendToWarehouseTitle={
                              warehouseSend.getSendButtonProps(row).title
                            }
                            onSendToWarehouse={() =>
                              warehouseSend.handleSendClick({
                                id: row.id,
                                warehouse_sent: row.warehouse_sent === true,
                                documentLabel: t("purchases.invoiceNo"),
                                documentNumber: row.invoice_number,
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

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto app-scrim p-4">
          <div className="my-6 w-full max-w-5xl">
            <PurchaseForm
              key={editingPurchase?.id || "new"}
              suppliers={suppliers}
              products={products}
              warehouses={warehouses}
              mode={editingPurchase ? "edit" : "create"}
              initialPurchase={editingPurchase}
              onCancel={closeForm}
              onSuccess={handleFormSuccess}
            />
          </div>
        </div>
      )}

      {viewingPurchase && (
        <PurchaseViewModal purchase={viewingPurchase} onClose={() => setViewingPurchase(null)} />
      )}

      {paymentPurchase && (
        <DocumentPaymentModal
          isOpen
          onClose={() => setPaymentPurchase(null)}
          documentLabel={t("purchases.invoiceNo")}
          documentNumber={paymentPurchase.invoice_number}
          counterpartyLabel={t("purchases.supplier")}
          counterpartyName={paymentPurchase.supplier_name || "-"}
          totalAmount={paymentPurchase.total_amount}
          paidAmount={paymentPurchase.paid_amount}
          remainingAmount={paymentPurchase.debt_amount}
          onSubmit={async (payload) => {
            const result = await recordPurchasePaymentAction({
              purchaseId: paymentPurchase.id,
              invoiceNumber: paymentPurchase.invoice_number,
              supplierId: paymentPurchase.supplier_id,
              amount: payload.amount,
              accountId: payload.accountId,
              method: payload.method,
              notes: payload.notes,
              currentPaid: paymentPurchase.paid_amount,
              totalAmount: paymentPurchase.total_amount,
              currentDebt: paymentPurchase.debt_amount,
            });
            if (result.success) void loadData();
            return result;
          }}
        />
      )}

      {printPurchase && (
        <div className="print-area">
          <PurchasePrintTemplate purchase={printPurchase} />
        </div>
      )}

      {warehouseSend.printSlip && (
        <div className="print-area">
          <WarehouseSlipPrintTemplate slip={warehouseSend.printSlip} />
        </div>
      )}

      <WarehouseResendModal
        isOpen={!!warehouseSend.resendTarget}
        documentLabel={warehouseSend.resendTarget?.documentLabel || t("purchases.invoiceNo")}
        documentNumber={warehouseSend.resendTarget?.documentNumber || "-"}
        onCancel={() => warehouseSend.setResendTarget(null)}
        onConfirm={warehouseSend.confirmResend}
        loading={!!warehouseSend.sendingId}
      />

      <DeliveryTimeModal
        isOpen={!!warehouseSend.deliveryTarget}
        documentLabel={warehouseSend.deliveryTarget?.documentLabel || t("purchases.invoiceNo")}
        documentNumber={warehouseSend.deliveryTarget?.documentNumber || "-"}
        onCancel={warehouseSend.cancelDelivery}
        onConfirm={(iso) => void warehouseSend.confirmDelivery(iso)}
        loading={!!warehouseSend.sendingId}
      />
      <ToastMessage message={warehouseSend.toastMessage ?? toastMessage} variant={warehouseSend.toastMessage ? warehouseSend.toastVariant : toastVariant} />
    </PageLayout>
  );
}
