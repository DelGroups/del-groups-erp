import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { TenantStatus } from "@/lib/tenants";
import TenantForm from "../TenantForm";
import { updateTenant } from "../actions";
import { tenantFormLabels } from "../labels";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  country: string;
  language: string;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
interface Domain {
  id: string;
  domain: string;
  kind: string;
  is_primary: boolean;
  ssl_status: "pending" | "active" | "failed";
}
interface TenantDatabase {
  supabase_project_ref: string | null;
  region: string | null;
  schema_version: string | null;
  last_migration: string | null;
  last_migrated_at: string | null;
}
interface Subscription {
  status: string;
  plans: { name: string } | null;
  subscription_items: { module_id: string; modules: { name: string } | null }[];
}
interface Usage {
  snapshot_date: string;
  active_users: number;
}
interface AuditEntry {
  id: number;
  created_at: string;
  action: string;
  actor_email: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID.test(id)) notFound();

  const { locale, messages, t } = await getI18n();
  const supabase = await createClient();

  const [tenantRes, domainsRes, dbRes, subRes, usageRes, auditRes] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, slug, status, country, language, currency, notes, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tenant_domains")
      .select("id, domain, kind, is_primary, ssl_status")
      .eq("tenant_id", id)
      .order("is_primary", { ascending: false })
      .order("domain"),
    supabase
      .from("tenant_databases")
      .select("supabase_project_ref, region, schema_version, last_migration, last_migrated_at")
      .eq("tenant_id", id)
      .maybeSingle(),
    supabase
      .from("subscriptions")
      .select("status, plans(name), subscription_items(module_id, modules(name))")
      .eq("tenant_id", id)
      .in("status", ["trial", "active", "past_due"])
      .maybeSingle(),
    supabase
      .from("usage_snapshots")
      .select("snapshot_date, active_users")
      .eq("tenant_id", id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("platform_audit_log")
      .select("id, created_at, action, actor_email")
      .eq("entity_table", "tenants")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const tenant = tenantRes.data as Tenant | null;
  if (!tenant) notFound();
  const domains = (domainsRes.data ?? []) as Domain[];
  const database = dbRes.data as TenantDatabase | null;
  const subscription = subRes.data as Subscription | null;
  const usage = usageRes.data as Usage | null;
  const history = (auditRes.data ?? []) as AuditEntry[];

  const action = updateTenant.bind(null, tenant.id);
  const none = t("common.none");

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">
            {tenant.name} <StatusBadge status={tenant.status} label={t(`tenants.statuses.${tenant.status}`)} />
          </h1>
          <p className="cp-muted">
            <code>{tenant.slug}</code>
          </p>
        </div>
        <Link className="cp-button cp-button-secondary" href="/tenants">
          {t("common.back")}
        </Link>
      </header>

      {created ? (
        <p className="cp-alert cp-alert-success" role="status">
          {t("tenants.created")}
        </p>
      ) : null}

      <div className="cp-grid-2">
        <section className="cp-panel">
          <h2 className="cp-panel-title">{t("tenants.detail.domains")}</h2>
          {domains.length === 0 ? (
            <p className="cp-muted">{t("tenants.detail.noDomains")}</p>
          ) : (
            <table className="cp-table">
              <tbody>
                {domains.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.domain}{" "}
                      {d.is_primary ? <span className="cp-badge cp-badge-info">{t("tenants.detail.primary")}</span> : null}
                    </td>
                    <td>
                      {t("tenants.detail.ssl")}: {t(`tenants.detail.sslStatuses.${d.ssl_status}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="cp-panel">
          <h2 className="cp-panel-title">{t("tenants.detail.modules")}</h2>
          {!subscription ? (
            <p className="cp-muted">{t("tenants.detail.noSubscription")}</p>
          ) : (
            <>
              <p>
                {t("tenants.detail.plan")}: <strong>{subscription.plans?.name ?? none}</strong>
              </p>
              {subscription.subscription_items.length === 0 ? (
                <p className="cp-muted">{t("tenants.detail.noModules")}</p>
              ) : (
                <p>
                  {subscription.subscription_items.map((item) => (
                    <span key={item.module_id} className="cp-badge cp-badge-muted" style={{ marginRight: "var(--erp-space-1)" }}>
                      {item.modules?.name ?? item.module_id}
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </section>

        <section className="cp-panel">
          <h2 className="cp-panel-title">{t("tenants.detail.users")}</h2>
          {!usage ? (
            <p className="cp-muted">{t("tenants.detail.noUsage")}</p>
          ) : (
            <p>
              {t("tenants.detail.usersCount")}: <strong>{usage.active_users}</strong>{" "}
              <span className="cp-muted">{t("tenants.detail.asOf", { date: formatDate(locale, usage.snapshot_date) })}</span>
            </p>
          )}
        </section>

        <section className="cp-panel">
          <h2 className="cp-panel-title">{t("tenants.detail.database")}</h2>
          {!database ? (
            <p className="cp-muted">{t("tenants.detail.notProvisioned")}</p>
          ) : (
            <dl className="cp-dl">
              <dt>{t("tenants.detail.projectRef")}</dt>
              <dd>{database.supabase_project_ref ?? none}</dd>
              <dt>{t("tenants.detail.region")}</dt>
              <dd>{database.region ?? none}</dd>
              <dt>{t("tenants.detail.schemaVersion")}</dt>
              <dd>{database.schema_version ?? none}</dd>
              <dt>{t("tenants.detail.lastMigration")}</dt>
              <dd>
                {database.last_migration ?? none}
                {database.last_migrated_at ? ` (${formatDate(locale, database.last_migrated_at, true)})` : ""}
              </dd>
            </dl>
          )}
        </section>
      </div>

      <section className="cp-panel">
        <h2 className="cp-panel-title">{t("tenants.editTitle")}</h2>
        <TenantForm
          action={action}
          initial={{
            name: tenant.name,
            slug: tenant.slug,
            status: tenant.status,
            country: tenant.country,
            language: tenant.language,
            currency: tenant.currency,
            notes: tenant.notes ?? "",
          }}
          labels={tenantFormLabels(messages)}
        />
      </section>

      <section className="cp-panel">
        <h2 className="cp-panel-title">{t("tenants.detail.history")}</h2>
        {history.length === 0 ? (
          <p className="cp-muted">{t("tenants.detail.noHistory")}</p>
        ) : (
          <table className="cp-table">
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(locale, entry.created_at, true)}</td>
                  <td>{t(`tenants.detail.actions.${entry.action}`)}</td>
                  <td className="cp-muted">
                    {t("tenants.detail.by", { actor: entry.actor_email ?? t("tenants.detail.system") })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
