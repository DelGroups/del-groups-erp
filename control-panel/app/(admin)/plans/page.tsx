import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/format";
import { loadPlans, toPlanPricing } from "@/lib/billing/catalog";

export default async function PlansPage() {
  await requireAdmin();
  const { locale, t } = await getI18n();
  const plans = await loadPlans(await createClient());
  const unlimited = t("billing.unlimited");

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">{t("plans.title")}</h1>
          <p className="cp-muted">{t("plans.subtitle")}</p>
        </div>
        <Link className="cp-button" href="/plans/new">
          {t("plans.new")}
        </Link>
      </header>
      <section className="cp-panel">
        {plans.length === 0 ? (
          <p className="cp-muted">{t("plans.empty")}</p>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t("plans.columns.name")}</th>
                <th>{t("plans.columns.code")}</th>
                <th>{t("plans.columns.baseFee")}</th>
                <th>{t("plans.columns.prices")}</th>
                <th>{t("plans.columns.maxUsers")}</th>
                <th>{t("plans.columns.annualDiscount")}</th>
                <th>{t("plans.columns.active")}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const pricing = toPlanPricing(plan);
                return (
                  <tr key={plan.id}>
                    <td>
                      <Link className="cp-link" href={`/plans/${plan.id}`}>
                        {plan.name}
                      </Link>
                    </td>
                    <td>
                      <code>{plan.code}</code>
                    </td>
                    <td>{formatMoney(locale, pricing.baseFee, pricing.currency)}</td>
                    <td>{pricing.modules.length}</td>
                    <td>{pricing.maxUsers ?? unlimited}</td>
                    <td>{pricing.annualDiscountPct}%</td>
                    <td>{plan.is_active ? t("common.yes") : t("common.no")}</td>
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
