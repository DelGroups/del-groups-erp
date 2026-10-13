import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { loadModules } from "@/lib/billing/catalog";
import PlanEditor from "../PlanEditor";
import { planEditorValues } from "../values";

export default async function NewPlanPage() {
  await requireAdmin();
  const { locale, messages, t } = await getI18n();
  const modules = await loadModules(await createClient());
  return (
    <>
      <header className="cp-page-header">
        <h1 className="erp-h3">{t("billing.planEditor.titleNew")}</h1>
        <Link className="cp-button cp-button-secondary" href="/plans">
          {t("common.back")}
        </Link>
      </header>
      <PlanEditor
        planId={null}
        initial={planEditorValues(null, modules.map((m) => m.id))}
        modules={modules.map((m) => ({ id: m.id, name: m.name, depends: [...m.depends], isCore: m.isCore }))}
        locale={locale}
        labels={messages.billing}
        saved={false}
      />
    </>
  );
}
