"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { createPartnerPaymentAction } from "@/lib/actions/partnerPayments";
import { fetchCashAccountOptions } from "@/lib/payments/fetchPayments";
import type { CashAccountOption, PaymentMethod, PaymentType } from "@/lib/payments/types";
import { fetchPartnerList, partnerDisplayName } from "@/lib/partners/fetchPartners";
import type { PartnerRecord } from "@/lib/partners/types";

type PaymentFormModalProps = {
  open: boolean;
  defaultPartnerId?: string | null;
  defaultPaymentType?: PaymentType;
  onClose: () => void;
  onSaved: () => void;
};

export default function PaymentFormModal({
  open,
  defaultPartnerId,
  defaultPaymentType = "in",
  onClose,
  onSaved,
}: PaymentFormModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [accounts, setAccounts] = useState<CashAccountOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [partnerId, setPartnerId] = useState(defaultPartnerId || "");
  const [paymentType, setPaymentType] = useState<PaymentType>(defaultPaymentType);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashAccountId, setCashAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [referenceNote, setReferenceNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setPartnerId(defaultPartnerId || "");
    setPaymentType(defaultPaymentType);
    setLoading(true);
    void Promise.all([fetchPartnerList(), fetchCashAccountOptions()]).then(([partnerRows, accountRows]) => {
      setPartners(partnerRows);
      setAccounts(accountRows);
      setLoading(false);
    });
  }, [open, defaultPartnerId, defaultPaymentType]);

  const filteredAccounts = useMemo(() => {
    const targetType = paymentMethod === "bank" ? "Bank" : "Kassa";
    const matched = accounts.filter((row) => row.type === targetType);
    return matched.length > 0 ? matched : accounts;
  }, [accounts, paymentMethod]);

  useEffect(() => {
    if (!open || filteredAccounts.length === 0) return;
    if (!cashAccountId || !filteredAccounts.some((row) => row.id === cashAccountId)) {
      setCashAccountId(filteredAccounts[0].id);
    }
  }, [open, filteredAccounts, cashAccountId]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!partnerId) {
      showError(t("payments.partnerRequired"));
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      showError(t("payments.amountRequired"));
      return;
    }
    if (!cashAccountId) {
      showError(t("payments.accountRequired"));
      return;
    }

    setSaving(true);
    const result = await createPartnerPaymentAction({
      partnerId,
      amount: parsedAmount,
      paymentType,
      paymentMethod,
      paymentDate,
      referenceNote: referenceNote.trim() || null,
      cashAccountId,
      idempotencyKey: `ui-payment:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });
    setSaving(false);

    if (!result.success) {
      showError(result.error);
      return;
    }

    showSuccess(t("payments.created"));
    onSaved();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
        <div className="app-modal w-full max-w-lg">
          <div className="flex items-center justify-between border-b border-app px-5 py-4">
            <h3 className="text-sm font-bold text-app">{t("payments.newPayment")}</h3>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
            {loading ? (
              <p className="text-app-muted">{t("common.loading")}</p>
            ) : (
              <>
                <label className="block font-semibold text-app">
                  {t("payments.partner")}
                  <select
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                    className="app-input mt-1 w-full"
                    required
                  >
                    <option value="">{t("payments.selectPartner")}</option>
                    {partners.map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {partnerDisplayName(partner)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block font-semibold text-app">
                    {t("payments.type")}
                    <select
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                      className="app-input mt-1 w-full"
                    >
                      <option value="in">{t("payments.typeIn")}</option>
                      <option value="out">{t("payments.typeOut")}</option>
                    </select>
                  </label>
                  <label className="block font-semibold text-app">
                    {t("payments.method")}
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="app-input mt-1 w-full"
                    >
                      <option value="cash">{t("payments.methodCash")}</option>
                      <option value="bank">{t("payments.methodBank")}</option>
                    </select>
                  </label>
                </div>

                <label className="block font-semibold text-app">
                  {t("payments.cashAccount")}
                  <select
                    value={cashAccountId}
                    onChange={(e) => setCashAccountId(e.target.value)}
                    className="app-input mt-1 w-full"
                    required
                  >
                    {filteredAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.type || account.code})
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block font-semibold text-app">
                    {t("payments.amount")}
                    <input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="app-input mt-1 w-full"
                      required
                    />
                  </label>
                  <label className="block font-semibold text-app">
                    {t("common.date")}
                    <input
                      type="datetime-local"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="app-input mt-1 w-full"
                      required
                    />
                  </label>
                </div>

                <label className="block font-semibold text-app">
                  {t("payments.reference")}
                  <input
                    value={referenceNote}
                    onChange={(e) => setReferenceNote(e.target.value)}
                    className="app-input mt-1 w-full"
                    placeholder={t("payments.referencePlaceholder")}
                  />
                </label>
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-app pt-4">
              <button type="button" onClick={onClose} className="btn-secondary">
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={saving || loading} className="btn-primary">
                <Save className="h-4 w-4" />
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </form>
        </div>
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
