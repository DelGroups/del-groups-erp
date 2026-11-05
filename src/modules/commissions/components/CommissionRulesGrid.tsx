"use client";

import { Trash2 } from "lucide-react";
import { StandardGrid } from "@/components/lists/StandardGrid";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { formatMoney } from "@/lib/dates/localeDate";
import type { CommissionRule } from "@/types/database.types";

/** The commission rules on the grid (UI-6, behind UI_STANDARD): both rule pages show this one. */
export function CommissionRulesGrid({ id, rules, loading, onDelete }: { id: string; rules: readonly CommissionRule[]; loading: boolean; onDelete: (id: string) => void }) {
  const { t, locale } = useI18n();
  return (
    <StandardGrid<CommissionRule>
      id={id}
      label={t("commissions.rulesList")}
      rows={rules}
      rowKey={(r) => r.id}
      loading={loading}
      empty={t("commissions.emptyRules")}
      columns={[
        { key: "category", header: t("commissions.categoryName"), className: "font-medium", cell: (r) => r.category_name, sortValue: (r) => r.category_name },
        { key: "min", header: t("commissions.minSalesCol"), type: "money", cell: (r) => formatMoney(r.min_sales, locale), sortValue: (r) => r.min_sales },
        {
          key: "max",
          header: t("commissions.maxSalesCol"),
          type: "money",
          cell: (r) => (r.max_sales != null ? formatMoney(r.max_sales, locale) : t("common.limitNone")),
          sortValue: (r) => r.max_sales,
        },
        { key: "rate", header: t("commissions.commissionRate"), type: "number", className: "font-semibold", cell: (r) => `%${r.commission_percentage}`, sortValue: (r) => r.commission_percentage },
      ]}
      rowActions={(r) => (
        <TableRowActionsMenu items={[{ key: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" />, onClick: () => onDelete(r.id), variant: "destructive" }]} />
      )}
    />
  );
}
