import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/format";

interface PlanRow {
  id: string;
  code: string;
  name: string;
  annual_discount_pct: number;
  is_active: boolean;
  plan_prices: {
    module_id: string | null;
    billing_period: "monthly" | "yearly";
    currency: string;
    amount: number;
  }[];
}

export default async function PlansPage() {
  await requireAdmin();
  const { locale, t } = await getI18n();
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("id, code, name, annual_discount_pct, is_active, plan_prices(module_id, billing_period, currency, amount)")
    .order("sort_order")
    .order("name");
  const plans = (data ?? []) as PlanRow[];

  return (
    <>
      <header className="cp-page-header">
        <div>
          <h1 className="erp-h3">{t("plans.title")}</h1>
          <p className="cp-muted">{t("plans.subtitle")}</p>
        </div>
      </header>
      <section className="cp-panel">
        {plans.length === 0 ? (
          <p className="cp-muted">{t("plans.empty")}</p>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t("plans.columns.code")}</th>
                <th>{t("plans.columns.name")}</th>
                <th>{t("plans.columns.baseFee")}</th>
                <th>{t("plans.columns.annualDiscount")}</th>
                <th>{t("plans.columns.prices")}</th>
                <th>{t("plans.columns.active")}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const base = plan.plan_prices.find((p) => p.module_id === null && p.billing_period === "monthly");
                return (
                  <tr key={plan.id}>
                    <td>
                      <code>{plan.code}</code>
                    </td>
                    <td>{plan.name}</td>
                    <td>{base ? formatMoney(locale, base.amount, base.currency) : t("common.none")}</td>
                    <td>{Number(plan.annual_discount_pct)}%</td>
                    <td>{plan.plan_prices.length}</td>
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
