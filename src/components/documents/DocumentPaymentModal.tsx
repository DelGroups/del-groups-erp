"use client";

import React, { useEffect, useState } from "react";
import { CreditCard, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";

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
      }
    })();

    setAmount(remainingAmount > 0 ? remainingAmount.toFixed(2) : "");
    setNotes("");
  }, [isOpen, remainingAmount]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount) || 0;
    if (numericAmount <= 0) {
      alert(t("modals.payment.invalidAmount"));
      return;
    }
    if (numericAmount > remainingAmount + 0.001) {
      alert(t("modals.payment.maxAmount", { amount: remainingAmount.toFixed(2) }));
      return;
    }
    if (!accountId) {
      alert(t("modals.payment.selectAccount"));
      return;
    }

    setSaving(true);
    const result = await onSubmit({
      amount: numericAmount,
      accountId,
      method,
      notes: notes.trim() || undefined,
    });
    setSaving(false);

    if (!result.success) {
      alert(t("common.errorOccurred", { message: result.error || t("modals.payment.paymentFailed") }));
      return;
    }

    onClose();
  };

  return (
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

        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
          <div className="rounded-xl bg-app-card-hover p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-app-muted">{documentLabel}</span>
              <span className="font-mono font-bold text-app-accent">{documentNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">{counterpartyLabel}</span>
              <span className="font-semibold text-app">{counterpartyName || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">{t("modals.payment.total")}</span>
              <span className="font-mono font-bold">{totalAmount.toFixed(2)} {t("common.currency")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">{t("modals.payment.paid")}</span>
              <span className="font-mono text-emerald-600">{paidAmount.toFixed(2)} {t("common.currency")}</span>
            </div>
            <div className="flex justify-between border-t border-app pt-2">
              <span className="font-semibold text-app">{t("modals.payment.remainingDebt")}</span>
              <span className="font-mono font-bold text-rose-600">{remainingAmount.toFixed(2)} {t("common.currency")}</span>
            </div>
          </div>

          <label className="block font-semibold text-app">
            {t("modals.payment.accountLabel")}
            <select
              value={accountId}
              onChange={(e) => {
                const id = e.target.value;
                setAccountId(id);
                const acc = accounts.find((a) => a.id === id);
                if (acc) setMethod(acc.name);
              }}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">{t("common.select")}</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.type})
                </option>
              ))}
            </select>
          </label>

          <label className="block font-semibold text-app">
            {t("modals.payment.amountLabel")}
            <input
              type="number"
              step="0.01"
              min="0"
              max={remainingAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm text-emerald-600"
            />
          </label>

          <label className="block font-semibold text-app">
            {t("common.notes")}
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-app px-4 py-2.5 font-semibold text-app"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || remainingAmount <= 0}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t("common.saving") : t("modals.payment.confirmPayment")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
