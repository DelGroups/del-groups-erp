"use client";

import { useActionState, useState } from "react";
import { TENANT_LANGUAGES, TENANT_STATUSES, suggestSlug, type TenantField } from "@/lib/tenants";
import type { TenantFormState } from "./actions";

export interface TenantFormLabels {
  fields: Record<TenantField | "slugHint", string>;
  statuses: Record<string, string>;
  languages: Record<string, string>;
  errors: Record<string, string>;
  save: string;
  saving: string;
  saved: string;
}

type Action = (prev: TenantFormState, formData: FormData) => Promise<TenantFormState>;

export default function TenantForm({
  action,
  initial,
  labels,
  suggestSlugFromName,
}: {
  action: Action;
  initial: Record<string, string>;
  labels: TenantFormLabels;
  /** On a new tenant, fill the slug from the name until the slug is edited by hand. */
  suggestSlugFromName?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {
    status: "idle",
    errors: {},
    formError: null,
    values: initial,
  });
  const values = state.values;
  const [slug, setSlug] = useState(values.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!suggestSlugFromName);

  const error = (field: TenantField) => {
    const key = state.errors[field];
    return key ? (
      <span className="cp-error" id={`${field}-error`}>
        {labels.errors[key] ?? key}
      </span>
    ) : null;
  };
  const invalid = (field: TenantField) => (state.errors[field] ? true : undefined);

  return (
    <form action={formAction} noValidate>
      {state.formError ? (
        <p className="cp-alert cp-alert-error" role="alert">
          {labels.errors[state.formError] ?? state.formError}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p className="cp-alert cp-alert-success" role="status">
          {labels.saved}
        </p>
      ) : null}

      <div className="cp-grid-2">
        <label className="cp-field">
          <span className="erp-label">{labels.fields.name}</span>
          <input
            className="cp-input"
            name="name"
            defaultValue={values.name}
            required
            maxLength={200}
            aria-invalid={invalid("name")}
            onChange={(e) => {
              if (!slugTouched) setSlug(suggestSlug(e.target.value));
            }}
          />
          {error("name")}
        </label>

        <label className="cp-field">
          <span className="erp-label">{labels.fields.slug}</span>
          <input
            className="cp-input"
            name="slug"
            value={slug}
            required
            maxLength={40}
            aria-invalid={invalid("slug")}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
          <span className="cp-hint">{labels.fields.slugHint}</span>
          {error("slug")}
        </label>

        <label className="cp-field">
          <span className="erp-label">{labels.fields.status}</span>
          <select className="cp-input" name="status" defaultValue={values.status || "provisioning"} aria-invalid={invalid("status")}>
            {TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labels.statuses[s]}
              </option>
            ))}
          </select>
          {error("status")}
        </label>

        <label className="cp-field">
          <span className="erp-label">{labels.fields.language}</span>
          <select className="cp-input" name="language" defaultValue={values.language || "az"} aria-invalid={invalid("language")}>
            {TENANT_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {labels.languages[l]}
              </option>
            ))}
          </select>
          {error("language")}
        </label>

        <label className="cp-field">
          <span className="erp-label">{labels.fields.country}</span>
          <input
            className="cp-input"
            name="country"
            defaultValue={values.country || "AZ"}
            maxLength={2}
            aria-invalid={invalid("country")}
          />
          {error("country")}
        </label>

        <label className="cp-field">
          <span className="erp-label">{labels.fields.currency}</span>
          <input
            className="cp-input"
            name="currency"
            defaultValue={values.currency || "AZN"}
            maxLength={3}
            aria-invalid={invalid("currency")}
          />
          {error("currency")}
        </label>
      </div>

      <label className="cp-field">
        <span className="erp-label">{labels.fields.notes}</span>
        <textarea className="cp-input" name="notes" rows={3} defaultValue={values.notes} maxLength={2000} aria-invalid={invalid("notes")} />
        {error("notes")}
      </label>

      <button className="cp-button" type="submit" disabled={pending}>
        {pending ? labels.saving : labels.save}
      </button>
    </form>
  );
}
