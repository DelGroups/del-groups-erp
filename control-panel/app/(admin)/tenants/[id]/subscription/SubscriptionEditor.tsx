"use client";

import { useActionState, useState } from "react";
import type { Locale, Messages } from "@/lib/i18n/messages";
import { formatDate } from "@/lib/format";
import { toChoice, toPlanPricing, type PlanRow, type SubscriptionRow } from "@/lib/billing/catalog";
import {
  ADDON_CODES,
  GIB,
  addPeriod,
  entitlements,
  prorate,
  quote,
  validateChoice,
  withDependencies,
  type AddonCode,
  type BillingPeriod,
  type ModuleInfo,
} from "@/lib/billing/pricing";
import { SUBSCRIPTION_STATUSES, type EditableSubscriptionStatus } from "@/lib/billing/forms";
import { fill, money } from "@/lib/billing/ui";
import type { SyncView } from "@/lib/billing/server";
import { Stepper } from "../../../plans/PlanEditor";
import { resyncSubscription, saveSubscription, type SubscriptionFormState } from "./actions";

type Catalog = (ModuleInfo & { name: string })[];

/**
 * Subscription of one tenant (prompt 12). Design references: pricing/pricing-change-plan-with-
 * prorated-preview (plan cards, "due today"), pricing/pricing-per-seat-pricing-with-quantity-
 * stepper (seats) and pricing/pricing-module-bundle-builder (modules + sticky summary).
 * Every figure is recomputed in the browser with lib/billing/pricing.ts; the server
 * validates again on save.
 */
export default function SubscriptionEditor({
  tenant,
  plans,
  modules,
  current,
  activeUsers,
  today,
  locale,
  labels,
  syncConfigured,
  hasDatabase,
}: {
  tenant: { id: string; name: string; slug: string };
  plans: PlanRow[];
  modules: Catalog;
  current: SubscriptionRow | null;
  activeUsers: number | null;
  today: string;
  locale: Locale;
  labels: Messages["billing"];
  syncConfigured: boolean;
  hasDatabase: boolean;
}) {
  const selectable = plans.filter((p) => p.is_active || p.id === current?.plan_id);
  const currentChoice = current ? toChoice(current) : null;
  const [planId, setPlanId] = useState(current?.plan_id ?? selectable[0]?.id ?? "");
  const [status, setStatus] = useState<EditableSubscriptionStatus>(
    current && (SUBSCRIPTION_STATUSES as readonly string[]).includes(current.status) ? (current.status as EditableSubscriptionStatus) : "trial"
  );
  const [period, setPeriod] = useState<BillingPeriod>(current?.billing_period ?? "monthly");
  const [users, setUsers] = useState(current?.user_count ?? Math.max(1, activeUsers ?? 1));
  const [chosen, setChosen] = useState<Set<string>>(new Set(currentChoice?.modules ?? []));
  const [addons, setAddons] = useState<Partial<Record<AddonCode, number>>>(currentChoice?.addons ?? {});
  const [periodStart, setPeriodStart] = useState(current?.current_period_start ?? today);
  const [periodEnd, setPeriodEnd] = useState(current?.current_period_end ?? addPeriod(today, current?.billing_period ?? "monthly"));
  const [trialEnds, setTrialEnds] = useState(current?.trial_ends_at?.slice(0, 10) ?? "");
  const [resync, setResync] = useState<SyncView | null>(null);
  const [resyncing, setResyncing] = useState(false);

  const action = saveSubscription.bind(null, tenant.id);
  const [state, formAction, pending] = useActionState<SubscriptionFormState, FormData>(action, {
    status: "idle",
    errors: {},
    formError: null,
    sync: null,
  });

  const planRow = selectable.find((p) => p.id === planId) ?? null;
  const pricing = planRow ? toPlanPricing(planRow) : null;
  const offered = new Set(pricing?.modules.map((m) => m.moduleId) ?? []);
  const visibleModules = modules.filter((m) => m.isCore || offered.has(m.id));
  const choice = { period, userCount: users, modules: [...chosen], addons };
  const closure = new Set(withDependencies([...chosen], modules));
  const m = (cents: number) => money(locale, cents, pricing?.currency ?? "AZN");
  const nameOf = (id: string) => modules.find((x) => x.id === id)?.name ?? id;

  const q = pricing ? quote(pricing, choice, modules) : null;
  const ent = pricing ? entitlements(pricing, choice) : null;
  const check = pricing ? validateChoice(pricing, choice, modules, activeUsers) : null;

  // What the tenant pays today for this change (preview only, nothing is invoiced yet).
  const currentPlanRow = current ? plans.find((p) => p.id === current.plan_id) ?? null : null;
  const currentQuote = current && currentPlanRow && currentChoice ? quote(toPlanPricing(currentPlanRow), currentChoice, modules) : null;
  const proration =
    q && status !== "trial"
      ? prorate({
          current:
            current && currentQuote && current.status !== "trial"
              ? { periodCents: currentQuote.periodCents, period: current.billing_period, periodStart: current.current_period_start, periodEnd: current.current_period_end }
              : null,
          next: { periodCents: status === "cancelled" ? 0 : q.periodCents, period },
          changeDate: today,
        })
      : null;

  const changePlan = (id: string) => {
    setPlanId(id);
    const next = selectable.find((p) => p.id === id);
    if (!next) return;
    const nextPricing = toPlanPricing(next);
    const nextOffered = new Set(nextPricing.modules.map((x) => x.moduleId));
    setChosen((prev) => new Set([...prev].filter((x) => nextOffered.has(x))));
    if (nextPricing.maxUsers !== null) setUsers((u) => Math.min(u, nextPricing.maxUsers!));
  };
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const sync = resync ?? state.sync;
  const syncMessage =
    sync?.status === "synced"
      ? labels.subscription.syncDone
      : sync?.status === "failed"
        ? fill(labels.subscription.syncFailed, { error: sync.error })
        : sync?.status === "skipped"
          ? labels.subscription.syncSkipped
          : sync?.status === "not_configured"
            ? labels.subscription.syncNotConfigured
            : null;

  if (!selectable.length) return <p className="cp-muted">{labels.subscription.noPlans}</p>;

  return (
    <form action={formAction} noValidate>
      {tenant.slug === "del-groups" ? (
        <p className="cp-alert cp-alert-error" role="note">
          {labels.subscription.tenantOneWarning}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p className="cp-alert cp-alert-success" role="status">
          {labels.subscription.saved}
        </p>
      ) : null}
      {state.formError ? (
        <p className="cp-alert cp-alert-error" role="alert">
          {labels.errors[state.formError as keyof typeof labels.errors] ?? state.formError}
        </p>
      ) : null}
      {syncMessage ? (
        <p className={`cp-alert ${sync?.status === "synced" ? "cp-alert-success" : "cp-alert-error"}`} role="status">
          {syncMessage}
        </p>
      ) : null}

      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="billing_period" value={period} />
      {[...chosen].map((id) => (
        <input key={id} type="hidden" name={`module_${id}`} value="on" />
      ))}
      {ADDON_CODES.map((code) => (
        <input key={code} type="hidden" name={`addon_${code}`} value={String(addons[code] ?? 0)} />
      ))}

      <div className="cp-builder">
        <div>
          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.subscription.plan}</h2>
            <div className="cp-choices" role="radiogroup" aria-label={labels.subscription.plan}>
              {selectable.map((plan) => {
                const p = toPlanPricing(plan);
                return (
                  <label key={plan.id} className="cp-choice">
                    <input type="radio" name="plan_choice" checked={plan.id === planId} onChange={() => changePlan(plan.id)} />
                    <span className="cp-choice-body">
                      <strong>{plan.name}</strong>{" "}
                      {plan.id === current?.plan_id ? <span className="cp-badge cp-badge-info">{labels.subscription.current}</span> : null}
                      {plan.description ? <span className="cp-hint" style={{ display: "block" }}>{plan.description}</span> : null}
                    </span>
                    <span className="cp-choice-price">
                      {money(locale, Math.round(p.baseFee * 100), p.currency)} {labels.quote.perMonth}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="cp-grid-2">
              <label className="cp-field">
                <span className="erp-label">{labels.subscription.status}</span>
                <select className="cp-input" name="status" value={status} onChange={(e) => setStatus(e.target.value as EditableSubscriptionStatus)}>
                  {SUBSCRIPTION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {labels.subscription.statuses[s]}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="cp-field">
                <legend className="erp-label">{labels.subscription.period}</legend>
                <div style={{ display: "flex", gap: "var(--erp-space-4)" }}>
                  {(["monthly", "yearly"] as const).map((p) => (
                    <label key={p} style={{ display: "flex", gap: "var(--erp-space-1)", alignItems: "center" }}>
                      <input type="radio" name="period_choice" checked={period === p} onChange={() => setPeriod(p)} />
                      {labels.subscription.periods[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>

          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.subscription.seats}</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--erp-space-4)", flexWrap: "wrap" }}>
              <Stepper name="user_count" value={users} min={1} max={pricing?.maxUsers ?? 10000} onChange={setUsers} labels={labels} />
              <span className="cp-hint">
                {pricing?.maxUsers ? fill(labels.subscription.seatsHint, { max: pricing.maxUsers }) : labels.subscription.seatsNoCap}
              </span>
            </div>
            {activeUsers !== null ? (
              <p className="cp-hint" style={{ marginTop: "var(--erp-space-2)" }}>
                {fill(labels.subscription.activeNow, { count: activeUsers })}
              </p>
            ) : null}
            {check?.belowActiveUsers ? (
              <p className="cp-error" style={{ marginTop: "var(--erp-space-2)" }}>
                {fill(labels.subscription.belowActive, { active: activeUsers ?? 0, seats: ent?.seatLimit ?? users })}
              </p>
            ) : null}
          </section>

          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.subscription.modules}</h2>
            <div className="cp-choices">
              {visibleModules.map((mod) => {
                const price = pricing?.modules.find((x) => x.moduleId === mod.id);
                const isDependency = !chosen.has(mod.id) && closure.has(mod.id) && !mod.isCore;
                const neededBy = [...chosen].filter((c) => modules.find((x) => x.id === c)?.depends.includes(mod.id)).map(nameOf);
                return (
                  <label key={mod.id} className="cp-choice">
                    <input
                      type="checkbox"
                      checked={mod.isCore || closure.has(mod.id)}
                      disabled={mod.isCore || isDependency}
                      onChange={(e) => toggle(mod.id, e.target.checked)}
                    />
                    <span className="cp-choice-body">
                      <strong>{mod.name}</strong>{" "}
                      {mod.isCore ? <span className="cp-badge cp-badge-muted">{labels.subscription.required}</span> : null}
                      {isDependency ? (
                        <span className="cp-hint" style={{ display: "block" }}>
                          {fill(labels.subscription.neededBy, { names: neededBy.join(", ") })}
                        </span>
                      ) : null}
                    </span>
                    <span className="cp-choice-price">
                      {price ? `${m(Math.round(price.amount * 100))}${price.perUser ? ` ${labels.quote.perUser}` : ""}` : labels.subscription.included}
                    </span>
                  </label>
                );
              })}
            </div>
            {check?.missingModules.length ? (
              <p className="cp-error">{fill(labels.subscription.missingModules, { names: check.missingModules.map(nameOf).join(", ") })}</p>
            ) : null}
          </section>

          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.subscription.addons}</h2>
            {pricing?.addons.length ? (
              <div className="cp-choices">
                {pricing.addons.map((a) => (
                  <div key={a.code} className="cp-choice">
                    <span className="cp-choice-body">
                      <strong>{labels.addons[a.code]}</strong>
                      <span className="cp-hint" style={{ display: "block" }}>
                        {m(Math.round(a.amount * 100))} {labels.quote.perMonth}
                      </span>
                    </span>
                    <Stepper
                      value={addons[a.code] ?? 0}
                      min={0}
                      max={a.code === "custom_domain" ? 1 : 10000}
                      onChange={(n) => setAddons((prev) => ({ ...prev, [a.code]: n }))}
                      labels={labels}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="cp-muted">{labels.subscription.noAddons}</p>
            )}
          </section>

          <section className="cp-panel">
            <h2 className="cp-panel-title">{labels.subscription.dates}</h2>
            <div className="cp-grid-2">
              <label className="cp-field">
                <span className="erp-label">{labels.subscription.periodStart}</span>
                <input className="cp-input" type="date" name="current_period_start" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.subscription.periodEnd}</span>
                <input className="cp-input" type="date" name="current_period_end" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                {state.errors.current_period_end ? <span className="cp-error">{labels.errors.periodOrder}</span> : null}
              </label>
              <label className="cp-field">
                <span className="erp-label">{labels.subscription.trialEnds}</span>
                <input className="cp-input" type="date" name="trial_ends_at" value={trialEnds} onChange={(e) => setTrialEnds(e.target.value)} />
              </label>
            </div>
          </section>
        </div>

        <aside className="cp-summary" aria-live="polite">
          <h2 className="cp-panel-title">{labels.subscription.summary}</h2>
          {q ? (
            <>
              {q.lines.map((line) => (
                <div key={`${line.kind}-${line.id}`} className="cp-summary-row">
                  <span>
                    {line.kind === "base" ? labels.quote.base : line.kind === "addon" ? labels.addons[line.id as AddonCode] : nameOf(line.id)}
                    {line.quantity > 1 ? <span className="cp-muted"> {fill(labels.quote.times, { count: line.quantity, price: m(line.unitCents) })}</span> : null}
                  </span>
                  <span className="cp-figure">{m(line.totalCents)}</span>
                </div>
              ))}
              {q.discountCents > 0 ? (
                <div className="cp-summary-row cp-credit">
                  <span>{fill(labels.quote.discount, { pct: pricing!.annualDiscountPct })}</span>
                  <span className="cp-figure">−{m(q.discountCents)}</span>
                </div>
              ) : null}
              <div className="cp-summary-row cp-summary-total">
                <span>{period === "yearly" ? labels.quote.yearly : labels.quote.monthly}</span>
                <span className="cp-figure">{m(q.periodCents)}</span>
              </div>
            </>
          ) : null}

          {ent ? (
            <dl className="cp-dl" style={{ marginTop: "var(--erp-space-3)" }}>
              <dt>{labels.subscription.limitSeats}</dt>
              <dd>{ent.seatLimit}</dd>
              <dt>{labels.subscription.limitStorage}</dt>
              <dd>{ent.storageLimitBytes === null ? labels.unlimited : `${Math.round((ent.storageLimitBytes / GIB) * 100) / 100} GB`}</dd>
              <dt>{labels.subscription.limitAi}</dt>
              <dd>{ent.aiLimitUsd === null ? labels.unlimited : `${ent.aiLimitUsd} USD`}</dd>
              <dt>{labels.subscription.limitDomain}</dt>
              <dd>{ent.customDomain ? labels.yes : labels.no}</dd>
            </dl>
          ) : null}

          <div className="cp-due">
            <strong>{labels.subscription.dueToday}</strong>
            {status === "trial" ? (
              <p className="cp-hint">{labels.subscription.trialNoCharge}</p>
            ) : proration ? (
              <>
                {proration.creditCents > 0 ? (
                  <div className="cp-summary-row cp-credit">
                    <span>{fill(labels.subscription.credit, { days: proration.daysLeft })}</span>
                    <span className="cp-figure">−{m(proration.creditCents)}</span>
                  </div>
                ) : null}
                {proration.chargeCents > 0 ? (
                  <div className="cp-summary-row">
                    <span>
                      {proration.daysTotal && current?.billing_period === period
                        ? fill(labels.subscription.charge, { days: proration.daysLeft })
                        : labels.subscription.newPeriod}
                    </span>
                    <span className="cp-figure">{m(proration.chargeCents)}</span>
                  </div>
                ) : null}
                <div className="cp-summary-row cp-summary-total">
                  <span>{proration.dueCents >= 0 ? labels.subscription.dueTotal : labels.subscription.creditTotal}</span>
                  <span className="cp-figure">{m(Math.abs(proration.dueCents))}</span>
                </div>
                {status !== "cancelled" ? (
                  <p className="cp-hint">
                    {fill(labels.subscription.nextCharge, { amount: m(proration.nextChargeCents), date: formatDate(locale, proration.nextChargeDate) })}
                  </p>
                ) : null}
              </>
            ) : null}
            <p className="cp-hint">{labels.subscription.previewOnly}</p>
          </div>

          <button
            className="cp-button"
            type="submit"
            disabled={pending || Boolean(status !== "cancelled" && check?.errors.length)}
            style={{ width: "100%", justifyContent: "center", marginTop: "var(--erp-space-4)" }}
          >
            {pending ? labels.subscription.saving : labels.subscription.save}
          </button>
          {status !== "cancelled" && check?.errors.length ? (
            <p className="cp-error">{check.errors.map((e) => labels.errors[e]).join(" ")}</p>
          ) : null}

          <div style={{ marginTop: "var(--erp-space-4)" }}>
            <span className="erp-label">{labels.subscription.syncStatus}</span>{" "}
            {current ? (
              <span className={`cp-badge ${current.sync_status === "synced" ? "cp-badge-success" : current.sync_status === "failed" ? "cp-badge-danger" : "cp-badge-warning"}`}>
                {labels.subscription.syncStatuses[current.sync_status]}
              </span>
            ) : (
              <span className="cp-badge cp-badge-muted">{labels.subscription.syncStatuses.not_synced}</span>
            )}
            {current?.synced_at ? <span className="cp-hint"> {formatDate(locale, current.synced_at, true)}</span> : null}
            {current?.sync_error ? <p className="cp-error">{current.sync_error}</p> : null}
            {!hasDatabase ? <p className="cp-hint">{labels.subscription.syncSkipped}</p> : null}
            {!syncConfigured ? <p className="cp-hint">{labels.subscription.syncNotConfigured}</p> : null}
            {current && hasDatabase && syncConfigured ? (
              <button
                type="button"
                className="cp-button cp-button-secondary"
                style={{ marginTop: "var(--erp-space-2)" }}
                disabled={resyncing}
                onClick={async () => {
                  setResyncing(true);
                  try {
                    setResync(await resyncSubscription(tenant.id));
                  } finally {
                    setResyncing(false);
                  }
                }}
              >
                {labels.subscription.syncNow}
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </form>
  );
}
