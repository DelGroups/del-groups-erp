import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { loadModules, PLAN_SELECT, type PlanRow } from "@/lib/billing/catalog";
import PlanEditor from "../PlanEditor";
import { planEditorValues } from "../values";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;
  if (!UUID.test(id)) notFound();
  const { locale, messages, t } = await getI18n();
  const supabase = await createClient();
  const [modules, { data }] = await Promise.all([
    loadModules(supabase),
    supabase.from("plans").select(PLAN_SELECT).eq("id", id).maybeSingle(),
  ]);
  const plan = data as PlanRow | null;
  if (!plan) notFound();
  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">{t("billing.planEditor.titleEdit", { name: plan.name })}</h1>
          <p className="cp-muted">
            <code>{plan.code}</code>
          </p>
        </div>
        <Link className="cp-button cp-button-secondary" href="/plans">
          {t("common.back")}
        </Link>
      </header>
      <PlanEditor
        planId={plan.id}
        initial={planEditorValues(plan, modules.map((m) => m.id))}
        modules={modules.map((m) => ({ id: m.id, name: m.name, depends: [...m.depends], isCore: m.isCore }))}
        locale={locale}
        labels={messages.billing}
        saved={Boolean(saved)}
      />
    </>
  );
}
