"use client";

import { useMemo, useState } from "react";
import { GitMerge, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { mergePartnersAction } from "@/lib/actions/partners";
import type { PartnerRecord } from "@/lib/partners/types";
import { partnerDisplayName } from "@/lib/partners/fetchPartners";

type MergePartnersDialogProps = {
  open: boolean;
  partners: PartnerRecord[];
  onClose: () => void;
  onMerged: () => void;
};

export default function MergePartnersDialog({
  open,
  partners,
  onClose,
  onMerged,
}: MergePartnersDialogProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [merging, setMerging] = useState(false);

  const options = useMemo(
    () =>
      partners.map((partner) => ({
        id: partner.id,
        label: `${partnerDisplayName(partner)}${partner.code ? ` (${partner.code})` : ""}`,
      })),
    [partners]
  );

  if (!open) return null;

  const handleMerge = async () => {
    if (!sourceId || !targetId) {
      showError(t("partners.mergeSelectBoth"));
      return;
    }
    if (sourceId === targetId) {
      showError(t("partners.mergeSameError"));
      return;
    }

    setMerging(true);
    const result = await mergePartnersAction(sourceId, targetId);
    setMerging(false);

    if (!result.success) {
      showError(result.error);
      return;
    }

    showSuccess(
      t("partners.mergeSuccess", {
        sales: String(result.data?.salesMoved ?? 0),
        purchases: String(result.data?.purchasesMoved ?? 0),
      })
    );
    setSourceId("");
    setTargetId("");
    onMerged();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
        <div className="app-modal w-full max-w-lg">
          <div className="flex items-center justify-between border-b border-app px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-app">
              <GitMerge className="h-4 w-4 text-app-accent" />
              {t("partners.mergePartners")}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 p-5 text-xs">
            <p className="text-sm text-app-muted">{t("partners.mergeDescription")}</p>

            <label className="block font-semibold text-app">
              {t("partners.mergeSource")}
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="app-input mt-1 w-full"
              >
                <option value="">{t("partners.selectPartner")}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id} disabled={option.id === targetId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block font-semibold text-app">
              {t("partners.mergeTarget")}
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="app-input mt-1 w-full"
              >
                <option value="">{t("partners.selectPartner")}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id} disabled={option.id === sourceId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex justify-end gap-2 border-t border-app pt-4">
              <button type="button" onClick={onClose} className="btn-secondary">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleMerge()}
                disabled={merging}
                className="btn-primary"
              >
                <GitMerge className="h-4 w-4" />
                {merging ? t("partners.merging") : t("partners.mergeConfirm")}
              </button>
            </div>
          </div>
        </div>
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
