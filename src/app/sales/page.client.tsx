"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import { useRouter } from "next/navigation";
import SalesDocumentStatusBadge from "@/components/sales/SalesDocumentStatusBadge";
import { isSalesDraft } from "@/lib/invoices/invoiceStatus";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import { Table, TableWrap, THead, Th, Td } from "@/components/ui/table";
import SalesViewModal from "@/components/sales/SalesViewModal";
import DocumentPaymentModal from "@/components/documents/DocumentPaymentModal";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import { mapSaleToInvoicePrint } from "@/lib/print/mapSaleToInvoicePrint";
import { fetchSaleById, fetchSalesListWithMeta, formatSaleAmount, getSaleRemaining, getSaleWarehouseLabel, type SaleRecord } from "@/lib/sales/fetchSales";
import { recordSalePaymentAction } from "@/lib/actions/payments";
import { sendSaleToWarehouseAction } from "@/lib/actions/sendToWarehouse";
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
import { voidSaleAction } from "@/lib/actions/entityDelete";
import { FileSpreadsheet, Plus, ShoppingCart } from "lucide-react";
import InvoiceRemainingBalanceCell from "@/components/finance/InvoiceRemainingBalanceCell";
import { computeInvoiceDebtBreakdown } from "@/lib/finance/invoiceRemainingBalance";
import { useVatAccountIds } from "@/hooks/useVatAccountIds";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import EQaimeExportButton from "@/components/tax/EQaimeExportButton";
import { exportSaleEQaime } from "@/lib/tax/eQaimeDocuments";

export default function SalesListPage() {
  const router = useRouter();
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewingSale, setViewingSale] = useState<SaleRecord | null>(null);
  const [paymentSale, setPaymentSale] = useState<SaleRecord | null>(null);
  const [voidTarget, setVoidTarget] = useState<SaleRecord | null>(null);
  const [voiding, setVoiding] = useState(false);
  const invoicePrint = useInvoicePrintSystem();
  const vatAccountIds = useVatAccountIds();
  const branding = useCompanyBranding();
  const { can } = useAuth();
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const canCreateInvoice = can("can_create_invoice");
  const canDeleteSales = can("can_delete_sales");

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { sales: rows, error } = await fetchSalesListWithMeta();
      setSales(rows);
      if (error) {
        setLoadError(error);
        showError(`${t("common.error")}: ${error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t("common.error");
      console.error("[/sales] loadData failed:", err);
      setSales([]);
      setLoadError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  const warehouseSend = useWarehouseDocumentSend(sendSaleToWarehouseAction, loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredSales = sales.filter((s) => {
    if (!s?.id) return false;
    const q = searchTerm.toLowerCase();
    return (
      (s.doc_no ?? "").toLowerCase().includes(q) ||
      (s.customer_name ?? "").toLowerCase().includes(q) ||
      (s.warehouse_name ?? "").toLowerCase().includes(q) ||
      getSaleWarehouseLabel(s).toLowerCase().includes(q)
    );
  });

  const openView = async (row: SaleRecord) => {
    const full = await fetchSaleById(row.id);
    if (full) setViewingSale(full);
  };

  const openPrint = async (row: SaleRecord) => {
    const full = await fetchSaleById(row.id);
    if (full) invoicePrint.requestPrint(mapSaleToInvoicePrint(full));
  };

  const openPayment = async (row: SaleRecord) => {
    const full = await fetchSaleById(row.id);
    if (full) setPaymentSale(full);
  };

  const exportEQaime = async (row: SaleRecord, format: "xml" | "json") => {
    try {
      const full = (await fetchSaleById(row.id)) || row;
      await exportSaleEQaime(full, branding, format);
      showSuccess(t("tax.exportSuccess"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("common.error"));
    }
  };

  const handleVoidSale = async () => {
    if (!voidTarget) return;
    const deletedId = voidTarget.id;
    setVoiding(true);
    const result = await voidSaleAction(deletedId);
    setVoiding(false);
    if (!result.success) {
      showError(result.error || t("common.error"));
      return;
    }
    setVoidTarget(null);
    setSales((prev) => prev.filter((row) => row.id !== deletedId));
    showSuccess(t("common.voidSuccessRestore"));
    void loadData();
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
      s.doc_no ?? "",
      s.doc_date ?? "",
      `"${s.customer_name ?? ""}"`,
      getSaleWarehouseLabel(s),
      Number(s.total_amount || 0).toFixed(2),
      Number(s.paid_amount || 0).toFixed(2),
      Number(getSaleRemaining(s) || 0).toFixed(2),
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
          onCreate={() => router.push("/sales/new")}
          createDisabled={!canCreateInvoice}
          extraActions={
            <>
              <Button href="/sales/polywood/new" className="bg-emerald-600 bg-none text-white shadow-md ring-2 ring-emerald-500/30 hover:bg-emerald-700 hover:brightness-100">
                <Plus className="h-4 w-4" />
                {t("sales.polywoodCreateButton")}
              </Button>
              <Button type="button" variant="secondary" onClick={handleDownloadCSV}>
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                {t("common.csvDownload")}
              </Button>
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

          {loadError && !loading && (
            <div className="alert-warning text-xs">
              <p className="font-semibold">{t("common.error")}</p>
              <p className="mt-1 text-app-muted">{loadError}</p>
            </div>
          )}

          <Card padding={false}>
            {loading ? (
              <div className="p-12 text-center text-xs text-app-muted">{t("sales.loading")}</div>
            ) : filteredSales.length === 0 ? (
              <div className="p-12 text-center text-xs text-app-muted">
                {t("sales.empty")}
              </div>
            ) : (
              <TableWrap>
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <Th>{t("sales.docNo")}</Th>
                      <Th>{t("common.date")}</Th>
                      <Th>{t("sales.customer")}</Th>
                      <Th>{t("sales.warehouse")}</Th>
                      <Th numeric>{t("sales.totalAmount")}</Th>
                      <Th numeric>{t("sales.paid")}</Th>
                      <Th numeric>{t("sales.remaining")}</Th>
                      <Th>{t("sales.docStatus")}</Th>
                      <Th>{t("sales.sendStatus")}</Th>
                      <Th className="text-center">{t("common.actions")}</Th>
                    </tr>
                  </THead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filteredSales.map((sale) => {
                      const debtBreakdown = computeInvoiceDebtBreakdown(
                        {
                          isOfficial: sale.is_official,
                          subtotalAmount: sale.subtotal_amount,
                          vatAmount: sale.vat_amount ?? sale.vat_total,
                          grandTotal: sale.grand_total ?? sale.total_amount,
                          totalAmount: sale.total_amount,
                          paidAmount: sale.paid_amount,
                          remainingBalance:
                            sale.remaining_balance != null && Number(sale.remaining_balance) > 0
                              ? sale.remaining_balance
                              : getSaleRemaining(sale),
                          payments: sale.payments,
                        },
                        vatAccountIds
                      );

                      return (
                      <tr key={sale.id} className="transition-colors hover:bg-app-card-hover">
                        <Td className="font-mono font-bold text-app-accent">
                          {sale.doc_no ?? "-"}
                        </Td>
                        <Td>{sale.doc_date ?? "-"}</Td>
                        <Td className="font-semibold text-app">
                          {sale.customer_name || t("common.anonymousCustomer")}
                        </Td>
                        <Td className="text-app-muted">
                          {getSaleWarehouseLabel(sale)}
                        </Td>
                        <Td numeric className="font-bold">
                          {formatSaleAmount(sale.total_amount, t("common.currency"))}
                        </Td>
                        <Td numeric className="text-emerald-600">
                          {formatSaleAmount(sale.paid_amount, t("common.currency"))}
                        </Td>
                        <Td numeric>
                          <InvoiceRemainingBalanceCell
                            breakdown={debtBreakdown}
                            currencyLabel={t("common.currency")}
                            splitLabel={t("official.remainingSplit", {
                              base: debtBreakdown.remainingBase.toFixed(2),
                              vat: debtBreakdown.remainingVat.toFixed(2),
                            })}
                            totalRemainingLabel={t("official.totalRemaining")}
                          />
                        </Td>
                        <Td>
                          <SalesDocumentStatusBadge status={sale.status} />
                        </Td>
                        <Td>
                          <WarehouseSendBadge
                            warehouseSent={sale.warehouse_sent === true}
                            warehouseSlipStatus={sale.warehouse_slip_status ?? null}
                          />
                        </Td>
                        <Td>
                          <DocumentListActions
                            onView={() => void openView(sale)}
                            onPrint={() => void openPrint(sale)}
                            onEdit={
                              isSalesDraft(sale.status)
                                ? () => router.push(`/sales/new?draft=${sale.id}`)
                                : undefined
                            }
                            onPayment={() => void openPayment(sale)}
                            extra={
                              <EQaimeExportButton
                                compact
                                onExport={(format) => exportEQaime(sale, format)}
                              />
                            }
                            paymentDisabled={debtBreakdown.totalRemaining <= 0}
                            onDelete={
                              canDeleteSales ? () => setVoidTarget(sale) : undefined
                            }
                            deleteTitle={t("common.void")}
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
                                warehouse_sent: sale.warehouse_sent === true,
                                documentLabel: t("sales.docNo"),
                                documentNumber: sale.doc_no ?? "-",
                              })
                            }
                          />
                        </Td>
                      </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              </TableWrap>
            )}
          </Card>
        </main>

      {viewingSale && (
        <SalesViewModal
          sale={viewingSale}
          onClose={() => setViewingSale(null)}
          onPrint={() => {
            invoicePrint.requestPrint(mapSaleToInvoicePrint(viewingSale));
          }}
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
          isOfficial={paymentSale.is_official === true}
          documentSubtotalAmount={Number(paymentSale.subtotal_amount ?? paymentSale.subtotal ?? 0)}
          documentVatAmount={Number(paymentSale.vat_amount ?? paymentSale.vat_total ?? 0)}
          onSubmit={async (payload) => {
            const result = await recordSalePaymentAction({
              saleId: paymentSale.id,
              docNo: paymentSale.doc_no || "",
              customerId: paymentSale.customer_id,
              amount: payload.amount,
              accountId: payload.accountId,
              method: payload.method,
              notes: payload.notes,
              currentPaid: Number(paymentSale.paid_amount || 0),
              totalAmount: Number(paymentSale.total_amount || 0),
              existingPayments: paymentSale.payments ?? [],
              treasurySplits: payload.treasurySplits,
            });
            if (result.success) void loadData();
            return result;
          }}
        />
      )}

      <ConfirmDeleteModal
        open={Boolean(voidTarget)}
        title={t("common.void")}
        message={t("common.voidConfirmMessage")}
        itemName={voidTarget?.doc_no || undefined}
        confirmLabel={t("common.void")}
        loading={voiding}
        onConfirm={() => void handleVoidSale()}
        onCancel={() => setVoidTarget(null)}
      />

      <InvoicePrintSystem
        branding={invoicePrint.branding}
        modalOpen={invoicePrint.modalOpen}
        pendingData={invoicePrint.pendingData}
        printPayload={invoicePrint.printPayload}
        closeModal={invoicePrint.closeModal}
        confirmPrint={invoicePrint.confirmPrint}
      />

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
      <ToastMessage message={warehouseSend.toastMessage ?? toastMessage} variant={warehouseSend.toastVariant ?? toastVariant} />
    </PageLayout>
  );
}
