# UI standard

One set of UI rules for every screen. Later prompts link here. Behind `UI_STANDARD` (server env, off by default): with it on, `<html data-ui-standard>` turns on the token aliases and layout fixes in `src/design-system/ui-standard.css`, and screens switch to the components below.

## Tokens

- `--ds-*` (`src/design-system/theme.css`) is the single source of truth.
- Every legacy `--erp-*` token is an alias of a `--ds-*` token in `src/design-system/ui-standard.css`, so `src/components/ui/*` and `src/design-system` render with the same scale.
- Don't add new `--erp-*` tokens, and never hard-code a colour or size in a component.

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

## Rules

Never native select or date inputs; never wrapped text in a row, chip, button or title.

1. **No text wraps inside a table row, chip, button or widget title.** Use one line with an ellipsis, and give the full text in a tooltip (`Truncate`, `Chip`).
2. **Controls never stretch across a row.**
   - Full width only inside a stacked `Field` (label above the control).
   - In inline groups, toolbars and table cells, a control sizes to its content or to a width token.
3. **Labels never wrap under their control.** Long labels get an ellipsis and a tooltip.
4. **Card and section headers:** the title is on the left; the actions on the right are icon or small buttons and never push the title to wrap.
5. **No duplicate actions for the same thing on one screen.** One "Save", one "Print", one place to add a line.
6. **Every lookup field uses `Combobox`.** Never a native `<select>` or `<datalist>`.
7. **Every date uses `DateField` / `DateTimeField`.** Never `<input type="date">`.
   - Typing is `dd.mm.yyyy`; the value stays ISO.
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

## Which component (`@/design-system/components`)

| Need | Component |
| --- | --- |
| Label + control + hint/error | `Field` (`layout="inline"` for label-left) |
| Form layout, 1–4 responsive columns | `FormGrid` (+ `span` on `Field`), `FieldRow` for a new line |
| Controls on one line (cost row, filters) | `InlineGroup` (wraps whole units; `ds-grow` for the one that may grow) |
| Card / section with title and actions | `Section` / `Card` |
| Bar above a list | `Toolbar`: left = title, filters, search; right = actions, then the settings icon |
| Page title with actions | `PageHeader` |
| Any one-line text that may be long | `Truncate` (tooltip only when actually cut) |
| Icon-only button | `IconButton` (`size` md 32 px / sm 28 px) |
| Status | `Chip` |
| Any list of records | `DataGrid` (classic pages: `ListGrid`) |
| Money / number / date in a table | `MoneyCell` / `NumberCell` / `DateCell` |
| Lookup or choice | `Combobox` (fixed or async options, clear, empty state, `footer` slot for "+ create") |
| Date / date and time | `DateField` / `DateTimeField` |

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
