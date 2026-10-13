import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { loadLiveSubscription, loadModules, loadPlans } from "@/lib/billing/catalog";
import { migrationConfig } from "@/lib/migrations/server";
import SubscriptionEditor from "./SubscriptionEditor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TenantSubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { locale, messages, t } = await getI18n();
  const supabase = await createClient();

  const [tenantRes, plans, modules, current, usageRes, dbRes] = await Promise.all([
    supabase.from("tenants").select("id, name, slug").eq("id", id).maybeSingle(),
    loadPlans(supabase),
    loadModules(supabase),
    loadLiveSubscription(supabase, id),
    supabase.from("usage_snapshots").select("active_users").eq("tenant_id", id).order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("tenant_databases").select("supabase_project_ref").eq("tenant_id", id).maybeSingle(),
  ]);
  const tenant = tenantRes.data as { id: string; name: string; slug: string } | null;
  if (!tenant) notFound();

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">{t("billing.subscription.editTitle", { name: tenant.name })}</h1>
          <p className="cp-muted">
            <code>{tenant.slug}</code>
          </p>
        </div>
        <Link className="cp-button cp-button-secondary" href={`/tenants/${tenant.id}`}>
          {t("common.back")}
        </Link>
      </header>
      <SubscriptionEditor
        tenant={tenant}
        plans={plans}
        modules={modules}
        current={current}
        activeUsers={(usageRes.data as { active_users: number } | null)?.active_users ?? null}
        today={new Date().toISOString().slice(0, 10)}
        locale={locale}
        labels={messages.billing}
        syncConfigured={migrationConfig().config !== null}
        hasDatabase={Boolean((dbRes.data as { supabase_project_ref: string | null } | null)?.supabase_project_ref)}
      />
    </>
  );
}
