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
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

interface Account {
  id: string;
  name: string;
  type: string;
}

export interface DocumentPaymentPayload {
  amount: number;
  accountId: string;
  method: string;
  notes?: string;
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
  onSubmit,
}: DocumentPaymentModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError: showToastError } = useToast();
  const resolvedTitle = title ?? t("modals.payment.title");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      const { data } = await supabase.from("accounts").select("id, name, type").order("name");
      const rows = (data as Account[]) || [];
      setAccounts(rows);
      if (rows[0]) {
        setAccountId(rows[0].id);
        setMethod(rows[0].name);
      } else {
        setAccountId("");
        setMethod("");
      }
    })();

    setAmount(remainingAmount > 0 ? remainingAmount.toFixed(2) : "");
    setNotes("");
  }, [isOpen, remainingAmount]);

  const numericAmount = parseFloat(amount) || 0;
  const paymentPreflightIssue = useMemo(
    () =>
      validateDocumentPaymentPreflight({
        amount: numericAmount,
        remainingAmount,
        accountId,
      }),
    [accountId, numericAmount, remainingAmount]
  );
  const paymentPreflightHint = paymentPreflightIssue
    ? preflightMessage(t, paymentPreflightIssue)
    : undefined;

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentPreflightIssue) {
      showToastError(paymentPreflightHint || t("common.error"));
      return;
    }

    const accountError = assertPaymentAccountId(accountId);
    if (accountError) {
      showToastError(PAYMENT_ACCOUNT_REQUIRED_MESSAGE);
      return;
    }

    setSaving(true);
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
                </option>
              ))}
            </select>
          </label>

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
