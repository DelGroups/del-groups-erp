"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { WarehouseSlipStatus } from "@/types/database.types";

interface WarehouseSendBadgeProps {
  warehouseSent: boolean;
  warehouseSlipStatus: WarehouseSlipStatus | null;
}

export default function WarehouseSendBadge({
  warehouseSent,
  warehouseSlipStatus,
}: WarehouseSendBadgeProps) {
  const { t } = useI18n();

  if (!warehouseSent) {
    return (
      <span className="badge-neutral">
        {t("warehouseSend.notSent")}
      </span>
    );
  }

  if (warehouseSlipStatus === "pending") {
    return (
      <span className="badge-warning">
        {t("warehouseSend.pendingApproval")}
      </span>
    );
  }

  if (warehouseSlipStatus === "approved") {
    return (
      <span className="badge-success">
        {t("warehouseSend.sent")}
      </span>
    );
  }

  return (
    <span className="badge-danger">
      {t("warehouseSend.rejected")}
    </span>
  );
}
