"use client";

import React, { useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { VatMode } from "@/lib/finance/vatEngine";
import {
  fetchContracts,
  type Contract,
  type ContractType,
} from "@/lib/contracts/api";
import ContractQuickCreateModal from "@/components/contracts/ContractQuickCreateModal";

export interface OfficialTransactionSectionProps {
  transactionType: ContractType;
  partyId: string | null;
  partyName?: string;
  partyVoen?: string | null;
  isOfficial: boolean;
  onIsOfficialChange: (value: boolean) => void;
  vatMode: VatMode;
  onVatModeChange: (value: VatMode) => void;
  contractId: string | null;
  onContractIdChange: (value: string | null) => void;
  voenVerification: string;
  onVoenVerificationChange: (value: string) => void;
  onContractCreated?: (contract: Contract) => void;
}

export default function OfficialTransactionSection({
  transactionType,
  partyId,
  partyName,
  partyVoen,
  isOfficial,
  onIsOfficialChange,
  vatMode,
  onVatModeChange,
  contractId,
  onContractIdChange,
  voenVerification,
  onVoenVerificationChange,
  onContractCreated,
}: OfficialTransactionSectionProps) {
  const { t } = useI18n();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
    if (!partyId) {
      setContracts([]);
      onContractIdChange(null);
      return;
    }

    setLoadingContracts(true);
    void fetchContracts({ type: transactionType, partyId, status: "active" }).then((rows) => {
      setContracts(rows);
      setLoadingContracts(false);
      if (contractId && !rows.some((c) => c.id === contractId)) {
        onContractIdChange(null);
      }
    });
  }, [partyId, transactionType, contractId, onContractIdChange]);

  useEffect(() => {
    if (isOfficial && partyVoen && !voenVerification) {
      onVoenVerificationChange(partyVoen);
    }
  }, [isOfficial, partyVoen, voenVerification, onVoenVerificationChange]);

  const handleOfficialChange = (official: boolean) => {
    onIsOfficialChange(official);
    if (!official) {
      onVatModeChange("none");
      onContractIdChange(null);
    } else if (vatMode === "none") {
      onVatModeChange("exclusive");
    }
  };

  return (
    <>
      <div className="app-card space-y-3 p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app pb-2">
          <h3 className="flex items-center gap-1.5 font-bold text-app">
            <FileText className="h-4 w-4 text-app-accent" />
            {t("official.transactionType")}
          </h3>
          <div className="inline-flex overflow-hidden rounded-lg border border-app">
            <button
              type="button"
              onClick={() => handleOfficialChange(false)}
              className={`px-3 py-1.5 font-semibold transition ${
                !isOfficial
                  ? "bg-slate-600 text-white"
                  : "bg-app-card text-app-muted hover:bg-app-card-hover"
              }`}
            >
              {t("official.unofficial")}
            </button>
            <button
              type="button"
              onClick={() => handleOfficialChange(true)}
              className={`px-3 py-1.5 font-semibold transition ${
                isOfficial
                  ? "bg-emerald-600 text-white"
                  : "bg-app-card text-app-muted hover:bg-app-card-hover"
              }`}
            >
              {t("official.official")}
            </button>
          </div>
        </div>

        {isOfficial && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="font-semibold text-app">
                {t("official.contract")} <span className="text-rose-500">*</span>
              </span>
              <div className="flex gap-2">
                <select
                  value={contractId || ""}
                  onChange={(e) => onContractIdChange(e.target.value || null)}
                  className="app-input flex-1"
                  required
                  disabled={!partyId || loadingContracts}
                >
                  <option value="">
                    {!partyId
                      ? t("official.selectPartyFirst")
                      : loadingContracts
                        ? t("common.loading")
                        : t("official.selectContract")}
                  </option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contract_number} — {c.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowQuickCreate(true)}
                  disabled={!partyId}
                  className="btn-secondary flex items-center gap-1 whitespace-nowrap px-2"
                  title={t("official.newContract")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("official.newContract")}
                </button>
              </div>
            </label>

            <label className="block space-y-1">
              <span className="font-semibold text-app">{t("invoice.voen")}</span>
              <input
                type="text"
                value={voenVerification}
                onChange={(e) => onVoenVerificationChange(e.target.value)}
                placeholder={t("official.voenPlaceholder")}
                className="app-input w-full"
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="font-semibold text-app">{t("official.vatMode")}</legend>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-app p-2 hover:bg-app-card-hover">
                <input
                  type="radio"
                  name="vatMode"
                  checked={vatMode === "exclusive"}
                  onChange={() => onVatModeChange("exclusive")}
                />
                <span>{t("official.vatExclusive")}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-app p-2 hover:bg-app-card-hover">
                <input
                  type="radio"
                  name="vatMode"
                  checked={vatMode === "inclusive"}
                  onChange={() => onVatModeChange("inclusive")}
                />
                <span>{t("official.vatInclusive")}</span>
              </label>
            </fieldset>
          </div>
        )}
      </div>

      {showQuickCreate && partyId && (
        <ContractQuickCreateModal
          type={transactionType}
          partyId={partyId}
          partyName={partyName}
          partyVoen={partyVoen}
          onClose={() => setShowQuickCreate(false)}
          onCreated={(contract) => {
            setContracts((prev) => [contract, ...prev]);
            onContractIdChange(contract.id);
            onContractCreated?.(contract);
            setShowQuickCreate(false);
          }}
        />
      )}
    </>
  );
}
