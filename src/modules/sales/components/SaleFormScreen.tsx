"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Banknote, FileCode2, FileJson, Lock, PencilLine, Printer, SearchX, Truck } from "lucide-react";
import { EmptyState, SkeletonList, TypeToConfirmDialog, useToast } from "@/design-system/components";
import { formatFigure } from "@/design-system/logic";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecordCrumb } from "@/components/shell/useShell";
import DocumentPaymentModal from "@/components/documents/DocumentPaymentModal";
import WarehouseResendModal from "@/components/documents/WarehouseResendModal";
import DeliveryTimeModal from "@/components/documents/DeliveryTimeModal";
import WarehouseSlipPrintTemplate from "@/components/warehouse/WarehouseSlipPrintTemplate";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import ToastMessage from "@/components/ui/ToastMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useVatAccountIds } from "@/hooks/useVatAccountIds";
import { useWarehouseDocumentSend } from "@/hooks/useWarehouseDocumentSend";
import { voidSaleAction } from "@/lib/actions/entityDelete";
import { sendSaleToWarehouseAction } from "@/lib/actions/sendToWarehouse";
import { computeInvoiceDebtBreakdown } from "@/lib/finance/invoiceRemainingBalance";
import { exportSaleEQaime } from "@/lib/tax/eQaimeDocuments";
import { canDelegateInvoiceIssuer } from "@/types/database.types";
import { FormView, invalidateModel, useFormatter, useViewRecord, ViewScope, type FormAction } from "@/views";
import { recordSalePaymentAction } from "../actions/payments";
import { mapSaleToInvoicePrint } from "../lib/mapSaleToInvoicePrint";
import type { SaleRecord } from "../lib/fetchSales";
import { SALES_DEFINITION } from "../hooks/useSalesDefinition";
import { SALES_VIEW_KEY } from "../views/sales";

/** One sales invoice in the view engine's form (new UI), read-only like the classic detail page. */
export default function SaleFormScreen({ id }: { id: string }) {
  return (
    <ViewScope>
      <SaleForm id={id} />
    </ViewScope>
  );
}

function SaleForm({ id }: { id: string }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const client = useQueryClient();
  const { can, profile } = useAuth();
  const { toast } = useToast();
  const branding = useCompanyBranding();
  const vatAccountIds = useVatAccountIds();
  const invoicePrint = useInvoicePrintSystem();
  const data = useViewRecord(SALES_DEFINITION, id);
  const sale = data.row as unknown as SaleRecord | null;
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const reload = async () => {
    await invalidateModel(client, SALES_VIEW_KEY);
  };
  const warehouseSend = useWarehouseDocumentSend(sendSaleToWarehouseAction, reload);
  useRecordCrumb(sale?.doc_no ?? null);

  if (data.status === "loading") return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  if (data.status === "forbidden") return <EmptyState icon={Lock} title={t("views.forbidden")} description={t("views.forbiddenHint")} />;
  if (data.status === "error")
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t("views.error")}
        action={
          <button type="button" className="ds-btn ds-btn-sm" onClick={data.refetch}>
            {t("views.retry")}
          </button>
        }
      />
    );
  if (!data.record || !sale)
    return (
      <EmptyState
        icon={SearchX}
        title={t("sales.engine.notFound")}
        action={
          <Link href="/sales" className="ds-btn ds-btn-sm">
            {t("sales.engine.backToList")}
          </Link>
        }
      />
    );

  const record = data.record;
  const money = (n: number) => `${formatFigure(n, 2, fmt.locale)} ${t("common.currency")}`;
  const debt = computeInvoiceDebtBreakdown(
    {
      isOfficial: sale.is_official,
      subtotalAmount: sale.subtotal_amount,
      vatAmount: sale.vat_amount ?? sale.vat_total,
      grandTotal: sale.grand_total ?? sale.total_amount,
      totalAmount: sale.total_amount,
      paidAmount: sale.paid_amount,
      remainingBalance: record.remaining,
      payments: sale.payments,
    },
    vatAccountIds
  );
  const send = warehouseSend.getSendButtonProps(sale);
  const isDraft = record.doc_status === "draft";
  const canSeeProfit = canDelegateInvoiceIssuer(profile?.role);

  const eQaime = async (format: "xml" | "json") => {
    try {
      await exportSaleEQaime(sale, branding, format);
      toast(t("tax.exportSuccess"), undefined, "success");
    } catch (err) {
      toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
    }
  };

  const actions: FormAction[] = [
    ...(isDraft && can("can_edit_sales") ? [{ key: "edit", label: t("sales.engine.actions.editDraft"), primary: true, icon: <PencilLine className="h-4 w-4" aria-hidden />, onClick: () => router.push(`/sales/new?draft=${sale.id}`) }] : []),
    ...(debt.totalRemaining > 0 ? [{ key: "pay", label: t("sales.engine.actions.registerPayment"), primary: !isDraft, icon: <Banknote className="h-4 w-4" aria-hidden />, onClick: () => setPaying(true) }] : []),
    { key: "print", label: t("common.print"), icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => invoicePrint.requestPrint(mapSaleToInvoicePrint(sale)) },
    { key: "xml", label: `${t("tax.eQaimeExport")} · ${t("taxPayrollSettings.formats.XML_ETAXES")}`, icon: <FileCode2 className="h-4 w-4" aria-hidden />, onClick: () => void eQaime("xml") },
    { key: "json", label: `${t("tax.eQaimeExport")} · ${t("taxPayrollSettings.formats.JSON_STANDARD")}`, icon: <FileJson className="h-4 w-4" aria-hidden />, onClick: () => void eQaime("json") },
    ...(send.show
      ? [{
          key: "send",
          label: t("sales.engine.actions.sendToWarehouse"),
          icon: <Truck className="h-4 w-4" aria-hidden />,
          disabled: send.disabled,
          onClick: () => warehouseSend.handleSendClick({ id: sale.id, warehouse_sent: sale.warehouse_sent === true, documentLabel: t("sales.docNo"), documentNumber: sale.doc_no ?? "-" }),
        }]
      : []),
    ...(can("can_delete_sales") ? [{ key: "void", label: t("common.void"), icon: <Ban className="h-4 w-4" aria-hidden />, onClick: () => setVoiding(true) }] : []),
  ];

  const linesTab = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5 ds-label">{t("dashboard.product")}</th>
            <th scope="col" className="px-2 py-1.5 ds-label">{t("sales.warehouse")}</th>
            <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("modals.salesView.quantity")}</th>
            <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("modals.salesView.price")}</th>
            <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("sales.engine.fields.discount")}</th>
            <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("modals.salesView.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {(sale.items ?? []).map((item, i) => (
            <tr key={item.id || i} style={{ borderTop: "1px solid var(--ds-border)" }}>
              <td className="px-2 py-1.5">
                <span className="font-medium">{item.product_name}</span>
                {item.product_code ? <span className="ml-2 ds-mono ds-subtle text-[length:var(--ds-text-xs)]">{item.product_code}</span> : null}
                {item.extra_info ? <span className="block ds-muted text-[length:var(--ds-text-xs)]">{item.extra_info}</span> : null}
              </td>
              <td className="px-2 py-1.5 ds-muted">{item.warehouse_name || "—"}</td>
              <td className="px-2 py-1.5 text-right ds-mono">{`${formatFigure(item.quantity, 2, fmt.locale)} ${item.unit}`}</td>
              <td className="px-2 py-1.5 text-right ds-mono">{formatFigure(item.unit_price, 2, fmt.locale)}</td>
              <td className="px-2 py-1.5 text-right ds-mono">{item.discount_percent ? (item.discount_type === "fixed" ? formatFigure(item.discount_percent, 2, fmt.locale) : `${item.discount_percent}%`) : "—"}</td>
              <td className="px-2 py-1.5 text-right ds-mono font-semibold">{formatFigure(item.total, 2, fmt.locale)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--ds-border-strong)" }}>
            <th scope="row" colSpan={5} className="px-2 py-2 text-left">{t("modals.salesView.total")}</th>
            <td className="px-2 py-2 text-right ds-mono font-semibold">{money(sale.total_amount)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  const paymentsTab =
    (sale.payments ?? []).length === 0 ? (
      <p className="ds-muted">{t("sales.engine.noPayments")}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {sale.payments.map((p, i) => (
          <li key={p.id || i} className="flex items-center justify-between gap-3 border-b pb-2" style={{ borderColor: "var(--ds-border)" }}>
            <span>{p.method || "—"}</span>
            <span className="ds-mono font-semibold">{money(Number(p.amount) || 0)}</span>
          </li>
        ))}
      </ul>
    );

  const profit = sale.total_amount - (sale.total_cogs ?? 0);
  const profitTab = (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[
        [t("sales.profitability.revenue"), money(sale.total_amount)],
        [t("sales.profitability.cogs"), money(sale.total_cogs ?? 0)],
        [t("sales.profitability.grossProfit"), money(profit)],
        [t("sales.profitability.margin"), `${sale.total_amount > 0 ? formatFigure((profit / sale.total_amount) * 100, 1, fmt.locale) : "0"}%`],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="ds-label">{label}</dt>
          <dd className="mt-1 ds-mono text-[length:var(--ds-text-lg)] font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      <FormView
        definition={data.definition}
        record={record}
        canWrite={false}
        fmt={fmt}
        actions={actions}
        extraTabs={[
          { key: "lines", label: t("sales.engine.tabs.lines", { count: sale.items?.length ?? 0 }), content: linesTab },
          { key: "payments", label: t("sales.engine.tabs.payments", { count: sale.payments?.length ?? 0 }), content: paymentsTab },
          ...(canSeeProfit ? [{ key: "profit", label: t("sales.profitability.title"), content: profitTab }] : []),
        ]}
        chatter={
          <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="sale-info">
            <h2 id="sale-info" className="ds-label">{t("sales.engine.info")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[length:var(--ds-text-xs)]">
              <dt className="ds-muted">{t("invoice.issuedBy")}</dt>
              <dd>{sale.issued_by_name || sale.seller_name || "—"}</dd>
              {sale.created_by && sale.issued_by && sale.created_by !== sale.issued_by ? (
                <>
                  <dt className="ds-muted">{t("sales.engine.fields.createdBy")}</dt>
                  <dd>{sale.created_by_name || "—"}</dd>
                </>
              ) : null}
              {sale.delivery_type || sale.delivery_address ? (
                <>
                  <dt className="ds-muted">{t("sales.engine.fields.delivery")}</dt>
                  <dd>{[sale.delivery_type, sale.delivery_address, sale.delivery_fee ? money(sale.delivery_fee) : null].filter(Boolean).join(" · ")}</dd>
                </>
              ) : null}
            </dl>
            {debt.showSplit ? (
              <p className="rounded-[var(--ds-radius-md)] p-2 text-[length:var(--ds-text-xs)]" style={{ background: "var(--ds-surface-sunken)" }}>
                {t("official.remainingSplit", { base: debt.remainingBase.toFixed(2), vat: debt.remainingVat.toFixed(2) })}
              </p>
            ) : null}
          </section>
        }
      />

      {paying ? (
        <DocumentPaymentModal
          isOpen
          onClose={() => setPaying(false)}
          documentLabel={t("sales.docNo")}
          documentNumber={sale.doc_no || "-"}
          counterpartyLabel={t("sales.customer")}
          counterpartyName={sale.customer_name || t("common.anonymousCustomer")}
          totalAmount={Number(sale.total_amount || 0)}
          paidAmount={Number(sale.paid_amount || 0)}
          remainingAmount={record.remaining}
          isOfficial={sale.is_official === true}
          documentSubtotalAmount={Number(sale.subtotal_amount ?? sale.subtotal ?? 0)}
          documentVatAmount={Number(sale.vat_amount ?? sale.vat_total ?? 0)}
          onSubmit={async (payload) => {
            const result = await recordSalePaymentAction({
              saleId: sale.id,
              docNo: sale.doc_no || "",
              customerId: sale.customer_id,
              amount: payload.amount,
              accountId: payload.accountId,
              method: payload.method,
              notes: payload.notes,
              paymentDate: payload.paymentDate,
              currentPaid: Number(sale.paid_amount || 0),
              totalAmount: Number(sale.total_amount || 0),
              existingPayments: sale.payments ?? [],
              treasurySplits: payload.treasurySplits,
            });
            if (result.success) void reload();
            return result;
          }}
        />
      ) : null}

      <TypeToConfirmDialog
        open={voiding}
        onOpenChange={setVoiding}
        confirmText={sale.doc_no || sale.id}
        consequences={[t("sales.engine.void.consequence")]}
        labels={{
          title: t("sales.engine.void.title"),
          description: t("common.voidConfirmMessage"),
          instruction: t("sales.engine.void.instruction"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("common.void"),
          working: t("sales.engine.void.working"),
          audit: t("sales.engine.void.audit"),
        }}
        onConfirm={async () => {
          const result = await voidSaleAction(sale.id);
          if (!result.success) {
            toast(t("common.error"), result.error, "error");
            return;
          }
          toast(t("common.voidSuccessRestore"), undefined, "success");
          await reload();
          router.push("/sales");
        }}
      />

      <InvoicePrintSystem
        branding={invoicePrint.branding}
        modalOpen={invoicePrint.modalOpen}
        pendingData={invoicePrint.pendingData}
        printPayload={invoicePrint.printPayload}
        closeModal={invoicePrint.closeModal}
        confirmPrint={invoicePrint.confirmPrint}
      />
      {warehouseSend.printSlip ? (
        <div className="print-area">
          <WarehouseSlipPrintTemplate slip={warehouseSend.printSlip} />
        </div>
      ) : null}
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
      <ToastMessage message={warehouseSend.toastMessage} variant={warehouseSend.toastVariant} />
    </>
  );
}
