"use client";

import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { createPartnerAction, updatePartnerAction } from "@/lib/actions/partners";
import type { PartnerFormInput, PartnerRecord } from "@/lib/partners/types";
import { partnerDisplayName } from "@/lib/partners/fetchPartners";

type PartnerFormModalProps = {
  open: boolean;
  partner?: PartnerRecord | null;
  onClose: () => void;
  onSaved: () => void;
};

function toFormInput(partner?: PartnerRecord | null): PartnerFormInput {
  if (!partner) {
    return {
      name: "",
      code: "",
      phone: "",
      email: "",
      voen: "",
      bank_name: "",
      iban: "",
      credit_limit: 0,
      is_customer: true,
      is_supplier: false,
      address: "",
    };
  }
  return {
    name: partnerDisplayName(partner),
    code: partner.code || "",
    phone: partner.phone || "",
    email: partner.email || "",
    voen: partner.voen || "",
    bank_name: partner.bank_name || "",
    iban: partner.iban || "",
    credit_limit: partner.credit_limit || 0,
    is_customer: partner.is_customer,
    is_supplier: partner.is_supplier,
    address: partner.address || "",
  };
}

export default function PartnerFormModal({ open, partner, onClose, onSaved }: PartnerFormModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [form, setForm] = useState<PartnerFormInput>(toFormInput(partner));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(toFormInput(partner));
  }, [open, partner]);

  if (!open) return null;

  const isEdit = Boolean(partner?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showError(t("partners.nameRequired"));
      return;
    }
    if (!form.is_customer && !form.is_supplier) {
      showError(t("partners.roleRequired"));
      return;
    }

    setSaving(true);
    const result = isEdit
      ? await updatePartnerAction(partner!.id, form)
      : await createPartnerAction(form);
    setSaving(false);

    if (!result.success) {
      showError(result.error);
      return;
    }

    showSuccess(isEdit ? t("partners.updated") : t("partners.created"));
    onSaved();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
        <div className="app-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-app bg-app-card px-5 py-4">
            <h3 className="text-sm font-bold text-app">
              {isEdit ? t("partners.editPartner") : t("partners.newPartner")}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-5 text-xs">
            <section className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-app-muted">
                {t("partners.basicDetails")}
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block font-semibold text-app sm:col-span-2">
                  {t("partners.name")} *
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="app-input mt-1"
                  />
                </label>
                <label className="block font-semibold text-app">
                  {t("partners.code")}
                  <input
                    value={form.code || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                    className="app-input mt-1"
                  />
                </label>
                <label className="block font-semibold text-app">
                  {t("partners.phone")}
                  <input
                    value={form.phone || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="app-input mt-1"
                  />
                </label>
                <label className="block font-semibold text-app sm:col-span-2">
                  {t("partners.email")}
                  <input
                    type="email"
                    value={form.email || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    className="app-input mt-1"
                  />
                </label>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-app-muted">
                {t("partners.roles")}
              </h4>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 font-semibold text-app">
                  <input
                    type="checkbox"
                    checked={form.is_customer}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_customer: e.target.checked }))}
                  />
                  {t("partners.customer")}
                </label>
                <label className="inline-flex items-center gap-2 font-semibold text-app">
                  <input
                    type="checkbox"
                    checked={form.is_supplier}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_supplier: e.target.checked }))}
                  />
                  {t("partners.supplier")}
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-app-muted">
                {t("partners.financialDetails")}
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block font-semibold text-app">
                  {t("partners.voen")}
                  <input
                    value={form.voen || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, voen: e.target.value }))}
                    className="app-input mt-1"
                  />
                </label>
                <label className="block font-semibold text-app">
                  {t("partners.creditLimit")}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.credit_limit ?? 0}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, credit_limit: Number(e.target.value) || 0 }))
                    }
                    className="app-input mt-1"
                  />
                </label>
                <label className="block font-semibold text-app">
                  {t("partners.bankName")}
                  <input
                    value={form.bank_name || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, bank_name: e.target.value }))}
                    className="app-input mt-1"
                  />
                </label>
                <label className="block font-semibold text-app">
                  {t("partners.iban")}
                  <input
                    value={form.iban || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, iban: e.target.value }))}
                    className="app-input mt-1"
                  />
                </label>
              </div>
            </section>

            <div className="flex justify-end gap-2 border-t border-app pt-4">
              <button type="button" onClick={onClose} className="btn-secondary">
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
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
