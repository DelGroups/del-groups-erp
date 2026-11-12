"use client";

import { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { FiltersLabToolbar } from "@/views/components/FiltersLabToolbar";
import type { ViewDefinition, ViewRecord } from "@/views/types";
import { saleToRecord, salesDefinition, salesModel } from "../views/sales";

/*
 * UI lab (FLT-2, dev only): the sales list toolbar with the "Filtrlər" menu on sample invoices.
 * Two different creator accounts share a name, so the muted id line shows (item 7).
 */
const model = { fetchAll: async () => [], fetchOne: async () => null };

const SELLERS = [
  ["u-ulviyya", "Ulviyya Shahbazova", 9],
  ["u-omer", "Ömər Çələbiyev", 4],
  ["u-aynur", "Aynur Əliyeva", 3],
  ["u-resad", "Rəşad Hüseynov", 2],
  ["u-gulsen", "Gülşən Məmmədova", 2],
  ["u-elvin", "Elvin Qasımov", 1],
] as const;

function labSales(): ViewRecord[] {
  const rows: ViewRecord[] = [];
  let n = 1;
  for (const [id, name, count] of SELLERS) {
    for (let i = 0; i < count; i += 1) {
      // Two creator accounts with the same name (item 7): told apart by the id line.
      const creator = n % 5 === 0 ? ["99999999-8888-7777-6666-cccccc000001", "Ulviyya Shahbazova"] : ["11111111-2222-3333-4444-aaaaaabbbbbb", "Ulviyya Shahbazova"];
      rows.push(
        saleToRecord({
          id: `s${n}`,
          doc_no: `SAT-2026/${String(n).padStart(4, "0")}`,
          doc_date: `2026-11-${String((n % 28) + 1).padStart(2, "0")}`,
          status: n % 4 === 0 ? "draft" : "posted",
          customer_name: "Şüşə Dünyası MMC",
          total_amount: 100 * n,
          paid_amount: n % 3 === 0 ? 0 : 100 * n,
          remaining_balance: n % 3 === 0 ? 100 * n : 0,
          seller_id: `emp-${n % 3}`,
          seller_name: name,
          issued_by: id,
          issued_by_name: name,
          created_by: n % 2 ? creator[0] : "u-sebine",
          created_by_name: n % 2 ? creator[1] : "Səbinə Qasımova",
        })
      );
      n += 1;
    }
  }
  return rows;
}

export default function SalesFiltersLab() {
  const { t } = useI18n();
  const def = useMemo(() => salesDefinition(salesModel(model)) as unknown as ViewDefinition, []);
  const rows = useMemo(() => labSales(), []);
  return <FiltersLabToolbar definition={def} title={t("nav.items.sales")} records={rows} />;
}
