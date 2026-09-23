"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import StatusBadge, { type StatusTone } from "@/components/ui/status-badge";
import type { ConsignmentDocumentType } from "@/lib/consignment/types";

interface ConsignmentDocumentStatusBadgeProps {
  documentType: ConsignmentDocumentType;
  className?: string;
}

const TONE_BY_TYPE: Record<ConsignmentDocumentType, StatusTone> = {
  DISPATCH: "neutral",
  RETURN: "warning",
  ACTUAL_SALE: "success",
};

export default function ConsignmentDocumentStatusBadge({
  documentType,
  className = "",
}: ConsignmentDocumentStatusBadgeProps) {
  const { t } = useI18n();
  const label =
    documentType === "DISPATCH"
      ? t("consignments.docTypeDispatch")
      : documentType === "RETURN"
        ? t("consignments.docTypeReturn")
        : t("consignments.docTypeActualSale");

  return (
    <StatusBadge tone={TONE_BY_TYPE[documentType]} className={className}>
      {label}
    </StatusBadge>
  );
}
