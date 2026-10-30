"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSalesList, useInvalidateSalesList, useUpdateSalesListCache } from "../hooks/useSalesList";
import PageLayout from "@/components/layout/PageLayout";
import ListPageChrome from "@/components/layout/ListPageChrome";
import { useRouter } from "next/navigation";
import SalesDocumentStatusBadge from "./SalesDocumentStatusBadge";
import {
  isSalesDraft,
  isSalesPosted,
  normalizeSalesDocumentStatus,
  type SalesDocumentStatus,
} from "@/lib/invoices/invoiceStatus";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentListActions from "@/components/documents/DocumentListActions";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import {
  ActionsTd,
  ActionsTh,
  BulkActionBar,
  DataTableLayout,
  SelectTd,
  SelectTh,
  Table,
  TablePagination,
  TableSkeletonRows,
  TableWrap,
  THead,
  Th,
  Tr,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import SalesViewModal from "./SalesViewModal";
import DocumentPaymentModal from "@/components/documents/DocumentPaymentModal";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import { mapSaleToInvoicePrint } from "../lib/mapSaleToInvoicePrint";
import { fetchSaleById, formatSaleAmount, getSaleRemaining, getSaleWarehouseLabel, type SaleRecord } from "../lib/fetchSales";
import { recordSalePaymentAction } from "../actions/payments";
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
import { exportSaleEQaime } from "@/lib/tax/eQaimeDocuments";
import { ListBodyCells, ListHeadCells, dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { ListGrid } from "@/components/lists/ListGrid";
import { useUiStandard } from "@/design-system/components";
import { formatGridDate } from "@/lib/dates/localeDate";
import { exportXlsx, xlsxFileName, type XlsxColumn } from "@/lib/export/exportXlsx";
import { docStatusLabelKey, paymentTypeLabelKey, warehouseStateLabelKey } from "@/lib/lists/documentLabels";

type SalesStatusFilter = "all" | SalesDocumentStatus;

const STATUS_FILTERS: Array<{ id: SalesStatusFilter; labelKey: string }> = [
  { id: "all", labelKey: "sales.filters.all" },
  { id: "posted", labelKey: "sales.filters.posted" },
  { id: "draft", labelKey: "sales.filters.draft" },
  { id: "cancelled", labelKey: "sales.filters.cancelled" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/** Column choice key of this list (prompt 24c). */
const SALES_LIST_KEY = "sales.invoices";

export default function SalesPage() {
  const router = useRouter();
  const { data: sales = [], isLoading, isFetching, error: queryError, refetch } = useSalesList();
  const invalidateSalesList = useInvalidateSalesList();
  const { removeSale } = useUpdateSalesListCache();
  const loading = isLoading || isFetching;
  const loadError = queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null;
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<SalesStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [viewingSale, setViewingSale] = useState<SaleRecord | null>(null);
  const [paymentSale, setPaymentSale] = useState<SaleRecord | null>(null);
  const [voidTarget, setVoidTarget] = useState<SaleRecord | null>(null);
  const [voiding, setVoiding] = useState(false);
  const invoicePrint = useInvoicePrintSystem();
  const vatAccountIds = useVatAccountIds();
  const branding = useCompanyBranding();
  const { can } = useAuth();
  const { t, formatDateTime } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const canCreateInvoice = can("can_create_invoice");
  const canEditSales = can("can_edit_sales");
  // Fix F1: a posted invoice is changed by admins only (can_edit_posted_sales; the database checks it).
  const canEditPostedSales = can("can_edit_posted_sales");
  const canDeleteSales = can("can_delete_sales");

  const loadData = useCallback(async () => {
    const result = await refetch();
    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : t("common.error");
      showError(message);
    }
  }, [refetch, showError, t]);

  const warehouseSend = useWarehouseDocumentSend(sendSaleToWarehouseAction, loadData);

  useEffect(() => {
    if (queryError) {
      const message = queryError instanceof Error ? queryError.message : t("common.error");
      showError(message);
    }
  }, [queryError, showError, t]);

  const filteredSales = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return sales.filter((s) => {
      if (!s?.id) return false;
      if (
        statusFilter !== "all" &&
        normalizeSalesDocumentStatus(s.status) !== statusFilter
      ) {
        return false;
      }
      return (
        (s.doc_no ?? "").toLowerCase().includes(q) ||
        (s.customer_name ?? "").toLowerCase().includes(q) ||
        (s.warehouse_name ?? "").toLowerCase().includes(q) ||
        getSaleWarehouseLabel(s).toLowerCase().includes(q)
      );
    });
  }, [sales, searchTerm, statusFilter]);

  const paginatedSales = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSales.slice(start, start + pageSize);
  }, [filteredSales, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize) || 1);
    if (page > totalPages) setPage(totalPages);
  }, [filteredSales.length, page, pageSize]);

  const bulk = useBulkSelection(filteredSales, (sale) => sale.id);

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
    removeSale(deletedId);
    showSuccess(t("common.voidSuccessRestore"));
    invalidateSalesList();
  };

  const debtOf = useCallback(
    (sale: SaleRecord) =>
      computeInvoiceDebtBreakdown(
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
      ),
    [vatAccountIds]
  );

  // UI_STANDARD (UI-2): the list renders through DataGrid (ListGrid) instead of the table below.
  const standard = useUiStandard();

  // Columns of the list (prompt 24c): today's set, then the standard and optional columns that
  // LIST_COLUMNS offers. Header, cells and the Excel export all follow the visible set.
  const columnDefs = useMemo<TableColumn<SaleRecord>[]>(
    () => [
      { key: "doc_no", labelKey: "sales.docNo", defaultVisible: true, required: true, thClassName: "min-w-[7rem]", tdClassName: "font-mono font-bold text-app-accent", cell: (s) => s.doc_no ?? "-" },
      { key: "doc_date", labelKey: "listColumns.invoiceDate", offLabelKey: "common.date", defaultVisible: true, thClassName: "min-w-[6rem]", exportType: "date", exportValue: (s) => s.doc_date, cell: (s) => (standard ? formatGridDate(s.doc_date) : s.doc_date ?? "-") },
      { key: "customer", labelKey: "sales.customer", defaultVisible: true, thClassName: "min-w-[10rem]", tdClassName: "font-semibold text-app", cell: (s) => s.customer_name || t("common.anonymousCustomer") },
      { key: "warehouse", labelKey: "sales.warehouse", defaultVisible: true, thClassName: "min-w-[8rem]", tdClassName: "text-app-muted", cell: (s) => getSaleWarehouseLabel(s) },
      { key: "total_amount", labelKey: "sales.totalAmount", defaultVisible: true, numeric: true, thClassName: "min-w-[7rem]", tdClassName: "font-bold", exportValue: (s) => Number(s.total_amount || 0), cell: (s) => formatSaleAmount(s.total_amount, t("common.currency")) },
      { key: "paid_amount", labelKey: "sales.paid", defaultVisible: true, numeric: true, thClassName: "min-w-[6rem]", tdClassName: "text-emerald-600", exportValue: (s) => Number(s.paid_amount || 0), cell: (s) => formatSaleAmount(s.paid_amount, t("common.currency")) },
      {
        key: "remaining",
        labelKey: "sales.remaining",
        defaultVisible: true,
        numeric: true,
        thClassName: "min-w-[7rem]",
        exportValue: (s) => debtOf(s).totalRemaining,
        cell: (s) => {
          const debtBreakdown = debtOf(s);
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
      { key: "doc_status", labelKey: "sales.docStatus", defaultVisible: true, thClassName: "min-w-[6rem]", exportValue: (s) => t(docStatusLabelKey(normalizeSalesDocumentStatus(s.status))), cell: (s) => <SalesDocumentStatusBadge status={s.status} /> },
      {
        key: "send_status",
        labelKey: "sales.sendStatus",
        defaultVisible: true,
        thClassName: "min-w-[7rem]",
        exportValue: (s) => t(warehouseStateLabelKey(s.warehouse_sent, s.warehouse_slip_status)),
        cell: (s) => <WarehouseSendBadge warehouseSent={s.warehouse_sent === true} warehouseSlipStatus={s.warehouse_slip_status ?? null} />,
      },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, thClassName: "min-w-[9rem]", tdClassName: "whitespace-nowrap text-app-muted", exportType: "datetime", exportValue: (s) => s.created_at, cell: (s) => (s.created_at ? formatDateTime(s.created_at) : "—") },
      // Salesperson: the issuer's name, else the stored seller name (as mapSaleToInvoicePrint).
      { key: "salesperson", labelKey: "listColumns.salesperson", defaultVisible: true, standard: true, thClassName: "min-w-[8rem]", cell: (s) => dash(s.issued_by_name || s.seller_name) },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, thClassName: "min-w-[8rem]", cell: (s) => dash(s.created_by_name) },
      { key: "vat", labelKey: "sales.engine.fields.vat", defaultVisible: false, numeric: true, exportValue: (s) => Number(s.vat_amount ?? s.vat_total ?? 0), cell: (s) => formatSaleAmount(s.vat_amount ?? s.vat_total, t("common.currency")) },
      { key: "due_date", labelKey: "sales.engine.fields.dueDate", defaultVisible: false, exportType: "date", exportValue: (s) => s.due_date, cell: (s) => (standard ? formatGridDate(s.due_date) : dash(s.due_date)) },
      { key: "payment_type", labelKey: "sales.engine.fields.paymentType", defaultVisible: false, cell: (s) => { const key = paymentTypeLabelKey(s.payment_type); return key ? t(key) : dash(s.payment_type); } },
      { key: "currency", labelKey: "sales.engine.fields.currency", defaultVisible: false, cell: (s) => dash(s.currency) },
      { key: "official", labelKey: "sales.engine.fields.official", defaultVisible: false, cell: (s) => (s.is_official ? t("views.yes") : t("views.no")) },
      { key: "note", labelKey: "sales.engine.fields.note", defaultVisible: false, tdClassName: "max-w-[16rem] truncate", cell: (s) => dash(s.note) },
    ],
    [t, formatDateTime, debtOf, standard]
  );
  const columns = useTableColumns(SALES_LIST_KEY, columnDefs);

  // Excel (prompt 24c, without the flag): every filtered row (or the selection); today's export
  // columns while LIST_COLUMNS is off, the columns the user sees while it is on.
  const handleExport = (rows = filteredSales) => {
    if (rows.length === 0) return;
    const legacyColumns: XlsxColumn<SaleRecord>[] = [
      { header: t("sales.docNo"), value: (s) => s.doc_no },
      { header: t("common.date"), type: "date", value: (s) => s.doc_date },
      { header: t("sales.customer"), value: (s) => s.customer_name },
      { header: t("sales.warehouse"), value: (s) => getSaleWarehouseLabel(s) },
      { header: t("common.total"), type: "money", value: (s) => Number(s.total_amount || 0) },
      { header: t("sales.paid"), type: "money", value: (s) => Number(s.paid_amount || 0) },
      { header: t("sales.remaining"), type: "money", value: (s) => Number(getSaleRemaining(s) || 0) },
    ];
    void exportXlsx(xlsxFileName(t("sales.csvFilename"), new Date()), {
      sheetName: t("sales.title"),
      columns: columns.enabled ? columns.exportColumns : legacyColumns,
      rows,
    });
  };

  const rowActions = (sale: SaleRecord) => {
    const debtBreakdown = debtOf(sale);
    return (
      <DocumentListActions
        onView={() => void openView(sale)}
        onPrint={() => void openPrint(sale)}
        onEdit={
          canEditSales && isSalesDraft(sale.status)
            ? () => router.push(`/sales/new?draft=${sale.id}`)
            : canEditPostedSales && isSalesPosted(sale.status)
              ? () => router.push(`/sales/new?draft=${sale.id}&amend=1`)
              : undefined
        }
        onPayment={() => void openPayment(sale)}
        onEQaimeExport={(format) => exportEQaime(sale, format)}
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
    );
  };

  return (
    <PageLayout>
      <ListPageChrome
        header={
          <DocumentPageHeader
            variant="chrome"
            icon={<ShoppingCart className="h-6 w-6 text-app-accent" />}
            title={t("sales.title")}
            description={t("sales.description")}
            createLabel={t("sales.createLabel")}
            onCreate={() => router.push("/sales/new")}
            createDisabled={!canCreateInvoice}
            extraActions={
              standard ? undefined : (
                <>
                  <Button type="button" variant="secondary" onClick={() => handleExport()}>
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    {t("common.excelDownload")}
                  </Button>
                </>
              )
            }
          />
        }
        filters={
          <>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    statusFilter === tab.id
                      ? "bg-[color:var(--app-accent)] text-white shadow-sm"
                      : "border border-app bg-app-card text-app-muted hover:bg-app-card-hover hover:text-app"
                  )}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>
            <DocumentListSearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={t("sales.searchPlaceholder")}
              onRefresh={() => void loadData()}
              loading={loading}
            />
            {columns.picker}
          </>
        }
        contentClassName="pb-6"
      >
          {loadError && !loading && (
            <div className="alert-warning text-xs">
              <p className="font-semibold">{t("common.error")}</p>
              <p className="mt-1 text-app-muted">{loadError}</p>
            </div>
          )}

          <Card padding={false} className="overflow-visible">
            <BulkActionBar count={bulk.count} onClear={bulk.clear}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleExport(bulk.selectedItems)}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {t("table.exportSelected")}
              </Button>
              {canDeleteSales ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    const target = bulk.selectedItems[0];
                    if (target) setVoidTarget(target);
                  }}
                  disabled={bulk.count !== 1}
                >
                  {t("common.void")}
                </Button>
              ) : null}
            </BulkActionBar>

            {standard ? (
              <ListGrid
                columns={columns}
                rows={paginatedSales}
                total={filteredSales.length}
                rowKey={(sale) => sale.id}
                label={t("sales.title")}
                loading={loading}
                empty={<p className="text-xs ds-muted">{t("sales.empty")}</p>}
                selection={{ isSelected: bulk.isSelected, toggle: bulk.toggle, allSelected: bulk.allSelected, someSelected: bulk.someSelected, toggleAll: bulk.toggleAll }}
                onOpen={(sale) => void openView(sale)}
                rowActions={rowActions}
                onExport={() => handleExport()}
                footer={
                  filteredSales.length ? (
                    <TablePagination
                      page={page}
                      limit={pageSize}
                      total={filteredSales.length}
                      onPageChange={setPage}
                      onLimitChange={(limit) => {
                        setPageSize(limit);
                        setPage(1);
                      }}
                      limitOptions={PAGE_SIZE_OPTIONS}
                    />
                  ) : null
                }
              />
            ) : loading ? (
              <TableWrap>
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
            ) : filteredSales.length === 0 ? (
              <div className="p-8 text-center text-xs text-app-muted">
                {t("sales.empty")}
              </div>
            ) : (
              <DataTableLayout
                className="rounded-none border-0 bg-transparent shadow-none"
                pagination={{
                  page,
                  limit: pageSize,
                  total: filteredSales.length,
                  onPageChange: setPage,
                  onLimitChange: (limit) => {
                    setPageSize(limit);
                    setPage(1);
                  },
                  limitOptions: PAGE_SIZE_OPTIONS,
                }}
              >
                <Table className="min-w-[72rem]">
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
                    {paginatedSales.map((sale) => {
                      return (
                      <Tr key={sale.id}>
                        <SelectTd
                          checked={bulk.isSelected(sale)}
                          onChange={() => bulk.toggle(sale)}
                        />
                        <ListBodyCells columns={columns.visible} row={sale} />
                        <ActionsTd>
                          {rowActions(sale)}
                        </ActionsTd>
                      </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </DataTableLayout>
            )}
          </Card>
      </ListPageChrome>

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
          documentDate={paymentSale.doc_date}
          onSubmit={async (payload) => {
            const result = await recordSalePaymentAction({
              saleId: paymentSale.id,
              docNo: paymentSale.doc_no || "",
              customerId: paymentSale.customer_id,
              amount: payload.amount,
              accountId: payload.accountId,
              method: payload.method,
              notes: payload.notes,
              paymentDate: payload.paymentDate,
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
