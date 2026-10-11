"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { normalizeSalesDocumentStatus } from "@/lib/invoices/invoiceStatus";
import StatusBadge, { type StatusTone } from "@/components/ui/status-badge";

interface SalesDocumentStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export default function SalesDocumentStatusBadge({
  status,
  className = "",
}: SalesDocumentStatusBadgeProps) {
  const { t } = useI18n();
  const normalized = normalizeSalesDocumentStatus(status);

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
