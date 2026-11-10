# UI audit of the whole ERP (UI-7, phase 1b–1c)

**When and how.** 2026-11-10, live site erp.del-groups.com, signed in as admin. Production has
UI_STANDARD, NEW_UI, LIST_COLUMNS, NEW_HOME, NEW_IMPORTS and SETTINGS_V2 on. **Look only:** nothing
was saved. Dialogs were opened and cancelled; menus were opened and closed with Escape.

- **Widths:**
  - 1366 px: Chrome maximised, viewport 1366×633.
  - 390×844: same-origin frames, because the window could not be resized.
  - 1920: a 70 % scaled frame (Settings audit, `docs/settings-redesign/audit.md`).
- **Theme and language:**
  - Dark (graphite) everywhere; light (daylight) on four pages. The theme is a browser-only setting and was switched back.
  - Russian could not be switched live: the language is saved to the user's profile, which would be a write. Russian was checked in the code instead (strings, lengths).
- **Measurement script:** every page also ran a script that counts headings, breadcrumbs, menus, buttons and primary buttons, native controls, unlabelled inputs, grids and tables, font families and sizes, uppercase text, radii, text below 4.5:1 contrast, targets under 24 px, every scroller and sideways scroll, and empty bands. It returns counts only, never personal data.
- **Screenshots** are in `screens/`. Names, emails and phone numbers are pixelated.

**Screens opened (51):**
- Apps.
- Home: home, to-do, documents.
- Ticarət: sales list, new invoice and its lines, invoice record (top and bottom), list filters, list row menu; purchases list and new purchase; contracts; consignments; imports; import reports.
- Anbar: products (dark and light), stock, new transfer, counts, initial balance, warehouses, slips, damaged goods, Polywood.
- Production: production list, BOM.
- CRM: pipeline, customers, the new-customer dialog, customer row menu, partners, calendar.
- Maliyyə: cash and bank, payments, expenses, transactions, opening balances.
- HR: employees, commissions, commission report.
- Reports: management reports, financial, trial balance, reconciliation, inventory turnover.
- Settings: hub, plus the 18 pages of SET-1.
- Shell: command palette, quick actions.
- Phone: sales list, new invoice and products at 390.
- A flag-off route (404).

**Not opened:**
- Record pages other than one sales invoice.
- "New" forms other than sales, purchase and transfer.
- Contract, consignment, production, employee and payroll forms.

They use the same parts (`ViewEngine` and `EngineScreen`, or the same classic form components), so the findings for their kind apply to them. Each area is checked again in its phase-3 PR.

**Code-side counts** (`src/**/*.tsx`, from main b80fcd1). These show how widely a pattern is used:

| Pattern | Files |
| --- | --- |
| Old glass header / box `app-glass` | 24 |
| Hand-made overlay `fixed inset-0` / `app-modal` | 51 / 40 |
| Radix dialog | 14 |
| Old `PageHeader` (`components/ui/page-header`) vs design-system `PageHeader` | 11 vs 2 |
| Pages with their own `<h1>` markup | 56 |
| Old `btn-primary` vs design-system `ds-btn` | 90 vs 68 |
| Gradient buttons/backgrounds | 33 |
| Raw Tailwind palette colours (`text-rose-500` …) | 141 |
| Text 10–11 px (`text-[10px]`, `text-[11px]`) | 111 |
| `uppercase` class | 90 |
| Native `<select>` | 87 |
| Raw `<table>` | 107 |
| Old `ToastMessage` | 62 |
| Token families: `--app-*` (38 tokens, 57 files), `--erp-*` (91 tokens, 42 files), `--ds-*` (137 tokens, 115 files) | 3 systems |
| Body font stack starts with "Vazirmatn", "Dana" (Persian faces); design system uses Inter | 2 families |
| i18n: az strings in Title Case (≥ 3 words, all capitalised) | 62 |
| i18n: ru strings identical to az / Latin-only | 27 / 21 |
| i18n: ru strings ≥ 40 % longer than az (layout risk) | 139 |
| `.tsx` files with hard-coded Azerbaijani text | 23 |

Severity: **high** = breaks or blocks a task, hides data, or fails WCAG AA; **medium** = visibly
inconsistent or slows work; **low** = polish. The rule column refers to `docs/ui-standard.md`.

## Findings

### Navigation and location

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NAV-01 | All apps | every page | 1280–1920 | high | **Settings has a left side menu, every other app has top tabs** — two navigation patterns. Anbar has 9 tabs and fills the row at 1366; in ru it overflows (arrows since SET-1). | NAV-1 | One pattern: the grouped left side menu for every app with ≥ 2 pages (research.md "navigation decision"). | `screens/settings-hub-1366.jpg`, `screens/products-1366.jpg` |
| NAV-02 | Ticarət, HR, Maliyyə, Hesabatlar, Əlaqələr | purchases, consignments, employees, opening balances, import reports, calendar | 1366 | high | **A second tab row inside the page** under the app tabs (e.g. "Alış fakturaları \| Satın Alma Tələbləri"; "İşçilər kataloqu \| Maaş və Bordro \| …"). Two levels of tabs that look alike (N9: don't mix navigation and in-page tabs). | NAV-1, NAV-5 | Sub-pages become items of the app's side menu (in a group); in-page tabs only for parts of one record. | `screens/purchases-list-1366.jpg`, `screens/employees-1366.jpg` |
| NAV-03 | All | 20 list pages (sales, purchases, contracts, consignments, imports, products, stock, warehouses, production, CRM, customers, calendar, cash-bank, expenses, transactions, employees, commissions, reports, to-do, documents) | all | medium | **No breadcrumbs on list pages**, but breadcrumbs on "new", record, report and some list pages (counts, initial balance, slips, payments, partners, damaged goods). | NAV-2 | Breadcrumbs on every page except Home, from one route map. | `screens/sales-list-1366.jpg` |
| NAV-04 | All | pages with crumbs | all | medium | **Four breadcrumb formats:** "Inventory › İnventarizasiya" (English route name); "Anbar və Məhsul › Stok Girişi…" (app first); "Əsas Panel › Anbar və Məhsul › Anbar Qaimələri" (home first); "Maliyyə / Tranzaksiyalar › Maliyyə İlkin Qalıqları" (a sibling page as parent). | NAV-2 | One format: App › Page › Record. The parent is always the app; never the home page or a sibling page. | `screens/counts-1366.jpg`, `screens/slips-1366.jpg`, `screens/opening-balances-1366.jpg` |
| NAV-05 | Anbar | new transfer | all | high | Crumbs **untranslated**: "Inventory › Transfers › Yeni". | NAV-2, TXT-2 | Labels from the route map in az/en/ru. | `screens/transfer-new-1366.jpg` |
| NAV-06 | Maliyyə | payments | all | medium | Payments is in Maliyyə, but its crumb says "Əsas Panel › Ödənişlər" (wrong app). | NAV-2 | Crumb parent = the app the page belongs to. | `screens/payments-1366.jpg` |
| NAV-07 | Hesabatlar | import reports | all | medium | The page sits in the Reports app tabs, but its crumbs and back link point to the Imports app ("İdxal › …", "← İdxal"). | NAV-2, NAV-4 | A page belongs to one app; crumbs follow it. | `screens/imports-reports-1366.jpg` |
| NAV-08 | Many | 6 pages | all | medium | **Five back patterns:** the shell back button; a "Geri" text link (BOM); "← Hesabatlara qayıt" (reports); a back arrow inside the header (commission report); "← İdxal" (import reports, import settings). | NAV-4 | Only the shell back button and the breadcrumbs; no in-page back links. | `screens/production-bom-1366.jpg`, `screens/report-financial-1366.jpg`, `screens/commission-report-1366.jpg` |
| NAV-09 | All | every page | all | medium | **One page, several names:** tab "Zədələnmə Çıxışı", crumb "Məhsullar › Zədələnmə Çıxışı", title "Anbar zədələnməsi / tullantı". Also tab "Anbar qalığı" vs title "Anbar əməliyyatları"; "CRM boru xətti" vs "Sövdələşmələr"; "Komissiyalar" vs "Satış Komissiyaları"; "Kassa və Bank" vs "Kassa və Bank Hesabları"; "Məhsullar" vs "Məhsullar və Anbar". | NAV-3 | Page title = last crumb = menu item name, from one list per app (as SET-1 did for Settings). | `screens/damaged-goods-1366.jpg` |
| NAV-10 | Anbar | Polywood qalığı | all | medium | The launcher item "Polywood qalığı" silently opens the products list. | NAV-3 | The item opens its own page, or it is removed. | `screens/products-1366.jpg` |
| NAV-11 | CRM, Settings | flag-off routes (/crm/leads, /settings/billing) | all | medium | **Next's default 404**: white, English, outside the shell, and it ignores the theme. | NAV-6 | Our own not-found page inside the shell (translated, with a link back to the app). | `screens/404-flag-off-1366.jpg` |
| NAV-12 | Settings | hub, every settings page | 1366×633 | low | The settings side menu shows **its own vertical scrollbar** next to the page scrollbar when the window is short. | PAGE-4, NAV-1 | The menu fits by collapsing groups, or scrolls with a hidden scrollbar and fades (like the tab bar). | `screens/settings-hub-1366.jpg` |

### Page layout

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PAGE-01 | All | 15 pages (products, warehouses, BOM, customers, partners, opening balances, 5 reports, commission report, new sale, new purchase, new transfer) | all | high | **Three page-header kinds:** (1) the design-system list header (title + count + actions), (2) the old glass header box with an icon and a bold 20 px `<h2>`, which has **no `<h1>` at all**, (3) none (new transfer has only a description line). Home has no `<h1>` either. | PAGE-1 | One `PageHeader` on every page: `<h1>` 22 px/600, one-line description, actions on the right. | `screens/products-1366.jpg`, `screens/warehouses-1366.jpg`, `screens/transfer-new-1366.jpg` |
| PAGE-02 | All | lists with KPIs (sales, purchases, contracts, consignments, imports, stock, counts, slips, cash-bank, expenses, transactions, employees, commissions …) | all | medium | **The page title is below the KPI cards** (and, on Sales, below a second row of charts). The user sees numbers before knowing which page this is; the list starts at about y = 400 on desktop and 3 screens down on a phone. | PAGE-2, PAGE-3 | Order: header (title, actions) → KPIs (one row, max 4) → toolbar → list. Charts collapse into a panel on lists. | `screens/sales-list-1366.jpg`, `screens/phone-390-sales-new-products.jpg` |
| PAGE-03 | All | h1 sizes | all | medium | Title sizes differ: 22 px/600 (lists), 20 px/700 (old headers, forms), 30 px/600 (sales record, documents). | PAGE-1, TOK-2 | One title style; record numbers are part of the title, not a 30 px display. | `screens/sales-record-1366.jpg`, `screens/documents-1366.jpg` |
| PAGE-04 | Ticarət | new sale, new purchase | all | medium | **Title twice:** the page header "Yeni satış fakturası" and the form card "Yeni satış fakturası" (also `<h1>` + `<h2>` on new purchase). | FORM-6 | Title once, in the page header; the status chip and number sit next to it. | `screens/sales-new-1366.jpg`, `screens/purchases-new-1366.jpg` |
| PAGE-05 | CRM, Documents, HR, Contacts | CRM pipeline (196 px), documents (175), commission report (179), calendar (89) | 1366 | medium | **Empty band** under the content above the 48 px limit (SCROLL-1 rule). | PAGE-4 | Board and empty pages fill the frame; or the frame ends at its content. | `screens/crm-pipeline-1366.jpg`, `screens/calendar-1366.jpg` |
| PAGE-06 | Production | BOM | 1366 | high | **The page scrolls sideways** (a horizontal scrollbar on the page scroller; "Sil" is cut off at the right edge). Plain bug. | RESP-2 | Fix the overflowing row (can ship without the flag). | `screens/production-bom-1366.jpg` |
| PAGE-07 | Ticarət | new sale | 390 | high | On a phone the form is 30 px wider than the screen (it scrolls sideways inside the page). Plain bug. | RESP-2 | Fix the overflowing element (can ship without the flag). | `screens/phone-390-sales-new-products.jpg` |
| PAGE-08 | Reports | 5 report pages | all | medium | Report frame differs from lists: the old header + a "Hesabat filtrləri" card (date presets, an ISO date range, "Hesabatı yenilə") + separate native selects + the grid. | PAGE-2, LIST-1 | A report = PageHeader + toolbar (period, filters) + content, like lists. | `screens/report-osv-1366.jpg` |

### Buttons and actions

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ACT-01 | All | every page | all | high | **The shell's "Sürətli əməliyyatlar" is a filled primary button on every page**, so every page with its own primary has two or more (C1, F1, A1, G4: one primary per screen). | ACT-2 | Shell quick actions become a secondary or icon button; the page owns the only primary. | `screens/quick-actions-1366.jpg` |
| ACT-02 | Anbar | products | all | high | Header with **six controls in five colours**: blue "Kateqoriyalar", a native select, outlined green "Çap et / Label", pink "Zədələnmə çıxışı", green split primary. | ACT-1, ACT-7 | Primary "Yeni məhsul" + at most 2 secondaries; the rest in a "…" menu; the label size goes into the print dialog. | `screens/products-1366.jpg`, `screens/products-1366-light.jpg` |
| ACT-03 | Ticarət | new sale | all | high | The form's action bar is **a card at the top** with four different styles (outlined green "Ləğv et", dark "Layihə kimi saxla", disabled green "Təsdiqlə və Keçir", outlined "Çap et"), far from the fields. Cancel is first, in green. | ACT-1, ACT-3, FORM-5 | Sticky save bar at the bottom: Cancel (secondary) · Save as draft (secondary) · Approve (primary, rightmost). | `screens/sales-new-1366.jpg` |
| ACT-04 | Ticarət | sales record | all | medium | **Seven action buttons in two rows**, the primary "Ödəniş qəbul et" in the middle of them, no "More" menu; technical labels "e-Qaimə Eksport · XML_ETAXES / JSON_STANDARD". | ACT-3, ACT-6, ACT-7 | At most 3 visible (primary rightmost), the rest in "…"; plain labels ("e-Qaimə: XML", "e-Qaimə: JSON"). | `screens/sales-record-1366.jpg` |
| ACT-05 | Reports | financial, OSV, reconciliation, inventory turnover | all | medium | **Two refresh buttons** ("Yenilə" in the header and a gradient "Hesabatı yenilə" in the filter card); gradient buttons are a third primary style. | ACT-1, ui-standard rule 5 | One refresh (or apply filters automatically); no gradients. | `screens/report-financial-1366.jpg` |
| ACT-06 | Ticarət, Production, HR, CRM, Maliyyə | consignments, production, calendar, payments, commissions | all | low | **Actions repeated** in the header and in the empty state (all three header buttons on consignments). | ACT-4 | The empty state repeats only the primary action. | `screens/consignments-1366.jpg`, `screens/production-1366.jpg` |
| ACT-07 | All | many headers | all | low | Button labels in Title Case ("Yeni Xərc Əlavə Et", "Yeni Müştəri") next to sentence-case ones ("Yeni alış fakturası"). | TXT-1 | Sentence case everywhere. | `screens/expenses-1366.jpg` |
| ACT-08 | CRM | partners | all | medium | Row actions as **three inline icons** (view, edit, delete) instead of the "…" menu; delete is one click away and not last; the icons are under 24 px. | LIST-3, A11Y-3 | "…" menu, View first, Delete last with confirmation. | `screens/partners-1366.jpg` |

### Forms

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FORM-01 | Ticarət | new sale | all | high | **28 native `<select>`** (also in every line cell) and native date inputs although UI_STANDARD is on; 27 inputs without a label. The sale form was never moved to `Combobox` / `DateField` / `LineGrid` / `EntityLookup`. | FORM-4, A11Y-4 | Sales form on the standard parts (as purchases already uses `LineGrid`). | `screens/sales-new-lines-1366.jpg` |
| FORM-02 | Ticarət, Anbar | new purchase, new sale, new transfer | all | high | Native date inputs show **"mm/dd/yyyy" (US order)** in the Azerbaijani UI. | FORM-4, TXT-3 | `DateField` (dd.mm.yyyy) everywhere. | `screens/purchases-new-1366.jpg`, `screens/transfer-new-1366.jpg` |
| FORM-03 | Ticarət | new sale | all | medium | **Premature warning:** "Zəhmət olmasa müştərini seçin!" in orange before the user did anything (N5, N6: don't show errors before input). | FORM-3 | Show it after Save is pressed, next to the customer field. | `screens/sales-new-1366.jpg` |
| FORM-04 | Maliyyə | opening balances | all | high | Amount inputs show raw numbers ("1543.86": dot decimal, no grouping); 10 inputs without an accessible label. | FORM-4, TXT-4, A11Y-4 | Money input with the locale format; label from the row. | `screens/opening-balances-1366.jpg` |
| FORM-05 | CRM | new customer dialog | all | medium | Two ways to mark fields: "*" for required and "(Məcburi deyil)" for one optional field; a native select; a different segmented control. | FORM-2, FORM-4 | "*" only; `Combobox`; one segmented control. | `screens/dialog-new-customer-1366.jpg` |
| FORM-06 | Anbar, Production, Reports | products filters, BOM, reports | all | medium | Filter cards and BOM use native selects (4 on products, 3 on BOM, 1–2 on each report); the reconciliation partner is a native select instead of `EntityLookup`. | FORM-4 | Filters in the list toolbar; `EntityLookup` for records. | `screens/report-reconciliation-1366.jpg` |
| FORM-07 | All | forms | all | medium | Save placement differs: the header (tax, procurement, CRM before SET-1), a top card (new sale), the bottom of a dialog (customer), a sticky bar (Settings V2 only). No unsaved-changes warning outside Settings V2. | FORM-5 | One sticky save bar + guard on every form. | `screens/sales-new-1366.jpg` |

### Lists and grids

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-01 | All | initial balance, slips, expenses, transactions, sales (datetime), counts | 1366 | high | **Date and date-time columns are cut** ("19.10.20…", "19.10.2026 13:…"); the date — the column users scan most — is unreadable without hovering. | LIST-2 | Fixed widths for date (96 px) and datetime (132 px) as in ui-standard; never squeezed. | `screens/expenses-1366.jpg`, `screens/initial-balance-1366.jpg` |
| LIST-02 | CRM, Anbar | customers, partners, products, warehouses | all | medium | **Two list toolbars:** view-engine lists have Search · Filters · Group · Favourites · Excel · view switch; classic lists have a search card only (customers, partners) or a big uppercase "QABAQCIL FİLTR" card (products). | LIST-1 | One toolbar for every list. | `screens/customers-1366.jpg`, `screens/products-1366.jpg` |
| LIST-03 | CRM | customers row menu | all | low | The row menu has no "View/Open" item (Edit, Delete only). | LIST-3 | View first. | `screens/customers-row-menu-1366.jpg` |
| LIST-04 | Ticarət | sales row menu | 1366 | low | Opening the row menu scrolls the grid sideways (the first columns jump out of view). | LIST-3 | Keep the scroll position when the pinned menu opens. | `screens/sales-row-menu-1366.jpg` |
| LIST-05 | CRM | customers | all | low | Balances of 0,00 AZN shown in green (colour where nothing is due); phone numbers in mixed formats. | LIST-5 | Neutral colour for zero; green/red only for meaning. | `screens/customers-1366.jpg` |
| LIST-06 | Anbar, Reports | warehouses, reports | all | medium | KPI values in a **monospace font and raw numbers** ("221607.83 AZN", "4817 AZN", "393 Adda Məhsul" — also a typo of "Ədəd"). | TOK-2, TXT-4 | `MetricCard` with `formatMoney`; fix the typo. | `screens/warehouses-1366.jpg`, `screens/reports-1366.jpg` |
| LIST-07 | Reports, Documents, HR | commission report, reconciliation, documents | all | low | **Own empty states** (a grey card with centred text, different icons); the design-system `EmptyState` is used elsewhere. | LIST-4 | `EmptyState` everywhere. | `screens/commission-report-1366.jpg` |

### Dialogs and overlays

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OVL-01 | All | `.app-modal` dialogs (40 files: new customer, quick-add supplier/product/employee, production, categories …) | all | high | **Not real dialogs:** no `role="dialog"`/`aria-modal`; **Escape does not close them**; the close × has no name; focus is not trapped; the whole dialog scrolls, so the title and the Save/Cancel buttons scroll away (W3). Users' dialogs were fixed in SET-1; the rest are not. | OVL-1, A11Y-5 | One `Dialog` component (Radix): header and footer fixed, body scrolls. | `screens/dialog-new-customer-1366.jpg`, `screens/dialog-new-customer-bottom-1366.jpg` |
| OVL-02 | Ticarət | sales list filters | 1366 | low | The filter popover shows its own scrollbar on a 633 px window; the header is uppercase. | OVL-2, TXT-1 | Max height from the free space and a hidden scrollbar with fades; sentence case. | `screens/sales-filters-1366.jpg` |
| OVL-03 | Shell | command palette | all | low | The search field's focus ring is clipped at the top; group headings are uppercase. | A11Y-2, TXT-1 | Inset focus ring; sentence-case group headings. | `screens/command-palette-1366.jpg` |
| OVL-04 | All | toasts | all | medium | Two toast systems (old `ToastMessage` in 62 files: a coloured box at the bottom right; design-system toasts with icon and timer). | OVL-3 | One `useToast`. | – |

### Visual tokens (colour, type, spacing, radius, icons)

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TOK-01 | All | all | all | high | **Three token systems** (`--app-*` 38, `--erp-*` 91, `--ds-*` 137). UI_STANDARD aliases `--erp-*` to `--ds-*`, but `--app-*` (57 files) and raw Tailwind palette colours (141 files) bypass both. | TOK-1 | `--ds-*` is the only system; `--app-*` and `--erp-*` become aliases, then go away; lint stops raw palette classes. | – |
| TOK-02 | All classic pages | 15+ pages | all | medium | **Two font families on one page:** body text falls back to the "Vazirmatn" (Persian) stack from `globals.css`; design-system parts use Inter. | TOK-2 | Inter for everything (mono only for codes). | `screens/sales-new-1366.jpg` |
| TOK-03 | Reports, Products, forms | reports (60 texts), products (47), opening balances, financial | all | medium | **Text below 12 px** (10–11 px; 111 files use `text-[10px]`/`text-[11px]`). | TOK-2, A11Y-1 | 12 px minimum (ramp 12/14/16/18/22/30). | `screens/reports-1366.jpg` |
| TOK-04 | All | per page | all | low | Up to **9 border radii on one page** (new purchase: 0, 4, 6, 8, 10, 12, 14, 16, pill). | TOK-3 | Radius scale 4/6/10/14/20 by role (control 10, card 14, dialog 20). | `screens/purchases-new-1366.jpg` |
| TOK-05 | All | headers, tabs, chips | all | medium | **Six tab and segmented styles:** underline (shell), in-page underline, green filled pills (sale form, import reports, calendar), outlined blue pills (opening balances), quick-range pills (reports), segmented toggle (customer dialog). | NAV-5, TOK-1 | Two components: `Tabs` (underline) and `SegmentedControl`. | `screens/opening-balances-1366.jpg`, `screens/calendar-1366.jpg` |

### States (empty, loading, error, success)

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STATE-01 | All | every page | all | medium | On every navigation the page body is blank with "İcazələr yoxlanılır…" (permission check) for about a second before any skeleton. | PERF-1 | Keep the page frame (header, crumbs) and a skeleton while the permission resolves. | (seen on every page; see `docs/settings-redesign/audit.md`) |
| STATE-02 | Reports | reports home | all | low | An empty "Layihə Rentabelliyi" card with grey centred text ("Aktiv istehsal sifarişi tapılmadı.") takes a full card. | LIST-4 | Hide empty widgets or use `EmptyState` (compact). | `screens/reports-1366.jpg` |

### Mobile

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MOB-01 | Ticarət and every list with analytics | sales and others | 390 | high | The list starts about 3 screens down (KPIs, ring, chart, top customers come first). | PAGE-3, RESP-1 | On phones: title, 2 KPIs, then the list; analytics behind a "Göstəricilər" toggle. | `screens/phone-390-sales-new-products.jpg` |
| MOB-02 | Anbar | products | 390 | medium | Six header controls wrap into three rows; then a full-screen filter card before the list. | ACT-7, RESP-1 | Primary + "…" on phones; filters in a sheet. | `screens/phone-390-sales-new-products.jpg` |
| MOB-03 | Shell | header | 390 | low | App title cut ("Anbar və…", "Tənziml…"). | RESP-1 | Smaller app title, no company name on phones. | `screens/phone-390-sales-new-products.jpg` |

### Accessibility

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-01 | Anbar, CRM, Reports, forms | products (42 texts), partners (43), customers (37), reports (22), new sale (10), new purchase (10) | all | high | Text below **4.5:1 contrast** (muted greys on dark cards, green on dark). | A11Y-1 | Muted text token ≥ 4.5:1 on every surface, in both themes. | `screens/products-1366.jpg` |
| A11Y-02 | Lists | products (394), stock (412), transactions (57), sales (32), partners (42) | all | medium | **Targets under 24×24 px** (row checkboxes, row icons, grid header buttons) — WCAG 2.5.8. | A11Y-3 | 24 px minimum hit area (IconButton sm 28). | `screens/partners-1366.jpg` |
| A11Y-03 | All | 40 `.app-modal` dialogs | all | high | Dialogs: no focus trap, no Escape, close without name (see OVL-01). | A11Y-5 | `Dialog` component. | `screens/dialog-new-customer-1366.jpg` |
| A11Y-04 | Forms | new sale (27), opening balances (10), new transfer (3), new purchase | all | high | Inputs without a programmatic label. | A11Y-4 | `Field` gives every control its label. | `screens/sales-new-1366.jpg` |

### Text and i18n

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TXT-01 | Reports | trial balance | all | medium | The az title "Tərəddüd-Qalıq Cədvəli (ОСВ)" uses **Cyrillic letters** О, С, В; the tab says "(OCB)" in Latin letters. | TXT-2 | One spelling, Latin script in az. | `screens/report-osv-1366.jpg` |
| TXT-02 | HR, Reports, To-do | commission report, reports, to-do | all | medium | **Dates in other formats:** "November 2026" (English month in az), "(2026-11)", "2026-11-01 — 2026-11-10", "son tarix 2026-11-02" next to "02.11.2026" on the same screen. | TXT-3 | `formatGridDate` / `formatLongDate` only. | `screens/commission-report-1366.jpg`, `screens/todo-1366.jpg` |
| TXT-03 | CRM | pipeline | all | medium | Stage names in English ("Lead, Qualified, Proposal, Won, Lost") in the az UI. | TXT-2 | Default stages translated (data seeded per language). | `screens/crm-pipeline-1366.jpg` |
| TXT-04 | Ticarət | sales record | all | medium | **UPPERCASE field labels** (19 on the record: "MÜŞTƏRİ", "TARİX" …), also on forms ("YEKUN ENDİRİM", "BARKOD OXUT"), filters, palette (90 files use `uppercase`). | TXT-1 | Sentence case; uppercase only for codes. | `screens/sales-record-1366.jpg` |
| TXT-05 | All | 62 az strings | all | low | Title Case in az ("Ümumi Avans Həcmi", "Stok Girişi və İlkin Qalıq sənədləri"); Azerbaijani uses sentence case. | TXT-1 | Rewrite the 62 strings. | `screens/contracts-list-1366.jpg` |
| TXT-06 | Ticarət | sales record | all | low | Raw values: salesperson shown as an e-mail address; delivery "free" (English data value). | TXT-2 | Person name; translated enum. | `screens/sales-record-1366.jpg` |
| TXT-07 | Production | BOM | all | low | "Satır əlavə et" (spelling; the app elsewhere says "Sətir"). | TXT-2 | One term ("sətir"). | `screens/production-bom-1366.jpg` |
| TXT-08 | All | ru | – | medium | 27 ru strings are still Azerbaijani, 21 are Latin-only; 139 ru strings are ≥ 40 % longer than az (truncation risk in buttons and tabs); 23 `.tsx` files have hard-coded Azerbaijani text. | TXT-2 | Translate; check ru lengths in ui:guard. | – |

### Performance felt by users

| ID | Area | Page | Width | Sev. | Finding | Rule | Proposed fix | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PERF-01 | All | every page | all | medium | Blank "İcazələr yoxlanılır…" on each navigation (see STATE-01). | PERF-1 | Frame + skeleton immediately. | – |
| PERF-02 | Anbar | products (793 buttons on one page), stock (425) | 1366 | medium | Very heavy DOM: every row renders several buttons and icons; the tab froze once for 30 s while taking a screenshot of a record page. | PERF-1, LIST-1 | Row actions rendered on demand; virtualise long lists. | – |

## Summary: the 10 biggest problems

| # | Problem | Findings | Screens affected |
| --- | --- | --- | --- |
| 1 | **Two navigation patterns and a second tab row inside pages** (side menu only in Settings; nested tabs on 6 pages; 6 tab styles). | NAV-01, NAV-02, TOK-05 | every app (11), 6 pages with nested tabs |
| 2 | **Breadcrumbs missing on 20 pages and in 4 formats elsewhere**, partly English, sometimes the wrong app. | NAV-03…07 | ~34 |
| 3 | **Three page-header kinds; 16 pages without an `<h1>`; one page has several names; title below the KPIs.** | PAGE-01…04, NAV-09 | ~45 |
| 4 | **Every page has two or more primary buttons** (shell quick actions + page), plus 5 button colours and gradient buttons on classic pages. | ACT-01…05 | every page |
| 5 | **Forms never moved to the standard parts:** native selects and dates (US date order), unlabelled inputs, top action cards, premature warnings, no save bar or unsaved guard. | FORM-01…07, A11Y-04 | ~12 forms + every classic form |
| 6 | **Dialogs are not real dialogs** (no Escape, no focus trap, title and buttons scroll away). | OVL-01, A11Y-03 | 40 dialog files |
| 7 | **Dates and numbers:** cut date columns, ISO or English dates, raw unformatted money. | LIST-01, LIST-06, FORM-02/04, TXT-02 | ~14 |
| 8 | **Three token systems, two font families, text below 12 px, up to 9 radii per page.** | TOK-01…04 | every classic page (~15 in the audit) |
| 9 | **Contrast and target size below WCAG 2.2 AA** on dense lists and old cards. | A11Y-01, A11Y-02 | ~10 |
| 10 | **Mobile: the list is 3 screens down; header controls wrap into 3 rows; two pages scroll sideways.** | MOB-01…03, PAGE-06/07 | every list with analytics (~14) + 2 |

Also notable: text and i18n (uppercase labels, Title Case, Cyrillic in az, English stage names; TXT-01…08) and the English 404 page for switched-off features (NAV-11).

**Model pages.** These already follow most of the rulebook and are the starting point for the shared components:
- the design-system lists (stock, counts, cash and bank, employees, imports);
- the Settings V2 pages.
