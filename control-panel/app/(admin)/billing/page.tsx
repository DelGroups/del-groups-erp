import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { formatDate, formatMoney } from "@/lib/format";
import { billingSetup } from "@/lib/billing/billingServer";
import { formatInvoiceNumber } from "@/lib/billing/invoicing";
import BillingSettingsForm from "./BillingSettingsForm";
import { handlePlanRequest, saveBillingSettings } from "./actions";
import { INVOICE_STATUS_BADGE, EMAIL_STATUS_BADGE } from "./badges";

interface InvoiceRow {
  id: string;
  number: string;
  kind: string;
  status: string;
  currency: string;
  total: number;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  tenant_id: string;
  tenants: { name: string } | null;
}
interface RequestRow {
  id: string;
  tenant_id: string;
  billing_period: string;
  user_count: number;
  note: string | null;
  requested_by_email: string | null;
  requested_by_name: string | null;
  created_at: string;
  tenants: { name: string } | null;
  current: { name: string } | null;
  requested: { name: string } | null;
}
interface EmailRow {
  id: string;
  created_at: string;
  kind: string;
  recipient: string | null;
  status: string;
  error: string | null;
  tenant_id: string;
  tenants: { name: string } | null;
}

export default async function BillingPage() {
  await requireAdmin();
  const { locale, messages, t } = await getI18n();
  const supabase = await createClient();
  const [settingsRes, invoicesRes, requestsRes, emailsRes] = await Promise.all([
    supabase.from("billing_settings").select("*").eq("id", true).maybeSingle(),
    supabase
      .from("invoices")
      .select("id, number, kind, status, currency, total, issued_at, due_date, paid_at, tenant_id, tenants(name)")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("plan_change_requests")
      .select(
        "id, tenant_id, billing_period, user_count, note, requested_by_email, requested_by_name, created_at, tenants(name), current:plans!plan_change_requests_current_plan_id_fkey(name), requested:plans!plan_change_requests_plan_id_fkey(name)"
      )
      .eq("status", "pending")
      .order("created_at"),
    supabase.from("billing_emails").select("id, created_at, kind, recipient, status, error, tenant_id, tenants(name)").order("created_at", { ascending: false }).limit(30),
  ]);
  const settings = (settingsRes.data ?? {}) as Record<string, unknown>;
  const invoices = (invoicesRes.data ?? []) as unknown as InvoiceRow[];
  const requests = (requestsRes.data ?? []) as unknown as RequestRow[];
  const emails = (emailsRes.data ?? []) as unknown as EmailRow[];
  const setup = billingSetup();
  const none = t("common.none");
  const prefix = String(settings.invoice_prefix ?? "INV");

  const initial = Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">{t("billingAdmin.title")}</h1>
          <p className="cp-muted">{t("billingAdmin.subtitle")}</p>
        </div>
      </header>

      <section className="cp-panel">
        <h2 className="cp-panel-title">{t("billingAdmin.setup.title")}</h2>
        <dl className="cp-dl">
          <dt>{t("billingAdmin.setup.job")}</dt>
          <dd>{t("billingAdmin.setup.jobHint")}</dd>
          <dt>{t("billingAdmin.setup.email")}</dt>
          <dd>
            {setup.emailMissing.length
              ? t("billingAdmin.setup.emailOff", { missing: setup.emailMissing.join(", ") })
              : t("billingAdmin.setup.emailOn")}
          </dd>
          <dt>{t("billingAdmin.setup.card")}</dt>
          <dd>
            {setup.card.missing.length
              ? t("billingAdmin.setup.cardOff", { missing: setup.card.missing.join(", ") })
              : t("billingAdmin.setup.cardOn", { id: setup.card.id })}
          </dd>
          <dt>{t("billingAdmin.setup.webhook")}</dt>
          <dd>
            {setup.webhookReady && !setup.card.missing.length
              ? t("billingAdmin.setup.webhookOn", { id: setup.card.id })
              : t("billingAdmin.setup.webhookOff")}
          </dd>
        </dl>
      </section>

      <section className="cp-panel">
        <h2 className="cp-panel-title">{t("billingAdmin.requests.title")}</h2>
        {requests.length === 0 ? (
          <p className="cp-muted">{t("billingAdmin.requests.empty")}</p>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t("billingAdmin.requests.columns.tenant")}</th>
                <th>{t("billingAdmin.requests.columns.from")}</th>
                <th>{t("billingAdmin.requests.columns.to")}</th>
                <th>{t("billingAdmin.requests.columns.users")}</th>
                <th>{t("billingAdmin.requests.columns.period")}</th>
                <th>{t("billingAdmin.requests.columns.note")}</th>
                <th>{t("billingAdmin.requests.columns.requested")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="cp-link" href={`/tenants/${r.tenant_id}/billing`}>
                      {r.tenants?.name ?? none}
                    </Link>
                  </td>
                  <td>{r.current?.name ?? none}</td>
                  <td>{r.requested?.name ?? none}</td>
                  <td>{r.user_count}</td>
                  <td>{t(`billing.subscription.periods.${r.billing_period}`)}</td>
                  <td>{r.note ?? ""}</td>
                  <td>
                    {formatDate(locale, r.created_at)}
                    {r.requested_by_name || r.requested_by_email ? (
                      <div className="cp-muted">{t("billingAdmin.requests.by", { name: r.requested_by_name || r.requested_by_email || "" })}</div>
                    ) : null}
                  </td>
                  <td>
                    <Link className="cp-button cp-button-secondary" href={`/tenants/${r.tenant_id}/subscription`}>
                      {t("billingAdmin.requests.open")}
                    </Link>{" "}
                    <form action={handlePlanRequest.bind(null, r.id, "approved")} style={{ display: "inline" }}>
                      <button className="cp-button cp-button-secondary" type="submit">
                        {t("billingAdmin.requests.approve")}
                      </button>
                    </form>{" "}
                    <form action={handlePlanRequest.bind(null, r.id, "rejected")} style={{ display: "inline" }}>
                      <button className="cp-button cp-button-secondary" type="submit">
                        {t("billingAdmin.requests.reject")}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cp-panel">
        <h2 className="cp-panel-title">{t("billingAdmin.invoices.title")}</h2>
        {invoices.length === 0 ? (
          <p className="cp-muted">{t("billingAdmin.invoices.empty")}</p>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t("billingAdmin.invoices.columns.number")}</th>
                <th>{t("billingAdmin.invoices.columns.tenant")}</th>
                <th>{t("billingAdmin.invoices.columns.kind")}</th>
                <th>{t("billingAdmin.invoices.columns.status")}</th>
                <th>{t("billingAdmin.invoices.columns.total")}</th>
                <th>{t("billingAdmin.invoices.columns.issued")}</th>
                <th>{t("billingAdmin.invoices.columns.due")}</th>
                <th>{t("billingAdmin.invoices.columns.paid")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <a className="cp-link" href={`/invoices/${i.id}/pdf`} target="_blank" rel="noopener">
                      {i.number}
                    </a>
                  </td>
                  <td>
                    <Link className="cp-link" href={`/tenants/${i.tenant_id}/billing`}>
                      {i.tenants?.name ?? none}
                    </Link>
                  </td>
                  <td>{t(`billingAdmin.invoices.kinds.${i.kind}`)}</td>
                  <td>
                    <span className={`cp-badge ${INVOICE_STATUS_BADGE[i.status] ?? "cp-badge-muted"}`}>{t(`billingAdmin.invoices.statuses.${i.status}`)}</span>
                  </td>
                  <td>{formatMoney(locale, i.total, i.currency)}</td>
                  <td>{formatDate(locale, i.issued_at)}</td>
                  <td>{formatDate(locale, i.due_date)}</td>
                  <td>{formatDate(locale, i.paid_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cp-panel">
        <h2 className="cp-panel-title">{t("billingAdmin.emails.title")}</h2>
        {emails.length === 0 ? (
          <p className="cp-muted">{t("billingAdmin.emails.empty")}</p>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t("billingAdmin.emails.columns.date")}</th>
                <th>{t("billingAdmin.emails.columns.tenant")}</th>
                <th>{t("billingAdmin.emails.columns.kind")}</th>
                <th>{t("billingAdmin.emails.columns.recipient")}</th>
                <th>{t("billingAdmin.emails.columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(locale, e.created_at, true)}</td>
                  <td>{e.tenants?.name ?? none}</td>
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

      <section className="cp-panel">
        <h2 className="cp-panel-title">{t("billingAdmin.settings.title")}</h2>
        <BillingSettingsForm
          action={saveBillingSettings}
          initial={initial}
          labels={{
            ...messages.billingAdmin.settings,
            saving: messages.common.saving,
            prefixHint: t("billingAdmin.settings.prefixHint", { example: formatInvoiceNumber(prefix, new Date().getUTCFullYear(), 1) }),
            timeline: t("billingAdmin.settings.timeline", {
              grace: Number(settings.grace_days ?? 7),
              readOnly: Number(settings.suspend_after_days ?? 30),
            }),
          }}
          errorLabels={messages.billingAdmin.errors}
        />
      </section>
    </>
  );
}
