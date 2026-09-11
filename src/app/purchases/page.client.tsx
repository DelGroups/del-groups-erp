"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import PurchaseDocumentStatusBadge from "@/components/purchases/PurchaseDocumentStatusBadge";
import { isPurchaseDraft } from "@/lib/invoices/invoiceStatus";
import PurchaseViewModal from "@/components/purchases/PurchaseViewModal";
import PurchaseRequisitionsPanel from "@/components/purchases/PurchaseRequisitionsPanel";
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
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { useToast } from "@/hooks/useToast";
import { voidPurchaseAction } from "@/lib/actions/entityDelete";
import Button from "@/components/ui/button";
import { Plus, ShoppingBag } from "lucide-react";
import InvoiceRemainingBalanceCell from "@/components/finance/InvoiceRemainingBalanceCell";
import { computeInvoiceDebtBreakdown } from "@/lib/finance/invoiceRemainingBalance";
import { useVatAccountIds } from "@/hooks/useVatAccountIds";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import EQaimeExportButton from "@/components/tax/EQaimeExportButton";
import { exportPurchaseEQaime } from "@/lib/tax/eQaimeDocuments";

export default function PurchasesPage() {
  const router = useRouter();
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
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const vatAccountIds = useVatAccountIds();
  const branding = useCompanyBranding();
  const canDeletePurchases = can("can_delete_purchases");
  const canEditPurchases = can("can_edit_purchases");
  const [deleteTarget, setDeleteTarget] = useState<PurchaseRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<"invoices" | "requisitions">("invoices");

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

  const openEditById = async (purchaseId: string) => {
    const full = await fetchPurchaseById(purchaseId);
    if (!full) {
      showError(t("common.notFound"));
      return;
    }
    if (isPurchaseDraft(full.status)) {
      router.push(`/purchases/new?draft=${full.id}`);
      return;
    }
    setEditingPurchase(full);
    setIsFormOpen(true);
    setActiveTab("invoices");
  };

  const openEdit = async (row: PurchaseRecord) => {
    const full = await fetchPurchaseById(row.id);
    if (!full) {
      showError(t("common.notFound"));
      return;
    }
    if (isPurchaseDraft(full.status)) {
      router.push(`/purchases/new?draft=${full.id}`);
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

  const exportEQaime = async (row: PurchaseRecord, format: "xml" | "json") => {
    try {
      const full = (await fetchPurchaseById(row.id)) || row;
      await exportPurchaseEQaime(full, branding, format);
      showSuccess(t("tax.exportSuccess"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("common.error"));
    }
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingPurchase(null);
  };

  const handleFormSuccess = () => {
    closeForm();
    void loadData();
  };

  const handleVoidPurchase = async () => {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    setDeleting(true);
    const result = await voidPurchaseAction(deletedId);
    setDeleting(false);
    if (!result.success) {
      showError(result.error || t("common.error"));
      return;
    }
    setDeleteTarget(null);
    setPurchases((prev) => prev.filter((row) => row.id !== deletedId));
    showSuccess(t("purchases.deleteSuccess"));
    void loadData();
  };

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<ShoppingBag className="h-6 w-6 text-emerald-600" />}
          title={t("purchases.title")}
          description={t("purchases.description")}
          extraActions={
            <Button href="/purchases/new">
              <Plus className="h-4 w-4" />
              {t("purchases.createLabel")}
            </Button>
          }
        />

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="flex flex-wrap gap-2 border-b border-app pb-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "invoices"
                  ? "bg-app-accent text-white"
                  : "bg-app-card-hover text-app hover:bg-app-surface"
              }`}
              onClick={() => setActiveTab("invoices")}
            >
              {t("purchases.tabInvoices")}
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "requisitions"
                  ? "bg-app-accent text-white"
                  : "bg-app-card-hover text-app hover:bg-app-surface"
              }`}
              onClick={() => setActiveTab("requisitions")}
            >
              {t("purchases.tabRequisitions")}
            </button>
          </div>

          {activeTab === "requisitions" ? (
            <PurchaseRequisitionsPanel onOpenPurchase={(purchaseId) => void openEditById(purchaseId)} />
          ) : (
            <>
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
                    {filtered.map((row) => {
                      const debtBreakdown = computeInvoiceDebtBreakdown(
                        {
                          isOfficial: row.is_official,
                          subtotalAmount: row.subtotal_amount,
                          vatAmount: row.vat_amount,
                          grandTotal: row.grand_total ?? row.total_amount,
                          totalAmount: row.total_amount,
                          paidAmount: row.paid_amount,
                          remainingBalance: row.debt_amount,
                        },
                        vatAccountIds
                      );

                      return (
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
                        <td className="px-4 py-3">
                          <InvoiceRemainingBalanceCell
                            breakdown={debtBreakdown}
                            currencyLabel={t("common.currency")}
                            splitLabel={t("official.remainingSplit", {
                              base: debtBreakdown.remainingBase.toFixed(2),
                              vat: debtBreakdown.remainingVat.toFixed(2),
                            })}
                            totalRemainingLabel={t("official.totalRemaining")}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <PurchaseDocumentStatusBadge status={row.status} />
                        </td>
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
                            extra={
                              <EQaimeExportButton
                                compact
                                onExport={(format) => exportEQaime(row, format)}
                              />
                            }
                            paymentDisabled={debtBreakdown.totalRemaining <= 0}
                            onEdit={canEditPurchases ? () => void openEdit(row) : undefined}
                            onDelete={
                              canDeletePurchases ? () => setDeleteTarget(row) : undefined
                            }
                            deleteTitle={t("common.void")}
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
            </>
          )}
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
          isOfficial={paymentPurchase.is_official === true}
          documentSubtotalAmount={Number(
            paymentPurchase.subtotal_amount ?? paymentPurchase.total_amount ?? 0
          )}
          documentVatAmount={Number(paymentPurchase.vat_amount ?? 0)}
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
              treasurySplits: payload.treasurySplits,
            });
            if (result.success) void loadData();
            return result;
          }}
        />
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={t("common.void")}
        message={t("common.voidConfirmMessage")}
        itemName={deleteTarget?.invoice_number}
        confirmLabel={t("common.void")}
        loading={deleting}
        onConfirm={() => void handleVoidPurchase()}
        onCancel={() => setDeleteTarget(null)}
      />

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
