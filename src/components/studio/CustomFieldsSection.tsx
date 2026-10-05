"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { StudioField } from "@/lib/studio/fields";

/** Raw form state for custom fields: what the inputs hold, before validation. */
export type CustomFieldDraft = Record<string, string | boolean>;

/** Turns stored values (record.custom_fields) into input state. */
export function draftFromValues(fields: StudioField[], values: unknown): CustomFieldDraft {
  const source = values && typeof values === "object" ? (values as Record<string, unknown>) : {};
  const draft: CustomFieldDraft = {};
  for (const field of fields) {
    const value = source[field.name];
    draft[field.name] = field.field_type === "checkbox" ? value === true : value === null || value === undefined ? "" : String(value);
  }
  return draft;
}

/**
 * Renders the admin-defined Studio fields of a form. Renders nothing when the
 * model has no active fields, so forms look unchanged until an admin adds one.
 */
export default function CustomFieldsSection({
  fields,
  value,
  onChange,
  disabled,
}: {
  fields: StudioField[];
  value: CustomFieldDraft;
  onChange: (next: CustomFieldDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (fields.length === 0) return null;

  const set = (name: string, next: string | boolean) => onChange({ ...value, [name]: next });

  return (
    <fieldset className="space-y-3 rounded-lg border border-app p-3">
      <legend className="px-1 text-xs font-semibold text-app-muted">{t("studio.sectionTitle")}</legend>
      {fields.map((field) => {
        const id = `studio-${field.name}`;
        const current = value[field.name];
        const label = (
          <label htmlFor={id} className="mb-1 block text-xs font-medium text-app">
            {field.label}
            {field.required && field.field_type !== "checkbox" ? " *" : ""}
          </label>
        );
        const help = field.help ? <p className="mt-1 text-[11px] text-app-muted">{field.help}</p> : null;

        if (field.field_type === "checkbox") {
          return (
            <div key={field.name}>
              <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-app">
                <input
                  id={id}
                  type="checkbox"
                  checked={current === true}
                  disabled={disabled}
                  onChange={(e) => set(field.name, e.target.checked)}
                />
                {field.label}
              </label>
              {help}
            </div>
          );
        }

        const text = typeof current === "string" ? current : "";
        let input: React.ReactNode;
        if (field.field_type === "textarea") {
          input = (
            <textarea
              id={id}
              rows={3}
              value={text}
              disabled={disabled}
              required={field.required}
              onChange={(e) => set(field.name, e.target.value)}
              className="app-input"
            />
          );
        } else if (field.field_type === "selection") {
          input = (
            <select
              id={id}
              value={text}
              disabled={disabled}
              required={field.required}
              onChange={(e) => set(field.name, e.target.value)}
              className="app-input"
            >
              <option value="">{t("studio.choose")}</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          );
        } else {
          const type =
            field.field_type === "date"
              ? "date"
              : field.field_type === "url"
                ? "url"
                : field.field_type === "integer" || field.field_type === "decimal" || field.field_type === "money"
                  ? "number"
                  : "text";
          input = (
            <input
              id={id}
              type={type}
              step={field.field_type === "integer" ? 1 : field.field_type === "money" ? 0.01 : "any"}
              value={text}
              disabled={disabled}
              required={field.required}
              onChange={(e) => set(field.name, e.target.value)}
              className="app-input"
            />
          );
        }

        return (
          <div key={field.name}>
            {label}
            {input}
            {help}
          </div>
        );
      })}
    </fieldset>
  );
}
