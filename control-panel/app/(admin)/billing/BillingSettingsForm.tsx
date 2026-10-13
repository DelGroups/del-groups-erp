"use client";

import { useActionState } from "react";
import type { SettingsFormState } from "./actions";

type Action = (prev: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

export interface SettingsLabels {
  [key: string]: string;
}

const SELLER = ["seller_name", "seller_tax_id", "seller_address", "seller_email", "seller_phone"] as const;
const BANK = ["bank_name", "bank_code", "bank_tax_id", "bank_swift", "bank_correspondent_account", "bank_account"] as const;
const LABEL_KEY: Record<string, string> = {
  seller_name: "sellerName",
  seller_tax_id: "sellerTaxId",
  seller_address: "sellerAddress",
  seller_email: "sellerEmail",
  seller_phone: "sellerPhone",
  bank_name: "bankName",
  bank_code: "bankCode",
  bank_tax_id: "bankTaxId",
  bank_swift: "bankSwift",
  bank_correspondent_account: "bankCorrespondent",
  bank_account: "bankAccount",
  invoice_prefix: "prefix",
  tax_label: "taxLabel",
  tax_rate_pct: "taxRate",
  payment_terms_days: "paymentTerms",
  grace_days: "grace",
  suspend_after_days: "suspendAfter",
};

export default function BillingSettingsForm({
  action,
  initial,
  labels,
  errorLabels,
}: {
  action: Action;
  initial: Record<string, string>;
  labels: SettingsLabels;
  errorLabels: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle", errors: {}, formError: null });

  const field = (name: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => {
    const err = state.errors[name];
    return (
      <label className="cp-field" key={name}>
        <span className="erp-label">{labels[LABEL_KEY[name]]}</span>
        <input
          className="cp-input"
          name={name}
          defaultValue={initial[name] ?? ""}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${name}-error` : undefined}
          {...props}
        />
        {hint ? <span className="cp-hint">{hint}</span> : null}
        {err ? (
          <span className="cp-error" id={`${name}-error`}>
            {errorLabels[err] ?? err}
          </span>
        ) : null}
      </label>
    );
  };

  return (
    <form action={formAction} noValidate>
      {state.formError ? (
        <p className="cp-alert cp-alert-error" role="alert">
          {errorLabels[state.formError] ?? state.formError}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p className="cp-alert cp-alert-success" role="status">
          {labels.saved}
        </p>
      ) : null}

      <h3 className="erp-label">{labels.seller}</h3>
      <div className="cp-grid-2">{SELLER.map((f) => field(f, { maxLength: f === "seller_address" ? 500 : 200, type: f === "seller_email" ? "email" : "text" }))}</div>

      <h3 className="erp-label">{labels.bank}</h3>
      <div className="cp-grid-2">{BANK.map((f) => field(f, { maxLength: 200 }))}</div>

      <h3 className="erp-label">{labels.numbering}</h3>
      <div className="cp-grid-2">
        {field("invoice_prefix", { maxLength: 10, required: true }, labels.prefixHint)}
        {field("tax_label", { maxLength: 20, required: true })}
        {field("tax_rate_pct", { inputMode: "decimal" })}
      </div>

      <h3 className="erp-label">{labels.dunning}</h3>
      <div className="cp-grid-2">
        {field("payment_terms_days", { type: "number", min: 0, max: 60 }, labels.paymentTermsHint)}
        {field("grace_days", { type: "number", min: 0, max: 90 })}
        {field("suspend_after_days", { type: "number", min: 1, max: 365 })}
      </div>
      <p className="cp-hint">{labels.timeline}</p>

      <button className="cp-button" type="submit" disabled={pending}>
        {pending ? labels.saving : labels.save}
      </button>
    </form>
  );
}
