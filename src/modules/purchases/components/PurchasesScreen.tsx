"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, FileCode2, FileJson, PencilLine, Plus, Printer, Truck } from "lucide-react";
import { SkeletonList, TypeToConfirmDialog, useToast } from "@/design-system/components";
import { formatFigure } from "@/design-system/logic";
import { useAuth } from "@/components/auth/AuthProvider";
import DocumentPaymentModal from "@/components/documents/DocumentPaymentModal";
import WarehouseResendModal from "@/components/documents/WarehouseResendModal";
import DeliveryTimeModal from "@/components/documents/DeliveryTimeModal";
import WarehouseSlipPrintTemplate from "@/components/warehouse/WarehouseSlipPrintTemplate";
import ToastMessage from "@/components/ui/ToastMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useWarehouseDocumentSend } from "@/hooks/useWarehouseDocumentSend";
import { voidPurchaseAction } from "@/lib/actions/entityDelete";
import { sendPurchaseToWarehouseAction } from "@/lib/actions/sendToWarehouse";
import { exportPurchaseEQaime } from "@/lib/tax/eQaimeDocuments";
import type { PurchaseRecord } from "@/types/database.types";
import { EngineScreen, FormView, invalidateModel, RECORD_PARAM, useFormatter, useViewRecord, ViewScope, type FormAction } from "@/views";
import { recordPurchasePaymentAction } from "../actions/payments";
import { fetchPurchaseFormData } from "../lib/fetchPurchases";
import { PURCHASES_DEFINITION } from "../hooks/usePurchasesDefinition";
import { purchaseKpis, PURCHASES_VIEW_KEY, type PurchaseListRecord } from "../views/purchases";
import PurchaseForm from "./PurchaseForm";
import PurchasePrintTemplate from "./PurchasePrintTemplate";
import PurchaseRequisitionsPanel from "./PurchaseRequisitionsPanel";

/** Purchases on the view engine (new UI): invoices with a dashboard, and purchase requisitions. */
export default function PurchasesScreen() {
  const params = useSearchParams();
  return params.get("tab") === "requisitions" ? <RequisitionsTab /> : <InvoicesTab />;
}

function Tabs({ active }: { active: "invoices" | "requisitions" }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("purchases.title")} className="flex gap-4 border-b" style={{ borderColor: "var(--ds-border)" }}>
      <Link href="/purchases" className="ds-tab" aria-current={active === "invoices" ? "page" : undefined}>
        {t("purchases.tabInvoices")}
      </Link>
      <Link href="/purchases?tab=requisitions" className="ds-tab" aria-current={active === "requisitions" ? "page" : undefined}>
        {t("purchases.tabRequisitions")}
      </Link>
    </nav>
  );
}

function RequisitionsTab() {
  const router = useRouter();
  return (
    <ViewScope>
      <div className="flex flex-col gap-4">
        <Tabs active="requisitions" />
        <PurchaseRequisitionsPanel onOpenPurchase={(id) => router.push(`/purchases?${RECORD_PARAM}=${encodeURIComponent(id)}`)} />
      </div>
    </ViewScope>
  );
}

function InvoicesTab() {
  const { t } = useI18n();
  return (
    <EngineScreen
      definition={PURCHASES_DEFINITION}
      title={t("purchases.title")}
      header={<Tabs active="invoices" />}
      kpis={(records, fmt, ctx) => purchaseKpis(records, fmt, ctx.now)}
      actions={
        <Link href="/purchases/new" className="ds-btn ds-btn-sm ds-btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {t("purchases.createLabel")}
        </Link>
      }
      recordTitle={(r) => r.invoice_number}
      renderRecord={(r, { close }) => <PurchaseRecordView id={r.id} close={close} />}
    />
  );
}

/** One purchase invoice in the side panel: read-only form with the classic actions. */
function PurchaseRecordView({ id, close }: { id: string; close: () => void }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  const branding = useCompanyBranding();
  const data = useViewRecord(PURCHASES_DEFINITION, id);
  const purchase = data.row as unknown as PurchaseRecord | null;
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const { printData, setPrintData } = useDocumentPrint<PurchaseRecord>();
  const formData = useQuery({ queryKey: ["purchases", "form-data"], queryFn: fetchPurchaseFormData, enabled: mode === "edit" });
  const reload = async () => {
    await invalidateModel(client, PURCHASES_VIEW_KEY);
  };
  const warehouseSend = useWarehouseDocumentSend(sendPurchaseToWarehouseAction, reload);

  if (data.status !== "ready" || !data.record || !purchase) {
    return <SkeletonList loading={data.status === "loading"} rows={6} label={t("common.loading")}>{<p className="ds-muted">{t("common.notFound")}</p>}</SkeletonList>;
  }
  const record = data.record as PurchaseListRecord;

  if (mode === "edit") {
    if (!formData.data) return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
    return (
      <PurchaseForm
        key={purchase.id}
        suppliers={formData.data.suppliers}
        products={formData.data.products}
        warehouses={formData.data.warehouses}
        mode="edit"
        initialPurchase={purchase}
        onCancel={() => setMode("view")}
        onSuccess={() => {
          setMode("view");
          void reload();
        }}
      />
    );
  }

  const isDraft = record.doc_status === "draft";
  const send = warehouseSend.getSendButtonProps(purchase);
  const eQaime = async (format: "xml" | "json") => {
    try {
      await exportPurchaseEQaime(purchase, branding, format);
      toast(t("tax.exportSuccess"), undefined, "success");
    } catch (err) {
      toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
    }
  };
  const actions: FormAction[] = [
    ...(can("can_edit_purchases")
      ? [{ key: "edit", label: isDraft ? t("sales.engine.actions.editDraft") : t("common.edit"), primary: isDraft, icon: <PencilLine className="h-4 w-4" aria-hidden />, onClick: () => (isDraft ? router.push(`/purchases/new?draft=${purchase.id}`) : setMode("edit")) }]
      : []),
    ...(record.remaining > 0 ? [{ key: "pay", label: t("purchases.engine.registerPayment"), primary: !isDraft, icon: <Banknote className="h-4 w-4" aria-hidden />, onClick: () => setPaying(true) }] : []),
    { key: "print", label: t("common.print"), icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => setPrintData(purchase) },
    { key: "xml", label: `${t("tax.eQaimeExport")} · ${t("taxPayrollSettings.formats.XML_ETAXES")}`, icon: <FileCode2 className="h-4 w-4" aria-hidden />, onClick: () => void eQaime("xml") },
    { key: "json", label: `${t("tax.eQaimeExport")} · ${t("taxPayrollSettings.formats.JSON_STANDARD")}`, icon: <FileJson className="h-4 w-4" aria-hidden />, onClick: () => void eQaime("json") },
    ...(send.show
      ? [{
          key: "send",
          label: t("sales.engine.actions.sendToWarehouse"),
          icon: <Truck className="h-4 w-4" aria-hidden />,
          disabled: send.disabled,
          onClick: () => warehouseSend.handleSendClick({ id: purchase.id, warehouse_sent: purchase.warehouse_sent === true, documentLabel: t("purchases.invoiceNo"), documentNumber: purchase.invoice_number }),
        }]
      : []),
    ...(can("can_delete_purchases") ? [{ key: "void", label: t("common.void"), icon: <Ban className="h-4 w-4" aria-hidden />, onClick: () => setVoiding(true) }] : []),
  ];

  const lines = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5 ds-label">{t("dashboard.product")}</th>
            <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("modals.salesView.quantity")}</th>
            <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("modals.salesView.price")}</th>
            <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("modals.salesView.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {purchase.items.map((item, i) => (
            <tr key={item.id || i} style={{ borderTop: "1px solid var(--ds-border)" }}>
              <td className="px-2 py-1.5">
                {item.product_name}
                {item.product_code ? <span className="ml-2 ds-mono ds-subtle text-[length:var(--ds-text-xs)]">{item.product_code}</span> : null}
              </td>
              <td className="px-2 py-1.5 text-right ds-mono">{`${formatFigure(item.quantity, 2, fmt.locale)} ${item.unit}`}</td>
              <td className="px-2 py-1.5 text-right ds-mono">{formatFigure(item.unit_price, 2, fmt.locale)}</td>
              <td className="px-2 py-1.5 text-right ds-mono font-semibold">{formatFigure(item.total, 2, fmt.locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <FormView
        definition={data.definition}
        record={record}
        canWrite={false}
        fmt={fmt}
        actions={actions}
        extraTabs={[{ key: "lines", label: t("sales.engine.tabs.lines", { count: purchase.items.length }), content: lines }]}
      />
      {paying ? (
        <DocumentPaymentModal
          isOpen
          onClose={() => setPaying(false)}
          documentLabel={t("purchases.invoiceNo")}
          documentNumber={purchase.invoice_number}
          counterpartyLabel={t("purchases.supplier")}
          counterpartyName={purchase.supplier_name || "-"}
          totalAmount={purchase.total_amount}
          paidAmount={purchase.paid_amount}
          remainingAmount={purchase.debt_amount}
          isOfficial={purchase.is_official === true}
          documentSubtotalAmount={Number(purchase.subtotal_amount ?? purchase.total_amount ?? 0)}
          documentVatAmount={Number(purchase.vat_amount ?? 0)}
          onSubmit={async (payload) => {
            const result = await recordPurchasePaymentAction({
              purchaseId: purchase.id,
              invoiceNumber: purchase.invoice_number,
              supplierId: purchase.supplier_id,
              amount: payload.amount,
              accountId: payload.accountId,
              method: payload.method,
              notes: payload.notes,
              paymentDate: payload.paymentDate,
              currentPaid: purchase.paid_amount,
              totalAmount: purchase.total_amount,
              currentDebt: purchase.debt_amount,
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
        confirmText={purchase.invoice_number || purchase.id}
        consequences={[t("purchases.engine.voidConsequence")]}
        labels={{
          title: t("purchases.engine.voidTitle"),
          description: t("common.voidConfirmMessage"),
          instruction: t("sales.engine.void.instruction"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("common.void"),
          working: t("sales.engine.void.working"),
          audit: t("sales.engine.void.audit"),
        }}
        onConfirm={async () => {
          const result = await voidPurchaseAction(purchase.id);
          if (!result.success) {
            toast(t("common.error"), result.error, "error");
            return;
          }
          toast(t("common.voidSuccessRestore"), undefined, "success");
          await reload();
          close();
          router.replace(pathname);
        }}
      />
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
      <ToastMessage message={warehouseSend.toastMessage} variant={warehouseSend.toastVariant} />
      {/* Print templates go to the page root, outside the side panel, so the print styles apply. */}
      {printData ? createPortal(<div className="print-area"><PurchasePrintTemplate purchase={printData} /></div>, document.body) : null}
      {warehouseSend.printSlip ? createPortal(<div className="print-area"><WarehouseSlipPrintTemplate slip={warehouseSend.printSlip} /></div>, document.body) : null}
    </>
  );
}
