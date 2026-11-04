"use client";

import React, { useDeferredValue, useState } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Combobox, Field, FormGrid } from "@/design-system/components";
import { Drawer } from "@/components/ui/drawer";
import ProductForm from "@/components/products/ProductForm";
import DuplicateNameWarning from "@/components/products/DuplicateNameWarning";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { supabase } from "@/lib/supabase";
import { findSameNameProducts, type NameCheckProduct } from "@/lib/products/duplicateNames";
import { isMetricMeasureUnit, measureUnitLabel, PRODUCT_MEASURE_UNITS } from "@/lib/products/productPriceUnits";
import type { Category, Product, Warehouse } from "@/types/database.types";
import {
  createAccountRecord,
  createCustomer,
  createEmployeeRecord,
  createExpenseCategory,
  createPartnerRecord,
  createConsignmentPartnerRecord,
  createProductCategory,
  createProductRecord,
  createSupplierRecord,
  createWarehouse,
  findProductsByName,
} from "./data";
import { parseOptionalNumber, quickCreatePrefill, validateParty } from "./logic";
import { EntityLookup } from "./EntityLookup";
import { LookupScope } from "./LookupScope";
import { lookupQueryKey, type LookupEntity, type LookupRecord } from "./registry";

export interface QuickCreateDefaults {
  /** Customers / suppliers: start as a legal entity (official documents need a VÖEN). */
  legal?: boolean;
  /** Partners: the roles the new partner starts with (default: customer). */
  partnerRoles?: { customer: boolean; supplier: boolean };
  /** Accounts: Kassa or Bank. */
  accountType?: "Kassa" | "Bank";
}

export interface QuickCreateDialogProps {
  entity: LookupEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What was typed in the search; pre-fills the name (or the phone). */
  query: string;
  defaults?: QuickCreateDefaults;
  onCreated: (record: LookupRecord) => void;
}

type Values = Record<string, string | boolean | null>;

function initialValues(entity: LookupEntity, query: string, defaults?: QuickCreateDefaults): Values {
  const prefill = quickCreatePrefill(query);
  switch (entity) {
    case "customer":
    case "supplier":
    case "consignmentPartner":
      return { fullName: prefill.name, companyName: "", phone: prefill.phone, voen: "", address: "", legal: Boolean(defaults?.legal) };
    case "partner":
      return {
        fullName: prefill.name,
        phone: prefill.phone,
        voen: "",
        address: "",
        isCustomer: defaults?.partnerRoles ? defaults.partnerRoles.customer : true,
        isSupplier: defaults?.partnerRoles ? defaults.partnerRoles.supplier : false,
      };
    case "product":
      return { name: query.trim(), code: "", unit: "Ədəd", category: "", categoryId: null, sheetLength: "4", sellPrice: "" };
    case "warehouse":
      return { name: query.trim(), code: "", location: "" };
    case "account":
      return { name: query.trim(), accountType: defaults?.accountType ?? "Kassa" };
    case "employee":
      return { fullName: prefill.name, role: "", phone: prefill.phone };
    default:
      return { name: query.trim() };
  }
}

/**
 * Quick-create of one record from inside a form (UI-2 lookups): a Radix dialog (focus trap,
 * Esc, works over another dialog), the minimum fields of the entity, the same validation and
 * write path as the full page. On save the record is created, every lookup of the entity is
 * refreshed, the dialog closes and the caller selects the record; the form underneath is never
 * reset. Products also get the duplicate-name warning (F4) and a link to the full product form,
 * which opens in a drawer over the current form.
 */
export function QuickCreateDialog({ entity, open, onOpenChange, query, defaults, onCreated }: QuickCreateDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(() => initialValues(entity, query, defaults));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fullForm, setFullForm] = useState(false);

  // Every time it opens it starts from what was typed (state adjusted during render, no effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValues(initialValues(entity, query, defaults));
      setError(null);
    }
  }

  const set = (patch: Values) => setValues((prev) => ({ ...prev, ...patch }));
  const str = (key: string) => String(values[key] ?? "");
  const title = t(`lookup.create.${entity}`);

  const finish = (record: LookupRecord) => {
    void queryClient.invalidateQueries({ queryKey: lookupQueryKey(entity) });
    toast.success(t("lookup.created", { name: String(record.name ?? record.full_name ?? record.company_name ?? "") }));
    onOpenChange(false);
    onCreated(record);
  };

  const submit = async () => {
    if (saving) return;
    setError(null);
    let invalid: string | null = null;
    if (entity === "consignmentPartner") {
      invalid = str("fullName").trim() ? null : "lookup.errors.nameRequired";
    } else if (entity === "customer" || entity === "supplier") {
      invalid = validateParty({ fullName: str("fullName"), companyName: str("companyName"), phone: str("phone"), voen: str("voen"), legal: Boolean(values.legal) });
    } else if (entity === "partner") {
      invalid = !str("fullName").trim() ? "lookup.errors.nameRequired" : !values.isCustomer && !values.isSupplier ? "lookup.errors.roleRequired" : null;
    } else if (entity === "employee") {
      invalid = str("fullName").trim() ? null : "lookup.errors.nameRequired";
    } else if (!str("name").trim()) {
      invalid = "lookup.errors.nameRequired";
    }
    if (invalid) {
      setError(t(invalid));
      return;
    }
    setSaving(true);
    try {
      const party = { fullName: str("fullName"), companyName: str("companyName"), phone: str("phone"), voen: str("voen"), legal: Boolean(values.legal), address: str("address") };
      const result =
        entity === "customer"
          ? await createCustomer(party)
          : entity === "supplier"
            ? await createSupplierRecord(party)
            : entity === "consignmentPartner"
              ? await createConsignmentPartnerRecord({ name: str("fullName"), companyName: str("companyName"), phone: str("phone"), voen: str("voen"), address: str("address") })
            : entity === "partner"
              ? await createPartnerRecord({ name: str("fullName"), phone: str("phone"), voen: str("voen"), address: str("address"), isCustomer: Boolean(values.isCustomer), isSupplier: Boolean(values.isSupplier) })
            : entity === "product"
              ? await createProductRecord({
                  name: str("name"),
                  code: str("code"),
                  unit: str("unit") || "Ədəd",
                  category: str("category"),
                  categoryId: (values.categoryId as string | null) ?? null,
                  sheetLength: parseOptionalNumber(str("sheetLength")),
                  sellPrice: parseOptionalNumber(str("sellPrice")),
                })
              : entity === "warehouse"
                ? await createWarehouse({ name: str("name"), code: str("code"), location: str("location") })
                : entity === "account"
                  ? await createAccountRecord({ name: str("name"), type: str("accountType") === "Bank" ? "Bank" : "Kassa" })
                  : entity === "employee"
                    ? await createEmployeeRecord({ fullName: str("fullName"), role: str("role"), phone: str("phone") })
                    : entity === "expenseCategory"
                      ? await createExpenseCategory({ name: str("name") })
                      : await createProductCategory({ name: str("name") });
      if (!result.ok) {
        const duplicate = "duplicate" in result && result.duplicate;
        setError(duplicate ? t("lookup.errors.duplicate") : t("lookup.errors.failed", { message: result.error }));
        return;
      }
      finish(result.record);
    } catch (e) {
      setError(t("lookup.errors.failed", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
        <Dialog.Portal>
          <LookupScope className="ds-lookup-dialog-scope">
            <Dialog.Overlay className="ds-overlay ds-lookup-overlay" />
            <Dialog.Content
              className="ds-panel ds-lookup-dialog"
              onEscapeKeyDown={(e) => {
                // Esc closes only this dialog, never a dialog underneath.
                e.stopPropagation();
              }}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // A form inside another form: never submit the outer one.
                  e.stopPropagation();
                  void submit();
                }}
                className="flex flex-col gap-4"
                noValidate
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Dialog.Title className="truncate text-[length:var(--ds-text-lg)] font-semibold">{title}</Dialog.Title>
                    <Dialog.Description className="ds-muted text-[length:var(--ds-text-xs)]">{t("lookup.dialogHint")}</Dialog.Description>
                  </div>
                </div>

                {entity === "customer" || entity === "supplier" ? (
                  <PartyFields values={values} set={set} />
                ) : entity === "consignmentPartner" ? (
                  <PartyFields values={values} set={set} withLegal={false} />
                ) : entity === "partner" ? (
                  <PartnerFields values={values} set={set} />
                ) : entity === "product" ? (
                  <ProductFields values={values} set={set} onFullForm={() => { onOpenChange(false); setFullForm(true); }} />
                ) : entity === "warehouse" ? (
                  <FormGrid columns={2}>
                    <Field label={t("lookup.fields.name")} required span={2}>
                      {({ id }) => <input id={id} className="ds-input w-full" value={str("name")} onChange={(e) => set({ name: e.target.value })} autoFocus />}
                    </Field>
                    <Field label={t("lookup.fields.code")}>
                      {({ id }) => <input id={id} className="ds-input w-full" value={str("code")} placeholder={t("lookup.fields.codeAuto")} onChange={(e) => set({ code: e.target.value })} />}
                    </Field>
                    <Field label={t("lookup.fields.location")}>
                      {({ id }) => <input id={id} className="ds-input w-full" value={str("location")} onChange={(e) => set({ location: e.target.value })} />}
                    </Field>
                  </FormGrid>
                ) : entity === "account" ? (
                  <FormGrid columns={2}>
                    <Field label={t("lookup.fields.name")} required span={2}>
                      {({ id }) => <input id={id} className="ds-input w-full" value={str("name")} onChange={(e) => set({ name: e.target.value })} autoFocus />}
                    </Field>
                    <Field label={t("lookup.fields.accountType")}>
                      {({ id }) => (
                        <Combobox
                          id={id}
                          value={str("accountType") || "Kassa"}
                          onChange={(next) => set({ accountType: next ?? "Kassa" })}
                          options={[
                            { value: "Kassa", label: t("lookup.fields.cash") },
                            { value: "Bank", label: t("lookup.fields.bank") },
                          ]}
                          labels={comboboxLabels(t)}
                          clearable={false}
                          width="full"
                        />
                      )}
                    </Field>
                  </FormGrid>
                ) : entity === "employee" ? (
                  <FormGrid columns={2}>
                    <Field label={t("lookup.fields.fullName")} required span={2}>
                      {({ id }) => <input id={id} className="ds-input w-full" value={str("fullName")} onChange={(e) => set({ fullName: e.target.value })} autoFocus />}
                    </Field>
                    <Field label={t("lookup.fields.role")}>
                      {({ id }) => <input id={id} className="ds-input w-full" value={str("role")} onChange={(e) => set({ role: e.target.value })} />}
                    </Field>
                    <Field label={t("lookup.fields.phone")}>
                      {({ id }) => <input id={id} className="ds-input w-full" inputMode="tel" value={str("phone")} onChange={(e) => set({ phone: e.target.value })} />}
                    </Field>
                  </FormGrid>
                ) : (
                  <Field label={t("lookup.fields.name")} required>
                    {({ id }) => <input id={id} className="ds-input w-full" value={str("name")} onChange={(e) => set({ name: e.target.value })} autoFocus />}
                  </Field>
                )}

                {error ? (
                  <p className="ds-field-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <button type="button" className="ds-btn" disabled={saving}>
                      {t("common.cancel")}
                    </button>
                  </Dialog.Close>
                  <button type="submit" className="ds-btn ds-btn-primary" disabled={saving} aria-busy={saving || undefined}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                    {saving ? t("lookup.saving") : t("lookup.saveAndSelect")}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </LookupScope>
        </Dialog.Portal>
      </Dialog.Root>
      {entity === "product" && fullForm ? (
        <FullProductFormDrawer
          name={str("name")}
          onClose={() => setFullForm(false)}
          onCreated={(product) => {
            setFullForm(false);
            void queryClient.invalidateQueries({ queryKey: lookupQueryKey("product") });
            onCreated(product as unknown as LookupRecord);
          }}
        />
      ) : null}
    </>
  );
}

function PartyFields({ values, set, withLegal = true }: { values: Values; set: (patch: Values) => void; withLegal?: boolean }) {
  const { t } = useI18n();
  const str = (key: string) => String(values[key] ?? "");
  const legal = Boolean(values.legal);
  return (
    <FormGrid columns={2}>
      <Field label={t("lookup.fields.fullName")} required span={2}>
        {({ id }) => <input id={id} className="ds-input w-full" value={str("fullName")} onChange={(e) => set({ fullName: e.target.value })} autoFocus />}
      </Field>
      <Field label={t("lookup.fields.phone")}>
        {({ id }) => <input id={id} className="ds-input w-full" inputMode="tel" value={str("phone")} onChange={(e) => set({ phone: e.target.value })} />}
      </Field>
      <Field label={t("lookup.fields.companyName")} required={legal}>
        {({ id }) => <input id={id} className="ds-input w-full" value={str("companyName")} onChange={(e) => set({ companyName: e.target.value })} />}
      </Field>
      {withLegal ? (
      <div className="flex items-center gap-2 @md:col-span-2">
        <input id="lookup-party-legal" type="checkbox" checked={legal} onChange={(e) => set({ legal: e.target.checked })} />
        <label htmlFor="lookup-party-legal" className="truncate">
          {t("lookup.fields.legal")}
        </label>
      </div>
      ) : null}
      <Field label={t("lookup.fields.voen")} required={legal}>
        {({ id }) => <input id={id} className="ds-input ds-mono w-full" inputMode="numeric" value={str("voen")} onChange={(e) => set({ voen: e.target.value })} />}
      </Field>
      <Field label={t("lookup.fields.address")}>
        {({ id }) => <input id={id} className="ds-input w-full" value={str("address")} onChange={(e) => set({ address: e.target.value })} />}
      </Field>
    </FormGrid>
  );
}

function PartnerFields({ values, set }: { values: Values; set: (patch: Values) => void }) {
  const { t } = useI18n();
  const str = (key: string) => String(values[key] ?? "");
  return (
    <FormGrid columns={2}>
      <Field label={t("lookup.fields.fullName")} required span={2}>
        {({ id }) => <input id={id} className="ds-input w-full" value={str("fullName")} onChange={(e) => set({ fullName: e.target.value })} autoFocus />}
      </Field>
      <Field label={t("lookup.fields.phone")}>
        {({ id }) => <input id={id} className="ds-input w-full" inputMode="tel" value={str("phone")} onChange={(e) => set({ phone: e.target.value })} />}
      </Field>
      <Field label={t("lookup.fields.voen")}>
        {({ id }) => <input id={id} className="ds-input ds-mono w-full" inputMode="numeric" value={str("voen")} onChange={(e) => set({ voen: e.target.value })} />}
      </Field>
      <Field label={t("lookup.fields.address")} span={2}>
        {({ id }) => <input id={id} className="ds-input w-full" value={str("address")} onChange={(e) => set({ address: e.target.value })} />}
      </Field>
      <div className="flex flex-wrap items-center gap-4 @md:col-span-2" role="group" aria-label={t("lookup.fields.roles")}>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={Boolean(values.isCustomer)} onChange={(e) => set({ isCustomer: e.target.checked })} />
          {t("lookup.fields.isCustomer")}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={Boolean(values.isSupplier)} onChange={(e) => set({ isSupplier: e.target.checked })} />
          {t("lookup.fields.isSupplier")}
        </label>
      </div>
    </FormGrid>
  );
}

function ProductFields({ values, set, onFullForm }: { values: Values; set: (patch: Values) => void; onFullForm: () => void }) {
  const { t } = useI18n();
  const str = (key: string) => String(values[key] ?? "");
  const unit = str("unit") || "Ədəd";
  const metric = isMetricMeasureUnit(unit);
  const deferredName = useDeferredValue(str("name"));
  const sameName = useQuery({
    queryKey: ["lookup", "product", "sameName", deferredName.trim().toLocaleLowerCase("az")],
    queryFn: () => findProductsByName(deferredName),
    enabled: deferredName.trim().length > 1,
    staleTime: 10_000,
  });
  const duplicates = findSameNameProducts(deferredName, (sameName.data ?? []) as unknown as NameCheckProduct[]);
  return (
    <div className="flex flex-col gap-3">
      <FormGrid columns={2}>
        <Field label={t("lookup.fields.name")} required span={2}>
          {({ id }) => <input id={id} className="ds-input w-full" value={str("name")} onChange={(e) => set({ name: e.target.value })} autoFocus />}
        </Field>
        <Field label={t("lookup.fields.code")}>
          {({ id }) => <input id={id} className="ds-input ds-mono w-full" value={str("code")} placeholder={t("lookup.fields.codeAuto")} onChange={(e) => set({ code: e.target.value })} />}
        </Field>
        <Field label={t("lookup.fields.unit")}>
          {({ id }) => (
            <Combobox
              id={id}
              value={unit}
              onChange={(next) => set({ unit: next ?? "Ədəd" })}
              options={PRODUCT_MEASURE_UNITS.map((u) => ({ value: u, label: measureUnitLabel(u) }))}
              labels={comboboxLabels(t)}
              clearable={false}
              width="full"
            />
          )}
        </Field>
        <Field label={t("lookup.fields.category")}>
          {({ id }) => (
            <CategoryPicker id={id} value={(values.categoryId as string | null) ?? null} onChange={(categoryId, name) => set({ categoryId, category: name })} />
          )}
        </Field>
        {metric ? (
          <Field label={t("lookup.fields.sheetLength")} hint={t("lookup.hints.sheetLength")}>
            {({ id, describedBy }) => (
              <input id={id} aria-describedby={describedBy} className="ds-input ds-mono w-full tabular-nums" inputMode="decimal" value={str("sheetLength")} onChange={(e) => set({ sheetLength: e.target.value })} />
            )}
          </Field>
        ) : null}
        <Field label={t("lookup.fields.sellPrice")}>
          {({ id }) => (
            <input id={id} className="ds-input ds-mono w-full tabular-nums" inputMode="decimal" placeholder="0.00" value={str("sellPrice")} onChange={(e) => set({ sellPrice: e.target.value })} />
          )}
        </Field>
      </FormGrid>
      <DuplicateNameWarning products={duplicates} />
      <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm self-start" onClick={onFullForm}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        {t("lookup.openFullForm")}
      </button>
    </div>
  );
}

/** Product category: a lookup of its own, so a missing category is created in place as well. */
/** Top-level product category, with its own "+ New category" (a nested quick-create). */
function CategoryPicker({ id, value, onChange }: { id: string; value: string | null; onChange: (id: string | null, name: string) => void }) {
  const { t } = useI18n();
  return (
    <EntityLookup
      id={id}
      entity="productCategory"
      value={value}
      where={{ parent_id: null }}
      placeholder={t("lookup.fields.categoryDefault")}
      onChange={(next, record) => onChange(next, record ? String(record.name ?? "") : "")}
    />
  );
}

/** The full product form in a drawer over the current form; the created product is selected. */
function FullProductFormDrawer({ name, onClose, onCreated }: { name: string; onClose: () => void; onCreated: (product: Product) => void }) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const refs = useQuery({
    queryKey: ["lookup", "product", "fullFormRefs"],
    queryFn: async () => {
      const [categories, warehouses] = await Promise.all([
        supabase.from("categories").select("*").order("name"),
        supabase.from("warehouses").select("*").order("name"),
      ]);
      return { categories: (categories.data ?? []) as Category[], warehouses: (warehouses.data ?? []) as Warehouse[] };
    },
  });
  const formId = "lookup-full-product-form";
  if (typeof document === "undefined") return null;
  return createPortal(
    // Above any dialog it opens from (layers.css); the drawer itself is z 50 inside this layer.
    <div style={{ position: "relative", zIndex: "calc(var(--ds-z-modal-nested) + 8)" as unknown as number }}>
      <Drawer
        open
        onClose={onClose}
        title={t("lookup.create.product")}
        className="sm:max-w-[min(44rem,96vw)]"
        headerActions={
          <button type="submit" form={formId} className="btn-primary" disabled={saving || !refs.data}>
            {saving ? t("lookup.saving") : t("lookup.saveAndSelect")}
          </button>
        }
      >
        {refs.data ? (
          <ProductForm
            formId={formId}
            categories={refs.data.categories}
            warehouses={refs.data.warehouses}
            initialProduct={name ? ({ name } as Product) : null}
            embedded
            onCancel={onClose}
            onSavingChange={setSaving}
            onSuccess={(created) => {
              if (created) onCreated(created);
              else onClose();
            }}
          />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-label={t("common.loading")} />
        )}
      </Drawer>
    </div>,
    document.body
  );
}
