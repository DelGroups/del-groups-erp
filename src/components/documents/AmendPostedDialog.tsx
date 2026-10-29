"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import Button from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Asks an admin why a posted invoice is changed (fix F1). The reason is required and goes to the
 * invoice history; the warning says that stock, cost and accounting are reversed and posted again.
 * Mounted only while open, so every opening starts with an empty reason.
 */
export default function AmendPostedDialog({
  documentNumber,
  onCancel,
  onConfirm,
}: {
  documentNumber: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onCancel())}
      title={t("invoice.amend.title", { docNo: documentNumber })}
      className="max-w-md"
      footer={
        <>
          <Button appearance="outline" color="secondary" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button color="danger" size="sm" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>
            {t("invoice.amend.start")}
          </Button>
        </>
      }
    >
      <Alert variant="warning" className="mb-3">
        {t("invoice.amend.warning")}
      </Alert>
      <label className="erp-label" htmlFor="amend-reason">
        {t("invoice.amend.reason")}
      </label>
      <textarea
        id="amend-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("invoice.amend.reasonPlaceholder")}
        className="app-input w-full resize-none text-sm"
      />
    </Modal>
  );
}
