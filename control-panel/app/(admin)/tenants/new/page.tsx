import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import TenantForm from "../TenantForm";
import { createTenant } from "../actions";
import { tenantFormLabels } from "../labels";

export default async function NewTenantPage() {
  await requireAdmin();
  const { messages, t } = await getI18n();

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">{t("tenants.createTitle")}</h1>
          <p className="cp-muted">{t("tenants.createSubtitle")}</p>
        </div>
        <Link className="cp-button cp-button-secondary" href="/tenants">
          {t("common.back")}
        </Link>
      </header>
      <section className="cp-panel">
        <TenantForm
          action={createTenant}
          initial={{ name: "", slug: "", status: "provisioning", country: "AZ", language: "az", currency: "AZN", notes: "" }}
          labels={tenantFormLabels(messages, t("tenants.new"))}
          suggestSlugFromName
        />
      </section>
    </>
  );
}
