# UI rulebook

The single source of UI rules for the Del Groups ERP. Every new screen and every UI change follows
it; the PR description names the rules it touched (CLAUDE.md, `.github/pull_request_template.md`).

- **Why these rules:** `docs/ui-system/research.md` (sources N1…B3 are cited by their number).
- **What is wrong today:** `docs/ui-system/audit.md` (finding ids such as NAV-01).
- **Part A** (this part) is the rules. **Part B** is the reference of the components that implement them (lists, line grids, lookups, page frame, settings, guards).

**Flags.**
- `UI_STANDARD` (on in production) switched on the first layer: tokens, `DataGrid`, lookups.
- Rules marked **(UI_UNIFIED)** are built in UI-7 phase 2 and switched on per area behind `UI_UNIFIED` + `UI_UNIFIED_AUDIENCE`. Until an area is migrated, its old screens may still break them. New code follows them from now on.

**How a rule is enforced:**
- **lint**: `npm run lint` fails.
- **test**: `npm test` fails.
- **guard**: `npm run ui:guard` fails in the browser.
- **component**: the shared component makes the right thing the only thing.
- **review**: the PR checklist.

Each rule says *planned* where the check is not built yet. Phase 2 (UI-7) built the lint categories, the rulebook page checks of `ui:guard` and the shared components; the checks and their names are in Part B, "Guards".

**Who we design for.** Accountants, sales and warehouse staff, all day, on 1280–1920 px desktops
(Windows, mouse and keyboard) and on 390 px phones in the warehouse. The UI comes in az, en and ru; ru is up to 40 % longer.

---

## 1. Shell and navigation

**NAV-1 · One navigation pattern for every app: a grouped left side menu.** (UI_UNIFIED)
- **Rule:**
  - Every app with 2 or more pages has a left side menu on desktop (≥ 1024 px). It shows the pages in labelled groups, highlights the current page, sticks inside the page scroller, and is 15 rem wide. The user can collapse it to an icon rail with tooltips, and the choice is remembered.
  - Apps with one page have no menu.
  - Below 1024 px the menu is a button at the top of the page that opens the same menu as a bottom sheet.
  - The shell header shows no app tabs.
  - The menu never shows its own scrollbar at 1366×768: groups collapse, or it scrolls with a hidden scrollbar and edge fades.
- **Why:**
  - A left panel suits more than 5 sub-pages and frequent switching (C5).
  - Vertical navigation scales and is easy to scan; keep it visible and don't duplicate it (N10).
  - Overflowing tab bars hide tabs (N9).
  - 4 of 6 big apps overflow at 1366 px in az (NAV-01).
  - One pattern beats two (N12). Full reasoning: research.md, "The navigation decision".
- **Do:** Anbar → menu groups "Məhsullar" (Məhsullar, Kateqoriyalar…), "Hərəkət" (Transfer, Qaimələr, Zədələnmə…), "Sayım" (İnventarizasiya, İlkin qalıq).
- **Don't:** top tabs for one app and a side menu for another; a second row of tabs inside a page for sibling pages (NAV-02).
- **Enforced by:**
  - component: `AppSideMenu`, one list of pages per app, as `src/lib/settings/items.ts` is for Settings.
  - test: every page belongs to one app item.
  - guard (`shell-tabbar`): no app tab bar in the shell header; the side menu hides its scrollbar (component).

**NAV-2 · Breadcrumbs on every page except Home, in one place and one format.** (UI_UNIFIED)
- **Rule:**
  - Breadcrumbs sit above the page title in the page header, and the format is **App › Page › Record**. The app is always first: never "Əsas Panel" and never a sibling page.
  - Every crumb except the last is a link. The last one is the current page, plain text with `aria-current="page"`.
  - The trail comes from one route map with translated labels, and record crumbs show the record's name or number.
  - The trail never wraps. On phones it collapses to the parent only ("‹ Anbar").
  - A list page has two crumbs (App › Page).
- **Why:** breadcrumbs show the place in the hierarchy, last item not a link, never wrapping (N2, C6). The trail needs a labelled `nav` landmark (W5). Today 20 pages have none and the rest use 4 formats (NAV-03…07).
- **Do:** `Anbar › İnventarizasiya › INV-2026-0007`.
- **Don't:** `Inventory › Transfers › Yeni`; `Əsas Panel › Ödənişlər`; `Maliyyə / Tranzaksiyalar › Maliyyə İlkin Qalıqları`.
- **Enforced by:**
  - component: `PageHeader` renders `Breadcrumbs` from the route map.
  - test: every route has a label in az, en and ru.
  - guard (`breadcrumbs`): every page of an app except `/` and `/apps` has a breadcrumb nav with ≥ 2 items.

**NAV-3 · One name per page.**
- **Rule:**
  - The menu item, the page title (`<h1>`), the last breadcrumb and the command-palette entry show the same text. All four come from the same i18n key.
  - A record page's title is the record's number or name.
- **Why:** the same thing must be called the same everywhere (N12). Today one page has up to three names (NAV-09).
- **Do:** menu "Zədələnmə çıxışı", title "Zədələnmə çıxışı".
- **Don't:** menu "Zədələnmə Çıxışı", crumb "Məhsullar › Zədələnmə Çıxışı", title "Anbar zədələnməsi / tullantı".
- **Enforced by:** test (each app's page list: title key = menu key = crumb key, as `tests/settingsRedesign.test.mjs` does for Settings).

**NAV-4 · One way back.**
- **Rule:**
  - "Back" is the shell back button (the app icon that turns into an arrow) and the breadcrumbs.
  - The back button goes to the parent breadcrumb, not to the browser history. On an app's first page it goes to the launcher.
  - No back links or arrows inside the page.
- **Why:** five back patterns today (NAV-08); predictability (N12).
- **Don't:** "← Hesabatlara qayıt", "Geri", a back arrow inside the header card.
- **Enforced by:** component (`PageHeader` has no back prop); review.

**NAV-5 · In-page tabs only for the parts of one thing.**
- **Rule:**
  - Tabs inside a page switch between parts of one record or one report (e.g. "Sətirlər", "Ödənişlər", "Tarixçə"). They never switch between sibling pages; those belong in the side menu.
  - Use at most 6 tabs, in one row, with the underline style (`Tabs` component, `role="tablist"`, arrow keys).
  - Segmented controls (2–4 options that filter one view, e.g. "Mənim təqvimim / Komanda") use `SegmentedControl`.
  - There are no other tab or pill styles.
- **Why:** tabs only for few, grouped items, one row, two selection cues (N9); the APG keyboard model (W4). Today there are six styles (TOK-05).
- **Enforced by:** component (`Tabs`, `SegmentedControl`); lint (`rawTabRole`): `role="tab"` outside the design system.

**NAV-6 · Our own "not found" page.**
- **Rule:** an unknown route, or a feature switched off by a flag, shows a translated not-found page inside the shell with a link to the app.
- **Why:** NAV-11.
- **Enforced by:** `src/app/not-found.tsx`; test.

## 2. Page anatomy

**PAGE-1 · One `PageHeader` on every page.** (UI_UNIFIED)
- **Rule:**
  - Every page renders exactly one `PageHeader`:
    - breadcrumbs (NAV-2);
    - one `<h1>` (22 px / 600, one line, ellipsis with tooltip);
    - for records, a status chip next to the title;
    - an optional one-line description (14 px, muted);
    - actions on the right.
  - Nothing else renders an `<h1>`, and there are no icons before titles.
- **Why:** one page header per page, breadcrumbs and title left, actions right (A2). Today there are three header kinds and 16 pages without an `<h1>` (PAGE-01, PAGE-03).
- **Don't:** a glass box with an icon and an `<h2>` as the title; the title repeated in a form card (PAGE-04).
- **Enforced by:**
  - component.
  - guard (`h1-count`, `h1-header`, migrated pages): exactly one `h1`, inside `.ds-page-header`.
  - lint (`rawH1`): `<h1` outside the design system.

**PAGE-2 · One page frame and one section order.**
- **Rule:**
  - Order from top to bottom:
    1. `PageHeader`;
    2. KPI cards (optional, at most 4, one row, `.ds-kpi-grid`);
    3. toolbar (search, filters, view switch);
    4. content (list, form sections, report);
    5. sticky save bar for forms.
  - No card around the whole page: the page sits on the page background, and its parts are cards (`Section`).
  - Widths:
    - lists and reports use the full width (content max 120 rem);
    - forms and settings use a 75 rem column;
    - text paragraphs are at most 72 ch.
  - Padding: page 24 px on desktop, 16 px on phones; 24 px between sections.
- **Why:** the user must know where they are before reading numbers (N1 #6, PAGE-02); a two-thirds reading width (G5).
- **Enforced by:** component (`PageFrame` renders header, KPIs, toolbar, content and save bar in this order; phones show 2 KPI cards).

**PAGE-3 · The list starts within the first screen.**
- **Rule:**
  - On a list page, the toolbar starts within the first 50 % of the window on desktop and the first screen on a phone.
  - Charts and analytics on list pages are folded into a "Göstəricilər" panel (closed on phones; the state is remembered).
  - Phones show at most 2 KPI cards.
- **Why:** dashboards are for at-a-glance information, lists are for work (N11, N7); MOB-01.
- **Enforced by:** guard (`toolbar-low`, migrated pages): toolbar top < 0.5 × window height from 1024 px, < 1.0 × below.

**PAGE-4 · One vertical scroller, no empty band, no sideways page scroll.**
- **Rule:**
  - Only the shell's `[data-scroll-root]` scrolls vertically.
  - A side menu or an overlay may scroll inside itself, with a hidden scrollbar.
  - No band of more than 48 px under the last content.
  - The page never scrolls sideways; grids scroll inside their own box.
- **Why:** SCROLL-1; reflow (W2 1.4.10); PAGE-05…07.
- **Enforced by:** guard (`scripts/ui-page-checks.mjs`, existing).

## 3. Actions and buttons

**ACT-1 · Five button variants, two sizes.**
- **Rule:**

  | Variant | Use |
  | --- | --- |
  | primary (brand fill) | the one main action |
  | secondary (neutral outline) | other actions, Cancel |
  | ghost (text) | low-emphasis actions in toolbars and cards |
  | danger | the confirm button of a destructive dialog; in menus, red text |
  | `IconButton` | icon only, with a tooltip and an `aria-label` |

  - Sizes: md 40 px (default), sm 32 px (toolbars, tables).
  - No gradients, no colours outside the tokens, no outline-in-brand-colour "half primaries".
- **Why:** variant sets in C1, F1, A1. Today there are 5 colours in one header and gradient buttons (ACT-02, ACT-05).
- **Enforced by:**
  - component (`Button`, `IconButton`).
  - lint (`legacyButton`): `btn-primary`, `bg-gradient-to-*` and `app-gradient` classes; (`rawPalette`) Tailwind palette classes.

**ACT-2 · One primary action per screen.**
- **Rule:**
  - A page has at most one primary button: the action the page exists for. A dialog is its own screen and has one.
  - The shell's quick-actions button is not primary-styled.
- **Why:** C1, F1, A1 and G4 agree. Today every page has two or more primaries (ACT-01).
- **Enforced by:** guard (`primary-count`, migrated pages): visible `.ds-btn-primary` outside dialogs ≤ 1; the shell's quick actions are a secondary button under UI_UNIFIED.

**ACT-3 · Button order and place.**
- **Rule:**
  - Page actions are in the `PageHeader`: secondaries first, the primary rightmost.
  - Form save is in the sticky save bar (FORM-5): Cancel/Discard (secondary) left, Save (primary) right.
  - In dialogs the footer is right-aligned with Cancel left of the primary.
  - Same side everywhere.
- **Why:** consistency of button side (N12, N8). Our dialogs, save bar and header already do this (research.md, "Button order").
- **Don't:** an action card at the top of a form (ACT-03); the primary in the middle of a row (ACT-04).
- **Enforced by:** component (`PageHeader actions`, `FormSaveBar`, `Dialog footer`).

**ACT-4 · No duplicate actions.**
- **Rule:**
  - One button per action per screen.
  - An empty state may repeat only the page's primary action, as one button.
- **Why:** ui-standard rule 5; ACT-06.
- **Enforced by:** review; component (`EmptyState` takes one action).

**ACT-5 · Destructive actions.**
- **Rule:**
  - Delete, cancel a posted document and similar actions use the danger style, come last in menus (after a separator) and always ask in a `ConfirmDialog` that names the object.
  - Irreversible actions use `TypeToConfirmDialog`.
  - Never `window.confirm`.
  - Where the action can be undone, offer Undo in the success toast instead of asking.
- **Why:** confirm consequential actions (N1 #5); warning buttons only for serious actions (G4); confirm destructive actions (P1).
- **Enforced by:** component (`ConfirmDialog`); lint (`windowDialog`): `window.confirm` / `alert` / `prompt`.

**ACT-6 · Labels.**
- **Rule:**
  - A verb plus an object, sentence case, at most about 3 words ("Yeni faktura", "Ödəniş qəbul et").
  - No technical codes ("XML_ETAXES"), no "+" in the text next to a Plus icon, no "OK".
- **Why:** explicit verbs (N8, C2, G4); ACT-04, ACT-07.
- **Enforced by:** review; test: the `uiUnified` texts are sentence case (`tests/uiUnified.test.mjs`); each area's texts get the same test when it migrates (planned).

**ACT-7 · At most three visible actions.**
- **Rule:**
  - A header shows the primary and at most two secondaries. Everything else goes into a "…" menu (`IconButton` + `DropdownMenu`).
  - On phones: primary + "…".
- **Why:** 2–3 actions per group, more into a menu (C1); ACT-02, ACT-04, MOB-02.
- **Enforced by:** component (`PageHeader` takes `primary`, `secondary[]` (≤ 2) and `more[]`).

## 4. Forms

**FORM-1 · Layout.**
- **Rule:**
  - Fields sit in a `FormGrid`: 2 columns when the form column is wide enough (`@md`), 1 on phones. Related short fields may share a row; long text spans the row.
  - Groups of fields are `Section` cards with a title.
  - Labels are above the field, short, sentence case, no colon, never only a placeholder.
  - Field width follows the expected input (`ds-w-*`), or full width inside a stacked `Field`.
- **Why:** labels on top (N3, C2, B2, P2); placeholders are not labels (N4); single column by default, 2 columns allowed for dense business forms (N3 caveat).
- **Enforced by:** component (`Field`, `FormGrid`, `Section`); guard (planned): every input has a programmatic label.

**FORM-2 · Required fields.**
- **Rule:**
  - Required fields have "*" after the label (and `aria-required`), and required fields come first.
  - Optional fields are not marked: no "(Məcburi deyil)".
- **Why:** most ERP fields are optional, so the few required ones are marked (C2). Today two systems are mixed (FORM-05).
- **Enforced by:** component (`Field required`).

**FORM-3 · Validation.**
- **Rule:**
  - Check format rules when the user leaves a field. Once a field is in error, re-check on every keystroke so the error clears as soon as it is fixed. Check all rules again on Save.
  - The message sits under the field, in red text with an icon, and says what to do ("Müştərini seçin", "VÖEN 10 rəqəmdir").
  - With 3 or more errors, a summary at the top links to each field, and focus moves to the first error.
  - Keep what the user typed.
  - No errors before the user has done anything.
  - Server errors: a toast or banner, plus the field error when it maps to a field.
- **Why:** N5, N6, G1, G3, B1, P2; FORM-03.
- **Enforced by:** component (`Field error`, `useFormErrors`); review.

**FORM-4 · Controls.**
- **Rule:**

  | Need | Control |
  | --- | --- |
  | choice from a list | `Combobox` |
  | a record | `EntityLookup`, with quick-create in place (**never leave a form to create a related record**) |
  | date | `DateField` (dd.mm.yyyy) |
  | money | `MoneyInput` (locale format, right-aligned, currency suffix) |
  | quantity | `NumberInput` (unit suffix) |
  | yes / no | switch or checkbox |
  | 2–4 options | `SegmentedControl` or radios |

  - Never a native select or date input.
- **Why:** standard controls and formats (N12, W2 3.3.2); FORM-01, FORM-02, FORM-04; Del's rule on quick-create.
- **Enforced by:**
  - lint (existing): `<select>`, `<input type="date">`, `<datalist>`.
  - lint (planned): `type="number"` for money fields in new code.

**FORM-5 · Save.**
- **Rule:**
  - One `FormSaveBar` at the bottom of the page scroller (`erp-sticky-actions`).
    - Edit forms show it only while there are unsaved changes ("Yadda saxlanmamış dəyişikliklər var", Discard, Save).
    - New forms show it always (Cancel, Save; documents may add "Save as draft" as a secondary).
  - Unsaved changes trigger `useUnsavedChangesGuard`: the browser prompt on reload or close, our dialog on in-app links.
  - Success shows a toast. The Save button is disabled only while saving (spinner) or without permission (tooltip says why).
- **Why:** a contextual save bar that appears with changes (S1); explicit save with one button, never disabled for validation (P1, A1, G4); FORM-07, ACT-03. Built and proven in SET-1.
- **Enforced by:** component; test (forms list); review.

**FORM-6 · The title once.**
- **Rule:** the form's title is the page title. The document number and status sit next to it, not in a second card.
- **Why:** PAGE-04.
- **Enforced by:** guard (planned): one `h1`, and no `h2` with the same text.

## 5. Lists

**LIST-1 · One list: `DataGrid` with one toolbar.**
- **Rule:**
  - Every list is a `DataGrid`; see Part B "Lists" for the details.
  - The toolbar above it, the same on every list:
    - left: search, Filters, Group, Favourites, record count;
    - right: view switch (list, board, calendar) where the page has views, density, Excel, Columns.
  - Filters open in a panel. There are no filter cards on the page.
- **Why:** find, compare, act (N7); toolbar above, pagination below, search on the left (C3); LIST-02.
- **Enforced by:** component; lint (existing): raw `<table>`.

**LIST-2 · Columns.**
- **Rule:**
  - Fixed widths by type: date 96 px, datetime 132 px, code 136 px. A date is never cut.
  - Text is start-aligned; money and numbers are end-aligned with tabular figures.
  - The first column is the human-readable identifier and is pinned, as is the actions column.
- **Why:** N7, C3; LIST-01.
- **Enforced by:** component (`columnAlign`, type widths); guard (planned): no truncated date cells.

**LIST-3 · Row actions.**
- **Rule:**
  - A "…" menu in the pinned last column: "Bax" (View) first, destructive actions last after a separator.
  - Clicking the row opens the record.
  - No inline icon rows. Opening the menu never scrolls the grid.
- **Why:** hover-only and inline actions are hard to discover; menus beyond 2 actions (N7, C3); LIST-03, LIST-04, ACT-08.
- **Enforced by:** component (`RowActionsMenu`).

**LIST-4 · States.**
- **Rule:**
  - Loading: skeleton rows of the same height (no spinner).
  - Empty: `EmptyState` (icon, title, one sentence, one primary action).
  - Error: `EmptyState` with the alert icon, what went wrong in plain words, and "Yenidən cəhd et".
  - Filtered to nothing: "Filtrə uyğun qeyd yoxdur" with "Filtri təmizlə".
- **Why:** P3, C3; LIST-07, STATE-02.
- **Enforced by:** component.

**LIST-5 · Chips and colour in lists.**
- **Rule:**
  - Status chips are sentence case and never cut.
  - Colour means status: success, warning, danger, info, neutral.
  - Numbers are neutral. Green or red only when the sign matters (a debt), and never green for zero.
- **Why:** status colour never decorative (F4); don't use colour alone (N6, W2 1.4.1); LIST-05.
- **Enforced by:** component (`Chip`, `MoneyCell`).

## 6. Dialogs, drawers, popovers, toasts

**OVL-1 · One `Dialog`.** (UI_UNIFIED)
- **Rule:**
  - Every modal uses the design-system `Dialog` (Radix): `role="dialog"`, `aria-modal`, a title, a close `IconButton` with a name, a focus trap, Escape closes it, and focus returns to the opener.
  - Structure: header (title and close) and footer (actions, right-aligned) stay fixed; only the body scrolls. Height ≤ 100dvh − 2 rem.
  - Sizes: sm 400 px (confirm), md 560 px (short forms, < 5 fields), lg 800 px (longer forms).
  - More than 5 fields, or editing a row next to its list: a `Drawer` from the right (480 px). On phones every dialog and drawer is a bottom sheet.
- **Why:** W3; dialog for fewer than 5 inputs, side panel for more (C2); edit in a side panel (N7); OVL-01, A11Y-03.
- **Enforced by:** component (`Dialog`, `Drawer`, `ConfirmDialog`); lint (`appModal`, `fixedOverlay`): `.app-modal` and hand-made `fixed inset-0` overlays (allowlist shrinks).

**OVL-2 · Popovers and menus.**
- **Rule:**
  - Popovers and menus render in the one overlay layer (`DesignScope`) with the z-index scale (`layers.css`).
  - Their height is limited to the free space and they scroll with a hidden scrollbar.
  - Group headings are sentence case.
- **Why:** OVL-02, OVL-03; UI-5.
- **Enforced by:** component; guard (existing): clipped popovers.

**OVL-3 · Feedback.**
- **Rule:**
  - One `useToast`:
    - success: 4 s, top-right on desktop, top on phones;
    - info: 4 s;
    - error: stays until closed, with what to do next.
  - Field errors are inline (FORM-3), never only a toast.
  - A blocking problem that stops the task uses a dialog.
  - Status messages are announced (`aria-live`).
- **Why:** toasts after an action (L2); match severity to presentation (N6); W2 4.1.3; OVL-04.
- **Enforced by:** component; lint (`toastMessage`): imports of the old `ToastMessage`.

## 7. Visual tokens

**TOK-1 · One token system: `--ds-*`.**
- **Rule:**
  - `--ds-*` (`src/design-system/theme.css`) is the only source.
  - `--erp-*` is an alias under UI_STANDARD, `--app-*` under UI_UNIFIED (`src/design-system/ui-unified.css`); both go away in the final phase.
  - Components use tokens by meaning (`--ds-text-muted`, `--ds-danger`), never a raw colour, hex value or Tailwind palette class (`text-rose-500`).
- **Why:** choose tokens by meaning; themes swap values (A4); TOK-01.
- **Enforced by:** lint (`rawPalette`): Tailwind palette classes such as `text-rose-500` (allowlist with counts, may only shrink); hex values in `style` (planned).

**TOK-2 · Type.**
- **Rule:**
  - One family: Inter (`--ds-font-sans`). Mono (`--ds-font-mono`) only for codes, IBANs and barcodes.
  - Ramp:

    | Use | Size / weight |
    | --- | --- |
    | small | 12 px |
    | body | 14 px |
    | base | 16 px |
    | section titles | 18 px |
    | page titles | 22 px / 600 |
    | KPI values | 30 px |

  - Nothing below 12 px. Weights: 400, 500, 600 (700 only for KPI values).
- **Why:** productive type sets with 14 px body (C8, F3); TOK-02, TOK-03.
- **Enforced by:** lint (`tinyText`): `text-[9px]`, `text-[10px]`, `text-[11px]` (other arbitrary sizes planned); under UI_UNIFIED the body font is Inter (`ui-unified.css`).

**TOK-3 · Space, radius, elevation.**
- **Rule:**
  - Spacing on a 4 px grid (`--ds-space-1…10`: 4–40 px).
  - Radius by role:

    | Role | Radius |
    | --- | --- |
    | chip, checkbox | 4 px |
    | small control | 6 px |
    | control, button | 10 px |
    | card, menu | 14 px |
    | dialog, sheet | 20 px |
    | pill | full |

  - Elevation 1 card, 2 hover / sticky bar, 3 popover, 4 dialog.
- **Why:** 4/8 px scales (C7, F2, A3); TOK-04.
- **Enforced by:** lint (planned): arbitrary `rounded-[…]`, `p-[…]`, `gap-[…]` in new code.

**TOK-4 · Colour roles and themes.**
- **Rule:**
  - Roles: brand (the primary action and the current item); neutral surfaces (bg, surface, sunken, raised, border); text (text, muted, subtle); status (success, warning, danger, info, each with a soft background).
  - Brand is not used for large surfaces.
  - Status colours always come with text or an icon.
  - Light and dark come from the same tokens; `dark:` follows `data-theme`.
  - Muted text is ≥ 4.5:1 on every surface in both themes; subtle text only for placeholders and disabled states.
- **Why:** F4, A4; A11Y-01.
- **Enforced by:** test (contrast of token pairs in both themes, planned).

**TOK-5 · Icons.**
- **Rule:**
  - One set: lucide.
  - Sizes: 16 px in buttons, menus and fields; 20 px for header icon buttons; 24 px inside an empty-state badge.
  - Every icon is either decorative (`aria-hidden`) or has a name.
  - No icon before page titles or field labels.
- **Why:** consistency (N12); PAGE-01.
- **Enforced by:** review.

## 8. Responsive

**RESP-1 · Breakpoints and phone rules.**
- **Rule:**
  - Breakpoints: phone < 768, tablet 768–1023, desktop ≥ 1024, wide ≥ 1440. Components use container queries (`@md`) where they sit in panels.
  - On phones:
    - the side menu is a sheet;
    - the bottom tab bar is the shell;
    - headers show the primary and "…";
    - at most 2 KPI cards, analytics folded;
    - filters open in a sheet;
    - the save bar sits above the tab bar;
    - the AI button never covers a control.
  - Touch targets: 40 px controls on phones (24 px is the floor everywhere).
- **Why:** window size classes change near 600/840 dp (M1); Fluent's breakpoints (F2); MOB-01…03.
- **Enforced by:** guard (page checks at 390×844 and 360×740, existing + planned toolbar position).

**RESP-2 · No sideways scrolling of the page.**
- **Rule:** at 320 px and up nothing scrolls the page sideways; only grids scroll inside their box, with the first column pinned.
- **Why:** reflow (W2 1.4.10); PAGE-06, PAGE-07.
- **Enforced by:** guard (existing).

## 9. Accessibility (WCAG 2.2 AA)

**A11Y-1 · Contrast.**
- **Rule:**
  - Text 4.5:1 (3:1 at ≥ 24 px, or ≥ 18.66 px bold).
  - UI parts, borders of inputs and the focus ring 3:1.
- **Why:** W2 1.4.3, 1.4.11; A11Y-01.
- **Enforced by:** guard (planned): sample text contrast on every page; test of token pairs.

**A11Y-2 · Focus.**
- **Rule:**
  - Every control shows a visible focus ring (`--ds-focus-ring`), never clipped.
  - A sticky header or save bar never hides the focused element (`scroll-padding`).
  - Tab order follows the visual order.
- **Why:** W2 2.4.7, W1 2.4.11; OVL-03.
- **Enforced by:** component; review.

**A11Y-3 · Target size.**
- **Rule:** every pointer target is at least 24×24 px, or has 24 px of spacing around it.
- **Why:** W1 2.5.8; A11Y-02.
- **Enforced by:** guard (`small-target`, migrated pages): buttons, tabs, menu items and radios smaller than 24 × 24 px.

**A11Y-4 · Names and labels.**
- **Rule:**
  - Every input has a label.
  - Every icon-only button has an `aria-label` and a tooltip.
  - Landmarks: one `main`, the navigation `nav`s labelled.
- **Why:** W2 3.3.2, 4.1.2; A11Y-04.
- **Enforced by:** component; guard (planned).

**A11Y-5 · Keyboard and motion.**
- **Rule:**
  - Everything works with the keyboard: dialogs (W3), menus (W6), tabs (W4), grids (Part B "Lists" #8).
  - Every drag has a button alternative (2.5.7).
  - Motion follows "reduce motion".
- **Why:** W1, W3, W4, W6.
- **Enforced by:** component.

## 10. Text

**TXT-1 · Sentence case, no ALL CAPS.**
- **Rule:**
  - Titles, labels, buttons, tabs, menu items, chips and group headings are in sentence case.
  - No `uppercase` styling, except codes and abbreviations (ƏDV, VÖEN).
- **Why:** sentence case (F3, A2, C2); TXT-04, TXT-05.
- **Enforced by:**
  - lint (`uppercase`): the `uppercase` class.
  - test: az/en `uiUnified` texts are sentence case; each area's texts when it migrates (planned).

**TXT-2 · Language.**
- **Rule:**
  - Every UI string goes through `src/i18n` (az, en, ru). The only exceptions are proper names and data.
  - One script per language: no Cyrillic letters in az.
  - No English words in the az or ru UI ("Lead", "free", "November").
  - One term per concept (glossary in `src/i18n/README.md`, planned: sətir, faktura, qaimə, anbar…).
  - Seeded data (stages, types) is translated.
- **Why:** consistent terminology (N12); TXT-01, TXT-03, TXT-06, TXT-07, TXT-08, NAV-05.
- **Enforced by:**
  - test (existing per module).
  - test (planned): ru ≠ az, no Latin-only ru strings, no hard-coded Azerbaijani letters in JSX.

**TXT-3 · Dates.**
- **Rule:**
  - Dates come only from `src/lib/dates/localeDate.ts`: dd.mm.yyyy in grids, cells, fields and ranges; month names only in long headings (`formatLongDate`, in the user's language).
  - Never ISO in the UI, never the US order.
- **Why:** existing rule 8; TXT-02, FORM-02.
- **Enforced by:**
  - lint (existing): `toLocaleString`, `Intl.DateTimeFormat`.
  - lint (planned): template strings building dates.

**TXT-4 · Numbers and money.**
- **Rule:**
  - `formatMoney`, `formatQuantity` and `formatFigure` only: grouping, comma decimal (az), currency after the amount.
  - Monospace never for amounts.
- **Why:** LIST-06, FORM-04.
- **Enforced by:** lint (existing); review.

**TXT-5 · Tone.**
- **Rule:**
  - Short and plain. Start with the verb.
  - Errors say what happened and what to do, with no blame and no "invalid".
  - Empty states say why the list is empty and what to do next.
- **Why:** N6, G1, P3.
- **Enforced by:** review (the ux-copy pass in each area PR).

## 11. Performance felt by users

**PERF-1 · Something useful on screen in 300 ms.**
- **Rule:**
  - The shell, the page header and a skeleton show immediately; permission checks never blank the page.
  - Lists over 200 rows virtualise or paginate.
  - Row actions render on demand.
- **Why:** visibility of system status (N1 #1); STATE-01, PERF-01, PERF-02.
- **Enforced by:** guard (planned): time to `h1` on the main routes.

## 12. Process

- **Every UI change follows this rulebook.** The PR description lists the rule ids it touched and any exception, with the reason (`.github/pull_request_template.md`).
- **New UI needs a component, not one-off styles.** If no design-system component fits:
  1. Add it to `src/design-system/components` (typed props, texts from the caller, tokens only, Radix for behaviour, motion via `design-system/motion`).
  2. Show it in `/dev/ui-lab` with long az and ru texts, both densities and both themes.
  3. List it in Part B "Which component".
  4. Add a test.
- **Migrating an area** (UI-7 phases 3–N) runs behind `UI_UNIFIED`. It references the audit ids it closes, adds its routes to `MAIN_ROUTES`, and has before/after screenshots at 1366 and 390 in light and dark.
- **Exceptions** (a print layout, a third-party widget) are listed in the rule's allowlist with a reason; allowlists only shrink.

---

# Part B · Component reference

## Tokens

- `--ds-*` (`src/design-system/theme.css`) is the single source of truth (TOK-1).
- Every legacy `--erp-*` token is an alias of a `--ds-*` token in `src/design-system/ui-standard.css`, so `src/components/ui/*` and `src/design-system` render with the same scale.
- Don't add new `--erp-*` or `--app-*` tokens, and never hard-code a colour or size in a component.

| Scale | Tokens |
| --- | --- |
| Spacing (4 px grid) | `--ds-space-0…10`: 0, 4, 8, 12, 16, 20, 24, 32, 40 px |
| Type | `--ds-text-xs` 12 · `sm` 14 (body) · `base` 16 · `lg` 18 · `xl` 22 · `2xl` 30 · `3xl` 36 px |
| Radius | `--ds-radius-xs` 4 · `sm` 6 · `md` 10 (controls) · `lg` 14 · `xl` 20 (cards) px |
| Control width | `--ds-w-xs` 5rem · `sm` 8rem · `md` 12rem · `lg` 18rem (classes `ds-w-*`, or `width` on DateField / Combobox) |

Control heights per density:

| | Comfortable | Compact |
| --- | --- | --- |
| Control (`--ds-control-h`) | 40 px | 32 px |
| Small control (`--ds-control-h-sm`) | 32 px | 28 px |
| Table row (`--ds-row-h`) | 48 px | 36 px |
| IconButton md / sm | 32 / 28 px | 32 / 28 px |

## Basic rules (UI-1)

Never native select or date inputs; never wrapped text in a row, chip, button or title.

1. **No text wraps inside a table row, chip, button or widget title.** Use one line with an ellipsis, and give the full text in a tooltip (`Truncate`, `Chip`).
2. **Controls never stretch across a row.** Full width only inside a stacked `Field`; in inline groups, toolbars and table cells a control sizes to its content or to a width token.
3. **Labels never wrap under their control.** Long labels get an ellipsis and a tooltip.
4. **Card and section headers:** the title is on the left; the actions on the right are icon or small buttons and never push the title to wrap.
5. **No duplicate actions for the same thing on one screen.** One "Save", one "Print", one place to add a line.
6. **Every lookup field uses `Combobox`.** Never a native `<select>` or `<datalist>`.
7. **Every date uses `DateField` / `DateTimeField`.** Never `<input type="date">`. Typing is `dd.mm.yyyy`; the value stays ISO.
8. **Dates and numbers come only from `src/lib/dates/localeDate.ts`:**
   - grids, cells and inputs: `formatGridDate` (`dd.mm.yyyy`) and `formatGridDateTime` (`dd.mm.yyyy HH:mm`), in every language;
   - month names only in long headings: `formatLongDate`;
   - money: `formatMoney`; quantities: `formatQuantity`; fixed decimals: `formatFigure`;
   - never `toLocaleString`, `toLocaleDateString` or `Intl.DateTimeFormat`.
9. **Numbers are right-aligned with tabular figures** (`MoneyCell`, `NumberCell`).
10. **Every icon-only button is an `IconButton`:** an aria-label, a tooltip and a fixed hit area.
11. **Every UI text goes through `src/i18n`** (az, en, ru). Components take their texts from the caller.

## Lists

Every list is one `DataGrid` (`@/design-system/components`). Classic pages reach it through `ListGrid` (`src/components/lists/ListGrid.tsx`, fed by `useTableColumns`); view-engine lists through `ListView`. Behind `UI_STANDARD`; with the flag off every page renders its old table.

1. **Rows are one line**, with a fixed height: compact 32 px, comfortable 40 px.
   - Cells never wrap. They end in an ellipsis, and the full text shows as a tooltip only when it is cut.
   - Resizing a column moves the ellipsis point; it never wraps or changes the row height.
   - No two-line cells: a code goes in its own column, or as muted text on the same line ("Name · Company").
2. **Header:** one line, sentence case (never uppercase), semibold, muted. It has an ellipsis with a tooltip and a sort arrow, and it sticks to the top while the grid scrolls.
3. **Resizing:**
   - The resize handle shows only while the header is hovered.
   - Drag to resize; double-click to fit the content; arrow keys work when the handle has focus.
   - Each type has a minimum width.
4. **Column widths by type:**

   | Type | Width |
   | --- | --- |
   | date | 96 px |
   | datetime | 132 px |
   | money / number | sized to content, right-aligned, tabular figures |
   | status | sized to its longest label |
   | code | 136 px |
   | text | flexible: takes the free space |

   Widths, order, visibility and density are per user (`useColumnPrefs`, localStorage).
5. **Toolbar above the grid, never inside the header:**
   - left: search, filters, group by, record count;
   - right: density toggle, Excel export, and the "Columns" icon button. It opens the column picker: drag to reorder, show or hide, reset.
   - One export per screen: when the grid toolbar has it, the page header does not.
6. **Horizontal overflow:**
   - The grid scrolls inside its own box, which is at most the window's height, so the header, the totals row and the scrollbar stay visible.
   - A floating scrollbar appears at the bottom of the window while the box's own scrollbar is below it.
   - Edge shadows mark the side that hides columns.
   - The first column (selection checkbox and document number) and the actions column stay put.
   - Shift + wheel and trackpads scroll sideways.
7. **Rows:**
   - selection column; hover tint; no zebra; 1 px dividers;
   - a totals row that sticks to the bottom;
   - an empty state, and a loading skeleton with the same row height;
   - pagination or "load more" in the footer.
8. **Keyboard:** arrows (Home/End, PageUp/PageDown) move the focused row, Enter opens it, Space selects it.
9. **RTL-safe:** logical properties only (`inset-inline-start`, `padding-inline`, `text-align: start`).
10. **Global resizer:** `TableColumnResizer` skips grids (`.ds-grid`, `data-col-resize="manual"`). It stays for old tables until they move to the grid.

## Line grids

Every editable list of document lines (products, services, costs) is one `LineGrid` (`src/components/line-grid`). Behind `UI_STANDARD`; with the flag off every form keeps its old editor. Migrated so far: import product lines (`ImportLinesGrid`), purchase lines (`PurchaseLinesGrid`).

1. **Same look as `DataGrid`:** one-line rows of a fixed height (compact by default), a sticky one-line header, the grid's own horizontal scroll with edge shadows, a sticky first column (the product) and a sticky actions column, totals that stick to the bottom.
2. **Cells look like text** until hovered or focused (`LineNumberCell`, `LineTextCell`, `LineSelectCell`, `LineProductCell`; computed values `LineText`).
   - Numbers are right-aligned with tabular figures; the unit is a muted suffix in the same cell ("12 vərəq").
   - An error is a red outline and a tooltip (`error` on the column), never an extra line.
3. **Adding a line:** the "+ Add a line" row at the bottom, or Ctrl+Enter. Never a box at the top of the grid.
   - Forms whose lines may start empty pass `onAddLine`: the grid adds the line and focuses its first cell.
   - Product-first documents pass `newLineCell`: a new row opens with only a product search, which opens on its own; picking (or creating) the product adds the line.
   - The product cell searches by name, code and barcode; "+ New product" under the list creates one in a dialog and puts it in the row; a barcode scanned into the search and confirmed with Enter picks the product.
4. **Keyboard:** Tab / Shift+Tab move across the cells (nothing else takes a tab stop), Enter goes down the same column and adds a line at the last row, Shift+Enter goes up, Ctrl+Delete removes the line, Esc puts back the value the cell had when it got the focus.
5. **Row menu (⋯):** more fields (the details drawer), duplicate, move up / down, remove. With `onReorder` a drag handle (motion `Reorder`) sits before the first column.
6. **Rarely used fields** (HS code, weight, volume, warehouse per line, rate of a foreign currency) are `optional` columns: hidden until the user shows them with the Columns button in the header, always editable in the details drawer. The default columns fit a 1280 px window (`tests/lineGrid.test.mjs`).
7. **Business rules stay in the form** (prices, units, sheet metres, VAT, discounts, stock checks); the grid only shows and edits the lines.
8. **UI lab:** a 30-line grid with long names (`/dev/ui-lab`), checked by `npm run ui:guard`.

## Which component (`@/design-system/components`)

| Need | Component |
| --- | --- |
| Label + control + hint/error | `Field` (`layout="inline"` for label-left) |
| Form layout, 1–4 responsive columns | `FormGrid` (+ `span` on `Field`), `FieldRow` for a new line |
| Controls on one line (cost row, filters) | `InlineGroup` (wraps whole units; `ds-grow` for the one that may grow) |
| Card / section with title and actions | `Section` / `Card` |
| Bar above a list | `Toolbar`: left = title, filters, search; right = actions, then the settings icon |
| Page frame: header → KPIs → toolbar → content → save bar | `PageFrame` (`width="form"` for forms and settings) |
| Page title with crumbs, status and actions | `PageHeader` (`primary`, `secondary` ≤ 2, `more`, `status`; crumbs come from the shell) |
| Button | `Button` (`variant` primary / secondary / ghost / danger, `size` md / sm, `icon`, `loading`, `asChild` for links); `buttonClass()` for a `Link` |
| Parts of one record or report | `Tabs` (≤ 6) |
| 2–4 options that filter one view | `SegmentedControl` |
| Modal / side panel / question before an action | `Dialog` (sm / md / lg) / `Drawer` / `ConfirmDialog` (`TypeToConfirmDialog` when the name must be typed) |
| A form's Save | `FormSaveBar` + `useUnsavedChangesGuard` |
| Nothing yet / load failed / first load | `EmptyState` / `ErrorState` / `LoadingState` |
| Any one-line text that may be long | `Truncate` (tooltip only when actually cut) |
| Icon-only button | `IconButton` (`size` md 32 px / sm 28 px) |
| Status | `Chip` |
| Any list of records | `DataGrid` (classic pages: `ListGrid`) |
| Money / number / date in a table | `MoneyCell` / `NumberCell` / `DateCell` |
| Choice from a fixed list | `Combobox` (fixed or async options, clear, empty state, `footer` slot) |
| Field that points to a record | `EntityLookup` (`@/components/lookups`): search + quick-create |
| Editable document lines | `LineGrid` (`@/components/line-grid`) |
| Date / date and time | `DateField` / `DateTimeField` |

## Lookups

Every field that points to another record (customer, supplier, carrier / customs / broker, product,
warehouse, account, employee, expense or product category, consignment shop, partner) is an
`EntityLookup` from `@/components/lookups`. The user never leaves a form to create the record.

- **Search:** it searches the database as the user types (debounced, 20 rows, recent picks first),
  with code / phone / VÖEN / stock on the second line, and re-reads every time it opens.
- **Create in place:** "+ New …" under the list and a "+" next to the field open a quick-create
  dialog. What was typed pre-fills the name; the dialog uses the same validation and write path as
  the full page (products: POST /api/products, with the same-name warning and an "open full form"
  drawer). The new record is selected, a toast confirms it, and the form keeps its state.
- **Permissions:** the "+" shows only when the user may create that entity (`canQuickCreate`, the
  same permission as the full page).
- **Props to know:** `onChange(id, record)` gives the full record, so forms that keep their own list
  merge it (`mergeRecord`) instead of reloading; `where` (e.g. legal suppliers only), `allowedIds`
  (role-scoped warehouses / accounts, plus the ids created in place), `createDefaults`,
  `size="sm"` for table cells (the dropdown is portaled).
- **Registry:** a new entity is one entry in `src/components/lookups/registry.ts` (table, search
  columns, label, hint, create permissions) plus its fields in `QuickCreateDialog.tsx`.
- **Flag:** forms switch on `useUiStandard()` (`UI_STANDARD`); with the flag off the old field is
  rendered unchanged. `docs/lookup-audit.md` lists every form and field, and the fields left out
  with the reason; `tests/lookups.test.mjs` checks that every listed form keeps the flag switch.

## Page frame (UI-5)

- **One vertical scroll per page.** Only the shell's `[data-scroll-root]` (`NewShell`, `ERPLayout`) scrolls. Pages, `PageContent`, `ListPageChrome` and grids never add `overflow-y-auto`; a side menu (`<aside>`) and overlays may scroll inside themselves.
- **The window never scrolls (SCROLL-1).** While a shell is on screen `<html>` and `<body>` are locked (`globals.css`), the body uses `min-h-dvh` (never `100vh`, which is taller than a phone's visible screen), and the scroller is `position: relative` so absolutely placed parts (an `sr-only` label) stay inside it. Anything appended to `<body>` must take no room: the `DesignScope` overlay layer copies only font classes from its scope (`layerClassName`), never padding, width or margins.
- **Dialogs** (`.app-modal`) are at most `100dvh - 2rem` tall and scroll inside themselves, so the title and the Save button are always reachable.
- **Form action bars** use `erp-sticky-actions` (sticks to the scroller's bottom edge, leaves room for the AI button on desktop); on phones the AI button sits above the tab bar and the list toolbar of `ListPageChrome` scrolls away instead of sticking.
- **Sticky parts** (list toolbar, grid header, grid totals) stick inside that scroller. They use `--ds-sticky-top` / `--ds-sticky-bottom`, which `ListPageChrome` keeps in step with the toolbar height. A grid frame uses `overflow: clip`, never `hidden`, so `position: sticky` still works.
- **No empty band** under the last content (more than 48 px fails the page check).
- **Layers.** One z-index scale in `src/design-system/layers.css` (`--ds-z-grid-head` … `--ds-z-tooltip`; `Z_LAYERS` / `zVar()` in `theme.ts`). No raw z-index numbers: use `z-[var(--ds-z-modal)]` and the like. Popovers, menus and lookups render in one layer on `<body>` (`DesignScope`), so no card or grid can clip them; menus are limited to `--radix-popper-available-height` and scroll.
- **Row menu.** Every list with record actions has a "…" menu in a pinned actions column (`RowActionsMenu`; view engine: `rowActions` → `rowMenu()`). "View" comes first, destructive actions last. An action that needs the record page links to it with `?do=<action>`; the page runs it once (a one-minute intent in sessionStorage) and removes the parameter.
- **Column alignment.** `columnAlign()` in `grid.ts`: money and numbers end-aligned, the actions column centred, everything else start-aligned (header and cells alike).
- **Status chips** are sentence case and never cut.
- **KPI cards** of a module use `.ds-kpi-grid` (`KpiCards`, `MetricCard`): two per row on a phone, four from 80rem; a narrow card drops its sparkline and hint.
- **Labels next to an icon** carry no "+" or other symbol in the text.
- **`dark:` utilities** follow the app theme (`data-theme`: graphite and midnight are dark), not the OS setting.
- **Inputs with a leading icon** use `app-input pl-9`; `.app-input` keeps its padding in `@layer components` so the utility wins.
- **Breadcrumbs.** A page with a fixed address (a list, a "new" form) starts a new trail; record pages opened from it extend the trail. Every page has a translated crumb label (`lib/navigation/breadcrumbs.ts`).

## Settings (SET-1)

- **One list of settings pages:** `src/lib/settings/items.ts` (`SETTINGS_ITEMS`): path, name, one-line description, icon, group, permission, module, `adminOnly`, `newUiOnly`, feature flag. The shell's Settings app (tab bar, launcher, command palette, phone drawer), the classic `SettingsTabs`, the breadcrumbs and the `SETTINGS_V2` hub and side menu all read it through `useSettingsItems()`, so a page has one name and one visibility rule everywhere. A new settings page is one entry there (and its manifest menu uses the same `titleKey`; `tests/settingsRedesign.test.mjs` checks it).
- **One navigation:** in the new shell `SettingsTabs` renders nothing (the app tab bar is the menu); in the classic shell it stays.
- **App tab bar** (`AppTabBar`, every app): no visible scrollbar; it scrolls with the wheel, touch and the keyboard; a fade and a small arrow show only on a side that hides tabs; the active tab is scrolled into view.
- **`SETTINGS_V2`** (server env, off by default, new shell only): `/settings` is a hub (search + cards in groups), the company profile moves to `/settings/company`, every settings page gets the side menu (a menu sheet on phones) instead of the app tab bar, and the standard `PageHeader`. Pages wrap their body in `SettingsV2Page`; with the flag off they render their old JSX unchanged.
- **Settings forms** with `SETTINGS_V2`: design-system fields, two columns from `@md`, section cards, one `SettingsSaveBar` (`erp-sticky-actions`) that shows only while something changed, and `useUnsavedChangesGuard` (browser prompt on reload/close, our dialog on in-app links).

## Unified UI (UI-7 phase 2, `UI_UNIFIED`)

- **Flag.** `UI_UNIFIED` (server env, off by default, new shell only) and `UI_UNIFIED_AUDIENCE` (`admins`, the default, or `all`). `src/lib/features/uiUnified.ts`; the client reads `useUiUnified()`. With it on, the shell puts `data-ui-unified` on `<html>`.
- **Shell, with the flag on:**
  - **Side menu (NAV-1):** `AppSideMenu` (desktop, sticky, 15 rem, collapses to an icon rail, remembered in `localStorage`) and `AppMenuSheet` (below 1024 px, a bottom sheet). Pages come from the shell's one page list (`useShellApps`); groups from `src/lib/shell/appMenu.ts` (`APP_MENU_GROUPS`; Settings uses its own groups). A page no group names shows first without a heading, so it is never lost. Not on Home and the launcher; Settings with `SETTINGS_V2` keeps its own menu until phase 3.
  - **No app tab bar** in the header.
  - **Breadcrumbs (NAV-2):** App › Page › Record from the same page list (`appCrumbs` in `lib/shell/shell.ts`; record names via `useRecordCrumb`). A page whose `PageHeader` shows them claims them (`PageChromeProvider`), and the shell hides its own row; pages not migrated yet keep the shell's row. Phones show only the parent.
  - **Back (NAV-4):** the shell button goes to the parent crumb (`parentCrumbHref`), from an app's first page to the launcher.
  - **Quick actions** is a secondary button (ACT-2).
  - **Tokens and font:** `--app-*` alias `--ds-*` and the body font is Inter (`src/design-system/ui-unified.css`); every page sits in a design scope.
  - **Not found (NAV-6):** `src/app/not-found.tsx` shows a translated page with a link to the apps; with the flag off, the same plain page as before.
- **Migrating a page** (phases 3–N): wrap it in `PageFrame` with one `PageHeader`; use `Button`, `Tabs`, `Dialog` / `Drawer` / `ConfirmDialog`, `FormSaveBar` + `useUnsavedChangesGuard`, and the states. Texts come from `src/i18n/uiUnifiedLabels.ts` (group `uiUnified`). `PageFrame` marks the page (`data-ui-page`), so the rulebook page checks apply to it.
- **Lab:** `/dev/ui-lab?frame=unified` shows every shared part on one page with the flag on.

## Guards

- **Lint (`npm run lint`)** fails on a native `<select>`, `<input type="date">`, `<datalist>`, `toLocaleString`, `toLocaleDateString` or `Intl.DateTimeFormat` in `src/`.
  - Code that had them before the rule is listed in `scripts/ui-guard-allowlist.json` with its count.
  - The list may only shrink (`tests/uiStandard.test.mjs`).
  - After replacing usages, run `node scripts/ui-guard-allowlist.mjs --write` to lower it.
- **UI lab (`/dev/ui-lab`):** every component above, with long Azerbaijani and Russian texts, at 280, 360, 768 and 1280 px, in both densities, light and dark. It is for admins only and needs `NEW_UI`.
- **`npm run ui:guard`** opens the lab in Chromium and fails when:
  - an element marked `data-ui-check="single-line"` wraps;
  - a chip, button or cell overflows without a marked truncation;
  - a card's child leaves the card;
  - a frame scrolls sideways.

  To run it locally (it needs no sign-in and no database):

  ```
  UI_STANDARD=true UI_LAB_OPEN=true NEW_UI=true npm run dev
  npm run ui:guard -- --url http://localhost:3000 --screens design/screenshots/ui-lab
  ```

  - Playwright must resolve: install it globally, or set `UI_GUARD_PLAYWRIGHT` to a playwright folder.
  - `UI_LAB_OPEN` works only under `next dev`.
- **Page checks (UI-5)** run in `ui:guard` on `/dev/ui-lab?frame=page` (a shell, a list with row menus and totals, KPI cards and document lines) at 1440, 1366x768, 768 and 360x740 in az and ru. They fail on a second vertical scroller, a window taller than the screen, the page scrolling sideways, an empty band, a missing or hidden actions column, a numeric column not end-aligned, a grid header gone while its rows show, and a clipped popover (a row menu and a lookup are opened low in the window). With `UI_TEST_EMAIL` and `UI_TEST_PASSWORD` set, the same checks run signed in on the main pages (`MAIN_ROUTES` in `scripts/ui-guard.mjs`; `UI_GUARD_ROUTES` overrides).
- **UI rulebook lint (UI-7):** the same allowlist mechanism for `windowDialog`, `appModal`, `fixedOverlay`, `tinyText`, `uppercase`, `legacyButton`, `rawPalette`, `toastMessage`, `rawH1` and `rawTabRole` (rules in `scripts/ui-guard-rules.mjs`; the design system and print layouts are exempt where the rule says so). The totals when they were added are ceilings in `tests/uiUnified.test.mjs`.
- **UI rulebook page checks (UI-7)** run in `ui:guard` whenever `data-ui-unified` is set: on `/dev/ui-lab?frame=unified`, and on signed-in routes for a test account with the flag on. Shell: `shell-tabbar`, `breadcrumbs`. Migrated pages (`data-ui-page`): `h1-count`, `h1-header`, `primary-count`, `toolbar-low`, `small-target` (`findUnifiedIssues` in `scripts/ui-page-checks.mjs`).
- **Audit:** `docs/ui-audit-2026-11-03.md` lists what the live-site audit found and its status; `docs/ui-system/audit.md` is the UI-7 audit (finding ids such as NAV-01).
