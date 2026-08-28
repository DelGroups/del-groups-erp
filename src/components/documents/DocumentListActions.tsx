"use client";

import React from "react";
import { Banknote, Edit, Eye, Package, Printer } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface DocumentListActionsProps {
  onView?: () => void;
  onPrint?: () => void;
  onEdit?: () => void;
  onPayment?: () => void;
  onSendToWarehouse?: () => void;
  viewTitle?: string;
  printTitle?: string;
  editTitle?: string;
  paymentTitle?: string;
  paymentDisabled?: boolean;
  sendToWarehouseTitle?: string;
  sendToWarehouseDisabled?: boolean;
  showSendToWarehouse?: boolean;
}

export default function DocumentListActions({
  onView,
  onPrint,
  onEdit,
  onPayment,
  onSendToWarehouse,
  viewTitle,
  printTitle,
  editTitle,
  paymentTitle,
  paymentDisabled = false,
  sendToWarehouseTitle,
  sendToWarehouseDisabled = false,
  showSendToWarehouse = false,
}: DocumentListActionsProps) {
  const { t } = useI18n();
  const resolvedViewTitle = viewTitle ?? t("common.view");
  const resolvedPrintTitle = printTitle ?? t("common.print");
  const resolvedEditTitle = editTitle ?? t("common.edit");
  const resolvedPaymentTitle = paymentTitle ?? t("common.payment");
  const resolvedSendTitle = sendToWarehouseTitle ?? t("warehouseSend.send");

  return (
    <div className="flex items-center justify-center gap-1.5">
      {onView && (
        <button
          type="button"
          onClick={onView}
          className="rounded-lg p-1.5 text-app-muted hover:bg-app-card-hover"
          title={resolvedViewTitle}
        >
          <Eye className="h-4 w-4" />
        </button>
      )}
      {onPrint && (
        <button
          type="button"
          onClick={onPrint}
          className="rounded-lg p-1.5 text-app-muted hover:bg-app-card-hover"
          title={resolvedPrintTitle}
        >
          <Printer className="h-4 w-4" />
        </button>
      )}
      {showSendToWarehouse && onSendToWarehouse && (
        <button
          type="button"
          onClick={onSendToWarehouse}
          disabled={sendToWarehouseDisabled}
          className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
          title={resolvedSendTitle}
        >
          <Package className="h-4 w-4" />
        </button>
      )}
      {onPayment && (
        <button
          type="button"
          onClick={onPayment}
          disabled={paymentDisabled}
          className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          title={paymentDisabled ? t("common.noDebt") : resolvedPaymentTitle}
          aria-label={resolvedPaymentTitle}
        >
          <Banknote className="h-4 w-4" />
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg p-1.5 text-app-accent hover:bg-[color:var(--app-accent-soft)]"
          title={resolvedEditTitle}
        >
          <Edit className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
