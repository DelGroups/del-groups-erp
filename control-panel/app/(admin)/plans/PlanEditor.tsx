"use client";

import { useActionState, useMemo, useState } from "react";
import type { Locale, Messages } from "@/lib/i18n/messages";
import { ADDON_CODES, quote, type AddonCode, type PlanPricing } from "@/lib/billing/pricing";
import { fill, money } from "@/lib/billing/ui";
import { savePlan, type PlanFormState } from "./actions";

export interface PlanEditorValues {
  code: string;
  name: string;
  description: string;
  annual_discount_pct: string;
  is_active: boolean;
  sort_order: string;
  max_users: string;
  included_storage_gb: string;
  included_ai_credit_usd: string;
  includes_custom_domain: boolean;
  currency: string;
  base_fee: string;
  /** Offered modules and their price. */
  modules: Record<string, { offered: boolean; price: string; perUser: boolean }>;
  addons: Record<AddonCode, string>;
}

const decimal = (text: string) => Number(text.replace(",", ".")) || 0;

/**
 * Plan editor (prompt 12). Layout from pricing/pricing-module-bundle-builder: module cards on
 * the left, a sticky summary with an example price on the right. Prices are monthly; the
 * yearly price is derived from the discount.
 */
export default function PlanEditor({
  planId,
  initial,
  modules,
  locale,
  labels,
  saved,
}: {
  planId: string | null;
  initial: PlanEditorValues;
  modules: { id: string; name: string; depends: string[]; isCore: boolean }[];
  locale: Locale;
  labels: Messages["billing"];
  saved: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [exampleUsers, setExampleUsers] = useState(10);
  const action = savePlan.bind(null, planId);
  const [state, formAction, pending] = useActionState<PlanFormState, FormData>(action, {
    status: saved ? "saved" : "idle",
    errors: {},
    formError: null,
  });
  const err = (field: string) => (state.errors[field] ? labels.errors[state.errors[field] as keyof typeof labels.errors] : null);
  const set = <K extends keyof PlanEditorValues>(key: K, value: PlanEditorValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const setModule = (id: string, patch: Partial<PlanEditorValues["modules"][string]>) =>
    setValues((v) => ({ ...v, modules: { ...v.modules, [id]: { ...v.modules[id], ...patch } } }));

  // Example: every offered module for `exampleUsers` users, monthly and yearly.
  const pricing: PlanPricing = useMemo(
    () => ({
      currency: /^[A-Z]{3}$/.test(values.currency.toUpperCase()) ? values.currency.toUpperCase() : "AZN",
      baseFee: decimal(values.base_fee),
      annualDiscountPct: Math.min(100, decimal(values.annual_discount_pct)),
      maxUsers: values.max_users ? Number(values.max_users) : null,
      includedStorageGb: values.included_storage_gb ? decimal(values.included_storage_gb) : null,
      includedAiCreditUsd: values.included_ai_credit_usd ? decimal(values.included_ai_credit_usd) : null,
      includesCustomDomain: values.includes_custom_domain,
      modules: modules
        .filter((m) => values.modules[m.id]?.offered)
        .map((m) => ({ moduleId: m.id, amount: decimal(values.modules[m.id].price), perUser: values.modules[m.id].perUser })),
      addons: ADDON_CODES.filter((c) => values.addons[c] !== "").map((c) => ({ code: c, amount: decimal(values.addons[c]) })),
    }),
    [values, modules]
  );
  const offered = pricing.modules.map((m) => m.moduleId);
  const monthly = quote(pricing, { period: "monthly", userCount: exampleUsers, modules: offered, addons: {} }, modules);
  const yearly = quote(pricing, { period: "yearly", userCount: exampleUsers, modules: offered, addons: {} }, modules);
  const m = (cents: number) => money(locale, cents, pricing.currency);
  const nameOf = (id: string) => modules.find((x) => x.id === id)?.name ?? id;

  return (
    <form action={formAction} noValidate>
      {state.status === "saved" ? (
        <p className="cp-alert cp-alert-success" role="status">
          {labels.planEditor.saved}
        </p>
      ) : null}
      {state.formError ? (
        <p className="cp-alert cp-alert-error" role="alert">
          {labels.errors[state.formError as keyof typeof labels.errors] ?? state.formError}
        </p>
      ) : null}

      <div className="cp-builder">
        <div>
          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.planEditor.general}</h2>
            <div className="cp-grid-2">
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.name}</span>
                <input className="cp-input" name="name" value={values.name} onChange={(e) => set("name", e.target.value)} aria-invalid={err("name") ? true : undefined} />
                {err("name") ? <span className="cp-error">{err("name")}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.code}</span>
                <input className="cp-input" name="code" value={values.code} onChange={(e) => set("code", e.target.value)} aria-invalid={err("code") ? true : undefined} />
                <span className="cp-hint">{labels.planEditor.codeHint}</span>
                {err("code") ? <span className="cp-error">{err("code")}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.currency}</span>
                <input className="cp-input" name="currency" maxLength={3} value={values.currency} onChange={(e) => set("currency", e.target.value)} />
                {err("currency") ? <span className="cp-error">{err("currency")}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.baseFee}</span>
                <input className="cp-input" name="base_fee" inputMode="decimal" value={values.base_fee} onChange={(e) => set("base_fee", e.target.value)} />
                {err("base_fee") ? <span className="cp-error">{err("base_fee")}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.discount}</span>
                <input className="cp-input" name="annual_discount_pct" inputMode="decimal" value={values.annual_discount_pct} onChange={(e) => set("annual_discount_pct", e.target.value)} />
                <span className="cp-hint">{labels.planEditor.discountHint}</span>
                {err("annual_discount_pct") ? <span className="cp-error">{err("annual_discount_pct")}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.sortOrder}</span>
                <input className="cp-input" name="sort_order" inputMode="numeric" value={values.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
                {err("sort_order") ? <span className="cp-error">{err("sort_order")}</span> : null}
              </label>
            </div>
            <label className="cp-field">
              <span className="erp-label">{labels.planEditor.description}</span>
              <input className="cp-input" name="description" value={values.description} onChange={(e) => set("description", e.target.value)} />
              {err("description") ? <span className="cp-error">{err("description")}</span> : null}
            </label>
            <label style={{ display: "flex", gap: "var(--erp-space-2)", alignItems: "center" }}>
              <input type="checkbox" name="is_active" checked={values.is_active} onChange={(e) => set("is_active", e.target.checked)} />
              {labels.planEditor.active}
            </label>
          </section>

          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.planEditor.limits}</h2>
            <div className="cp-grid-2">
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.maxUsers}</span>
                <input className="cp-input" name="max_users" inputMode="numeric" value={values.max_users} onChange={(e) => set("max_users", e.target.value)} />
                <span className="cp-hint">{labels.planEditor.maxUsersHint}</span>
                {err("max_users") ? <span className="cp-error">{err("max_users")}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.storageGb}</span>
                <input className="cp-input" name="included_storage_gb" inputMode="decimal" value={values.included_storage_gb} onChange={(e) => set("included_storage_gb", e.target.value)} />
                <span className="cp-hint">{labels.planEditor.unlimitedHint}</span>
                {err("included_storage_gb") ? <span className="cp-error">{err("included_storage_gb")}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.planEditor.aiCredit}</span>
                <input className="cp-input" name="included_ai_credit_usd" inputMode="decimal" value={values.included_ai_credit_usd} onChange={(e) => set("included_ai_credit_usd", e.target.value)} />
                <span className="cp-hint">{labels.planEditor.unlimitedHint}</span>
                {err("included_ai_credit_usd") ? <span className="cp-error">{err("included_ai_credit_usd")}</span> : null}
              </label>
            </div>
            <label style={{ display: "flex", gap: "var(--erp-space-2)", alignItems: "center" }}>
              <input type="checkbox" name="includes_custom_domain" checked={values.includes_custom_domain} onChange={(e) => set("includes_custom_domain", e.target.checked)} />
              {labels.planEditor.customDomain}
            </label>
          </section>

          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.planEditor.modules}</h2>
            <p className="cp-hint" style={{ marginBottom: "var(--erp-space-3)" }}>
              {labels.planEditor.modulesHint}
            </p>
            <div className="cp-choices">
              {modules.map((mod) => {
                const row = values.modules[mod.id];
                return (
                  <div key={mod.id} className="cp-choice">
                    <input
                      type="checkbox"
                      id={`module_${mod.id}`}
                      name={`module_${mod.id}`}
                      checked={row.offered}
                      onChange={(e) => setModule(mod.id, { offered: e.target.checked })}
                    />
                    <label htmlFor={`module_${mod.id}`} className="cp-choice-body">
                      <strong>{mod.name}</strong>{" "}
                      {mod.isCore ? <span className="cp-badge cp-badge-muted">{labels.planEditor.coreIncluded}</span> : null}
                      {mod.depends.filter((d) => d !== "core").length ? (
                        <span className="cp-hint" style={{ display: "block" }}>
                          {fill(labels.planEditor.needs, { names: mod.depends.filter((d) => d !== "core").map(nameOf).join(", ") })}
                        </span>
                      ) : null}
                    </label>
                    <input
                      className="cp-input"
                      style={{ width: "6rem" }}
                      name={`price_${mod.id}`}
                      inputMode="decimal"
                      aria-label={`${mod.name}: ${labels.planEditor.price}`}
                      value={row.price}
                      disabled={!row.offered}
                      onChange={(e) => setModule(mod.id, { price: e.target.value })}
                    />
                    <label style={{ display: "flex", gap: "var(--erp-space-1)", alignItems: "center", whiteSpace: "nowrap" }}>
                      <input
                        type="checkbox"
                        name={`per_user_${mod.id}`}
                        checked={row.perUser}
                        disabled={!row.offered}
                        onChange={(e) => setModule(mod.id, { perUser: e.target.checked })}
                      />
                      {labels.planEditor.perUser}
                    </label>
                    {err(`price_${mod.id}`) ? <span className="cp-error">{err(`price_${mod.id}`)}</span> : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.planEditor.addons}</h2>
            <p className="cp-hint" style={{ marginBottom: "var(--erp-space-3)" }}>
              {labels.planEditor.addonsHint}
            </p>
            <div className="cp-grid-2">
              {ADDON_CODES.map((code) => (
                <label key={code} className="cp-field">
                  <span className="erp-label">{labels.addons[code]}</span>
                  <input
                    className="cp-input"
                    name={`addon_${code}`}
                    inputMode="decimal"
                    value={values.addons[code]}
                    onChange={(e) => set("addons", { ...values.addons, [code]: e.target.value })}
                  />
                  {err(`addon_${code}`) ? <span className="cp-error">{err(`addon_${code}`)}</span> : null}
                </label>
              ))}
            </div>
          </section>
        </div>

        <aside className="cp-summary" aria-live="polite">
          <h2 className="cp-panel-title">{labels.planEditor.example}</h2>
          <div className="cp-summary-row">
            <span>{labels.subscription.seats}</span>
            <Stepper value={exampleUsers} min={1} max={values.max_users ? Number(values.max_users) || 10000 : 10000} onChange={setExampleUsers} labels={labels} />
          </div>
          {monthly.lines.map((line) => (
            <div key={`${line.kind}-${line.id}`} className="cp-summary-row">
              <span>
                {line.kind === "base" ? labels.quote.base : nameOf(line.id)}
                {line.quantity > 1 ? <span className="cp-muted"> {fill(labels.quote.times, { count: line.quantity, price: m(line.unitCents) })}</span> : null}
              </span>
              <span className="cp-figure">{m(line.totalCents)}</span>
            </div>
          ))}
          <div className="cp-summary-row cp-summary-total">
            <span>{labels.quote.monthly}</span>
            <span className="cp-figure">{m(monthly.periodCents)}</span>
          </div>
          <div className="cp-summary-row">
            <span>{labels.quote.yearly}</span>
            <span className="cp-figure">{m(yearly.periodCents)}</span>
          </div>
          {yearly.discountCents > 0 ? (
            <div className="cp-summary-row cp-credit">
              <span>{fill(labels.quote.discount, { pct: pricing.annualDiscountPct })}</span>
              <span className="cp-figure">−{m(yearly.discountCents)}</span>
            </div>
          ) : null}
          <button className="cp-button" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center", marginTop: "var(--erp-space-4)" }}>
            {pending ? labels.planEditor.saving : labels.planEditor.save}
          </button>
        </aside>
      </div>
    </form>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  labels,
  name,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  labels: Messages["billing"];
  name?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.floor(n) || min));
  return (
    <span className="cp-stepper">
      <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={labels.subscription.decrease}>
        −
      </button>
      <input
        name={name}
        inputMode="numeric"
        value={value}
        aria-label={labels.subscription.seats}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={labels.subscription.increase}>
        +
      </button>
    </span>
  );
}
