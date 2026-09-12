"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Drawer, DrawerFooter } from "@/components/ui/drawer";
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
        <div>
          <label className="mb-2 block text-xs font-medium text-app">
            {t("customers.entityType")}
          </label>
          <div className="inline-flex overflow-hidden rounded-lg border border-app">
            <button
              type="button"
              onClick={() => onEntityTypeChange("physical")}
              className={`px-3 py-1.5 text-xs font-semibold ${
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
              className={`px-3 py-1.5 text-xs font-semibold ${
                formData.entity_type === "legal"
                  ? "bg-emerald-600 text-white"
                  : "bg-app-card text-app-muted"
              }`}
            >
              {t("customers.entityLegal")}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-app">
            {t("suppliers.codeOptional")}
          </label>
          <input
            type="text"
            name="code"
            placeholder={t("suppliers.codePlaceholder")}
            value={formData.code}
            onChange={onInputChange}
            className="app-input"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-app">
            {t("suppliers.contactPerson")}
          </label>
          <input
            type="text"
            name="full_name"
            required
            placeholder={t("suppliers.contactPlaceholder")}
            value={formData.full_name}
            onChange={onInputChange}
            className="app-input"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-app">
            {t("common.companyName")}
            {formData.entity_type === "legal" ? " *" : ""}
          </label>
          <input
            type="text"
            name="company_name"
            required={formData.entity_type === "legal"}
            placeholder={t("suppliers.companyPlaceholder")}
            value={formData.company_name}
            onChange={onInputChange}
            className="app-input"
          />
        </div>

        {formData.entity_type === "legal" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-app">
                {t("invoice.voen")} *
              </label>
              <input
                type="text"
                name="voen"
                required
                value={formData.voen}
                onChange={onInputChange}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-app">
                {t("invoice.addressLabel")}
              </label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={onInputChange}
                className="app-input"
              />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-app">
            {t("common.contactPhone")}
          </label>
          <input
            type="text"
            name="phone"
            placeholder={t("suppliers.phonePlaceholder")}
            value={formData.phone}
            onChange={onInputChange}
            className="app-input"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-app">
            {t("suppliers.initialDebt")}
          </label>
          <input
            type="number"
            step="0.01"
            name="balance"
            value={formData.balance}
            onChange={onInputChange}
            className="app-input"
          />
        </div>
      </form>
    </Drawer>
  );
}
