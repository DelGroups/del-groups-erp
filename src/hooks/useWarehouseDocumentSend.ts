"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  warehouseSlipToPrintData,
  type WarehouseSlipPrintData,
} from "@/components/warehouse/WarehouseSlipPrintTemplate";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import type { SendToWarehouseResult } from "@/lib/actions/sendToWarehouse";

export interface WarehouseDocumentRow {
  id: string;
  warehouse_sent?: boolean | null;
}

type SendAction = (
  id: string,
  deliveryDueAt: string,
  forceResend?: boolean
) => Promise<SendToWarehouseResult>;

export interface WarehouseSendTarget extends WarehouseDocumentRow {
  documentLabel: string;
  documentNumber: string;
}

export function useWarehouseDocumentSend(
  sendAction: SendAction,
  onReload: () => Promise<void> | void
) {
  const { can, isAdmin } = useAuth();
  const { t } = useI18n();
  const canSend = can("can_send_to_warehouse");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [resendTarget, setResendTarget] = useState<WarehouseSendTarget | null>(null);
  const [deliveryTarget, setDeliveryTarget] = useState<WarehouseSendTarget | null>(null);
  const [deliveryForceResend, setDeliveryForceResend] = useState(false);
  const { printData: printSlip, setPrintData: setPrintSlip } =
    useDocumentPrint<WarehouseSlipPrintData>();

  const openDeliveryModal = useCallback(
    (target: WarehouseSendTarget, forceResend = false) => {
      setDeliveryForceResend(forceResend);
      setDeliveryTarget(target);
    },
    []
  );

  const executeSend = useCallback(
    async (documentId: string, deliveryDueAt: string, forceResend = false) => {
      setSendingId(documentId);
      const result = await sendAction(documentId, deliveryDueAt, forceResend);
      setSendingId(null);

      if (!result.success) {
        if (result.error === "RESEND_CONFIRM_REQUIRED") {
          return false;
        }
        alert(t("common.error") + ": " + result.error);
        return false;
      }

      await onReload();

      if (result.autoApproved) {
        setPrintSlip(warehouseSlipToPrintData(result.slip));
      } else {
        alert(t("warehouseSend.sentPending"));
      }

      return true;
    },
    [onReload, sendAction, setPrintSlip, t]
  );

  const handleSendClick = useCallback(
    (target: WarehouseSendTarget) => {
      if (!canSend) return;

      if (target.warehouse_sent) {
        if (!isAdmin) return;
        setResendTarget(target);
        return;
      }

      openDeliveryModal(target, false);
    },
    [canSend, isAdmin, openDeliveryModal]
  );

  const confirmResend = useCallback(() => {
    if (!resendTarget) return;
    const target = resendTarget;
    setResendTarget(null);
    openDeliveryModal(target, true);
  }, [openDeliveryModal, resendTarget]);

  const confirmDelivery = useCallback(
    async (deliveryDueAt: string) => {
      if (!deliveryTarget) return;
      const ok = await executeSend(
        deliveryTarget.id,
        deliveryDueAt,
        deliveryForceResend
      );
      if (ok) {
        setDeliveryTarget(null);
        setDeliveryForceResend(false);
      }
    },
    [deliveryForceResend, deliveryTarget, executeSend]
  );

  const cancelDelivery = useCallback(() => {
    setDeliveryTarget(null);
    setDeliveryForceResend(false);
  }, []);

  const getSendButtonProps = useCallback(
    (row: WarehouseDocumentRow) => {
      if (!canSend) {
        return { show: false, disabled: true, title: t("warehouseSend.noPermission") };
      }

      if (row.warehouse_sent && !isAdmin) {
        return {
          show: true,
          disabled: true,
          title: t("warehouseSend.alreadySent"),
        };
      }

      if (row.warehouse_sent && isAdmin) {
        return {
          show: true,
          disabled: sendingId === row.id,
          title: t("warehouseSend.resend"),
        };
      }

      return {
        show: true,
        disabled: sendingId === row.id,
        title: t("warehouseSend.send"),
      };
    },
    [canSend, isAdmin, sendingId, t]
  );

  return {
    canSend,
    sendingId,
    resendTarget,
    setResendTarget,
    deliveryTarget,
    confirmDelivery,
    cancelDelivery,
    handleSendClick,
    confirmResend,
    getSendButtonProps,
    printSlip,
  };
}
