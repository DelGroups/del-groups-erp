"use client";

import { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { FiltersLabToolbar } from "@/views/components/FiltersLabToolbar";
import type { ViewDefinition, ViewRecord } from "@/views/types";
import { purchaseToRecord, purchasesDefinition, purchasesModel } from "../views/purchases";

/* UI lab (FLT-2, dev only): the purchase list toolbar with the "Filtrlər" menu on sample invoices. */
const model = { fetchAll: async () => [], fetchOne: async () => null };

function labPurchases(): ViewRecord[] {
  const suppliers = [
    ["sup-1", "Şəki Ağac Emalı ASC"],
    ["sup-2", "Gəncə Metal MMC"],
    ["sup-3", "Bakı Laminat"],
  ];
  return Array.from({ length: 12 }, (_, i) =>
    purchaseToRecord({
      id: `p${i + 1}`,
      invoice_number: `AL-2026/${String(i + 1).padStart(4, "0")}`,
      doc_date: `2026-11-${String(i + 1).padStart(2, "0")}`,
      status: i % 5 === 0 ? "draft" : "posted",
      supplier_id: suppliers[i % 3][0],
      supplier_name: suppliers[i % 3][1],
      responsible_id: i % 2 ? "u-resad" : "u-omer",
      responsible_name: i % 2 ? "Rəşad Hüseynov" : "Ömər Çələbiyev",
      created_by: "u-sebine",
      created_by_name: "Səbinə Qasımova",
      total_amount: 250 * (i + 1),
      paid_amount: 0,
      debt_amount: 250 * (i + 1),
    })
  );
}

export default function PurchasesFiltersLab() {
  const { t } = useI18n();
  const def = useMemo(() => purchasesDefinition(purchasesModel(model)) as unknown as ViewDefinition, []);
  const rows = useMemo(() => labPurchases(), []);
  return <FiltersLabToolbar definition={def} title={t("nav.items.purchases")} records={rows} />;
}
