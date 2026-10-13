import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { formatDate, formatMoney } from "@/lib/format";
import { billingSetup } from "@/lib/billing/billingServer";
import { MANUAL_PROVIDER_ID } from "@/lib/billing/providers/index";
import StatusBadge from "@/components/StatusBadge";
import type { TenantStatus } from "@/lib/tenants";
import { EMAIL_STATUS_BADGE, INVOICE_STATUS_BADGE, PAYMENT_STATUS_BADGE } from "../../../billing/badges";
import { InvoiceActions, RunBillingButton, TenantBillingForm } from "./TenantBillingPanels";
import { recordInvoicePayment, runTenantBilling, saveTenantBilling, voidInvoice } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  status_source: "admin" | "billing";
  status_changed_at: string | null;
  billing_email: string | null;
  billing_tax_id: string | null;
  billing_address: string | null;
  billing_paused_until: string | null;
  billing_exempt: boolean;
}
interface Invoice {
  id: string;
  number: string;
  kind: string;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
}
interface Payment {
  id: string;
  amount: number;
  currency: string;
  method: string;
  provider_reference: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
  invoices: { number: string } | null;
}
interface Email {
  id: string;
  created_at: string;
  kind: string;
  recipient: string | null;
  status: string;
  error: string | null;
}

export default async function TenantBillingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { locale, messages, t } = await getI18n();
  const supabase = await createClient();

  const [tenantRes, subRes, invoicesRes, paymentsRes, emailsRes] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, slug, status, status_source, status_changed_at, billing_email, billing_tax_id, billing_address, billing_paused_until, billing_exempt")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("subscriptions").select("auto_billing, payment_provider").eq("tenant_id", id).in("status", ["trial", "active", "past_due"]).maybeSingle(),
    supabase
      .from("invoices")
      .select("id, number, kind, status, currency, total, amount_paid, issued_at, due_date, paid_at, period_start, period_end")
      .eq("tenant_id", id)
      .order("issued_at", { ascending: false, nullsFirst: false })
      .limit(50),
    supabase
      .from("payments")
      .select("id, amount, currency, method, provider_reference, status, paid_at, created_at, invoices(number)")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("billing_emails").select("id, created_at, kind, recipient, status, error").eq("tenant_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const tenant = tenantRes.data as Tenant | null;
  if (!tenant) notFound();
  const subscription = subRes.data as { auto_billing: boolean; payment_provider: string } | null;
  const invoices = (invoicesRes.data ?? []) as Invoice[];
  const payments = (paymentsRes.data ?? []) as unknown as Payment[];
  const emails = (emailsRes.data ?? []) as Email[];
  const setup = billingSetup();
  const none = t("common.none");
  const today = new Date().toISOString().slice(0, 10);
  const L = messages.billingAdmin.tenant;

  const providerLabel = (pid: string) => (pid === MANUAL_PROVIDER_ID ? L.providers.manual_bank_transfer : t("billingAdmin.tenant.providers.card", { id: pid }));
  const providerIds = [...new Set([...setup.providers, ...(subscription ? [subscription.payment_provider] : [])])];

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">
            {t("billingAdmin.tenant.title", { name: tenant.name })}{" "}
            <StatusBadge status={tenant.status} label={t(`tenants.statuses.${tenant.status}`)} />
          </h1>
          <p className="cp-muted">
            {t("billingAdmin.tenant.status", {
              status: t(`tenants.statuses.${tenant.status}`),
              source: t(`billingAdmin.tenant.sources.${tenant.status_source}`),
              date: formatDate(locale, tenant.status_changed_at),
            })}
          </p>
        </div>
        <Link className="cp-button cp-button-secondary" href={`/tenants/${tenant.id}`}>
          {t("common.back")}
        </Link>
      </header>

      {tenant.billing_exempt ? (
        <p className="cp-alert cp-alert-success" role="status">
          {L.exempt}
        </p>
      ) : null}

      <section className="cp-panel">
        <TenantBillingForm
          action={saveTenantBilling.bind(null, tenant.id)}
          initial={{
            billing_email: tenant.billing_email ?? "",
            billing_tax_id: tenant.billing_tax_id ?? "",
            billing_address: tenant.billing_address ?? "",
            billing_paused_until: tenant.billing_paused_until ?? "",
            auto_billing: Boolean(subscription?.auto_billing),
            payment_provider: subscription?.payment_provider ?? MANUAL_PROVIDER_ID,
          }}
          hasSubscription={Boolean(subscription)}
          exempt={tenant.billing_exempt}
          providers={providerIds.map((pid) => ({ id: pid, label: providerLabel(pid) }))}
          labels={{
            saved: L.saved,
            save: L.save,
            saving: messages.common.saving,
            contact: L.contact,
            email: L.email,
            emailHint: L.emailHint,
            taxId: L.taxId,
            address: L.address,
            pausedUntil: L.pausedUntil,
            pausedHint: L.pausedHint,
            automation: L.automation,
            noSubscription: L.noSubscription,
            autoBilling: L.autoBilling,
            autoBillingHint: L.autoBillingHint,
            exempt: L.exempt,
            provider: L.provider,
          }}
          errors={messages.billingAdmin.errors}
        />
      </section>

      {!tenant.billing_exempt ? (
        <section className="cp-panel">
          <RunBillingButton
            run={runTenantBilling.bind(null, tenant.id)}
            labels={{
              runNow: L.runNow,
              running: L.running,
              runHint: L.runHint,
              runDone: L.runDone,
              runFailed: messages.billingAdmin.errors.runFailed,
              unchanged: L.unchanged,
              statuses: messages.tenants.statuses,
            }}
          />
        </section>
      ) : null}

      <section className="cp-panel">
        <h2 className="cp-panel-title">{L.invoices}</h2>
        {invoices.length === 0 ? (
          <p className="cp-muted">{L.noInvoices}</p>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t("billingAdmin.invoices.columns.number")}</th>
                <th>{t("billingAdmin.invoices.columns.kind")}</th>
                <th>{t("billingAdmin.invoices.columns.status")}</th>
                <th>{t("billingAdmin.invoices.columns.total")}</th>
                <th>{t("billingAdmin.invoices.columns.issued")}</th>
                <th>{t("billingAdmin.invoices.columns.due")}</th>
                <th>{t("billingAdmin.invoices.columns.paid")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const owed = Math.max(0, Number(i.total) - Number(i.amount_paid));
                const open = i.status === "issued" || i.status === "overdue";
                return (
                  <tr key={i.id}>
                    <td>
                      <a className="cp-link" href={`/invoices/${i.id}/pdf`} target="_blank" rel="noopener">
                        {i.number}
                      </a>
                      {i.period_start && i.period_end ? (
                        <div className="cp-muted">
                          {formatDate(locale, i.period_start)} – {formatDate(locale, i.period_end)}
                        </div>
                      ) : null}
                    </td>
                    <td>{t(`billingAdmin.invoices.kinds.${i.kind}`)}</td>
                    <td>
                      <span className={`cp-badge ${INVOICE_STATUS_BADGE[i.status] ?? "cp-badge-muted"}`}>{t(`billingAdmin.invoices.statuses.${i.status}`)}</span>
                    </td>
                    <td>
                      {formatMoney(locale, i.total, i.currency)}
                      {open && Number(i.amount_paid) > 0 ? (
                        <div className="cp-muted">{t("billingAdmin.tenant.balance", { amount: formatMoney(locale, owed, i.currency) })}</div>
                      ) : null}
                    </td>
                    <td>{formatDate(locale, i.issued_at)}</td>
                    <td>{formatDate(locale, i.due_date)}</td>
                    <td>{formatDate(locale, i.paid_at)}</td>
                    <td>
                      {open ? (
                        <InvoiceActions
                          action={recordInvoicePayment.bind(null, tenant.id, i.id)}
                          voidAction={voidInvoice.bind(null, tenant.id, i.id)}
                          owed={owed.toFixed(2)}
                          today={today}
                          number={i.number}
                          labels={{
                            recordPayment: L.recordPayment,
                            amount: L.amount,
                            paidOn: L.paidOn,
                            method: L.method,
                            reference: L.reference,
                            record: L.record,
                            recorded: L.recorded,
                            voidInvoice: L.voidInvoice,
                            voidConfirm: L.voidConfirm,
                            cancel: messages.common.cancel,
                            saving: messages.common.saving,
                          }}
                          methods={L.methods}
                          errors={messages.billingAdmin.errors}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="cp-grid-2">
        <section className="cp-panel">
          <h2 className="cp-panel-title">{L.payments}</h2>
          {payments.length === 0 ? (
            <p className="cp-muted">{L.noPayments}</p>
          ) : (
            <table className="cp-table">
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(locale, p.paid_at ?? p.created_at)}</td>
                    <td>{p.invoices?.number ?? none}</td>
                    <td>{formatMoney(locale, p.amount, p.currency)}</td>
                    <td>
                      {t(`billingAdmin.tenant.methods.${p.method}`)}
                      {p.provider_reference ? <div className="cp-muted">{p.provider_reference}</div> : null}
                    </td>
                    <td>
                      <span className={`cp-badge ${PAYMENT_STATUS_BADGE[p.status] ?? "cp-badge-muted"}`}>{t(`billingAdmin.tenant.paymentStatuses.${p.status}`)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="cp-panel">
          <h2 className="cp-panel-title">{L.emails}</h2>
          {emails.length === 0 ? (
            <p className="cp-muted">{t("billingAdmin.emails.empty")}</p>
          ) : (
            <table className="cp-table">
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(locale, e.created_at, true)}</td>
                    <td>{t(`billingAdmin.emails.kinds.${e.kind}`)}</td>
                    <td>{e.recipient ?? none}</td>
                    <td>
                      <span className={`cp-badge ${EMAIL_STATUS_BADGE[e.status] ?? "cp-badge-muted"}`} title={e.error ?? undefined}>
                        {t(`billingAdmin.emails.statuses.${e.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
