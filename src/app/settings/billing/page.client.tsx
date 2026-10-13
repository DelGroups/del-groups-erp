"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bot, CreditCard, Download, HardDrive, Landmark, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { formatBytesShort, type LimitKind, type TenantLimitStatus } from "@/lib/limits/limits";
import { daysUntil, invoiceOwed, usageMeters, type BillingOverview, type InvoiceStatus } from "@/lib/billing/overview";

const METER_ICON: Record<LimitKind, LucideIcon> = { users: Users, storage: HardDrive, ai: Bot };
const STATUS_BADGE: Record<InvoiceStatus, BadgeVariant> = { issued: "info", paid: "success", overdue: "danger", void: "neutral" };

function money(amount: number, currency: string): string {
  const [int, frac] = Math.abs(amount).toFixed(2).split(".");
  return `${amount < 0 ? "−" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${frac} ${currency}`;
}

function meterFigure(kind: LimitKind, value: number): string {
  if (kind === "storage") return formatBytesShort(value);
  if (kind === "ai") return `${value.toFixed(2)} USD`;
  return String(value);
}

export default function BillingSettingsPage() {
  const { t, formatDate } = useI18n();
  const { isAdmin, ready } = useAuth();
  const [data, setData] = useState<{ overview: BillingOverview; limits: TenantLimitStatus } | null>(null);
  const [error, setError] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    let active = true;
    fetch("/api/billing/overview", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { overview: BillingOverview; limits: TenantLimitStatus };
      })
      .then((json) => {
        if (active) {
          setData(json);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [ready, isAdmin, reload]);

  const overview = data?.overview;
  const sub = overview?.subscription ?? null;
  const open = (overview?.invoices ?? []).filter((i) => invoiceOwed(i) > 0);
  const balanceByCurrency = open.reduce<Record<string, number>>((acc, i) => {
    acc[i.currency] = Math.round(((acc[i.currency] ?? 0) + invoiceOwed(i)) * 100) / 100;
    return acc;
  }, {});
  const planName = (id: string) => overview?.plans.find((p) => p.id === id)?.name ?? "";

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="billing" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-4xl space-y-6">
            <header>
              <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                <CreditCard className="h-6 w-6 text-app-accent" />
                {t("tenantBilling.title")}
              </h1>
              <p className="mt-1 text-sm text-app-muted">{t("tenantBilling.description")}</p>
            </header>

            {ready && !isAdmin ? (
              <div className="app-card p-6 text-sm text-app-muted">{t("tenantBilling.adminOnly")}</div>
            ) : error ? (
              <div className="app-card p-6 text-sm text-rose-500">{t("tenantBilling.unavailable")}</div>
            ) : !overview || !data ? (
              <div className="app-card p-6 text-xs text-app-muted">{t("common.dataLoading")}</div>
            ) : (
              <>
                {overview.tenantStatus === "past_due" || overview.tenantStatus === "read_only" ? (
                  <div role="alert" className="app-card border-l-4 border-l-[color:var(--erp-color-warning)] p-4 text-sm text-app">
                    {t(`tenantBilling.notice_${overview.tenantStatus}`)}
                  </div>
                ) : null}

                {/* Plan, period and what is owed, then the meters (usage-and-billing-meters layout). */}
                <section className="app-card app-card-elevated overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
                    <div>
                      <h2 className="text-lg font-semibold text-app">
                        {sub
                          ? t("tenantBilling.planLine", {
                              plan: sub.planName,
                              users: sub.userCount,
                              period: t(`tenantBilling.period_${sub.billingPeriod}`),
                            })
                          : t("tenantBilling.noPlan")}
                      </h2>
                      <p className="mt-1 text-sm text-app-muted">
                        {sub?.periodStart && sub.periodEnd
                          ? t("tenantBilling.periodLine", {
                              start: formatDate(sub.periodStart),
                              end: formatDate(sub.periodEnd),
                              days: daysUntil(sub.periodEnd, today) ?? 0,
                            })
                          : sub?.trialEndsAt
                            ? t("tenantBilling.trialEnds", { date: formatDate(sub.trialEndsAt) })
                            : t("tenantBilling.noPeriod")}
                      </p>
                    </div>
                    {overview.plans.length ? (
                      <Button appearance="solid" color="primary" onClick={() => setRequestOpen(true)}>
                        {t("tenantBilling.changePlan")}
                      </Button>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-y border-app bg-[color:var(--erp-bg-table-header)] px-6 py-4">
                    <div>
                      <div className="text-2xl font-semibold tracking-tight text-app">
                        {Object.keys(balanceByCurrency).length
                          ? Object.entries(balanceByCurrency).map(([c, a]) => money(a, c)).join(" + ")
                          : money(0, sub?.currency ?? "AZN")}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-widest text-app-muted">
                        {open.length ? t("tenantBilling.openBalance") : t("tenantBilling.noBalance")}
                      </div>
                    </div>
                    <p className="max-w-sm text-xs leading-relaxed text-app-muted">
                      {open.length
                        ? t("tenantBilling.balanceNote")
                        : sub?.periodEnd
                          ? t("tenantBilling.renews", { date: formatDate(sub.periodEnd) })
                          : ""}
                    </p>
                  </div>

                  <ul className="divide-y divide-[color:var(--erp-border-default)]">
                    {usageMeters(data.limits).map((m) => {
                      const Icon = METER_ICON[m.kind];
                      const fill =
                        m.state === "blocked"
                          ? "bg-[color:var(--erp-color-danger)]"
                          : m.state === "warning"
                            ? "bg-[color:var(--erp-color-warning)]"
                            : "bg-[color:var(--app-accent)]";
                      return (
                        <li key={m.kind} className="px-6 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-2 text-sm font-medium text-app">
                              <Icon className="h-4 w-4 text-app-muted" aria-hidden />
                              {t(`tenantBilling.meter_${m.kind}`)}
                            </span>
                            <span className="font-mono text-xs text-app-muted">
                              {meterFigure(m.kind, m.used)} / {m.limit === null ? t("tenantBilling.unlimited") : meterFigure(m.kind, m.limit)}
                            </span>
                          </div>
                          {m.limit !== null ? (
                            <div
                              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--erp-bg-table-header)]"
                              role="progressbar"
                              aria-label={t(`tenantBilling.meter_${m.kind}`)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={m.percent}
                            >
                              <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${fill}`} style={{ width: `${m.percent}%` }} />
                            </div>
                          ) : null}
                          {m.state === "blocked" ? <p className="mt-1.5 text-xs text-[color:var(--erp-color-danger)]">{t("tenantBilling.limitReached")}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {overview.pendingRequest ? (
                  <div className="app-card p-4 text-sm text-app" role="status">
                    {t("tenantBilling.requestPending", {
                      date: formatDate(overview.pendingRequest.createdAt),
                      plan: planName(overview.pendingRequest.planId),
                      users: overview.pendingRequest.userCount,
                    })}
                  </div>
                ) : null}

                <section className="app-card app-card-elevated overflow-x-auto">
                  <h2 className="px-6 pt-5 text-base font-semibold text-app">{t("tenantBilling.invoices")}</h2>
                  {overview.invoices.length === 0 ? (
                    <p className="px-6 py-5 text-sm text-app-muted">{t("tenantBilling.noInvoices")}</p>
                  ) : (
                    <table className="mt-3 w-full text-left text-sm">
                      <thead className="border-b border-app text-xs uppercase text-app-muted">
                        <tr>
                          <th className="px-6 py-3">{t("tenantBilling.colNumber")}</th>
                          <th className="px-4 py-3">{t("tenantBilling.colPeriod")}</th>
                          <th className="px-4 py-3">{t("tenantBilling.colDue")}</th>
                          <th className="px-4 py-3 text-right">{t("tenantBilling.colTotal")}</th>
                          <th className="px-4 py-3">{t("tenantBilling.colStatus")}</th>
                          <th className="px-6 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {overview.invoices.map((i) => (
                          <tr key={i.id} className="border-b border-app last:border-0">
                            <td className="px-6 py-3 font-mono text-xs text-app">{i.number}</td>
                            <td className="px-4 py-3 text-app-muted">
                              {i.periodStart && i.periodEnd ? `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-app-muted">{formatDate(i.dueDate)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-app">{money(i.total, i.currency)}</td>
                            <td className="px-4 py-3">
                              <Badge variant={STATUS_BADGE[i.status]}>{t(`tenantBilling.status_${i.status}`)}</Badge>
                            </td>
                            <td className="px-6 py-3 text-right">
                              {i.hasPdf ? (
                                <a
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline"
                                  href={`/api/billing/invoices/${i.id}/pdf`}
                                >
                                  <Download className="h-3.5 w-3.5" aria-hidden />
                                  {t("tenantBilling.download")}
                                </a>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                {open.length && overview.bank.length ? (
                  <section className="app-card p-6">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-app">
                      <Landmark className="h-4 w-4 text-app-muted" aria-hidden />
                      {t("tenantBilling.bankTitle")}
                    </h2>
                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                      {overview.bank.map((row) => (
                        <React.Fragment key={row.key}>
                          <dt className="text-app-muted">{t(`tenantBilling.bank_${row.key}`)}</dt>
                          <dd className="font-mono text-xs text-app">{row.value}</dd>
                        </React.Fragment>
                      ))}
                      <dt className="text-app-muted">{t("tenantBilling.bank_reference")}</dt>
                      <dd className="font-mono text-xs font-semibold text-app">{open.map((i) => i.number).join(", ")}</dd>
                    </dl>
                  </section>
                ) : null}

                <PlanRequestDialog
                  open={requestOpen}
                  onOpenChange={setRequestOpen}
                  overview={overview}
                  onSent={() => setReload((n) => n + 1)}
                />
              </>
            )}
          </div>
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}

function PlanRequestDialog({
  open,
  onOpenChange,
  overview,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: BillingOverview;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const sub = overview.subscription;
  const [planId, setPlanId] = useState(sub?.planId ?? overview.plans[0]?.id ?? "");
  const [period, setPeriod] = useState<"monthly" | "yearly">(sub?.billingPeriod ?? "monthly");
  const [users, setUsers] = useState(String(sub?.userCount ?? 1));
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const send = useCallback(async () => {
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/billing/plan-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, billing_period: period, user_count: Number(users), note }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        const key = body.error && ["planInvalid", "periodInvalid", "usersInvalid", "noteTooLong"].includes(body.error) ? body.error : "failed";
        setError(t(`tenantBilling.error_${key}`));
        setState("idle");
        return;
      }
      setState("sent");
      onSent();
    } catch {
      setError(t("tenantBilling.error_failed"));
      setState("idle");
    }
  }, [planId, period, users, note, onSent, t]);

  const field = "w-full rounded-[var(--erp-radius-md)] border border-app bg-app px-3 py-2 text-sm text-app";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setState("idle");
      }}
    >
      <DialogContent className="p-6">
        <DialogTitle>{t("tenantBilling.requestTitle")}</DialogTitle>
        {state === "sent" ? (
          <p className="text-sm text-app" role="status">
            {t("tenantBilling.requestSent")}
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <p className="text-sm text-app-muted">{t("tenantBilling.requestBody")}</p>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-app">{t("tenantBilling.requestPlan")}</span>
              <select className={field} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {overview.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-app">{t("tenantBilling.requestPeriod")}</span>
                <select className={field} value={period} onChange={(e) => setPeriod(e.target.value === "yearly" ? "yearly" : "monthly")}>
                  <option value="monthly">{t("tenantBilling.period_monthly")}</option>
                  <option value="yearly">{t("tenantBilling.period_yearly")}</option>
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-app">{t("tenantBilling.requestUsers")}</span>
                <input className={field} type="number" min={1} max={10000} value={users} onChange={(e) => setUsers(e.target.value)} />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-app">{t("tenantBilling.requestNote")}</span>
              <textarea className={field} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {error ? (
              <p className="text-sm text-[color:var(--erp-color-danger)]" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button appearance="outline" color="secondary" type="button">
                  {t("tenantBilling.cancel")}
                </Button>
              </DialogClose>
              <Button appearance="solid" color="primary" type="submit" disabled={state === "sending" || !planId}>
                {state === "sending" ? t("tenantBilling.requestSending") : t("tenantBilling.requestSend")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
