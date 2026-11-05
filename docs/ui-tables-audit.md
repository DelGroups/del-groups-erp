# UI tables audit (UI-6, 2026-11-05)

This file lists every component that renders a raw `<table>` or imports the old
`src/components/ui/table.tsx`, with what happened to it in UI-6.

- **DataGrid:** lists, reports and read-only line tables. They use `StandardGrid` (`src/components/lists/StandardGrid.tsx`), `ListGrid` or the view engine's `ListView`.
- **LineGrid:** editable document lines (`src/components/line-grid`).
- **keep:** print layouts, tiny key-value blocks, markup that is not a list, and the old table component itself.
- **later:** left for a separate task, with the reason.

**How the converted screens switch.** Every converted screen switches on `useUiStandard()` (UI_STANDARD). With the flag off, the old table renders unchanged. So a converted file still contains its old table, and the guard allowlist (`scripts/ui-guard-allowlist.json`, `rawTable`) still counts it. The allowlist only stops *new* raw tables. It shrinks when a flag-off branch is deleted after UI_STANDARD is retired.

**What the guard ignores (exempt by path):**
- `src/design-system/**` (DataGrid, the Stats heatmap);
- `src/components/line-grid/**`;
- `src/components/print/**`;
- `*PrintTemplate.tsx`, `*PrintLayout.tsx`, `*Sheet.tsx` (CostSheet, ReceivingSheet).

## Converted in UI-6

| File | Screen | Kind | Decision | Status |
| --- | --- | --- | --- | --- |
| `src/modules/accounting/components/CashBankPage.tsx` | Finance › Cash & bank | list | DataGrid | converted: edit / delete in the row menu |
| `src/modules/accounting/components/TrialBalanceTable.tsx` | Reports › Trial balance | report | DataGrid | converted: sticky totals row |
| `src/modules/accounting/components/FinancialReportView.tsx` | Reports › Financial report | report | DataGrid | converted: two grids, totals row, texts moved to i18n (`tablesStd.finReport`) |
| `src/modules/accounting/components/GlFinancialReportsDashboard.tsx` | Reports › GL reports, general ledger | report | DataGrid | converted: "code · account" on one line; balance lists stay key-value |
| `src/modules/accounting/components/OpeningBalancesPage.tsx` | Finance › Opening balances (customers, suppliers) | list | DataGrid | converted: amount input in the row, Save in the pinned actions column |
| `src/modules/commissions/components/CommissionRulesPage.tsx` | Settings › Commissions | list | DataGrid | converted: shared `CommissionRulesGrid` |
| `src/modules/commissions/components/LegacyCommissionRulesPage.tsx` | /comissions | list | DataGrid | converted: shared `CommissionRulesGrid` |
| `src/modules/commissions/components/MonthlyCommissionReportPage.tsx` | Commissions › Monthly report | report | DataGrid | converted: one grid per seller |
| `src/modules/commissions/components/PendingCommissionsView.tsx` | Commissions › Pending | report | DataGrid | converted: product · category on one line, totals row |
| `src/modules/consignment/components/ConsignmentsPage.tsx` | Consignment › Stock, Alerts (History was already ListGrid) | list | DataGrid | converted |
| `src/modules/consignment/components/ConsignmentsScreen.tsx` | Consignment (new UI) › document lines tab | line items (read-only) | DataGrid | converted: totals row |
| `src/modules/consignment/components/ConsignmentRepPerformanceChart.tsx` | Consignment › Rep performance | report | DataGrid | converted |
| `src/modules/consignment/components/ConsignmentDispatchNewPage.tsx` | Consignment › New dispatch | line items | LineGrid | converted: stock check as a cell error |
| `src/modules/consignment/components/ConsignmentInitialBalanceNewPage.tsx` | Consignment › Initial balance | line items | LineGrid | converted |
| `src/modules/consignment/components/ConsignmentReturnModal.tsx` | Consignment › Return | line items | LineGrid | converted |
| `src/modules/consignment/components/ConsignmentSettlementNewPage.tsx` | Consignment › Settlement | line items | LineGrid | converted: line total footer |
| `src/modules/contracts/components/ContractLinkedInvoicesModal.tsx` | Contracts › Linked invoices | list | DataGrid | converted: the first column links to the document |
| `src/modules/contracts/components/ContractsScreen.tsx` | Contracts (new UI) › Linked tab | list | DataGrid | converted |
| `src/modules/crm/components/DealFormScreen.tsx` | CRM › Deal › Quotations | list | DataGrid | converted: open / print / convert / view order in the row menu |
| `src/modules/crm/components/pipeline/PipelineDealScreen.tsx` | CRM pipeline › Deal › Quotations | list | DataGrid | converted: row menu with invoice / open sale |
| `src/modules/crm/components/pipeline/CrmConfigScreen.tsx` | CRM › Settings › Targets | list | DataGrid | converted: delete in the row menu |
| `src/modules/crm/components/pipeline/CrmReportsScreen.tsx` | CRM › Reports (forecast, win rate) | report | DataGrid | converted |
| `src/modules/crm/components/QuotationBuilderModal.tsx` | CRM › Quotation builder | line items | LineGrid | converted: a custom item's name in its own column |
| `src/modules/documents/components/DocumentsScreen.tsx` | Documents › list mode | list | DataGrid | converted: selection column |
| `src/modules/expenses/components/ExpenseMonthlyReport.tsx` | Expenses › Monthly report | report | DataGrid | converted: one column per month, totals row |
| `src/modules/hr/components/EmployeesPage.tsx` | HR › Leaves (Employees list was already ListGrid) | list | DataGrid | converted: approve / reject in the row menu |
| `src/modules/imports/components/PostingPanel.tsx` | Imports › Payables, Journal | list, report | DataGrid | converted: Pay in the row menu; the receive dialog is "later" (see below) |
| `src/modules/inventory/components/WarehousesPage.tsx` | Inventory › Warehouses | list | DataGrid | converted |
| `src/modules/inventory/components/WarehouseStockPage.tsx` | Inventory › Warehouse stock | list | DataGrid | converted: transfer / kardex in the row menu, same pagination |
| `src/modules/inventory/components/StockIntegrityPage.tsx` | Settings › Stock integrity | report | DataGrid | converted: fix / open product in the row menu |
| `src/modules/inventory/components/InventoryTurnoverTable.tsx` | Reports › Inventory turnover | report | DataGrid | converted: totals row |
| `src/modules/inventory/components/InventoryScreens.tsx` | Inventory (new UI) › record lines | line items (read-only) | DataGrid | converted |
| `src/modules/inventory/components/CategoryBulkSelectModal.tsx` | Inventory › Pick products by category | list | DataGrid | converted: selection column |
| `src/modules/inventory/components/DamagedGoodsViewModal.tsx` | Inventory › Write-off view | line items (read-only) | DataGrid | converted |
| `src/modules/inventory/components/DamagedGoodsForm.tsx` | Inventory › New write-off | line items | LineGrid | converted |
| `src/modules/inventory/components/StockTransferNewPage.tsx` | Inventory › New transfer | line items | LineGrid | converted: one "Add a line" (the grid's) |
| `src/modules/inventory/components/InitialBalanceForm.tsx` | Inventory › Initial balance | line items | LineGrid | converted: piece breakdown as its own column, price hint in the details drawer |
| `src/modules/payroll/components/AdvancesTab.tsx` | HR › Advances | list | DataGrid | converted |
| `src/modules/payroll/components/PayrollTab.tsx` | HR › Payroll | list | DataGrid | converted: Pay in the row menu |
| `src/modules/polywood/components/PolywoodImportPanel.tsx` | Polywood › Stock import preview | list | DataGrid | converted |
| `src/modules/production/components/ProductionBoardPage.tsx` | Production › list view | list | DataGrid | converted: edit / print / delete in the row menu |
| `src/modules/production/components/ProductionInProgressPhase.tsx` | Production › Workflow (materials, services, payments) | list | DataGrid | converted |
| `src/modules/production/components/ProductionOrderDetailPage.tsx` | Production › Order (outsourcing, materials, expenses) | list | DataGrid | converted |
| `src/modules/purchases/components/PurchaseRequisitionsPanel.tsx` | Purchases › Requisitions | list | DataGrid | converted |
| `src/modules/purchases/components/PurchasesScreen.tsx` | Purchases (new UI) › lines tab | line items (read-only) | DataGrid | converted: shared `DocumentLinesGrid` |
| `src/modules/purchases/components/PurchaseViewModal.tsx` | Purchases › View | line items (read-only) | DataGrid | converted: `DocumentLinesGrid` |
| `src/modules/sales/components/SaleDetailPage.tsx` | Sales › Sale detail | line items (read-only) | DataGrid | converted: `DocumentLinesGrid` |
| `src/modules/sales/components/SaleFormScreen.tsx` | Sales (new UI) › lines tab | line items (read-only) | DataGrid | converted: totals row |
| `src/modules/sales/components/SalesReportView.tsx` | Reports › Sales | report | DataGrid | converted: texts moved to i18n (`tablesStd.salesReport`) |
| `src/modules/sales/components/SalesViewModal.tsx` | Sales › View | line items (read-only) | DataGrid | converted: `DocumentLinesGrid` |
| `src/views/components/PivotView.tsx` | Every engine screen › Pivot | report | DataGrid | converted: totals row |
| `src/app/dashboard/partners/[id]/page.client.tsx` | Partners › Partner (sales, purchases, ledger) | list | DataGrid | converted |
| `src/app/settings/activity-types/page.client.tsx` | Settings › Activity types | list | DataGrid | converted |
| `src/app/settings/audit/page.client.tsx` | Settings › Audit log | list | DataGrid | converted: diff in the row menu |
| `src/app/settings/billing/page.client.tsx` | Settings › Billing › Invoices | list | DataGrid | converted: PDF in the row menu |
| `src/app/settings/initial-setup/page.client.tsx` | Settings › Initial setup › import preview | list | DataGrid | converted |
| `src/app/settings/modules/page.client.tsx` | Settings › Modules | list | DataGrid | converted |
| `src/app/users/page.client.tsx` | Settings › Users | list | DataGrid | converted: role as a Combobox in the row, the same row menu |
| `src/components/dashboard/LowStockAlerts.tsx` | Dashboard › Low stock | list | DataGrid | converted |
| `src/components/dashboard/RecentTransactionsTable.tsx` | Dashboard › Recent activity | list | DataGrid | converted |
| `src/components/reports/InventoryInsightsSection.tsx` | Reports › Executive › Top materials | report | DataGrid | converted (dead stock stays a card list) |
| `src/components/reports/ProjectProfitabilitySection.tsx` | Reports › Executive › Projects | report | DataGrid | converted |
| `src/components/finance/ExpenseCategoriesManager.tsx` | Expenses › Categories | list | DataGrid | converted: tree as indented rows, actions in the row menu |
| `src/components/studio/StudioFieldsEditor.tsx` | Settings › Studio fields | list | DataGrid | converted |

## Already on the grid before UI-6 (the table is the flag-off branch)

| File | Screen | Kind | Decision | Status |
| --- | --- | --- | --- | --- |
| `src/app/customers/page.client.tsx` | Customers | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/app/suppliers/page.client.tsx` | Suppliers | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/app/dashboard/partners/page.client.tsx` | Partners | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/components/products/ProductTable.tsx` | Products | list | DataGrid | converted earlier (UI-2) |
| `src/modules/accounting/components/FinancePage.tsx` | Finance | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/accounting/components/PaymentsPage.tsx` | Payments | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/contracts/components/ContractsPage.tsx` | Contracts | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/expenses/components/ExpensesPage.tsx` | Expenses | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/inventory/components/DamagedGoodsPage.tsx` | Inventory › Write-offs | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/inventory/components/InitialBalanceListPage.tsx` | Inventory › Initial balances | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/inventory/components/InventoryCountsPage.tsx` | Inventory › Counts | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/inventory/components/WarehouseSlipsPage.tsx` | Inventory › Warehouse slips | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/purchases/components/PurchasesPage.tsx` | Purchases | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/purchases/components/PurchaseForm.tsx` | Purchases › Purchase form | line items | LineGrid | converted earlier (UI-3, PurchaseLinesGrid) |
| `src/modules/sales/components/SalesPage.tsx` | Sales | list | DataGrid | converted earlier (UI-2, ListGrid) |
| `src/modules/imports/components/ImportFormScreen.tsx` | Imports › Import form | line items | LineGrid | converted earlier (IMP-4, ImportLinesGrid; the table is the flag-off form) |
| `src/modules/imports/components/LandedCostPanel.tsx` | Imports › Landed cost | report | DataGrid | replaced earlier: with the flag on, the import form shows LandedCostGrid (IMP-4); this panel renders only with the flag off |
| `src/views/components/ListView.tsx` | Every engine screen › List | list | DataGrid | converted earlier (UI-2) |

## Kept

| File | Screen | Kind | Decision | Reason |
| --- | --- | --- | --- | --- |
| `src/modules/accounting/components/PartnerReconciliationDocument.tsx` | Reports › Partner reconciliation | print | keep | A signed reconciliation document printed on paper |
| `src/views/components/GraphView.tsx` | Engine › Graph | small key-value | keep | Screen-reader copy of the chart (`sr-only`), not shown |
| `src/components/ai/AiAssistantMarkdown.tsx` | AI assistant | not a list | keep | Renders Markdown tables inside AI answers |
| `src/components/home/widgets/ManagementWidgets.tsx` | Home › Week over week | small key-value | keep | A compact delta card already designed in UI-5 |
| `src/components/home/widgets/PersonalWidgets.tsx` | Home › Calendar | not a list | keep | A month calendar grid |
| `src/app/products/page.client.tsx` | Products | not a list | keep | Imports only `BulkActionBar` from the old table module |
| `src/app/dev/ui-lab/GridLab.tsx` | /dev/ui-lab | not a list | keep | The lab shows the old and the new grid side by side |
| `src/app/dev/ui-lab/UiLab.tsx` | /dev/ui-lab | not a list | keep | Lab fixtures |
| `src/components/lists/listTable.tsx` | (helper) | not a list | keep | Header and body cells of the flag-off list tables |
| `src/components/ui/table.tsx` | (component) | not a list | keep | The old table component; goes with the flag-off branches |
| `src/components/ui/data-table.tsx` | (component) | not a list | keep | Old generic table, only re-exported, not used by any screen |
| `src/components/ui/pagination.tsx` | (component) | not a list | keep | Re-exports `TablePagination` (also used as a grid footer) |
| `src/components/ui/TableColumnResizer.tsx` | (global) | not a list | keep | Resizer of the old tables; skips grids |
| `src/hooks/useTableResize.ts` | (hook) | not a list | keep | Column widths of the old tables |
| `src/modules/consignment/components/ConsignmentInvoiceForm.tsx` | — | line items | keep | Not imported anywhere (dead code; listed in the PR) |
| `src/modules/payroll/components/PayrollModal.tsx` | — | line items | keep | Not imported anywhere (dead code; listed in the PR) |
| `src/modules/polywood/components/PolywoodInventoryPage.tsx` | — | list | keep | Not imported anywhere (dead code; listed in the PR) |

Print layouts are exempt from the guard by path and need no entry. They are: `InvoicePrintLayout`, all `*PrintTemplate` files (consignment delivery and settlement, contract, quotation, write-off, transfer, purchase, production contract and job card, inventory audit voucher, warehouse slip), `CostSheet` and `ReceivingSheet`.

## Later

| File | Screen | Kind | Decision | Why it was left |
| --- | --- | --- | --- | --- |
| `src/modules/sales/components/InvoiceForm.tsx` | Sales › Invoice form (classic) | line items | later | A 3,283-line editor: metric sheets and pieces, per-line discounts, a warehouse per line, price lists, a barcode flow and its own column resizer. It needs its own task (a `SaleLinesGrid` like `PurchaseLinesGrid`). |
| `src/modules/polywood/components/MixedDimensionalInvoiceForm.tsx` | Polywood › New sale | line items | later | Line types (sheet, offcut, service, accessory) change which cells exist, plus sale modes and offcut picking. |
| `src/modules/inventory/components/InventoryCountDetailPage.tsx` | Inventory › Count sheet | line items | later | Scanner focus flow, piece inputs for metric goods, and drift warnings that today sit on extra lines. They need LineGrid cell errors and keyboard care. |
| `src/modules/imports/components/PostingPanel.tsx` (receive dialog) | Imports › Receive | line items | later | Sheet-aware quantity inputs, row splits per warehouse, and per-row issue messages under the name. The payables and journal in the same file are converted. |
| `src/modules/imports/components/ImportSettingsScreen.tsx` | Imports › Settings › Cost types | line items | later | A settings matrix with seven controls per row, including checkboxes and a native method select. It needs Combobox and checkbox cells in LineGrid. |
| `src/components/invoices/InvoiceProductSelectorModal.tsx` | Sales invoice › Pick products | list | later | A keyboard-highlight picker with a quantity input per row, part of the classic invoice form above. |
| `src/components/products/BulkImportModal.tsx` | Products › Bulk import | list | later | A 13-column editable preview (skip, name checks, duplicate hints) inside a fixed-height modal. |
| `src/components/documents/DocumentAdditionalExpensesSection.tsx` | Purchase / sale › Additional expenses | line items | later | The category cell is the native `ExpenseCategorySelect` with a quick-add button. That select must move to Combobox first. |
