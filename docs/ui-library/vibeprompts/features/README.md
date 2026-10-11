# Features (19)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Accessibility commitments

`features/features-accessibility-commitments` · [preview](features-accessibility-commitments.html) · [source](https://vibeprompts.dev/features/features-accessibility-commitments/)

> Conformance, keyboard support and how to report gaps — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an accessibility section with Tailwind CSS. Open with a small "Accessibility" label, a heading and a paragraph stating the conformance target plainly and admitting where gaps remain. Then a two-column layout: the wide column holds six commitment blocks in a two-column grid, each with a glyph tile, a bold heading and two lines — keyboard operability, screen reader labelling, contrast ratios, motion preferences, captioning, and text resizing to two hundred percent. The narrow column is a bordered card summarising the conformance report: a WCAG level pill, an audit date, the auditing firm, a link to the VPAT and a small "Known issues: 3" line linking to the tracker. Under both, a bordered strip on neutral-50 inviting reports of barriers with an email link and a promise about the response time, plus a line about the assistive technologies regularly tested.
```

## Alternating showcase

`features/features-alternating-showcase` · [preview](features-alternating-showcase.html) · [source](https://vibeprompts.dev/features/features-alternating-showcase/)

> Text and media rows that flip sides — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an alternating feature showcase with Tailwind CSS: two rows where the text and the media panel swap sides. Each row is a two-column grid on lg with a text block (eyebrow, heading, paragraph, bullet list, link) and a rounded media placeholder. Use order utilities to flip the second row. Stack vertically on mobile with the media on top.
```

## API block with language tabs

`features/features-api-block-with-language-tabs` · [preview](features-api-block-with-language-tabs.html) · [source](https://vibeprompts.dev/features/features-api-block-with-language-tabs/) · has JavaScript

> Developer-facing feature with switchable snippets — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a developer-focused feature block with Tailwind CSS in two columns. The left column holds a small "API first" label, a heading about shipping in an afternoon, a paragraph, three compact bullet rows with glyph tiles covering typed SDKs, idempotent writes and webhook replay, and a pair of links for the reference and the changelog. The right column is a dark code card: a header strip with three language tabs — cURL, TypeScript, Python — the active one in white on neutral-800, and a copy button on the right; the body is a pre block of monospaced code in light grey; a footer strip shows a muted response line with a green status dot. Then add JavaScript that holds the three snippets in a map, renders the active one into the pre block, moves the active styling when a tab is clicked, and turns the copy button into a green "Copied" state for a second and a half after writing the current snippet to the clipboard.
```

## Architecture flow diagram

`features/features-architecture-flow-diagram` · [preview](features-architecture-flow-diagram.html) · [source](https://vibeprompts.dev/features/features-architecture-flow-diagram/)

> How data moves, drawn in boxes and arrows — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an architecture explainer with Tailwind CSS that draws a data flow without images. Above the diagram, a heading and a muted line. The diagram is a horizontal row of four stages on lg screens, stacking vertically on small ones: each stage is a bordered rounded-xl card with a small numbered label, a glyph tile, a title, a one-line description and two tiny monospaced tags; between stages, an arrow glyph centred in a narrow column that rotates to point downward when stacked. Above the row, a dashed-border band labelled "Your infrastructure" enclosing the first stage only, to show the boundary. Under the diagram, three footnote cards explaining what never leaves the customer network, where encryption is applied, and what is retained, each with a glyph and two lines. Keep everything monochrome except one green accent on the encryption note.
```

## Before and after split

`features/features-before-and-after-split` · [preview](features-before-and-after-split.html) · [source](https://vibeprompts.dev/features/features-before-and-after-split/)

> The old way beside the new one — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a two-column contrast section with Tailwind CSS that sets the old workflow against the new one. A centered heading and subline, then two panels side by side on md and up. The left panel is muted — dashed border, neutral-50 background, an "Without Acme" label, and a list of five pain points each prefixed by a small grey ✕ tile, with the text in a softer grey. The right panel is the hero: solid neutral-900 background, a "With Acme" label in a translucent pill, the same five topics rewritten as outcomes, each prefixed by a white ✓ tile, and a footer strip inside the card quoting a hard number such as "Median setup time: 9 minutes". Keep both lists on the same baseline so the rows read across, and stack them with the muted panel first on mobile.
```

## Bento grid

`features/features-bento-grid` · [preview](features-bento-grid.html) · [source](https://vibeprompts.dev/features/features-bento-grid/)

> Asymmetric tiles of varying size — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a bento-style features grid with Tailwind CSS using a 6-column, auto-row layout. Mix tile sizes: one large 2x2 hero tile, a couple of wide 2x1 tiles, and several 1x1 tiles. Each tile has a rounded-2xl surface, an icon or small graphic area, a bold title, and a short line of copy. Vary background tints subtly. Collapse to a single column on mobile.
```

## Buy versus build panel

`features/features-buy-versus-build-panel` · [preview](features-buy-versus-build-panel.html) · [source](https://vibeprompts.dev/features/features-buy-versus-build-panel/)

> An honest cost comparison against doing it yourself — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a buy-versus-build comparison with Tailwind CSS. Use a max-w-4xl section with a heading, a paragraph acknowledging that building it is genuinely possible, and two columns of equal width. The left column, headed "Build it yourself", is a bordered card listing six cost lines as rows with a label and a figure — engineering time, on-call, infrastructure, compliance work, ongoing maintenance and opportunity cost — with a hairline before a bold first-year total. The right column, headed "Use ours", is a neutral-900 card with the same row structure but far shorter, ending in its own total in white, plus a small line noting what is not included. Below, a horizontal bar comparison showing the two totals to scale with figures at the ends, and a closing line in muted text stating the assumptions behind the estimate with a link to the workings.
```

## Grouped capability checklist

`features/features-grouped-capability-checklist` · [preview](features-grouped-capability-checklist.html) · [source](https://vibeprompts.dev/features/features-grouped-capability-checklist/)

> Dense four-column feature index — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a dense feature index with Tailwind CSS: four grouped columns, each with a small uppercase group label and a list of short capability items marked with a subtle check glyph. Above the columns place a heading, a one-line intro, and a link to full documentation. Keep the type small, the rows tight, and collapse to two columns on md and one on mobile — the goal is to communicate breadth at a glance.
```

## Hover-to-preview feature list

`features/features-hover-to-preview-feature-list` · [preview](features-hover-to-preview-feature-list.html) · [source](https://vibeprompts.dev/features/features-hover-to-preview-feature-list/) · has JavaScript

> A list on the left swaps the panel on the right — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a feature explorer with Tailwind CSS in two columns. The left column is a list of five rows; each row has a small square glyph tile, a medium-weight title, a one-line description and a chevron, and the active row gets a neutral-50 background with a neutral-900 left rule. The right column is a rounded-2xl bordered panel with a soft neutral-50 header strip showing a fake breadcrumb and three window dots, and a body that shows the active feature — a large glyph, a heading, a paragraph, and a two-column list of small facts with muted labels above medium values. Below the panel, a caption in muted small text. Then add JavaScript that switches the active row on both hover and click, swaps the panel content from a data map, and applies a short opacity transition to the panel body so the change reads as a fade rather than a jump. Stack the columns below lg with the panel underneath.
```

## Integrations directory with filter

`features/features-integrations-directory-with-filter` · [preview](features-integrations-directory-with-filter.html) · [source](https://vibeprompts.dev/features/features-integrations-directory-with-filter/) · has JavaScript

> Searchable logo grid grouped by purpose — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an integrations directory with Tailwind CSS. Start with a heading, a muted subline giving the count of available integrations, and a controls row holding a search input with a magnifier glyph on the left and a set of filter chips — All, Data, Comms, Deploy, Billing — where the active chip is dark. Below, a responsive grid of integration cards, three or four across: each card is a rounded-xl bordered tile with a square logo placeholder holding a monogram, the product name, a one-line description, and a footer row with a small category label and either a muted "Connected" state with a green dot or a neutral "Connect" text button. Include ten cards across the categories. Under the grid, a centred bordered strip inviting people to request an integration with a small link. Then add JavaScript that filters the cards by chip category and by a case-insensitive match on the name and description, shows a "no matches" line when the grid empties, and keeps the count in the subline accurate.
```

## Offline sync journey

`features/features-offline-sync-journey` · [preview](features-offline-sync-journey.html) · [source](https://vibeprompts.dev/features/features-offline-sync-journey/) · has JavaScript

> Explain local-first behavior through connection states — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an offline-first feature explainer with Tailwind CSS. Use a three-stage horizontal journey for local save, encrypted queue, and cloud sync, plus a document preview and connection-state control. Show pending change counts, last synced time, and conflict-free status. Add JavaScript that cycles between online, offline, and reconnecting modes, updates the journey indicators, queues simulated edits while offline, and drains the queue after reconnection.
```

## ⭐ Permission inheritance explorer

`features/features-permission-inheritance-explorer` · [preview](features-permission-inheritance-explorer.html) · [source](https://vibeprompts.dev/features/features-permission-inheritance-explorer/) · has JavaScript

> Trace access from organization to resource — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a permission-inheritance explorer with Tailwind CSS. Show an organization, workspace, project, and environment as a connected hierarchy. Each level displays its assigned role, inherited permissions, and override count. Selecting a node should open a detail panel listing effective capabilities and their source. Add JavaScript that switches the selected node, renders its effective permissions, and lets a user toggle between effective-access and explicit-rules views.
```

## Platform availability matrix

`features/features-platform-availability-matrix` · [preview](features-platform-availability-matrix.html) · [source](https://vibeprompts.dev/features/features-platform-availability-matrix/)

> What works on web, mobile, desktop and CLI — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a platform support matrix with Tailwind CSS. Above the table, a heading, a muted subline, and a legend of three small items — available, partial and planned — each with its marker. The table has a feature column and four platform columns with icon-and-label headers for Web, iOS, Android, Desktop and CLI. Include eight feature rows covering dashboards, editing, offline mode, notifications, exports, admin settings, SSO login and scripting. Cells hold a green check for full support, an amber half-circle glyph with a small "partial" label under it for limited support, a muted dash for unsupported, and a small "Q4" pill for planned items. Zebra-stripe alternate rows very faintly, make the first column sticky on horizontal scroll, and wrap the table in a container that scrolls sideways on small screens. Under it, a footnote about the minimum OS versions.
```

## Public roadmap columns

`features/features-public-roadmap-columns` · [preview](features-public-roadmap-columns.html) · [source](https://vibeprompts.dev/features/features-public-roadmap-columns/) · has JavaScript

> Shipped, in progress and under consideration — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a public roadmap section with Tailwind CSS as three columns. Each column has a header row with a coloured dot, a title — Shipped, In progress, Exploring — and a muted count, then a stack of cards. Every card is a bordered rounded-xl tile with a small category label, a title in medium weight, a two-line description, and a footer row holding either a shipped date with a check glyph, a thin progress bar with a percentage, or an upvote button with a count. Give the shipped column faintly muted text so attention lands on the live work. Under the columns, a bordered strip inviting people to suggest something, with a one-line pitch and a dark button. Then add JavaScript that makes the upvote buttons toggle: incrementing the count and filling the button dark on first click, reverting on a second, and keeping a running total in the exploring column header.
```

## Scroll-snap feature carousel

`features/features-scroll-snap-feature-carousel` · [preview](features-scroll-snap-feature-carousel.html) · [source](https://vibeprompts.dev/features/features-scroll-snap-feature-carousel/) · has JavaScript

> Swipeable cards with arrows and dots — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a horizontally scrolling feature carousel with Tailwind CSS. The header row holds a title and subline on the left and two round arrow buttons on the right, hidden below sm. The track is a flex row with snap-x snap-mandatory, overflow-x-auto, scroll-smooth and a hidden scrollbar; each card is a shrink-0 snap-start article about 85% wide on mobile, 45% on sm and 31% on lg, with a rounded icon tile, a title, two lines of copy, and a subtle "Learn more →" link. Add an empty dots container under the track. Then add JavaScript that measures the first card plus the gap to scroll exactly one card per arrow press, builds one dot per card and marks the nearest one active as the track scrolls, lets a dot click jump to its card, fades out an arrow when the track is at either end, and recalculates on resize so the maths survives a breakpoint change.
```

## Security and compliance panel

`features/features-security-and-compliance-panel` · [preview](features-security-and-compliance-panel.html) · [source](https://vibeprompts.dev/features/features-security-and-compliance-panel/)

> Certifications, controls and a link to the trust centre — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a security and compliance section with Tailwind CSS. Open with a small "Trust" label, a heading and a supporting paragraph. Then a row of four certification tiles — SOC 2 Type II, ISO 27001, GDPR and HIPAA — each a bordered rounded-xl card with a shield glyph, the standard name in medium weight, a muted line giving the audit date or status, and a tiny green "Current" pill. Below the tiles, a two-column grid of six control rows, each with a check glyph, a bold control name and a muted sentence; cover encryption at rest and in transit, single sign-on, key rotation, penetration testing, data residency and backups. Close with a dark full-width strip inviting people to the trust centre, holding a short line of copy on the left and two buttons on the right — a white primary for the trust centre and a ghost outline for requesting the latest report.
```

## Sticky visual with scrolling steps

`features/features-sticky-visual-with-scrolling-steps` · [preview](features-sticky-visual-with-scrolling-steps.html) · [source](https://vibeprompts.dev/features/features-sticky-visual-with-scrolling-steps/)

> Panel stays put while the story scrolls past — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a two-column "how it works" section with Tailwind CSS where the visual sticks while the copy scrolls. The left column is a sticky panel from lg up — top-24, self-start — holding a rounded-2xl neutral-900 card with a mock interface inside: a title bar of three dots, a stack of skeleton rows, and one highlighted row that reads like a log entry. The right column is a list of four numbered steps, each generously spaced with a numeral in a bordered circle, a medium-weight heading, a paragraph of relaxed grey prose and a small monospaced detail line. Give each step a left border that turns neutral-900 for the first one. Under the last step, a text link with an arrow. Collapse to one column below lg with the visual first and no stickiness.
```

## Tabbed feature switcher

`features/features-tabbed-feature-switcher` · [preview](features-tabbed-feature-switcher.html) · [source](https://vibeprompts.dev/features/features-tabbed-feature-switcher/)

> CSS-only tabs, no JavaScript needed — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a tabbed feature switcher with Tailwind CSS that works without JavaScript. Put three same-named radio inputs (visually hidden with sr-only) inside a section marked as a group, then a centered pill row of labels pointing at them, then three panels. Drive every state change with group-has variants keyed to the checked input id — for example group-has-[#feat-a:checked]:grid on the matching panel and the same variant for the active pill background — so both the pill highlight and the visible panel react to selection. Note that peer variants will not work here because the labels are nested inside the pill container rather than being siblings of the inputs. Each panel is a two-column card with a heading, a paragraph, a bullet list, and a rounded media placeholder.
```

## Three-column icons

`features/features-three-column-icons` · [preview](features-three-column-icons.html) · [source](https://vibeprompts.dev/features/features-three-column-icons/)

> Simple icon + title + text triad — a free feature section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a 3-column feature row with Tailwind CSS. Each column has a rounded square icon badge, a title, and two lines of description, centered. Above them place an eyebrow label and a section heading. Keep it airy with generous vertical padding; stack to one column under md.
```
