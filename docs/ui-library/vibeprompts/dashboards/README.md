# Dashboards (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## ⭐ Activity feed panel

`dashboards/dashboards-activity-feed-panel` · [preview](dashboards-activity-feed-panel.html) · [source](https://vibeprompts.dev/dashboards/dashboards-activity-feed-panel/)

> Timeline of events with actor avatars — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an activity feed panel with Tailwind CSS: a bordered rounded-2xl card with a header showing a title and a "Filter" ghost button, then a vertical timeline where a continuous hairline runs behind circular event markers. Each entry has a small colored dot or glyph marker, a sentence combining a bold actor name with a neutral action and a linked object, a relative timestamp, and for one entry an indented quoted comment in a tinted box. Finish with a full-width "View all activity" footer link.
```

## ⭐ Analytics overview with range chips

`dashboards/dashboards-analytics-overview-with-range-chips` · [preview](dashboards-analytics-overview-with-range-chips.html) · [source](https://vibeprompts.dev/dashboards/dashboards-analytics-overview-with-range-chips/) · has JavaScript

> Date range switches every figure on the page — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an analytics overview panel with Tailwind CSS. The header row holds a page title, a muted line naming the active range, and on the right a chip group for 24h, 7d, 30d and 90d where the active chip is dark, plus a bordered "Export" button. Below, a four-card metric row: each bordered rounded-xl card has a small label, a large figure, a signed change pill in green or red, and a twelve-bar mini chart drawn with flex items of varying heights. Under that, a wider chart card with a title, a legend of two dotted series labels, and a placeholder area chart drawn as an SVG polyline over a faint grid. Then add JavaScript that holds a dataset per range, redraws the four figures, the change pills and the mini bars when a chip is clicked, and updates the subline to name the compared period.
```

## ⭐ Approvals queue with detail drawer

`dashboards/dashboards-approvals-queue-with-detail-drawer` · [preview](dashboards-approvals-queue-with-detail-drawer.html) · [source](https://vibeprompts.dev/dashboards/dashboards-approvals-queue-with-detail-drawer/) · has JavaScript

> List on the left, the selected request on the right — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design an approvals workspace with Tailwind CSS in two panes. The left pane is a bordered list with a header showing a title and a pending count, three filter chips for pending, approved and rejected, and six request rows: each with a requester avatar, a title line describing what is being asked, a muted line with the amount and the age of the request, and a small type pill. The selected row has a neutral-50 background and a neutral-900 left border. The right pane is a detail panel showing the request title, a status pill, a two-column definition list of six fields, a justification paragraph in a bordered quote block, an attachment row with a file glyph and size, and a sticky footer with a red-outlined Reject button, a bordered "Ask a question" and a dark Approve. Then add JavaScript that swaps the detail panel content when a row is selected and decrements the pending count when a request is approved or rejected.
```

## ⭐ Chart card with legend

`dashboards/dashboards-chart-card-with-legend` · [preview](dashboards-chart-card-with-legend.html) · [source](https://vibeprompts.dev/dashboards/dashboards-chart-card-with-legend/) · has JavaScript

> CSS-only stacked bars and range picker — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an analytics chart card with Tailwind CSS using no charting library. The card header has a title, a subtitle with the total and a green delta, and a small segmented range picker (7d / 30d / 90d) where one option is active. The chart body is a flex row of column groups; each column is a rounded stacked bar built from two divs of different heights and shades, aligned to the bottom with items-end. Add x-axis labels beneath and a legend row with two colored dots naming the series. Then add JavaScript that renders the bars from a data array instead of fixed classes: hold one dataset per range, scale every bar as a percentage of the largest total so the chart always fills its height, redraw the bars, labels, total, and delta when the range changes, move the active pill, and give each column a title tooltip with its exact figures.
```

## Cost explorer by service

`dashboards/dashboards-cost-explorer-by-service` · [preview](dashboards-cost-explorer-by-service.html) · [source](https://vibeprompts.dev/dashboards/dashboards-cost-explorer-by-service/)

> Spend split across services with a forecast — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a cloud cost dashboard with Tailwind CSS. The header holds a title, a muted month label, a month-picker select and an outline "Set a budget" button. Below, three summary cards: month to date with a large figure and a small delta pill, forecast for the month with a muted note about the method, and budget with a thin track showing the percentage consumed and an amber fill when past eighty percent. Then a table of six services with columns for service, this month, last month, change and a share bar; the change column uses green and red arrows and the share column draws a thin neutral-900 bar with the percentage beside it. Highlight the largest row with a faint background. Under the table, two footnote lines about tax exclusion and the daily refresh time, plus a link to the detailed breakdown.
```

## ⭐ Data table with toolbar

`dashboards/dashboards-data-table-with-toolbar` · [preview](dashboards-data-table-with-toolbar.html) · [source](https://vibeprompts.dev/dashboards/dashboards-data-table-with-toolbar/) · has JavaScript

> Searchable list with status chips — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a data table card with Tailwind CSS: a header row with a title, a search input, and a filter/"Add" button; then a table with columns (Name, Status pill, Plan, Created) and a few rows. Status uses colored pills (green/amber/gray). Add hover states on rows and a rounded bordered container. Then add JavaScript so the toolbar is not decorative: filter rows live as the visitor types, make the Name, Plan, and Created headers clickable to sort ascending then descending with an arrow indicator on the active column, show a "no results" row when the search matches nothing, and keep a row count in the header.
```

## Feature flag rollout panel

`dashboards/dashboards-feature-flag-rollout-panel` · [preview](dashboards-feature-flag-rollout-panel.html) · [source](https://vibeprompts.dev/dashboards/dashboards-feature-flag-rollout-panel/) · has JavaScript

> Percentage targeting with environment toggles — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a feature flag management panel with Tailwind CSS. The header holds the flag name in monospace with a small "boolean" type pill, a muted description line, and a prominent switch on the right showing the flag on in production. Below, three environment rows in a bordered card: each has the environment name, a small state pill, a rollout percentage with a range slider, and a muted line giving how many users that represents. Then a targeting section listing two rules as bordered rows with a condition in monospace, a small "then serve true" clause and a delete cross, plus a dashed "Add a rule" row. Finish with an audit strip of three recent changes, each with an avatar, a sentence describing the change and a relative timestamp. Then add JavaScript that keeps each percentage label and its user estimate in sync with its slider, and flips the environment pill between off, partial and full.
```

## ⭐ Inbox split view

`dashboards/dashboards-inbox-split-view` · [preview](dashboards-inbox-split-view.html) · [source](https://vibeprompts.dev/dashboards/dashboards-inbox-split-view/) · has JavaScript

> Conversation list beside a reading pane — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a two-pane inbox layout with Tailwind CSS. The left pane is a 22rem column with its own border: a header with "Inbox", an unread count pill and a filter glyph, a compact search field, and a scrollable list of conversation rows. Each row is a button carrying a data-thread id, and shows an unread dot, an avatar circle with initials, the sender in medium weight, the time right-aligned, the subject, and a one-line preview truncated with line-clamp. The right pane fills the rest: a header with the subject, participant line and action glyphs (archive, snooze, ⋯), a scrollable thread body of message bubbles alternating between grey incoming cards and a neutral-900 outgoing card, and a sticky reply box at the bottom with a textarea and a dark Send button. Then add JavaScript holding the thread contents in an object keyed by id: clicking a row moves the selected highlight, clears that row's unread dot and decrements the header count, renders the subject, participants and every message into the reading pane, and scrolls the pane back to the top of the thread.
```

## Incident board

`dashboards/dashboards-incident-board` · [preview](dashboards-incident-board.html) · [source](https://vibeprompts.dev/dashboards/dashboards-incident-board/)

> Live incidents ranked by severity with owners — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an incident management board with Tailwind CSS. The header has a title, a live pill with a pulsing red dot reading how many incidents are open, and two buttons — a bordered "Subscribe" and a dark "Declare incident". Below, three summary tiles for open, mitigated and resolved-today counts with muted labels. The main list groups incidents by severity: a small uppercase group heading with a coloured square, then rows in a bordered card. Each row shows a severity chip, the incident title in medium weight, a muted line with the affected service and start time, a duration in monospace, a small stacked avatar pair for responders, and a status pill on the right. Include two Sev-1, two Sev-2 and one Sev-3 example, with the resolved one dimmed and struck through in its title. End with a link to the full timeline.
```

## ⭐ Inventory replenishment cockpit

`dashboards/dashboards-inventory-replenishment-cockpit` · [preview](dashboards-inventory-replenishment-cockpit.html) · [source](https://vibeprompts.dev/dashboards/dashboards-inventory-replenishment-cockpit/) · has JavaScript

> Prioritize purchase orders before stock runs out — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an inventory replenishment cockpit with Tailwind CSS. Show days-of-cover, stockout risk, open purchase-order value, and supplier reliability metrics. Include a priority table for SKUs with forecast, inbound quantity, lead time, and recommended order, plus a side panel for the selected item with demand bars and a Create purchase order action. Add JavaScript that selects inventory rows and fills the detail panel.
```

## ⭐ Kanban board with drag and drop

`dashboards/dashboards-kanban-board-with-drag-and-drop` · [preview](dashboards-kanban-board-with-drag-and-drop.html) · [source](https://vibeprompts.dev/dashboards/dashboards-kanban-board-with-drag-and-drop/) · has JavaScript

> Four columns, movable cards, live counts — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a kanban board with Tailwind CSS. A header row with the board name, a small avatar stack of collaborators and a dark "New task" button, then a horizontally scrollable flex row of four columns — Backlog, In progress, In review, Shipped — each a fixed-width neutral-50 panel with a rounded border. Every column header shows its name, a count badge, and a ⋯ menu glyph; below it a drop area marked with a data-column attribute holding the cards, and a quiet "+ Add task" button pinned at the bottom. A card is a white rounded tile with a coloured category chip, a task title, and a footer row with an avatar circle, a due date and a small comment count; mark each with a data-card attribute. Then add JavaScript that makes the cards draggable with the native HTML drag-and-drop events: fade and rotate the card while it is being dragged, tint the column under the pointer and ring it, insert the card above whichever card the pointer is nearest (or at the end of an empty column), and recount every column header after each drop.
```

## Log viewer with live tail

`dashboards/dashboards-log-viewer-with-live-tail` · [preview](dashboards-log-viewer-with-live-tail.html) · [source](https://vibeprompts.dev/dashboards/dashboards-log-viewer-with-live-tail/) · has JavaScript

> Streaming lines with severity filters and pause — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a log viewer with Tailwind CSS. The toolbar holds a service select, a search field with a magnifier glyph, four severity toggle chips for debug, info, warn and error with counts, a "Live" pill with a pulsing green dot, and a pause button. The body is a dark rounded-xl panel of monospaced log lines: each line has a muted timestamp, a coloured severity tag of fixed width, a service name in a dimmer colour, and the message, with error lines given a faint red left border and a slightly tinted background. Under the panel, a status bar with the line count on the left and the retention window on the right. Then add JavaScript that appends a new random line every second while live, caps the buffer at eighty lines, auto-scrolls to the bottom unless the user has scrolled up, toggles severities on and off, filters on the search text and switches the pause button between paused and live states.
```

## Query performance workbench

`dashboards/dashboards-query-performance-workbench` · [preview](dashboards-query-performance-workbench.html) · [source](https://vibeprompts.dev/dashboards/dashboards-query-performance-workbench/) · has JavaScript

> Diagnose slow database queries from one focused view — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a query-performance workbench with Tailwind CSS. Include database and time-range filters, p95 latency and throughput metrics, a ranked query table with calls, rows, duration, and trend, plus a detail panel showing the selected SQL, execution-plan steps, and a recommendation. Add JavaScript that selects rows, updates the detail panel from data, and filters to slow queries only.
```

## ⭐ Regional performance board

`dashboards/dashboards-regional-performance-board` · [preview](dashboards-regional-performance-board.html) · [source](https://vibeprompts.dev/dashboards/dashboards-regional-performance-board/) · has JavaScript

> Latency and uptime per region beside a map block — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a regional operations dashboard with Tailwind CSS. The left two thirds is a bordered card holding a title, a legend of three coloured dots for healthy, degraded and down, and a stylised world map built from a grid of small squares in varying tints — no images — with five larger dots absolutely positioned over it representing regions, one amber and one red. The right third is a scrollable list of eight region rows, each with a status dot, the region code in monospace, the city name, the p99 latency and a small uptime percentage; the degraded row carries a one-line note. Under both, a strip of four aggregate figures separated by vertical rules. Then add JavaScript that links the list to the map: hovering a row enlarges its map dot and shows a small tooltip with the region name and latency, and clicking a row keeps it selected until another is chosen.
```

## ⭐ Sidebar + stat cards

`dashboards/dashboards-sidebar-stat-cards` · [preview](dashboards-sidebar-stat-cards.html) · [source](https://vibeprompts.dev/dashboards/dashboards-sidebar-stat-cards/)

> App shell with metric row — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a dashboard shell with Tailwind CSS: a fixed left sidebar (logo, nav items with active state, user chip at bottom) and a main area with a top bar (page title + primary button) and a row of four KPI cards, each showing a label, a big value, and a small delta. Keep it light with borders and rounded-2xl cards. Hide the sidebar under lg.
```

## ⭐ Team and roles admin

`dashboards/dashboards-team-and-roles-admin` · [preview](dashboards-team-and-roles-admin.html) · [source](https://vibeprompts.dev/dashboards/dashboards-team-and-roles-admin/) · has JavaScript

> Member table with inline role controls — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a team administration panel with Tailwind CSS. The header holds a title, a muted seat counter reading how many of the licensed seats are in use, a search field and a dark "Invite people" button. The table lists six members with columns for member, role, last active and status: the member cell pairs an avatar circle with a name and email stacked; the role cell is a small bordered select with Owner, Admin, Editor and Viewer; last active is muted relative text; status is a pill reading Active, Invited or Suspended in appropriate tints, and each row ends with a three-dot menu button. Show a checkbox column with a header checkbox, and above the table a bulk-action bar that appears only when rows are selected, showing the count and two ghost buttons. Then add JavaScript that wires the select-all checkbox, keeps the bulk bar and its count in sync, and warns with an inline note when the last Owner role is changed away.
```

## ⭐ Usage and billing meters

`dashboards/dashboards-usage-and-billing-meters` · [preview](dashboards-usage-and-billing-meters.html) · [source](https://vibeprompts.dev/dashboards/dashboards-usage-and-billing-meters/)

> Every metered resource against its allowance — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a usage and billing panel with Tailwind CSS. The card header holds a title, a muted line giving the billing period and days remaining, and a dark "Manage plan" button. Below, an estimated-total block on a neutral-50 strip: a large figure with a muted "estimated for August" label on the left and, on the right, a two-line note about when the invoice is issued. Then a list of five metered resources — API requests, seats, storage, exports and webhook deliveries — each row showing the resource name with a small glyph, the used and included figures in monospace on the right, a thin progress track whose fill turns amber above eighty percent and red above one hundred, and an overage line in red beneath any row that exceeds its allowance showing the extra cost. Close with a footer row linking to detailed usage and the pricing page.
```

## ⭐ Week schedule grid

`dashboards/dashboards-week-schedule-grid` · [preview](dashboards-week-schedule-grid.html) · [source](https://vibeprompts.dev/dashboards/dashboards-week-schedule-grid/)

> Seven columns of time blocks with a now line — a free dashboard prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a weekly schedule view with Tailwind CSS. The toolbar holds the month and year as a heading, previous and next chevron buttons with a "Today" button between them, a segmented Day, Week and Month control on the right and a dark "New event" button. The grid below has a narrow left gutter of hour labels from 08:00 to 18:00 in small monospaced text, and seven day columns with a header row showing the weekday abbreviation and the date number, where today gets a dark filled circle behind the number. Inside the columns, place absolutely positioned event blocks with top and height set inline, coloured with tinted backgrounds and a matching left border, showing a title and a time range in small text; include eight events across the week, two overlapping on one day rendered side by side at half width, and a red current-time line across the grid with a small dot at its left end.
```
