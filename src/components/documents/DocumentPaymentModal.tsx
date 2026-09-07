"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CreditCard, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import {
  preflightMessage,
  validateDocumentPaymentPreflight,
} from "@/lib/forms/documentPreflight";
import {
  assertPaymentAccountId,
  PAYMENT_ACCOUNT_REQUIRED_MESSAGE,
} from "@/lib/forms/paymentValidation";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { allocateOfficialPaymentSplit } from "@/lib/finance/vatEngine";
import type { TreasuryPaymentSplit } from "@/lib/finance/officialTransaction";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

interface Account {
  id: string;
  name: string;
  type: string;
  is_vat_account?: boolean | null;
}

export type { TreasuryPaymentSplit } from "@/lib/finance/officialTransaction";

export interface DocumentPaymentPayload {
  amount: number;
  accountId: string;
  method: string;
  notes?: string;
  treasurySplits?: TreasuryPaymentSplit[];
}

interface DocumentPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  documentLabel: string;
  documentNumber: string;
  counterpartyLabel: string;
  counterpartyName: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  isOfficial?: boolean;
  documentSubtotalAmount?: number;
  documentVatAmount?: number;
  onSubmit: (payload: DocumentPaymentPayload) => Promise<{ success: boolean; error?: string }>;
}

export default function DocumentPaymentModal({
  isOpen,
  onClose,
  title,
  documentLabel,
  documentNumber,
  counterpartyLabel,
  counterpartyName,
  totalAmount,
  paidAmount,
  remainingAmount,
  isOfficial = false,
  documentSubtotalAmount = 0,
  documentVatAmount = 0,
  onSubmit,
}: DocumentPaymentModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError: showToastError } = useToast();
  const resolvedTitle = title ?? t("modals.payment.title");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [vatAccountId, setVatAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [useSplitTreasury, setUseSplitTreasury] = useState(false);

  const canSplitTreasury =
    isOfficial && documentVatAmount > 0 && documentSubtotalAmount > 0 && totalAmount > 0;

  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("id, name, type, is_vat_account")
        .order("name");
      const rows = (data as Account[]) || [];
      setAccounts(rows);
      const mainAccount = rows.find((a) => !a.is_vat_account) ?? rows[0];
      const vatAccount = rows.find((a) => a.is_vat_account);
      if (mainAccount) {
        setAccountId(mainAccount.id);
        setMethod(mainAccount.name);
      } else {
        setAccountId("");
        setMethod("");
      }
      setVatAccountId(vatAccount?.id || "");
    })();

    setAmount(remainingAmount > 0 ? remainingAmount.toFixed(2) : "");
    setNotes("");
    setUseSplitTreasury(canSplitTreasury);
  }, [isOpen, remainingAmount, canSplitTreasury]);

  const numericAmount = parseFloat(amount) || 0;
  const splitAmounts = useMemo(() => {
    if (!canSplitTreasury || !useSplitTreasury) {
      return { baseAmount: numericAmount, vatAmount: 0 };
    }
    return allocateOfficialPaymentSplit(
      numericAmount,
      documentSubtotalAmount,
      documentVatAmount,
      totalAmount
    );
  }, [
    canSplitTreasury,
    useSplitTreasury,
    numericAmount,
    documentSubtotalAmount,
    documentVatAmount,
    totalAmount,
  ]);

  const paymentPreflightIssue = useMemo(() => {
    if (useSplitTreasury && canSplitTreasury) {
      if (numericAmount <= 0) return "amount_required" as const;
      if (numericAmount > remainingAmount + 0.001) return "amount_exceeds_remaining" as const;
      if (!accountId) return "account_required" as const;
      if (!vatAccountId) return "vat_account_required" as const;
      return null;
    }
    return validateDocumentPaymentPreflight({
      amount: numericAmount,
      remainingAmount,
      accountId,
    });
  }, [
    accountId,
    canSplitTreasury,
    numericAmount,
    remainingAmount,
    useSplitTreasury,
    vatAccountId,
  ]);

  const paymentPreflightHint = paymentPreflightIssue
    ? paymentPreflightIssue === "vat_account_required"
      ? t("official.vatAccountRequired")
      : preflightMessage(t, paymentPreflightIssue)
    : undefined;

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentPreflightIssue) {
      showToastError(paymentPreflightHint || t("common.error"));
      return;
    }

    setSaving(true);

    if (useSplitTreasury && canSplitTreasury) {
      const mainAccount = accounts.find((a) => a.id === accountId);
      const vatAccount = accounts.find((a) => a.id === vatAccountId);
      const splits: TreasuryPaymentSplit[] = [];

      if (splitAmounts.baseAmount > 0) {
        const baseError = assertPaymentAccountId(accountId);
        if (baseError) {
          setSaving(false);
          showToastError(PAYMENT_ACCOUNT_REQUIRED_MESSAGE);
          return;
        }
        splits.push({
          amount: splitAmounts.baseAmount,
          accountId: accountId.trim(),
          method: mainAccount?.name || method,
          label: t("official.baseAmount"),
          notes: notes.trim() || undefined,
        });
      }

      if (splitAmounts.vatAmount > 0) {
        const vatError = assertPaymentAccountId(vatAccountId);
        if (vatError) {
          setSaving(false);
          showToastError(t("official.vatAccountRequired"));
          return;
        }
        splits.push({
          amount: splitAmounts.vatAmount,
          accountId: vatAccountId.trim(),
          method: vatAccount?.name || t("official.vatAmount"),
          label: t("official.vatAmount"),
          notes: notes.trim() || undefined,
        });
      }

      const result = await onSubmit({
        amount: numericAmount,
        accountId: accountId.trim(),
        method,
        notes: notes.trim() || undefined,
        treasurySplits: splits,
      });
      setSaving(false);

      if (!result.success) {
        showToastError(formatRpcError(result.error || t("modals.payment.paymentFailed"), t));
        return;
      }
      onClose();
      return;
    }

    const accountError = assertPaymentAccountId(accountId);
    if (accountError) {
      setSaving(false);
      showToastError(PAYMENT_ACCOUNT_REQUIRED_MESSAGE);
      return;
    }

    const result = await onSubmit({
      amount: numericAmount,
      accountId: accountId.trim(),
      method,
      notes: notes.trim() || undefined,
    });
    setSaving(false);

    if (!result.success) {
      showToastError(formatRpcError(result.error || t("modals.payment.paymentFailed"), t));
      return;
    }

    onClose();
  };

  const mainAccounts = accounts.filter((a) => !a.is_vat_account);
  const vatAccounts = accounts.filter((a) => a.is_vat_account);

  return (
    <>
    <div className="fixed inset-0 z-[60] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-app">{resolvedTitle}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="rounded-lg border border-app bg-app-card px-4 py-3 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-app-muted">{documentLabel}</span>
              <span className="font-mono font-semibold">{documentNumber}</span>
            </div>
            <div className="mt-1 flex justify-between gap-2">
              <span className="text-app-muted">{counterpartyLabel}</span>
              <span className="font-semibold">{counterpartyName}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-app pt-2 text-center">
              <div>
                <p className="text-[10px] text-app-muted">{t("modals.payment.total")}</p>
                <p className="font-mono font-bold">{totalAmount.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] text-app-muted">{t("modals.payment.paid")}</p>
                <p className="font-mono font-bold text-emerald-600">{paidAmount.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] text-app-muted">{t("modals.payment.remaining")}</p>
                <p className="font-mono font-bold text-rose-600">{remainingAmount.toFixed(2)}</p>
              </div>
            </div>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="font-semibold text-app">{t("modals.payment.amount")}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="app-input w-full"
            />
          </label>

          {canSplitTreasury && (
            <label className="flex items-center gap-2 text-xs font-semibold text-app">
              <input
                type="checkbox"
                checked={useSplitTreasury}
                onChange={(e) => setUseSplitTreasury(e.target.checked)}
              />
              {t("official.splitTreasury")}
            </label>
          )}

          {useSplitTreasury && canSplitTreasury ? (
            <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <div className="space-y-1">
                <span className="font-semibold text-app">{t("official.baseAmount")}</span>
                <p className="font-mono text-lg font-bold">{splitAmounts.baseAmount.toFixed(2)} AZN</p>
                <select
                  value={accountId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setAccountId(nextId);
                    const acc = accounts.find((a) => a.id === nextId);
                    if (acc) setMethod(acc.name);
                  }}
                  className="app-input w-full"
                  required
                >
                  {mainAccounts.length === 0 && (
                    <option value="">{t("forms.paymentAccountRequiredSelect")}</option>
                  )}
                  {mainAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className="font-semibold text-app">{t("official.vatAmount")}</span>
                <p className="font-mono text-lg font-bold text-amber-600">
                  {splitAmounts.vatAmount.toFixed(2)} AZN
                </p>
                <select
                  value={vatAccountId}
                  onChange={(e) => setVatAccountId(e.target.value)}
                  className="app-input w-full"
                  required
                >
                  {vatAccounts.length === 0 && (
                    <option value="">{t("official.noVatAccount")}</option>
                  )}
                  {vatAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <label className="block space-y-1 text-xs">
              <span className="font-semibold text-app">{t("modals.payment.account")}</span>
              <select
                value={accountId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setAccountId(nextId);
                  const acc = accounts.find((a) => a.id === nextId);
                  if (acc) setMethod(acc.name);
                }}
                className="app-input w-full"
                required
              >
                {accounts.length === 0 && (
                  <option value="">{t("forms.paymentAccountRequiredSelect")}</option>
                )}
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                    {acc.is_vat_account ? ` (${t("official.vatAccount")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block space-y-1 text-xs">
            <span className="font-semibold text-app">{t("modals.payment.method")}</span>
            <input
              type="text"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="app-input w-full"
            />
          </label>

          <label className="block space-y-1 text-xs">
            <span className="font-semibold text-app">{t("common.notes")}</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="app-input w-full resize-none"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || Boolean(paymentPreflightIssue)}
              title={paymentPreflightHint}
              className="btn-primary flex items-center gap-1 text-xs disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t("common.saving") : t("modals.payment.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
    <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
