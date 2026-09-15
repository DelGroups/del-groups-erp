"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import Button from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
}

export default function BulkImportModal({ open, onClose }: BulkImportModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("products.bulkImportLabel")}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <p className="text-sm text-app-muted">{t("products.bulkImportPlaceholder")}</p>
    </Modal>
  );
}
