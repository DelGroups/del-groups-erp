## What changed

<!-- In plain words. Name the task (e.g. UI-7 phase 3, SET-1). -->

## How it was tested

<!-- npm run lint (no new errors in touched files), npm test, npm run build; browser checks and widths. -->

## Manual steps for Del

<!-- Flags to set, SQL to run (in order), or "none". -->

## UI rulebook (docs/ui-standard.md)

Rules touched: <!-- e.g. NAV-2, PAGE-1, FORM-5 — or "no UI change" -->

- [ ] One navigation pattern; breadcrumbs App › Page › Record; title = last crumb = menu name (NAV-1…3)
- [ ] One `PageHeader` with one `<h1>`; header → KPIs → toolbar → content (PAGE-1, PAGE-2)
- [ ] One primary action per screen, primary rightmost, ≤ 3 visible actions, rest in "…" (ACT-2, ACT-3, ACT-7)
- [ ] Forms: labels on top, "*" for required, `Combobox` / `DateField` / `EntityLookup` with quick-create, one sticky save bar + unsaved guard (FORM-1…5)
- [ ] Lists: `DataGrid` + the standard toolbar, dates never cut, "…" row menu with View first (LIST-1…3)
- [ ] Dialogs: design-system `Dialog` (Escape, focus trap, fixed header/footer) (OVL-1)
- [ ] Tokens only: no raw colours, no text below 12 px, no `uppercase`, Inter only (TOK-1, TOK-2, TXT-1)
- [ ] All texts in az, en, ru; dates and money from the formatters (TXT-2…4)
- [ ] One vertical scroller, no sideways scroll, works at 390 px; contrast and 24 px targets (PAGE-4, RESP-1, A11Y-1, A11Y-3)
- [ ] New behaviour behind a flag, off by default (CLAUDE.md rule 6)
- [ ] Screenshots before / after at 1366 and 390, light and dark (UI changes only)

Exceptions (rule, reason):

## Unrelated problems found

<!-- List them; don't fix them in this PR. -->
