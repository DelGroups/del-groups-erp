"use client";

import { SalesFiltersLab } from "@/modules/sales/pages";
import { PurchasesFiltersLab } from "@/modules/purchases/pages";

/*
 * UI lab (FLT-2, dev only): the list toolbars of sales and purchases with the "Filtrlər" menu and
 * its person submenus, on sample invoices (no database). /dev/ui-lab?frame=filters.
 */
export function FiltersLab() {
  return (
    <div className="flex min-h-dvh flex-col gap-4 p-3 md:p-5" data-ui-lab-frame="filters">
      <SalesFiltersLab />
      <PurchasesFiltersLab />
    </div>
  );
}
