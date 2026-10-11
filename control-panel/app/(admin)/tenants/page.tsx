import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { TenantStatus } from "@/lib/tenants";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  created_at: string;
  tenant_domains: { domain: string; is_primary: boolean }[];
}

export default async function TenantsPage() {
  await requireAdmin();
  const { locale, t } = await getI18n();
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, name, slug, status, created_at, tenant_domains(domain, is_primary)")
    .order("created_at", { ascending: false });
  const tenants = (data ?? []) as TenantRow[];

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
                <th>{t("tenants.columns.created")}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
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
