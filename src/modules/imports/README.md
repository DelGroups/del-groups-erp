# Imports ("İdxal")

Import shipments bought in a foreign currency, with every cost that makes up the landed cost of
each product. Plan: `docs/claude-code-prompts.md`, "پرامپت IMP". Del approved the decisions on
2026-10-29. Behind `NEW_IMPORTS` (server env, off by default), new UI only.

## IMP-1 (this step): data, exchange rates, landed cost

- **Shipment:** supplier, currency (AZN, USD, EUR, TRY, CNY, RUB), invoice number, date and rate,
  incoterm, customs declaration with its rate, default warehouse, notes, status
  (draft → confirmed → cleared → partially_received → received → closed, or cancelled).
  Numbers are `IMP-YYYY-NNNN`.
- **Product lines:** quantity in the purchase unit and in the stock unit (metres for sheet
  products = sheets × sheet length), price in the shipment currency, total weight and volume,
  HS code, duty rate, warehouse (empty = the shipment's).
- **Cost lines:** type, partner (a supplier: carrier, customs, broker), amount in its own
  currency and rate, recoverable VAT in AZN, capitalized or not, split method, estimate, paid now
  and from which account.
- **CBAR rates:** "Get CBAR rate" reads `https://www.cbar.az/currencies/DD.MM.YYYY.xml` on the
  server and stores the bulletin in `exchange_rates`. The rate on a document can always be typed
  instead. When the site is down the form says so; it never uses 1.
- **Landed cost** (`src/lib/imports/landedCost.ts`, pure): goods at the invoice rate; customs
  value = goods + capitalized international freight and insurance (settings); duty per line =
  customs value × duty rate; customs VAT suggestion = 18 % (setting) × (customs value + duty),
  recoverable, never capitalized; every other capitalized cost split by its own method
  (value, quantity, weight, volume, chargeable weight, equal, manual). Splits are in cents and the
  remainder goes to the largest line, so every split adds up exactly.
- **Settings › Imports:** customs VAT rate, chargeable-weight factor (333 kg/m³), which costs are
  part of the customs value, and per cost type: name, default method, capitalized, VAT rate,
  default partner.
- **Attachments and notes:** the record's chatter (`import_shipments` in `chatter_models()`).

Saving is for drafts only. Amounts are hidden from users without `dashboard.view_financials`;
they see shipments without amounts and cannot save.

## Not in IMP-1

- IMP-2: confirm and approve, payables and payments per partner, receipt into several
  warehouses with a printed slip, stock (FIFO batches at landed cost) and every journal entry
  (1360 goods in transit, 1410 VAT, 2100 payables), late costs after receipt.
- IMP-3: exchange differences (4960 / 6260), reports and prints.

## Permissions

| Matrix | Flat key | Who by default |
| --- | --- | --- |
| `imports.view` | `can_view_imports` | admins |
| `imports.manage` | `can_manage_imports` | admins |
| `imports.approve` | `can_approve_imports` | admins (used from IMP-2) |

The database checks the same with `public.imports_can(action)`; reading amounts also needs
`public.can_view_financials()`.

## IMP-4: form v2, warehouse per line, landed cost grid

Behind `UI_STANDARD` (the IMP-1 layout stays when it is off, with the standard pickers).

- **General tab:** header (supplier, currency, incoterm, invoice no and date, default warehouse,
  notes), one **Rates** section (invoice and customs rate with a refresh icon each, "Refresh all
  rates" for the invoice, customs and every foreign-currency cost), products and costs on the
  LineGrid. The customs rate follows the invoice rate until it has its own value
  (`lib/rates.ts`, stored as `customs_rate = null` while it follows).
- **Warehouse per line:** every line shows its warehouse (the header's, muted, until it has its
  own). "Split across warehouses" plans one line over any number of warehouses
  (`import_shipment_line_warehouses`, migration `20261104100000_imports_line_warehouses.sql`); the
  rows add up to the line, whole sheets for sheet products (`lib/lineWarehouses.ts`, checked again
  by `import_shipment_save_draft`). The receive dialog starts from the plan, one row per planned
  warehouse; a row that differs from the plan is marked. `receive_import_shipment` is unchanged.
- **Landed cost tab:** the DataGrid, totals = the sum of the cells (a cost not fully split shows
  its unallocated part), a summary strip, the sale price suggestion from a margin. A capitalized
  cost with nothing to split by (`zero_basis`) blocks saving (`cost_unallocated`). Plausibility
  warnings (`lib/landedChecks.ts`) never block.
- `/dev/ui-lab?frame=import` shows the form with the mockup's sample data; `npm run ui:guard`
  checks it.
