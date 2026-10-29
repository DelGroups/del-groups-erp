/**
 * Saved views (view_favorites) as home shortcuts (prompt 24b): the page each view key lives on.
 * Keys without a page here are not offered. Pure.
 */
const PAGES: Record<string, string> = {
  "accounting.payments": "/dashboard/payments",
  "calendar.events": "/calendar",
  "commissions.pending": "/commissions",
  "consignment.documents": "/consignments",
  "contracts.list": "/contracts",
  "crm.deals": "/crm",
  "crm.pipeline": "/crm",
  "crm.leads": "/crm/leads",
  "expenses.documents": "/expenses",
  "hr.employees": "/employees",
  "inventory.stock": "/inventory",
  "inventory.slips": "/dashboard/warehouse/slips",
  "inventory.counts": "/inventory/counts",
  "production.orders": "/production",
  "purchases.invoices": "/purchases",
  "sales.invoices": "/sales",
  "sales.report": "/reports/sales",
  "todo.tasks": "/todo",
};

export function savedViewHref(viewKey: string): string | null {
  return PAGES[viewKey] ?? null;
}
