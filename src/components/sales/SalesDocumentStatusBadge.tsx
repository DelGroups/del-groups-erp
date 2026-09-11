"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { normalizeSalesDocumentStatus } from "@/lib/invoices/invoiceStatus";

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

  const styles =
    normalized === "draft"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : normalized === "cancelled"
        ? "bg-rose-100 text-rose-700 border-rose-200"
        : "bg-emerald-100 text-emerald-800 border-emerald-200";

  const label =
    normalized === "draft"
      ? t("invoice.statusDraft")
      : normalized === "cancelled"
        ? t("invoice.statusCancelled")
        : t("invoice.statusPosted");

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${styles} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
