"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState, RunResult } from "./actions";

type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;
const IDLE: FormState = { status: "idle", errors: {}, formError: null };

function Alerts({ state, saved, errors }: { state: FormState; saved: string; errors: Record<string, string> }) {
  return (
    <>
      {state.formError ? (
        <p className="cp-alert cp-alert-error" role="alert">
          {errors[state.formError] ?? state.formError}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p className="cp-alert cp-alert-success" role="status">
          {saved}
        </p>
      ) : null}
    </>
  );
}

function FieldError({ state, name, errors }: { state: FormState; name: string; errors: Record<string, string> }) {
  const key = state.errors[name];
  return key ? (
    <span className="cp-error" id={`${name}-error`}>
      {errors[key] ?? key}
    </span>
  ) : null;
}

// ── Contact, automatic billing, payment method ─────────────────────────────

export function TenantBillingForm({
  action,
  initial,
  hasSubscription,
  exempt,
  providers,
  labels,
  errors,
}: {
  action: FormAction;
  initial: { billing_email: string; billing_tax_id: string; billing_address: string; billing_paused_until: string; auto_billing: boolean; payment_provider: string };
  hasSubscription: boolean;
  exempt: boolean;
  providers: { id: string; label: string }[];
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const input = (name: keyof typeof initial, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      className="cp-input"
      name={name}
      defaultValue={String(initial[name] ?? "")}
      aria-invalid={state.errors[name] ? true : undefined}
      aria-describedby={state.errors[name] ? `${name}-error` : undefined}
      {...props}
    />
  );
  return (
    <form action={formAction} noValidate>
      <Alerts state={state} saved={labels.saved} errors={errors} />
      <h3 className="erp-label">{labels.contact}</h3>
      <div className="cp-grid-2">
        <label className="cp-field">
          <span className="erp-label">{labels.email}</span>
          {input("billing_email", { type: "email", maxLength: 200 })}
          <span className="cp-hint">{labels.emailHint}</span>
          <FieldError state={state} name="billing_email" errors={errors} />
        </label>
        <label className="cp-field">
          <span className="erp-label">{labels.taxId}</span>
          {input("billing_tax_id", { maxLength: 40 })}
          <FieldError state={state} name="billing_tax_id" errors={errors} />
        </label>
        <label className="cp-field">
          <span className="erp-label">{labels.address}</span>
          {input("billing_address", { maxLength: 500 })}
          <FieldError state={state} name="billing_address" errors={errors} />
        </label>
        <label className="cp-field">
          <span className="erp-label">{labels.pausedUntil}</span>
          {input("billing_paused_until", { type: "date" })}
          <span className="cp-hint">{labels.pausedHint}</span>
          <FieldError state={state} name="billing_paused_until" errors={errors} />
        </label>
      </div>

      <h3 className="erp-label">{labels.automation}</h3>
      {!hasSubscription ? (
        <p className="cp-muted">{labels.noSubscription}</p>
      ) : (
        <div className="cp-grid-2">
          <label className="cp-field">
            <span>
              <input type="checkbox" name="auto_billing" defaultChecked={initial.auto_billing} disabled={exempt} /> {labels.autoBilling}
            </span>
            <span className="cp-hint">{exempt ? labels.exempt : labels.autoBillingHint}</span>
          </label>
          <label className="cp-field">
            <span className="erp-label">{labels.provider}</span>
            <select
              className="cp-input"
              name="payment_provider"
              defaultValue={initial.payment_provider}
              aria-invalid={state.errors.payment_provider ? true : undefined}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <FieldError state={state} name="payment_provider" errors={errors} />
          </label>
        </div>
      )}
      <button className="cp-button" type="submit" disabled={pending}>
        {pending ? labels.saving : labels.save}
      </button>
    </form>
  );
}

// ── Run billing now ─────────────────────────────────────────────────────────

export function RunBillingButton({
  run,
  labels,
}: {
  run: () => Promise<RunResult>;
  labels: { runNow: string; running: string; runHint: string; runDone: string; runFailed: string; unchanged: string; statuses: Record<string, string> };
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RunResult | null>(null);
  const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
  return (
    <div>
      <p className="cp-hint">{labels.runHint}</p>
      <button className="cp-button cp-button-secondary" type="button" disabled={pending} onClick={() => start(async () => setResult(await run()))}>
        {pending ? labels.running : labels.runNow}
      </button>
      {result ? (
        result.ok ? (
          <p className="cp-alert cp-alert-success" role="status">
            {fill(labels.runDone, {
              issued: result.issued.length ? result.issued.join(", ") : "0",
              status: result.status ? (labels.statuses[result.status] ?? result.status) : labels.unchanged,
            })}
          </p>
        ) : (
          <p className="cp-alert cp-alert-error" role="alert">
            {fill(labels.runFailed, { error: result.error ?? "" })}
          </p>
        )
      ) : null}
    </div>
  );
}

// ── An open invoice: record a payment, or void it ───────────────────────────

export function InvoiceActions({
  action,
  voidAction,
  owed,
  today,
  number,
  labels,
  methods,
  errors,
}: {
  action: FormAction;
  voidAction: () => Promise<void>;
  owed: string;
  today: string;
  number: string;
  labels: Record<string, string>;
  methods: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [voiding, startVoid] = useTransition();

  if (state.status === "saved") return <span className="cp-badge cp-badge-success">{labels.recorded}</span>;
  return (
    <div>
      {!open ? (
        <span style={{ display: "inline-flex", gap: "var(--erp-space-2)", flexWrap: "wrap" }}>
          <button className="cp-button cp-button-secondary" type="button" onClick={() => setOpen(true)}>
            {labels.recordPayment}
          </button>
          {confirming ? (
            <>
              <span>{labels.voidConfirm.replace("{number}", number)}</span>
              <button className="cp-button" type="button" disabled={voiding} onClick={() => startVoid(() => voidAction())}>
                {labels.voidInvoice}
              </button>
              <button className="cp-button cp-button-secondary" type="button" onClick={() => setConfirming(false)}>
                {labels.cancel}
              </button>
            </>
          ) : (
            <button className="cp-button cp-button-secondary" type="button" onClick={() => setConfirming(true)}>
              {labels.voidInvoice}
            </button>
          )}
        </span>
      ) : (
        <form action={formAction} noValidate>
          <Alerts state={state} saved={labels.recorded} errors={errors} />
          <div className="cp-grid-2">
            <label className="cp-field">
              <span className="erp-label">{labels.amount}</span>
              <input className="cp-input" name="amount" defaultValue={owed} inputMode="decimal" aria-invalid={state.errors.amount ? true : undefined} />
              <FieldError state={state} name="amount" errors={errors} />
            </label>
            <label className="cp-field">
              <span className="erp-label">{labels.paidOn}</span>
              <input className="cp-input" name="paid_on" type="date" defaultValue={today} max={today} aria-invalid={state.errors.paid_on ? true : undefined} />
              <FieldError state={state} name="paid_on" errors={errors} />
            </label>
            <label className="cp-field">
              <span className="erp-label">{labels.method}</span>
              <select className="cp-input" name="method" defaultValue="bank_transfer">
                {Object.entries(methods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="method" errors={errors} />
            </label>
            <label className="cp-field">
              <span className="erp-label">{labels.reference}</span>
              <input className="cp-input" name="reference" maxLength={200} />
              <FieldError state={state} name="reference" errors={errors} />
            </label>
          </div>
          <span style={{ display: "inline-flex", gap: "var(--erp-space-2)" }}>
            <button className="cp-button" type="submit" disabled={pending}>
              {pending ? labels.saving : labels.record}
            </button>
            <button className="cp-button cp-button-secondary" type="button" onClick={() => setOpen(false)}>
              {labels.cancel}
            </button>
          </span>
        </form>
      )}
    </div>
  );
}
