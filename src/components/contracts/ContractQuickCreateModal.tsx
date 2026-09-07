"use client";

import React, { useState } from "react";
import { Save, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  contractTypesForTransaction,
  createContract,
  generateContractNumber,
  type Contract,
  type ContractType,
} from "@/lib/contracts/api";

interface ContractQuickCreateModalProps {
  transactionType: "sale" | "purchase";
  partyId: string;
  partyName?: string;
  partyVoen?: string | null;
  onClose: () => void;
  onCreated: (contract: Contract) => void;
}

export default function ContractQuickCreateModal({
  transactionType,
  partyId,
  partyName,
  partyVoen,
  onClose,
  onCreated,
}: ContractQuickCreateModalProps) {
  const { t } = useI18n();
  const defaultType = contractTypesForTransaction(transactionType)[0];
  const [contractNumber, setContractNumber] = useState(generateContractNumber(defaultType));
  const [type, setType] = useState<ContractType>(defaultType);
  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [advancePercentage, setAdvancePercentage] = useState("");
  const [paymentStages, setPaymentStages] = useState("");
  const [paymentTermsNotes, setPaymentTermsNotes] = useState("");
  const [contractDate, setContractDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTypes = contractTypesForTransaction(transactionType);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t("official.contractTitleRequired"));
      return;
    }
    if (!partyVoen?.trim()) {
      setError(t("official.legalPartyVoenRequired"));
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
      total_amount: totalAmount.trim() ? Number(totalAmount) : null,
      voen: partyVoen.trim(),
      advance_percentage: advancePercentage.trim() ? Number(advancePercentage) : null,
      payment_stages: paymentStages.trim() ? Number(paymentStages) : null,
      payment_terms_notes: paymentTermsNotes.trim() || null,
      contract_date: contractDate || null,
      expiry_date: expiryDate || null,
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
      <div className="app-modal max-h-[90vh] w-full max-w-md overflow-y-auto">
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

          {availableTypes.length > 1 && (
            <label className="block space-y-1">
              <span className="font-semibold">{t("official.contractType")}</span>
              <select
                value={type}
                onChange={(e) => {
                  const nextType = e.target.value as ContractType;
                  setType(nextType);
                  setContractNumber(generateContractNumber(nextType));
                }}
                className="app-input w-full"
              >
                {availableTypes.map((value) => (
                  <option key={value} value={value}>
                    {value === "service"
                      ? t("official.typeService")
                      : value === "purchase"
                        ? t("official.typePurchase")
                        : t("official.typeSale")}
                  </option>
                ))}
              </select>
            </label>
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

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="font-semibold">{t("official.contractDate")}</span>
              <input
                type="date"
                value={contractDate}
                onChange={(e) => setContractDate(e.target.value)}
                className="app-input w-full"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold">{t("official.expiryDate")}</span>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="app-input w-full"
              />
            </label>
          </div>

          <div className="rounded-lg border border-app bg-app-card-hover p-3 space-y-3">
            <p className="font-semibold text-app">{t("official.paymentTerms")}</p>
            <label className="block space-y-1">
              <span className="font-semibold">{t("official.advancePercentage")}</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={advancePercentage}
                onChange={(e) => setAdvancePercentage(e.target.value)}
                className="app-input w-full"
                placeholder="30"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold">{t("official.paymentStages")}</span>
              <input
                type="number"
                min="1"
                step="1"
                value={paymentStages}
                onChange={(e) => setPaymentStages(e.target.value)}
                className="app-input w-full"
                placeholder="3"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold">
                {t("official.contractAmount")} ({t("official.optional")})
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className="app-input w-full"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="font-semibold">{t("official.paymentTermsNotes")}</span>
            <textarea
              value={paymentTermsNotes}
              onChange={(e) => setPaymentTermsNotes(e.target.value)}
              rows={2}
              className="app-input w-full resize-none"
            />
          </label>

          <label className="block space-y-1">
            <span className="font-semibold">{t("invoice.voen")}</span>
            <input
              type="text"
              value={partyVoen || ""}
              readOnly
              className="app-input w-full bg-app-card-hover"
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
