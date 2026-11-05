"use client";

import type { InventoryTurnoverReport } from "@/lib/reports/inventoryTurnover";
import { formatReportMoney, formatReportQty } from "@/lib/reports/formatMoney";
import { useI18n } from "@/i18n/I18nProvider";
import { useUiStandard } from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { formatMoney, formatQuantity } from "@/lib/dates/localeDate";

type Row = InventoryTurnoverReport["rows"][number];
type Figure = "initialQty" | "initialValue" | "inboundQty" | "inboundValue" | "outboundQty" | "outboundValue" | "closingQty" | "closingValue";
const FIGURES: readonly [Figure, string][] = [
  ["initialQty", "colInitialQty"],
  ["initialValue", "colInitialValue"],
  ["inboundQty", "colInboundQty"],
  ["inboundValue", "colInboundValue"],
  ["outboundQty", "colOutboundQty"],
  ["outboundValue", "colOutboundValue"],
  ["closingQty", "colClosingQty"],
  ["closingValue", "colClosingValue"],
];

type InventoryTurnoverTableProps = {
  data: InventoryTurnoverReport;
  loading?: boolean;
};

export default function InventoryTurnoverTable({ data, loading }: InventoryTurnoverTableProps) {
  const { t, locale } = useI18n();
  // UI_STANDARD (UI-6): the turnover report on the grid with its totals row; old table with the flag off.
  const standard = useUiStandard();

  if (standard) {
    // Zero shows "—" like the old report.
    const show = (key: Figure, v: number) => (v === 0 ? "—" : key.endsWith("Qty") ? formatQuantity(v, locale) : formatMoney(v, locale));
    const columns: StandardColumn<Row>[] = [
      { key: "code", header: t("inventoryTurnover.colCode"), type: "code", cell: (r) => <span className="ds-mono">{r.productCode}</span>, sortValue: (r) => r.productCode },
      { key: "product", header: t("inventoryTurnover.colProduct"), width: 220, cell: (r) => r.productName, sortValue: (r) => r.productName },
      { key: "unit", header: t("inventoryTurnover.colUnit"), type: "code", width: 88, cell: (r) => r.unit },
      ...FIGURES.map<StandardColumn<Row>>(([key, label]) => ({ key, header: t(`inventoryTurnover.${label}`), type: key.endsWith("Qty") ? "number" : "money", cell: (r) => show(key, r[key]), sortValue: (r) => r[key] })),
    ];
    return (
      <StandardGrid<Row>
        id="reports-inventory-turnover"
        label={t("inventoryTurnover.pageTitle")}
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.productId}
        loading={loading}
        empty={t("inventoryTurnover.empty")}
        totals={Object.fromEntries([["code", t("inventoryTurnover.total")], ...FIGURES.map(([key]) => [key, show(key, data.totals[key])])])}
      />
    );
  }

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
                <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(row.initialQty)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.initialValue)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(row.inboundQty)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.inboundValue)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(row.outboundQty)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.outboundValue)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(row.closingQty)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(row.closingValue)}</td>
              </tr>
            ))
          )}
        </tbody>
        {!loading && data.rows.length > 0 ? (
          <tfoot className="border-t-2 border-app font-bold">
            <tr>
              <td className="p-2" colSpan={3}>{t("inventoryTurnover.total")}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(data.totals.initialQty)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.initialValue)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(data.totals.inboundQty)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.inboundValue)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(data.totals.outboundQty)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.outboundValue)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportQty(data.totals.closingQty)}</td>
              <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(data.totals.closingValue)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
