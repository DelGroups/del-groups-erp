"use client";

import React, { useState } from "react";
import { Save, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createContract,
  generateContractNumber,
  type Contract,
  type ContractType,
} from "@/lib/contracts/api";

interface ContractQuickCreateModalProps {
  type: ContractType;
  partyId: string;
  partyName?: string;
  partyVoen?: string | null;
  onClose: () => void;
  onCreated: (contract: Contract) => void;
}

export default function ContractQuickCreateModal({
  type,
  partyId,
  partyName,
  partyVoen,
  onClose,
  onCreated,
}: ContractQuickCreateModalProps) {
  const { t } = useI18n();
  const [contractNumber, setContractNumber] = useState(generateContractNumber(type));
  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [voen, setVoen] = useState(partyVoen || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t("official.contractTitleRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    const result = await createContract({
      contract_number: contractNumber.trim(),
      party_id: partyId,
      party_name: partyName ?? null,
      type,
      title: title.trim(),
      total_amount: Number(totalAmount) || 0,
      voen: voen.trim() || null,
      status: "active",
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.contract);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="text-sm font-bold text-app">{t("official.newContract")}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 p-5 text-xs">
          {error && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-600">
              {error}
            </p>
          )}

          <label className="block space-y-1">
            <span className="font-semibold">{t("official.contractNumber")}</span>
            <input
              type="text"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              className="app-input w-full"
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="font-semibold">{t("official.contractTitle")}</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="app-input w-full"
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="font-semibold">{t("official.contractAmount")}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              className="app-input w-full"
            />
          </label>

          <label className="block space-y-1">
            <span className="font-semibold">{t("invoice.voen")}</span>
            <input
              type="text"
              value={voen}
              onChange={(e) => setVoen(e.target.value)}
              className="app-input w-full"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-1">
              <Save className="h-4 w-4" />
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
