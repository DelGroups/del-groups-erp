import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { TenantStatus } from "@/lib/tenants";
import { dbVersion } from "@/lib/migrations/plan";
import { repoLatestVersion } from "@/lib/migrations/server";
import { erpSqlDir } from "@/lib/provisioning/config";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  created_at: string;
  tenant_domains: { domain: string; is_primary: boolean }[];
  tenant_databases: Version | Version[] | null;
}
interface Version {
  schema_version: string | null;
  last_migration: string | null;
}

export default async function TenantsPage() {
  await requireAdmin();
  const { locale, t } = await getI18n();
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, name, slug, status, created_at, tenant_domains(domain, is_primary), tenant_databases(schema_version, last_migration)")
    .order("created_at", { ascending: false });
  const tenants = (data ?? []) as TenantRow[];
  const latest = repoLatestVersion(erpSqlDir(process.env, process.cwd()));

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">{t("tenants.title")}</h1>
          <p className="cp-muted">{t("tenants.subtitle")}</p>
        </div>
        <Link className="cp-button" href="/tenants/new">
          {t("tenants.new")}
        </Link>
      </header>
      <section className="cp-panel">
        {tenants.length === 0 ? (
          <p className="cp-muted">{t("tenants.empty")}</p>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t("tenants.columns.name")}</th>
                <th>{t("tenants.columns.slug")}</th>
                <th>{t("tenants.columns.status")}</th>
                <th>{t("tenants.columns.domain")}</th>
                <th>{t("tenants.columns.dbVersion")}</th>
                <th>{t("tenants.columns.created")}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const db = Array.isArray(tenant.tenant_databases) ? (tenant.tenant_databases[0] ?? null) : tenant.tenant_databases;
                const version = dbVersion(db);
                const domain =
                  tenant.tenant_domains.find((d) => d.is_primary)?.domain ?? tenant.tenant_domains[0]?.domain;
                return (
                  <tr key={tenant.id}>
                    <td>
                      <Link className="cp-link" href={`/tenants/${tenant.id}`}>
                        {tenant.name}
                      </Link>
                    </td>
                    <td>
                      <code>{tenant.slug}</code>
                    </td>
                    <td>
                      <StatusBadge status={tenant.status} label={t(`tenants.statuses.${tenant.status}`)} />
                    </td>
                    <td>{domain ?? t("common.none")}</td>
                    <td>
                      {version ?? t("common.none")}
                      {version && latest && version < latest ? (
                        <>
                          {" "}
                          <span className="cp-badge cp-badge-warning">{t("tenants.detail.behind", { latest })}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{formatDate(locale, tenant.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
