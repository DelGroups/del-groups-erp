"use client";

import React from "react";
import { Banknote, Edit, Eye, FileCode2, Package, Printer, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  TableRowActionsMenu,
  type TableRowActionItem,
} from "@/components/ui/table-row-actions-menu";

interface DocumentListActionsProps {
  onView?: () => void;
  onPrint?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPayment?: () => void;
  onSendToWarehouse?: () => void;
  onEQaimeExport?: (format: "xml" | "json") => void | Promise<void>;
  viewTitle?: string;
  printTitle?: string;
  editTitle?: string;
  deleteTitle?: string;
  paymentTitle?: string;
  paymentDisabled?: boolean;
  sendToWarehouseTitle?: string;
  sendToWarehouseDisabled?: boolean;
  showSendToWarehouse?: boolean;
  /** @deprecated Use onEQaimeExport for menu integration. */
  extra?: React.ReactNode;
}

export default function DocumentListActions({
  onView,
  onPrint,
  onEdit,
  onDelete,
  onPayment,
  onSendToWarehouse,
  onEQaimeExport,
  viewTitle,
  printTitle,
  editTitle,
  deleteTitle,
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
  const resolvedDeleteTitle = deleteTitle ?? t("common.delete");
  const resolvedPaymentTitle = paymentTitle ?? t("common.payment");
  const resolvedSendTitle = sendToWarehouseTitle ?? t("warehouseSend.send");

  const items: TableRowActionItem[] = [];

  if (onView) {
    items.push({
      key: "view",
      label: resolvedViewTitle,
      icon: <Eye className="h-4 w-4" />,
      onClick: onView,
    });
  }
  if (onPrint) {
    items.push({
      key: "print",
      label: resolvedPrintTitle,
      icon: <Printer className="h-4 w-4" />,
      onClick: onPrint,
    });
  }
  if (showSendToWarehouse && onSendToWarehouse) {
    items.push({
      key: "warehouse",
      label: resolvedSendTitle,
      icon: <Package className="h-4 w-4" />,
      onClick: onSendToWarehouse,
      disabled: sendToWarehouseDisabled,
    });
  }
  if (onPayment) {
    items.push({
      key: "payment",
      label: paymentDisabled ? t("common.noDebt") : resolvedPaymentTitle,
      icon: <Banknote className="h-4 w-4" />,
      onClick: onPayment,
      disabled: paymentDisabled,
    });
  }
  if (onEQaimeExport) {
    items.push(
      {
        key: "eqaime-xml",
        label: t("taxPayrollSettings.formats.XML_ETAXES"),
        icon: <FileCode2 className="h-4 w-4" />,
        onClick: () => void onEQaimeExport("xml"),
      },
      {
        key: "eqaime-json",
        label: t("taxPayrollSettings.formats.JSON_STANDARD"),
        icon: <FileCode2 className="h-4 w-4" />,
        onClick: () => void onEQaimeExport("json"),
      }
    );
  }
  if (onEdit) {
    items.push({
      key: "edit",
      label: resolvedEditTitle,
      icon: <Edit className="h-4 w-4" />,
      onClick: onEdit,
    });
  }
  if (onDelete) {
    items.push({
      key: "delete",
      label: resolvedDeleteTitle,
      icon: <Trash2 className="h-4 w-4" />,
      onClick: onDelete,
      variant: "destructive",
    });
  }

  return <TableRowActionsMenu items={items} />;
}
