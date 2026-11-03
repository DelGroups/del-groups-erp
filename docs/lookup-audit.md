# Lookup audit (UI-2: lookup quick-create)

Rule: a user never leaves a form to create a related record. Every lookup field (customer, supplier,
product, warehouse, account, employee, category, …) is an `EntityLookup`: it searches the database as
the user types, and "+ New …" (under the list and next to the field) opens a quick-create dialog that
saves, selects the new record and keeps the form's state.

Everything below is behind `UI_STANDARD` (off by default): with the flag off each form renders its old
field unchanged. The component lives in `src/components/lookups/` (see docs/ui-standard.md, "Lookups").

"After" is `EntityLookup + quick create` unless a reason is written.

## Wired

| Form | Field | Entity | Before | After |
| --- | --- | --- | --- | --- |
| Import form `src/modules/imports/components/ImportFormScreen.tsx` | Supplier (Təchizatçı) | supplier | native select from a cached list | EntityLookup + quick create (live DB search; the new supplier is added to the form's cache) |
| Import form | Add product (Məhsul əlavə et) | product (stockable, not composite) | datalist | EntityLookup + quick create (the new product is added as a line) |
| Import form | Default warehouse; line warehouse | warehouse | native select | EntityLookup + quick create (line cell uses the compact size) |
| Import form | Cost "Kimə ödənilir" (paid to: carrier, customs, broker) | supplier | select with only "Tərəf yoxdur" | EntityLookup + quick create, with label and helper text |
| Import form | Cost cash account | account | native select | EntityLookup + quick create |
| Import form | Currency, incoterm, add-cost type, cost currency, split method | fixed lists | native select | Combobox (fixed choices, nothing to create) |
| Import form | Invoice date, customs declaration date | date | browser mm/dd/yyyy | DateField (dd.mm.yyyy) |
| Import posting `src/modules/imports/components/PostingPanel.tsx` | Receive: warehouse per line | warehouse | native select | EntityLookup + quick create (compact) |
| Import posting | Pay / prepay / cost: "pay from" accounts | account | native select | EntityLookup + quick create |
| Import posting | Add cost: paid to | supplier | native select | EntityLookup + quick create ("Kimə ödənilir") |
| Import settings `src/modules/imports/components/ImportSettingsScreen.tsx` | Default partner per cost type | supplier | native select | EntityLookup + quick create (compact) |
| Purchase `src/modules/purchases/components/PurchaseForm.tsx` | Supplier (legal only in official mode) | supplier | native select | EntityLookup + quick create (official mode creates a legal entity) |
| Purchase | Target warehouse | warehouse | native select | EntityLookup + quick create |
| Purchase | Payment account | account | native select | EntityLookup + quick create |
| Sales invoice `src/modules/sales/components/InvoiceForm.tsx` | Customer | customer | select + separate "Yeni müştəri" inline form | EntityLookup + quick create (the old inline form is hidden under the flag) |
| Sales invoice | Payment account | account | native select | EntityLookup + quick create |
| Polywood invoice `src/modules/polywood/components/MixedDimensionalInvoiceForm.tsx` | Customer, warehouse, payment account rows | customer, warehouse, account | native select | EntityLookup + quick create |
| Invoice / purchase / polywood `src/components/documents/ResponsiblePersonField.tsx` | Issuer / seller (responsible person) | employee | native select | EntityLookup + quick create |
| Document payment `src/components/documents/DocumentPaymentModal.tsx` | Account (single account) | account | native select | EntityLookup + quick create |
| Document expenses `src/components/documents/DocumentAdditionalExpensesSection.tsx` | Paid-from account per expense row | account | native select | EntityLookup + quick create (compact; category already had its quick-add) |
| Payment `src/components/payments/PaymentFormModal.tsx` | Partner (customer / supplier) | partner | native select | EntityLookup + quick create (role follows the payment type) |
| Payment | Cash / bank account | account | native select | EntityLookup + quick create |
| Expense `src/modules/expenses/components/ExpenseFormModal.tsx` | Employee, category, supplier, account, VAT account | employee, expenseCategory, supplier, account | native selects | EntityLookup + quick create |
| Expense reimbursement `src/modules/expenses/components/ExpensesPage.tsx` | Payment account | account | native select | EntityLookup + quick create |
| Payroll `src/modules/payroll/components/PayrollModal.tsx` | Payment account | account | native select | EntityLookup + quick create |
| Payroll pay `src/modules/payroll/components/PayPayrollModal.tsx` | Payment account | account | native select | EntityLookup + quick create |
| Advance `src/modules/payroll/components/AdvanceFormModal.tsx` | Employee, account | employee, account | native select | EntityLookup + quick create |
| Leave `src/modules/hr/components/LeaveFormModal.tsx` | Employee | employee | native select | EntityLookup + quick create |
| Inventory opening balance `src/modules/inventory/components/InitialBalanceForm.tsx` | Warehouse | warehouse | native select | EntityLookup + quick create |
| Damaged goods `src/modules/inventory/components/DamagedGoodsForm.tsx` | Warehouse | warehouse | native select | EntityLookup + quick create |
| Stock transfer `src/modules/inventory/components/StockTransferNewPage.tsx` | From / to warehouse | warehouse | native select | EntityLookup + quick create |
| CRM pipeline `src/modules/crm/components/pipeline/PipelineDialogs.tsx` | Quick deal customer; convert (link to customer) | customer | native select | EntityLookup + quick create |
| CRM deal `src/modules/crm/components/DealFormModal.tsx` | Client | customer | native select | EntityLookup + quick create |
| Production order `src/modules/production/components/ProductionOrderModal.tsx` | Customer, subcontractor, warehouse, advance account | customer, supplier, warehouse, account | native select | EntityLookup + quick create |
| Production workflow `src/modules/production/components/ProductionWorkflowModal.tsx` | Customer, installer, payment account | customer, employee, account | native select | EntityLookup + quick create |
| Production order detail `src/modules/production/components/ProductionOrderDetailPage.tsx` | Advance account, outsourcing supplier, contractor team | account, supplier, employee | native select | EntityLookup + quick create |
| Consignment invoice `src/modules/consignment/components/ConsignmentInvoiceForm.tsx` | Customer, payment accounts | customer, account | select + inline "+ Yeni Müştəri" form | EntityLookup + quick create |
| Consignment dispatch `src/modules/consignment/components/ConsignmentDispatchNewPage.tsx` | Partner shop, sales rep, warehouse | consignmentPartner, employee, warehouse | native select | EntityLookup + quick create |
| Consignment settlement `src/modules/consignment/components/ConsignmentSettlementNewPage.tsx` | Partner shop, sales rep | consignmentPartner, employee | native select | EntityLookup + quick create |
| Consignment opening balance `src/modules/consignment/components/ConsignmentInitialBalanceNewPage.tsx` | Partner shop | consignmentPartner | native select | EntityLookup + quick create |
| Consignment return `src/modules/consignment/components/ConsignmentReturnModal.tsx` | Partner shop, warehouse | consignmentPartner, warehouse | native select | EntityLookup + quick create |
| Contracts `src/modules/contracts/components/ContractsPage.tsx` | Party (supplier or customer by contract type, legal) | supplier / customer | native select | EntityLookup + quick create (creates a legal entity) |

## Not changed, with the reason

| Form | Field | Entity | Reason |
| --- | --- | --- | --- |
| Invoice, purchase, polywood, consignment, opening balance line items; QuotationBuilderModal, InvoiceProductSelectorModal, QuickScanModal | Product cell of a line | product | Line-item grids are UI-3 (new editable grid). EntityLookup already works in a cell (`size="sm"`, portal dropdown); the purchase form keeps its existing QuickAddProductModal until then. |
| Damaged goods, production material issue (`ProductionOrderDetailPage`, `ProductionInProgressPhase`) | Product / warehouse to take stock from | product, warehouse | Picks existing stock: a record created now has no stock to issue or write off. |
| Document forms (invoice, purchase) | Contract | contract | The contract picker already has its own quick-create (ContractQuickCreateModal). |
| Expense, document expenses, ledger row actions, official transaction | Expense category | expenseCategory | ExpenseCategorySelect already has a quick-add (QuickAddExpenseCategoryModal). The new expense form uses the lookup. |
| Product form, category manager, quick-add product | Product category / subcategory | productCategory | The product form has the category manager next to the field; the quick-create product dialog uses a category picker with create. |
| Quick-create product dialog | Unit | unit | A fixed list (PRODUCT_MEASURE_UNITS); a Combobox, nothing to create. |
| Document payment (split VAT mode) | Main / VAT accounts | account | Chooses only from the accounts the VAT split allows (filtered main and VAT lists); a new account would not be valid there. |
| Expense form | Department | department | Departments are a fixed list in settings, not a table with a create path. |
| Cash/bank, opening balances, customers, chart of accounts pages | Account type, price tier, … | fixed lists | Fixed choices, not lookups; they move to Combobox with the UI-0 select sweep. |
| Reports, list filters (expenses, inventory turnover, GL reports, partner reconciliation, consignments list, home) | Filter selects | various | Filters choose existing records; creating one from a filter makes no sense. |
| Merge partners, document requests | Partner | partner | Choose existing records to merge or to ask; no create by design. |
| Permission editor | User / role | user | Users are invited from settings (auth flow), not created inline. |
