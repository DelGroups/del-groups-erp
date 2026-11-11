"use client";

import { defaultDebtorQuery, mapBalanceReport, mapTurnoverReport } from "@/lib/reports/debtorReport";
import { BalanceGrid, BalanceKpis, TurnoverGrid, TurnoverKpis } from "./DebtorCreditorPage";

const Q = defaultDebtorQuery("2026-11-11");
const names = [
  "Abşeron Tikinti və Təmir Materialları MMC",
  "Gəncə Mebel Evi",
  "Sumqayıt Dizayn Studiyası",
  "Lənkəran Ağac Emalı",
  "Bakı Mətbəx Mərkəzi",
  "Şəki İnşaat",
];
const BALANCE = mapBalanceReport({
  as_of: "2026-11-11",
  tab: "debtors",
  total_count: 37,
  rows: names.map((n, i) => ({
    partner_id: `00000000-0000-4000-8000-00000000000${i}`,
    partner_name: n,
    phone: `+994 50 55${i} 12 3${i}`,
    is_customer: true,
    balance: [12480.5, 8350, 4200, 2975.2, 1500, 640][i],
    overdue: [6200, 0, 4200, 975.2, 0, 640][i],
    oldest_overdue_days: [74, null, 128, 12, null, 196][i],
    open_count: [5, 3, 2, 4, 1, 1][i],
    credit_limit: [10000, 15000, 0, 3000, 0, 500][i],
    credit_used_pct: [124.8, 55.7, null, 99.2, null, 128][i],
    last_payment_date: ["2026-10-28", "2026-11-05", "2026-07-02", "2026-10-30", null, "2026-04-01"][i],
    last_payment_amount: [3000, 1200, 800, 500, null, 150][i],
    payment_terms_days: [30, 14, 30, null, 7, 0][i],
  })),
  totals: { balance: 30145.7, overdue: 12015.2, open_count: 16 },
  kpi: {
    total_receivable: 48230.4,
    total_payable: 21480.9,
    net: 26749.5,
    overdue_receivable: 15730.2,
    top_debtors: names.map((n, i) => ({ partner_id: `p${i}`, partner_name: n, balance: [12480.5, 8350, 4200, 2975.2, 1500, 640][i] })),
  },
});
const TURNOVER = mapTurnoverReport({
  from: "2026-10-01",
  to: "2026-11-11",
  days: 42,
  total_count: 6,
  rows: names.map((n, i) => ({ partner_id: `t${i}`, partner_name: n, opening: [9000, 4000, 4200, 1500, 0, 640][i], debit: [8480.5, 6350, 0, 2475.2, 1500, 0][i], credit: [5000, 2000, 0, 1000, 0, 0][i], closing: [12480.5, 8350, 4200, 2975.2, 1500, 640][i], sales: [8480.5, 6350, 0, 2475.2, 1500, 0][i], dso: [53.2, 40.9, null, 37.9, 21, null][i], dpo: null })),
  totals: { opening: 19340, debit: 18805.7, credit: 8000, closing: 30145.7, sales: 18805.7, purchases: 9800, dso: 52.9, dpo: 61.4 },
});

/** UI lab (?frame=debtors): the debtor report's KPI strip, grid and the turnover tab with sample data. */
export default function DebtorReportsLab() {
  const noop = () => undefined;
  return (
    <div className="flex flex-col gap-4 p-4" data-ui-frame="debtors">
      <BalanceKpis report={BALANCE} />
      <BalanceGrid report={BALANCE} q={Q} onSort={noop} loading={false} />
      <TurnoverKpis report={TURNOVER} />
      <TurnoverGrid report={TURNOVER} q={{ ...Q, tab: "turnover", sort: "name", dir: "asc" }} onSort={noop} loading={false} />
    </div>
  );
}
