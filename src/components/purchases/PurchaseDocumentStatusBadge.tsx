"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { normalizePurchaseDocumentStatus } from "@/lib/invoices/invoiceStatus";
import StatusBadge, { type StatusTone } from "@/components/ui/status-badge";

interface PurchaseDocumentStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export default function PurchaseDocumentStatusBadge({
  status,
  className = "",
}: PurchaseDocumentStatusBadgeProps) {
  const { t } = useI18n();
  const normalized = normalizePurchaseDocumentStatus(status);

  const tone: StatusTone =
    normalized === "draft" ? "draft" : normalized === "cancelled" ? "cancelled" : "posted";

  const label =
    normalized === "draft"
      ? t("invoice.statusDraft")
      : normalized === "cancelled"
        ? t("invoice.statusCancelled")
        : t("invoice.statusPosted");

  return (
    <StatusBadge tone={tone} className={className}>
      {label}
    </StatusBadge>
  );
}
