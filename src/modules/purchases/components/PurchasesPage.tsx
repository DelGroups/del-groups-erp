"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ListPageChrome from "@/components/layout/ListPageChrome";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import PurchaseForm from "./PurchaseForm";
import PurchaseDocumentStatusBadge from "./PurchaseDocumentStatusBadge";
import { isPurchaseDraft, normalizePurchaseDocumentStatus } from "@/lib/invoices/invoiceStatus";
import PurchaseViewModal from "./PurchaseViewModal";
import PurchaseRequisitionsPanel from "./PurchaseRequisitionsPanel";
import DocumentPaymentModal from "@/components/documents/DocumentPaymentModal";
import { purchaseDocumentDate } from "../lib/purchaseDates";
import {
  fetchPurchaseById,
  fetchPurchaseFormData,
  fetchPurchaseList,
} from "../lib/fetchPurchases";
import { recordPurchasePaymentAction } from "../actions/payments";
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
import {
  ActionsTd,
  ActionsTh,
  BulkActionBar,
  SelectTd,
  SelectTh,
  Table,
  TableSkeletonRows,
  TableWrap,
  THead,
  Th,
  Tr,
} from "@/components/ui/table";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { FileSpreadsheet, Plus, ShoppingBag } from "lucide-react";
import { ListBodyCells, ListHeadCells, dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";
import { docStatusLabelKey, warehouseStateLabelKey } from "@/lib/lists/documentLabels";
import InvoiceRemainingBalanceCell from "@/components/finance/InvoiceRemainingBalanceCell";
import { computeInvoiceDebtBreakdown } from "@/lib/finance/invoiceRemainingBalance";
import { useVatAccountIds } from "@/hooks/useVatAccountIds";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { exportPurchaseEQaime } from "@/lib/tax/eQaimeDocuments";

/** Column choice key of this list (prompt 24c). */
const PURCHASES_LIST_KEY = "purchases.invoices";

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
  const { t, formatDateTime } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const vatAccountIds = useVatAccountIds();
  const branding = useCompanyBranding();
  const canDeletePurchases = can("can_delete_purchases");
  const canEditPurchases = can("can_edit_purchases");
  // Fix F1: a posted purchase is changed by admins only (can_edit_posted_purchases; the database checks it).
  const canEditPostedPurchases = can("can_edit_posted_purchases");
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

  const bulk = useBulkSelection(filtered, (row) => row.id);

  const debtOf = useCallback(
    (row: PurchaseRecord) =>
      computeInvoiceDebtBreakdown(
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
      ),
    [vatAccountIds]
  );

  // Columns of the list (prompt 24c). Purchases have no salesperson: "Responsible" instead.
  const columnDefs = useMemo<TableColumn<PurchaseRecord>[]>(
    () => [
      { key: "invoice_number", labelKey: "purchases.invoiceNo", defaultVisible: true, required: true, tdClassName: "font-mono font-bold text-emerald-600", cell: (r) => r.invoice_number },
      { key: "doc_date", labelKey: "listColumns.invoiceDate", offLabelKey: "common.date", defaultVisible: true, exportType: "date", exportValue: (r) => r.doc_date || r.created_at?.slice(0, 10) || null, cell: (r) => r.doc_date || r.created_at?.slice(0, 10) || "-" },
      { key: "supplier", labelKey: "purchases.supplier", defaultVisible: true, tdClassName: "font-semibold text-app", cell: (r) => r.supplier_name || "-" },
      { key: "total_amount", labelKey: "purchases.totalAmount", defaultVisible: true, tdClassName: "font-mono font-bold", exportType: "money", exportValue: (r) => r.total_amount, cell: (r) => `${r.total_amount.toFixed(2)} ${t("common.currency")}` },
      { key: "paid_amount", labelKey: "purchases.paid", defaultVisible: true, tdClassName: "font-mono text-emerald-600", exportType: "money", exportValue: (r) => r.paid_amount, cell: (r) => `${r.paid_amount.toFixed(2)} ${t("common.currency")}` },
      {
        key: "debt",
        labelKey: "purchases.debt",
        defaultVisible: true,
        exportType: "money",
        exportValue: (r) => debtOf(r).totalRemaining,
        cell: (r) => {
          const debtBreakdown = debtOf(r);
          return (
            <InvoiceRemainingBalanceCell
              breakdown={debtBreakdown}
              currencyLabel={t("common.currency")}
              splitLabel={t("official.remainingSplit", {
                base: debtBreakdown.remainingBase.toFixed(2),
                vat: debtBreakdown.remainingVat.toFixed(2),
              })}
              totalRemainingLabel={t("official.totalRemaining")}
            />
          );
        },
      },
      { key: "status", labelKey: "common.status", defaultVisible: true, exportValue: (r) => t(docStatusLabelKey(normalizePurchaseDocumentStatus(r.status))), cell: (r) => <PurchaseDocumentStatusBadge status={r.status} /> },
      {
        key: "send_status",
        labelKey: "purchases.sendStatus",
        defaultVisible: true,
        exportValue: (r) => t(warehouseStateLabelKey(r.warehouse_sent, r.warehouse_slip_status)),
        cell: (r) => <WarehouseSendBadge warehouseSent={r.warehouse_sent === true} warehouseSlipStatus={r.warehouse_slip_status ?? null} />,
      },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, tdClassName: "whitespace-nowrap text-app-muted", exportType: "datetime", exportValue: (r) => r.created_at, cell: (r) => (r.created_at ? formatDateTime(r.created_at) : "—") },
      { key: "responsible", labelKey: "listColumns.responsible", defaultVisible: true, standard: true, cell: (r) => dash(r.responsible_name) },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, cell: (r) => dash(r.created_by_name) },
      { key: "warehouse", labelKey: "purchases.warehouse", defaultVisible: false, cell: (r) => dash(r.warehouse_name) },
      { key: "vat", labelKey: "sales.engine.fields.vat", defaultVisible: false, numeric: true, exportValue: (r) => r.vat_amount ?? 0, cell: (r) => `${Number(r.vat_amount ?? 0).toFixed(2)} ${t("common.currency")}` },
      { key: "due_date", labelKey: "sales.engine.fields.dueDate", defaultVisible: false, exportType: "date", exportValue: (r) => r.due_date, cell: (r) => dash(r.due_date) },
      { key: "official", labelKey: "sales.engine.fields.official", defaultVisible: false, cell: (r) => (r.is_official ? t("views.yes") : t("views.no")) },
      { key: "notes", labelKey: "sales.engine.fields.note", defaultVisible: false, tdClassName: "max-w-[16rem] truncate", cell: (r) => dash(r.notes) },
    ],
    [t, formatDateTime, debtOf]
  );
  const columns = useTableColumns(PURCHASES_LIST_KEY, columnDefs);

  // Excel (prompt 24c): new with LIST_COLUMNS (this list had no export); every filtered row.
  const handleExport = (rows = filtered) => {
    if (rows.length === 0) return;
    void exportXlsx(xlsxFileName(t("purchases.title"), new Date()), {
      sheetName: t("purchases.title"),
      columns: columns.exportColumns,
      rows,
    });
  };

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
      <ListPageChrome
        header={
          <DocumentPageHeader
            variant="chrome"
            icon={<ShoppingBag className="h-6 w-6 text-emerald-600" />}
            title={t("purchases.title")}
            description={t("purchases.description")}
            extraActions={
              <>
                {columns.enabled ? (
                  <Button type="button" variant="secondary" onClick={() => handleExport()}>
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    {t("common.excelDownload")}
                  </Button>
                ) : null}
                <Button href="/purchases/new">
                  <Plus className="h-4 w-4" />
                  {t("purchases.createLabel")}
                </Button>
              </>
            }
          />
        }
        filters={
          <>
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
            {activeTab === "invoices" ? (
              <DocumentListSearchBar
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder={t("purchases.searchPlaceholder")}
                onRefresh={() => void loadData()}
                loading={loading}
              />
            ) : null}
            {activeTab === "invoices" ? columns.picker : null}
          </>
        }
      >
          {activeTab === "requisitions" ? (
            <PurchaseRequisitionsPanel onOpenPurchase={(purchaseId) => void openEditById(purchaseId)} />
          ) : (
            <>
          <div className="app-table-wrap">
            <BulkActionBar count={bulk.count} onClear={bulk.clear}>
              {columns.enabled ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => handleExport(bulk.selectedItems)}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {t("table.exportSelected")}
                </Button>
              ) : null}
              {canDeletePurchases ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    const target = bulk.selectedItems[0];
                    if (target) setDeleteTarget(target);
                  }}
                  disabled={bulk.count !== 1}
                >
                  {t("common.void")}
                </Button>
              ) : null}
            </BulkActionBar>

            {loading ? (
              <TableWrap className="rounded-none border-0 shadow-none">
                <Table>
                  <THead>
                    <tr>
                      <SelectTh checked={false} onChange={() => {}} />
                      {Array.from({ length: columns.visible.length }).map((_, index) => (
                        <Th key={index}>&nbsp;</Th>
                      ))}
                    </tr>
                  </THead>
                  <tbody>
                    <TableSkeletonRows columns={columns.visible.length} rows={10} withActions />
                  </tbody>
                </Table>
              </TableWrap>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-app-muted">
                {t("purchases.empty")}
              </div>
            ) : (
              <TableWrap className="rounded-none border-0 shadow-none">
                <Table>
                  <THead>
                    <tr>
                      <SelectTh
                        checked={bulk.allSelected}
                        indeterminate={bulk.someSelected}
                        onChange={bulk.toggleAll}
                      />
                      <ListHeadCells columns={columns.visible} />
                      <ActionsTh>{t("common.actions")}</ActionsTh>
                    </tr>
                  </THead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filtered.map((row) => {
                      const debtBreakdown = debtOf(row);

                      return (
                      <Tr key={row.id}>
                        <SelectTd
                          checked={bulk.isSelected(row)}
                          onChange={() => bulk.toggle(row)}
                        />
                        <ListBodyCells columns={columns.visible} row={row} />
                        <ActionsTd>
                          <DocumentListActions
                            onView={() => void openView(row)}
                            onPrint={() => void openPrint(row)}
                            onPayment={() => void openPayment(row)}
                            onEQaimeExport={(format) => exportEQaime(row, format)}
                            paymentDisabled={debtBreakdown.totalRemaining <= 0}
                            onEdit={
                              isPurchaseDraft(row.status)
                                ? canEditPurchases ? () => void openEdit(row) : undefined
                                : canEditPostedPurchases ? () => void openEdit(row) : undefined
                            }
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
                        </ActionsTd>
                      </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </div>
            </>
          )}
      </ListPageChrome>

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
          documentDate={purchaseDocumentDate(paymentPurchase)}
          onSubmit={async (payload) => {
            const result = await recordPurchasePaymentAction({
              purchaseId: paymentPurchase.id,
              invoiceNumber: paymentPurchase.invoice_number,
              supplierId: paymentPurchase.supplier_id,
              amount: payload.amount,
              accountId: payload.accountId,
              method: payload.method,
              notes: payload.notes,
              paymentDate: payload.paymentDate,
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
