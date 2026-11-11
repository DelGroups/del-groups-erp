"use client";

import { mapPartnerStatement } from "@/lib/reports/partnerStatement";
import { StatementEmpty, StatementGrid, StatementHeaderCard } from "./PartnerStatementView";
import StatementPrintLayout from "./StatementPrintLayout";

/** Sample statement: long names, a partner who is both, AZN and USD lines, a reversal. */
const SAMPLE = mapPartnerStatement({
  partner: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Abşeron",
    full_name: "Abşeron Tikinti və Təmir Materialları Məhdud Məsuliyyətli Cəmiyyəti",
    voen: "1402345671",
    is_customer: true,
    is_supplier: true,
    is_deleted: false,
    payment_terms_days: 30,
    phone: "+994 50 123 45 67",
    credit_limit: 5000,
  },
  from: "2026-10-01",
  to: "2026-10-31",
  side: "net",
  opening_balance: 1250,
  lines: [
    { entry_date: "2026-10-02", source_type: "sale", doc_no: "SS-2026-00041", description: "Satış fakturası", debit: 2480.5, credit: 0, currency_code: "AZN", amount_fc: 2480.5, doc_kind: "sale", doc_id: "00000000-0000-4000-8000-0000000000a1", created_by_name: "Nərmin Məmmədova" },
    { entry_date: "2026-10-05", source_type: "sale_payment", doc_no: "SS-2026-00041", description: "Satış fakturası SS-2026-00041 — Bank (Kapital Bank, hesablaşma hesabı)", debit: 0, credit: 1500, currency_code: "AZN", amount_fc: 1500, doc_kind: "sale", doc_id: "00000000-0000-4000-8000-0000000000a1", created_by_name: "Lalə Əliyeva" },
    { entry_date: "2026-10-09", source_type: "sale_payment_reversal", doc_no: "SS-2026-00041", description: "Ödənişin ləğvi (storno)", debit: 200, credit: 0, currency_code: "AZN", amount_fc: 200, doc_kind: "sale", doc_id: "00000000-0000-4000-8000-0000000000a1", created_by_name: "Lalə Əliyeva" },
    { entry_date: "2026-10-14", source_type: "import_payable", doc_no: "IMP-2026-0007", description: "İdxal: malın dəyəri", debit: 0, credit: 3400, currency_code: "USD", amount_fc: 2000, rate: 1.7, doc_kind: "import", doc_id: "00000000-0000-4000-8000-0000000000b1", created_by_name: "Rəşad Hüseynov" },
    { entry_date: "2026-10-20", source_type: "partner_payment", doc_no: null, description: "Ödəniş edildi", debit: 1700, credit: 0, currency_code: "AZN", amount_fc: 1700, created_by_name: "Lalə Əliyeva" },
  ],
  period_debit: 4380.5,
  period_credit: 4900,
  closing_balance: 730.5,
  currencies: [
    { currency_code: "AZN", debit: 4380.5, credit: 1500, net_fc: 2880.5 },
    { currency_code: "USD", debit: 0, credit: 3400, net_fc: -2000 },
  ],
});

/** UI lab (?frame=statement): the partner statement's header card, grid, subtotals and empty state. */
export default function PartnerStatementLab() {
  return (
    <div className="flex flex-col gap-4 p-4" data-ui-frame="statement">
      <StatementHeaderCard statement={SAMPLE} />
      <StatementGrid statement={SAMPLE} gridId="lab-partner-statement" />
      <StatementEmpty />
      {/* Paper version: shows only in print (emulate print media to check it). */}
      <StatementPrintLayout statement={SAMPLE} />
    </div>
  );
}
