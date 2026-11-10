# UI research for the Del Groups ERP (UI-7, phase 1a)

Who we design for: accountants, sales and warehouse staff using the ERP every day, mostly on
desktop (1280–1920 px, Windows, mouse and keyboard), and on phones (390 px) in the warehouse and
on the road. Three languages (az, en, ru); Azerbaijani and Russian labels are 20–40 % longer than
English. The data is dense: lists of hundreds of documents, forms with 10–40 fields and document lines.

How this was made: each source below was opened and read on 2026-11-10. Notes are paraphrased; a
source that could not be read is marked so and is not used for any number or rule.

## Sources read

| # | Source | URL |
| --- | --- | --- |
| N1 | NN/g: 10 Usability Heuristics for User Interface Design | https://www.nngroup.com/articles/ten-usability-heuristics/ |
| N2 | NN/g: Breadcrumbs: 11 Design Guidelines for Desktop and Mobile | https://www.nngroup.com/articles/breadcrumbs/ |
| N3 | NN/g: Website Forms Usability: Top 10 Recommendations | https://www.nngroup.com/articles/web-form-design/ |
| N4 | NN/g: Placeholders in Form Fields Are Harmful | https://www.nngroup.com/articles/form-design-placeholders/ |
| N5 | NN/g: 10 Design Guidelines for Reporting Errors in Forms | https://www.nngroup.com/articles/errors-forms-design-guidelines/ |
| N6 | NN/g: Error-Message Guidelines | https://www.nngroup.com/articles/error-message-guidelines/ |
| N7 | NN/g: Data Tables: Four Major User Tasks | https://www.nngroup.com/articles/data-tables/ |
| N8 | NN/g: OK-Cancel or Cancel-OK? The Trouble With Buttons | https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/ |
| N9 | NN/g: Tabs, Used Right | https://www.nngroup.com/articles/tabs-used-right/ |
| N10 | NN/g: Left-Side Vertical Navigation on Desktop | https://www.nngroup.com/articles/vertical-nav/ |
| N11 | NN/g: Dashboards: Making Charts and Graphs Easier to Understand | https://www.nngroup.com/articles/dashboards-preattentive/ |
| N12 | NN/g: Maintain Consistency and Adhere to Standards (Heuristic #4) | https://www.nngroup.com/articles/consistency-and-standards/ |
| W1 | W3C: What's New in WCAG 2.2 | https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ |
| W2 | W3C: Web Content Accessibility Guidelines (WCAG) 2.2 | https://www.w3.org/TR/WCAG22/ |
| W3 | WAI-ARIA APG: Dialog (Modal) Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ |
| W4 | WAI-ARIA APG: Tabs Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ |
| W5 | WAI-ARIA APG: Breadcrumb Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/ |
| W6 | WAI-ARIA APG: Menu Button Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ |
| W7 | WAI-ARIA APG: Grid Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/grid/ |
| C1 | IBM Carbon: Button usage | https://carbondesignsystem.com/components/button/usage/ |
| C2 | IBM Carbon: Forms pattern | https://carbondesignsystem.com/patterns/forms-pattern/ |
| C3 | IBM Carbon: Data table usage | https://carbondesignsystem.com/components/data-table/usage/ |
| C4 | IBM Carbon: Global header | https://carbondesignsystem.com/patterns/global-header/ |
| C5 | IBM Carbon: UI shell left panel | https://carbondesignsystem.com/components/UI-shell-left-panel/usage/ |
| C6 | IBM Carbon: Breadcrumb usage | https://carbondesignsystem.com/components/breadcrumb/usage/ |
| C7 | IBM Carbon: Spacing | https://carbondesignsystem.com/elements/spacing/overview/ |
| C8 | IBM Carbon: Type sets | https://carbondesignsystem.com/elements/typography/type-sets/ |
| F1 | Microsoft Fluent 2: Button (React) usage | https://fluent2.microsoft.design/components/web/react/core/button/usage |
| F2 | Microsoft Fluent 2: Layout | https://fluent2.microsoft.design/layout |
| F3 | Microsoft Fluent 2: Typography | https://fluent2.microsoft.design/typography |
| F4 | Microsoft Fluent 2: Color | https://fluent2.microsoft.design/color |
| A1 | Atlassian: Button usage | https://atlassian.design/components/button/usage |
| A2 | Atlassian: Page header usage | https://atlassian.design/components/page-header/usage |
| A3 | Atlassian: Spacing | https://atlassian.design/foundations/spacing |
| A4 | Atlassian: Design tokens | https://atlassian.design/foundations/tokens/design-tokens |
| P1 | GitHub Primer: Saving | https://primer.style/ui-patterns/saving |
| P2 | GitHub Primer: Forms | https://primer.style/product/ui-patterns/forms/ |
| P3 | GitHub Primer: Empty states | https://primer.style/ui-patterns/empty-states |
| S1 | Shopify App Home: Save Bar API | https://shopify.dev/docs/api/app-home/apis/save-bar |
| L1 | Salesforce Lightning (v1): Page headers | https://v1.lightningdesignsystem.com/components/page-headers/ |
| L2 | Salesforce Lightning (v1): Toast | https://v1.lightningdesignsystem.com/components/toast/ |
| M1 | Android: Use window size classes (Material adaptive layout) | https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes |
| G1 | GOV.UK Design System: Error message | https://design-system.service.gov.uk/components/error-message/ |
| G2 | GOV.UK Design System: Error summary | https://design-system.service.gov.uk/components/error-summary/ |
| G3 | GOV.UK Design System: Recover from validation errors | https://design-system.service.gov.uk/patterns/validation/ |
| G4 | GOV.UK Design System: Button | https://design-system.service.gov.uk/components/button/ |
| G5 | GOV.UK Design System: Layout | https://design-system.service.gov.uk/styles/layout/ |
| B1 | Baymard: Usability Testing of Inline Form Validation (2024) | https://baymard.com/blog/inline-form-validation |
| B2 | Baymard: Field Label UX: Place Labels Above the Field | https://baymard.com/blog/mobile-form-usability-label-position |
| B3 | Baymard: Mark Both Required and Optional Fields | https://baymard.com/blog/required-optional-form-fields |

**Could not be read** (refused automated access or only the page title loaded), so not used:
SAP Fiori design guidelines (www.sap.com/design-system, HTTP 403), Material Design 3 component and
touch-target pages (client-rendered; only titles), Apple Human Interface Guidelines (only titles),
Shopify Polaris page component (moved off-site). Their well-known ideas (Fiori's list report and
object page with a footer bar; HIG's 44 pt targets) are not cited here as evidence; where we use a
similar idea, the reason is given from a source that was read.

## What the sources agree on

1. **Consistency beats local optimisation.** Same patterns, same button side, same wording across
   the whole product; inconsistency costs users time and causes misclicks (N12, N8, N1 #4).
2. **One primary action per page or area.** Carbon (C1), Fluent (F1), Atlassian (A1) and GOV.UK (G4)
   all say it almost word for word. Other actions are secondary, subtle or in a menu.
3. **Labels above fields, always visible; placeholders are not labels** (N3, N4, C2, P2, B2).
   Single column by default (N3, C2, P2, G5); short related fields may share a row (N3).
4. **Errors next to the field, in plain words, saying how to fix it; keep what the user typed**
   (N5, N6, G1, P2). Never only colour (N6, W2 1.4.1, F4). No "invalid", "error occurred" (N6, G1).
5. **Breadcrumbs show the place in the hierarchy, not click history; current page last and not a
   link; never wrap** (N2, C6, W5). They supplement the main navigation, never replace it (N2).
6. **Tables for comparing and scanning many records** (N7): human-readable first column, frozen
   header (and first column), row hover, column hiding with a visible state, batch actions with
   select-all, row actions in an overflow menu (N7, C3). Toolbar above, pagination below (C3).
7. **Status feedback after every action** (N1 #1, L2); errors that block need a stronger form than a
   toast (N6, P1).
8. **Tokens by meaning, one scale.** Spacing on a 4/8 px grid (C7, F2, A3); type in a small ramp with
   a 14 px body for productive apps (C8, F3); colour by role (neutral / brand / status), status colour
   never decorative (F4, A4).
9. **Accessibility: WCAG 2.2 AA** — 4.5:1 text, 3:1 UI parts and focus, visible focus not hidden by
   sticky bars (2.4.11), targets at least 24×24 px (2.5.8), no drag-only actions (2.5.7), reflow at
   320 px (1.4.10), status messages announced (4.1.3) (W1, W2). Dialogs trap focus, close on Escape and
   return focus (W3).
10. **Don't hide the main navigation behind a hamburger on desktop; don't show it twice** (N10).

## Where they differ, and what we choose

| Topic | Positions | Our choice for this ERP | Why |
| --- | --- | --- | --- |
| **Button order** | Primary left on full-page forms, right in dialogs (C1, A1, P1, G4). Windows "OK first" vs Apple "OK last" (N8). | **Dialogs and the sticky save bar: Cancel left, primary right (at the end).** In page headers: primary is the right-most button. | Users are on Windows web apps that already put primary at the end of dialogs; our dialogs, save bar and header (SET-1) already do it. Consistency inside the product beats copying one source (N12, N8). |
| **Where Save lives** | Bottom of the form (C2, P1, G4); a contextual bar that shows only when there are changes (S1). | **One sticky save bar at the bottom of the scroller, shown only when the form is dirty**, Discard + Save; "new" forms show it always. | Long ERP forms push a bottom button off-screen; a sticky bar keeps it reachable (and SCROLL-1 already has `erp-sticky-actions`). S1 shows the "only when dirty" pattern. |
| **Validation timing** | On blur (B1, C2, P2 after leaving an invalid field); only on submit (G3). | **On blur for format rules, re-check on every keystroke once a field is in error (so the error clears as soon as it is fixed), and all rules again on Save** with a summary when there are 3+ errors (P2). | ERP staff fix one field and move on; G3 targets one-off public services. B1 measures that clearing errors live helps. |
| **Required marking** | Mark only optional when most fields are required (C2); mark both (B3); mark required (P2). | **Asterisk on required fields, "(optional)" never; forms keep required fields first.** | Most ERP form fields are optional; marking the few required ones is the shorter signal (C2's rule, applied to our ratio). |
| **Disabled primary button** | Avoid disabling (A1, G4, P1, P2); disable short forms until valid, and during submit (C2). | **Never disabled for validation; disabled only while saving** (with a spinner) or without permission (with a tooltip that says why). | Disabled buttons give no reason (G4, A1). |
| **Toasts** | Toast after an action (L2, F1); avoid toasts, prefer inline messages (P1). | **Toast for success and for errors not tied to a field; inline for field errors; a blocking dialog only for errors that stop the task** (N6). | Staff often save and move on; a short success toast is enough. |
| **Navigation inside an app** | Top header links for few sections (C4); left panel for more than 5 items or frequent switching (C5, N10); tabs only for few, grouped items, never overflowing (N9). | **See the decision below.** | — |
| **Row actions** | Inline icons for 1–2 actions, overflow menu for more (C3, N7). | **"…" menu in a pinned last column for every list; a single obvious action may also be the row click.** | Our rows have 3–8 actions; one place for them everywhere (N12). Already in UI-5. |
| **Row height** | Carbon 24–64 px, default 40 (C3). | **Compact 32 px (default for lists), comfortable 40 px** (already in ui-standard). | Accountants scan hundreds of rows; Carbon's sm/md sizes. |
| **Breakpoints** | Fluent 480/640/1024/1366/1920 (F2); Material 600/840/1200/1600 (M1). | **Phone < 768, tablet 768–1023, desktop ≥ 1024, wide ≥ 1440** (Tailwind md/lg + our `@md` container queries). | Matches the code base (Tailwind) and our real devices; both sources put the desktop change near 840–1024. |

## The navigation decision

**Problem (from the audit):** each app shows its pages as top tabs in the shell header; Settings
(SETTINGS_V2) has a left side menu. Apps differ in size: Trade has ~10 pages, Inventory ~12,
Finance ~10, Settings 18, while To-do, Calendar and Documents have 1–2. Top tabs over ~7 items
overflow and hide tabs even with SET-1's scroll arrows (N9: overflowing tab bars hide tabs).

**Sources:** a left panel when there are more than five secondary items or users switch often (C5);
vertical navigation scales and is easy to scan, keep it visible on desktop and do not duplicate it
(N10); tabs only for a few grouped items in one row (N9); a third level goes into in-page tabs (C5).

**Decision: one pattern for every app — a left side menu, inside the page, grouped, the same as
Settings.**

- Every app with **2 or more pages** has the same left side menu on desktop (≥ 1024 px): app name at
  the top, pages in labelled groups (the groups Settings already has; other apps get groups from
  their module menus), the current page highlighted, sticky inside the page scroller.
- Apps with **1 page** (To-do, Calendar, Documents, Apps) have no menu.
- **No top tabs in the shell header** for app pages any more. Top tabs remain only *inside* a page,
  for the parts of one record or one report (≤ 6 tabs, one row, N9) — e.g. a sales invoice's
  "Lines / Payments / History".
- **Below 1024 px** the side menu becomes the same button + bottom sheet that Settings uses on phones.
- The menu can collapse to icons (with tooltips) on 1280–1365 px screens, by the user's choice (N10
  allows icon rails only for daily-use apps where users learn the icons — our case), and remembers it.

Why not top tabs everywhere: 4 of the 6 big apps already overflow at 1366 px in Azerbaijani (audit
NAV-01), and NN/g says overflowing tabs hide content (N9). Why not "tabs up to N, side menu above
N": it gives two patterns, and apps cross the threshold when a module is switched on or the
language changes (ru is longer) — the layout would jump (N12).

## Practical rules taken into the rulebook

The rulebook (`docs/ui-standard.md`) cites these sources by their # in each rule.
