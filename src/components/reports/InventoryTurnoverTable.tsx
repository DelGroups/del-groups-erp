"use client";

import type { InventoryTurnoverReport } from "@/lib/reports/inventoryTurnover";
import { formatReportMoney, formatReportQty } from "@/lib/reports/formatMoney";
import { useI18n } from "@/i18n/I18nProvider";

type InventoryTurnoverTableProps = {
  data: InventoryTurnoverReport;
  loading?: boolean;
};

export default function InventoryTurnoverTable({ data, loading }: InventoryTurnoverTableProps) {
  const { t } = useI18n();

  return (
    <div className="app-card overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-xs">
        <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
          <tr>
            <th className="p-2">{t("inventoryTurnover.colCode")}</th>
            <th className="p-2">{t("inventoryTurnover.colProduct")}</th>
            <th className="p-2">{t("inventoryTurnover.colUnit")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colInitialQty")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colInitialValue")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colInboundQty")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colInboundValue")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colOutboundQty")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colOutboundValue")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colClosingQty")}</th>
            <th className="p-2 text-right">{t("inventoryTurnover.colClosingValue")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app">
          {loading ? (
            <tr>
              <td colSpan={11} className="p-6 text-center text-app-muted">{t("common.loading")}</td>
            </tr>
          ) : data.rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="p-6 text-center text-app-muted">{t("inventoryTurnover.empty")}</td>
            </tr>
          ) : (
            data.rows.map((row) => (
              <tr key={row.productId} className="hover:bg-app-card-hover/60">
                <td className="p-2 font-mono">{row.productCode}</td>
                <td className="p-2">{row.productName}</td>
                <td className="p-2">{row.unit}</td>
                <td className="p-2 text-right font-mono">{formatReportQty(row.initialQty)}</td>
                <td className="p-2 text-right font-mono">{formatReportMoney(row.initialValue)}</td>
                <td className="p-2 text-right font-mono">{formatReportQty(row.inboundQty)}</td>
                <td className="p-2 text-right font-mono">{formatReportMoney(row.inboundValue)}</td>
                <td className="p-2 text-right font-mono">{formatReportQty(row.outboundQty)}</td>
                <td className="p-2 text-right font-mono">{formatReportMoney(row.outboundValue)}</td>
                <td className="p-2 text-right font-mono">{formatReportQty(row.closingQty)}</td>
                <td className="p-2 text-right font-mono">{formatReportMoney(row.closingValue)}</td>
              </tr>
            ))
          )}
        </tbody>
        {!loading && data.rows.length > 0 ? (
          <tfoot className="border-t-2 border-app font-bold">
            <tr>
              <td className="p-2" colSpan={3}>{t("inventoryTurnover.total")}</td>
              <td className="p-2 text-right font-mono">{formatReportQty(data.totals.initialQty)}</td>
              <td className="p-2 text-right font-mono">{formatReportMoney(data.totals.initialValue)}</td>
              <td className="p-2 text-right font-mono">{formatReportQty(data.totals.inboundQty)}</td>
              <td className="p-2 text-right font-mono">{formatReportMoney(data.totals.inboundValue)}</td>
              <td className="p-2 text-right font-mono">{formatReportQty(data.totals.outboundQty)}</td>
              <td className="p-2 text-right font-mono">{formatReportMoney(data.totals.outboundValue)}</td>
              <td className="p-2 text-right font-mono">{formatReportQty(data.totals.closingQty)}</td>
              <td className="p-2 text-right font-mono">{formatReportMoney(data.totals.closingValue)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
