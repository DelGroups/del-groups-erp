"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Drawer, DrawerFooter } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { formInputClass } from "@/components/ui/form-field-styles";
import type { EntityType } from "@/lib/customers/entityType";

export const SUPPLIER_FORM_ID = "supplier-form";

export interface SupplierFormValues {
  code: string;
  full_name: string;
  phone: string;
  company_name: string;
  address: string;
  voen: string;
  entity_type: EntityType;
  balance: string;
}

interface SupplierFormDrawerProps {
  open: boolean;
  editing: boolean;
  formData: SupplierFormValues;
  saving: boolean;
  onClose: () => void;
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onEntityTypeChange: (entityType: EntityType) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export default function SupplierFormDrawer({
  open,
  editing,
  formData,
  saving,
  onClose,
  onInputChange,
  onEntityTypeChange,
  onSubmit,
}: SupplierFormDrawerProps) {
  const { t } = useI18n();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? t("common.edit") : t("suppliers.addModalTitle")}
      footer={
        <DrawerFooter
          formId={SUPPLIER_FORM_ID}
          onCancel={onClose}
          submitLabel={saving ? t("common.saving") : t("common.save")}
          submitDisabled={saving}
        />
      }
    >
      <form id={SUPPLIER_FORM_ID} onSubmit={onSubmit} className="space-y-4">
        <FormField label={t("customers.entityType")}>
          <div className="inline-flex overflow-hidden rounded-lg border border-app">
            <button
              type="button"
              onClick={() => onEntityTypeChange("physical")}
              className={`px-3 py-2 text-sm font-semibold ${
                formData.entity_type === "physical"
                  ? "bg-slate-600 text-white"
                  : "bg-app-card text-app-muted"
              }`}
            >
              {t("customers.entityPhysical")}
            </button>
            <button
              type="button"
              onClick={() => onEntityTypeChange("legal")}
              className={`px-3 py-2 text-sm font-semibold ${
                formData.entity_type === "legal"
                  ? "bg-emerald-600 text-white"
                  : "bg-app-card text-app-muted"
              }`}
            >
              {t("customers.entityLegal")}
            </button>
          </div>
        </FormField>

        <FormField label={t("suppliers.codeOptional")}>
          <input
            type="text"
            name="code"
            placeholder={t("suppliers.codePlaceholder")}
            value={formData.code}
            onChange={onInputChange}
            className={formInputClass}
          />
        </FormField>

        <FormField label={t("suppliers.contactPerson")} required>
          <input
            type="text"
            name="full_name"
            required
            placeholder={t("suppliers.contactPlaceholder")}
            value={formData.full_name}
            onChange={onInputChange}
            className={formInputClass}
          />
        </FormField>

        <FormField
          label={t("common.companyName")}
          required={formData.entity_type === "legal"}
        >
          <input
            type="text"
            name="company_name"
            required={formData.entity_type === "legal"}
            placeholder={t("suppliers.companyPlaceholder")}
            value={formData.company_name}
            onChange={onInputChange}
            className={formInputClass}
          />
        </FormField>

        {formData.entity_type === "legal" && (
          <>
            <FormField label={t("invoice.voen")} required>
              <input
                type="text"
                name="voen"
                required
                value={formData.voen}
                onChange={onInputChange}
                className={formInputClass}
              />
            </FormField>
            <FormField label={t("invoice.addressLabel")}>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={onInputChange}
                className={formInputClass}
              />
            </FormField>
          </>
        )}

        <FormField label={t("common.contactPhone")}>
          <input
            type="text"
            name="phone"
            placeholder={t("suppliers.phonePlaceholder")}
            value={formData.phone}
            onChange={onInputChange}
            className={formInputClass}
          />
        </FormField>

        <FormField label={t("suppliers.initialDebt")}>
          <input
            type="number"
            step="0.01"
            name="balance"
            value={formData.balance}
            onChange={onInputChange}
            className={formInputClass}
          />
        </FormField>
      </form>
    </Drawer>
  );
}
