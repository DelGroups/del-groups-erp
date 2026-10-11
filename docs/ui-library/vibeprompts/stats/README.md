# Stats (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## ⭐ Anomaly pulse strip

`stats/stats-anomaly-pulse-strip` · [preview](stats-anomaly-pulse-strip.html) · [source](https://vibeprompts.dev/stats/stats-anomaly-pulse-strip/)

> Surface unusual movement without losing context — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an anomaly pulse strip with Tailwind CSS for an operations dashboard. Show four compact metrics with current value, expected range, deviation, and a tiny SVG sparkline. Highlight only the anomalous metric in amber and include a plain-language diagnosis plus an Investigate action. Keep normal metrics quiet and use tabular numerals.
```

## Benchmark against industry

`stats/stats-benchmark-against-industry` · [preview](stats-benchmark-against-industry.html) · [source](https://vibeprompts.dev/stats/stats-benchmark-against-industry/)

> Your figures next to the median and the top decile — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a benchmark comparison with Tailwind CSS. Inside a bordered rounded-2xl card, put a header with a title, a muted line naming the peer set and sample size, and a small select for the industry. Below, five metric blocks stacked with generous spacing: each has the metric name and a short explanation on the left, and a comparison bar area on the right holding three stacked thin bars labelled You, Median and Top 10%, with widths set inline, values printed at the ends, and the user bar in neutral-900 while the others are neutral-300 and green respectively. Add a small verdict pill to each metric reading ahead, level or behind in the appropriate tint. Under the metrics, a footer note explaining the data is self-reported and anonymised, with the last refresh date in monospace.
```

## ⭐ Cohort retention heatmap

`stats/stats-cohort-retention-heatmap` · [preview](stats-cohort-retention-heatmap.html) · [source](https://vibeprompts.dev/stats/stats-cohort-retention-heatmap/) · has JavaScript

> Shaded grid of weekly retention — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a cohort retention card with Tailwind CSS and no chart library. A bordered card with a title, a subline naming the metric, and a legend on the right made of five small squares stepping from light to solid with "Low" and "High" captions. The body is a horizontally scrollable table with border-separate spacing, a header row of "Cohort", "Users", and Week 0 through Week 6, and an empty tbody. Close with a footnote about how the cohort is defined. Then add JavaScript that fills the table from an array of cohorts, each with a signup month, a user count, and a retention curve: render one cell per week, shade it by writing an rgba background whose alpha tracks the percentage, flip the text to white once the cell is dark enough to need it, print the percentage inside the cell, leave future weeks as an empty dashed placeholder, and add a title tooltip converting the percentage back into a user count.
```

## ⭐ Contribution rhythm calendar

`stats/stats-contribution-rhythm-calendar` · [preview](stats-contribution-rhythm-calendar.html) · [source](https://vibeprompts.dev/stats/stats-contribution-rhythm-calendar/) · has JavaScript

> Calendar heatmap with streak and consistency insights — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a contribution rhythm card with Tailwind CSS. Include a twelve-week calendar heatmap, weekday labels, low-to-high legend, current streak, active days, strongest weekday, and a short interpretation. Add JavaScript that renders deterministic daily values into the grid, gives each cell an accessible date-and-count label, and filters the calendar between commits, reviews, and deployments.
```

## ⭐ Conversion funnel steps

`stats/stats-conversion-funnel-steps` · [preview](stats-conversion-funnel-steps.html) · [source](https://vibeprompts.dev/stats/stats-conversion-funnel-steps/)

> Tapering bars with drop-off called out — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a conversion funnel block with Tailwind CSS. Inside a bordered rounded-2xl card, put a header row with a title, a muted date range and a small select for the segment. Below, five funnel rows stacked vertically: each row has a label and a count on the left in a fixed-width column, then a bar whose width is set inline as a percentage on a neutral-100 track, with the fill in neutral-900 and the conversion percentage printed inside the fill when it is wide enough or beside it when it is not. Between consecutive rows, a small indented note in muted red-ish text showing how many people dropped and the percentage lost. Under the rows, a summary strip with three figures — entered, completed and overall conversion — separated by vertical rules. Keep every number monospaced so the columns line up.
```

## ⭐ Count-up metrics on view

`stats/stats-count-up-metrics-on-view` · [preview](stats-count-up-metrics-on-view.html) · [source](https://vibeprompts.dev/stats/stats-count-up-metrics-on-view/) · has JavaScript

> Figures that animate the first time they appear — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a metrics band with Tailwind CSS on a neutral-900 background. Centre a small uppercase label and a one-line heading, then a four-column grid of metrics separated by hairline vertical rules on md and up. Each metric shows a large white figure with an optional prefix and suffix rendered as smaller muted spans, a medium-weight label under it, and a tiny grey note giving the measurement window. Use figures like 99.98 percent uptime, 2.4 million decisions a day, 41 milliseconds median latency and 14 regions. Then add JavaScript that watches the section with an IntersectionObserver, and the first time it becomes visible animates each figure from zero to its target over about 1.2 seconds using requestAnimationFrame with an ease-out curve, preserving decimal places and thousands separators, and skipping the animation entirely when the visitor prefers reduced motion.
```

## Four-metric row

`stats/stats-four-metric-row` · [preview](stats-four-metric-row.html) · [source](https://vibeprompts.dev/stats/stats-four-metric-row/) · has JavaScript

> Big numbers with labels — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a stats bar with Tailwind CSS: four evenly spaced metrics, each a large bold number and a muted label below. Separate them with vertical dividers on desktop. Center within a max-width wrapper and collapse to a 2x2 grid on mobile. Give each number data attributes describing its target value, decimal places, and any prefix or suffix, then add JavaScript that counts each metric up from zero when the row first scrolls into view, using an IntersectionObserver to trigger once and requestAnimationFrame with an ease-out curve to animate. Respect prefers-reduced-motion by snapping straight to the final values.
```

## ⭐ Goal progress bars

`stats/stats-goal-progress-bars` · [preview](stats-goal-progress-bars.html) · [source](https://vibeprompts.dev/stats/stats-goal-progress-bars/)

> Targets with completion percentages — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a goals progress block with Tailwind CSS: a bordered rounded-2xl card titled with the current quarter and a small "Updated today" note. Inside, three or four goal rows, each with a label on the left, a current-versus-target value on the right, and a thin rounded progress track below with a filled bar of a different width per row. Use a dark fill for on-track goals and an amber fill for the one that is behind, with a tiny status word beneath it.
```

## ⭐ Leaderboard with rank movement

`stats/stats-leaderboard-with-rank-movement` · [preview](stats-leaderboard-with-rank-movement.html) · [source](https://vibeprompts.dev/stats/stats-leaderboard-with-rank-movement/)

> Positions, scores and which way they moved — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a leaderboard with Tailwind CSS. The card header holds a title, a muted line naming the period, and a small segmented control for This week and All time. The list has ten rows divided by hairlines: each row shows the rank as a fixed-width monospaced number, a movement indicator with an up or down arrow in green or red and the number of places moved or a muted dash for no change, an avatar circle with initials, the name in medium weight with a muted team line under it, and the score right-aligned in monospace with a tiny delta beneath. Give the top three rows a subtle tint and a small medal-like coloured dot before the rank. Highlight one row as the current user with a neutral-900 left border and a "You" pill. Under the list, a footer strip showing the current user rank out of the total and a link to the full table.
```

## Live counter ticker

`stats/stats-live-counter-ticker` · [preview](stats-live-counter-ticker.html) · [source](https://vibeprompts.dev/stats/stats-live-counter-ticker/) · has JavaScript

> A number that keeps moving while you watch — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a live activity strip with Tailwind CSS. Use a full-width neutral-950 band containing a max-w-5xl flex row that wraps: on the left, a pill with a pulsing green dot reading "Live", a large monospaced counter with thousands separators, and a small label beneath reading events processed today. In the middle, a thin vertical rule and two secondary figures stacked with muted labels — active regions and current throughput per second. On the right, a compact bar chart of twelve slim vertical bars in varying heights representing the last twelve minutes, with the newest bar highlighted in green. Then add JavaScript that increments the main counter by a small random amount several times a second with a brief highlight flash on change, updates the throughput figure every two seconds, and every five seconds shifts the bar chart left by dropping the first bar and appending a new one with a random height.
```

## ⭐ Metric cards with sparkline bars

`stats/stats-metric-cards-with-sparkline-bars` · [preview](stats-metric-cards-with-sparkline-bars.html) · [source](https://vibeprompts.dev/stats/stats-metric-cards-with-sparkline-bars/)

> KPI tiles with a CSS-only trend chart — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a stats row with Tailwind CSS where each card pairs a metric with a tiny bar-chart sparkline drawn purely in CSS. Each bordered rounded-2xl card has a muted label, a large value with a colored delta chip beside it, and a bottom row of eight thin rounded bars of varying heights using flex items-end and h- utilities; the final bar is dark to mark the current period. Use three cards on a responsive grid.
```

## Milestone counters timeline

`stats/stats-milestone-counters-timeline` · [preview](stats-milestone-counters-timeline.html) · [source](https://vibeprompts.dev/stats/stats-milestone-counters-timeline/)

> Company numbers pinned to the years they happened — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a milestone timeline with Tailwind CSS laid out horizontally on large screens and vertically below md. Draw a hairline running through the middle with five nodes on it: each node is a small circle, filled dark for the past and outlined for the current year, with a card above or below alternating position. Every card is bordered and rounded-xl and contains a monospaced year, a large figure, a metric label, and one line of context. Use figures like first hundred customers, one million events a day, a Series A, ten thousand teams and one billion decisions. Give the most recent card a neutral-900 background with inverted text. Below the timeline, a summary strip of three cells separated by vertical rules showing years operating, total customers and people employed, each with a large figure and a muted label.
```

## Poll results breakdown

`stats/stats-poll-results-breakdown` · [preview](stats-poll-results-breakdown.html) · [source](https://vibeprompts.dev/stats/stats-poll-results-breakdown/)

> Survey answers with counts and a total — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a survey results block with Tailwind CSS. Use a max-w-2xl card with a question as the heading, a muted line giving the response count and the fieldwork dates, and a small "Multiple answers allowed" note. The results are six rows: each row is a full-width bordered rounded-xl bar container where a tinted fill sits behind the content at the answer percentage, and above it a flex row holding the answer label on the left and the percentage plus raw count on the right in monospace. Make the leading answer use a neutral-900 fill with white text and the rest a light neutral fill with dark text. Under the rows, a small horizontal divider then a two-column footer: a note on the method on the left, and on the right two links for the raw data and the previous wave. Add a small "Change since last wave" column of tiny green or red deltas beside each percentage.
```

## ⭐ Ring gauge trio

`stats/stats-ring-gauge-trio` · [preview](stats-ring-gauge-trio.html) · [source](https://vibeprompts.dev/stats/stats-ring-gauge-trio/) · has JavaScript

> Three SVG donuts with a figure in the middle — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a three-up gauge row with Tailwind CSS and inline SVG. Each gauge sits in a bordered rounded-2xl card: an SVG viewBox of 100 by 100 with two circles — a neutral-100 track and a coloured progress ring using stroke-dasharray and stroke-dashoffset with a rotate minus ninety transform — and an absolutely centred figure showing the percentage in large medium-weight text with a tiny label under it. Around the gauge, a title above and a two-line explanation below, plus a footer row with the raw counts. Use green for a healthy metric, amber for one that needs attention and neutral-900 for a neutral one. Then add JavaScript that reads a data-value attribute on each ring, computes the dash offset from the circumference, and animates the offset from empty to its value with a CSS transition triggered on the next frame so the rings sweep in on load.
```

## Stats on dark card

`stats/stats-stats-on-dark-card` · [preview](stats-stats-on-dark-card.html) · [source](https://vibeprompts.dev/stats/stats-stats-on-dark-card/)

> Metric trio inside a panel — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a stats block with Tailwind CSS inside a dark rounded-3xl panel. Three metrics in a row, each with a large gradient or white number, a label, and a tiny up/down delta chip. Add a short heading above the metrics inside the same panel.
```

## Sustainability impact panel

`stats/stats-sustainability-impact-panel` · [preview](stats-sustainability-impact-panel.html) · [source](https://vibeprompts.dev/stats/stats-sustainability-impact-panel/)

> Emissions, energy and materials with context lines — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an environmental impact panel with Tailwind CSS on a very light green-tinted background. Start with a small label, a heading and a paragraph stating the reporting standard and who verified the numbers. Then a four-card grid: each bordered white card holds a glyph tile, a large figure with its unit as a smaller muted span, a metric name, and a comparison line in plain language that makes the number legible — such as the equivalent in flights avoided. Under the cards, a two-column block: on the left, a stacked horizontal bar showing the split of emissions across three scopes with a legend below; on the right, three progress rows toward stated targets, each with a label, a thin track and a percentage with the target year. Close with a footer row linking the full report, the methodology and the verification statement.
```

## Uptime status strip

`stats/stats-uptime-status-strip` · [preview](stats-uptime-status-strip.html) · [source](https://vibeprompts.dev/stats/stats-uptime-status-strip/) · has JavaScript

> Per-service history bars with a live summary — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a status panel with Tailwind CSS that reports uptime per service. A bordered card whose header holds "System status" on the left and a green pill reading "All systems operational" with a pulsing dot on the right. Below it, one row per service — API, Dashboard, Webhooks, Email delivery — each row showing the service name and its 60-day uptime percentage on one line, then an empty flex container marked with a data-uptime attribute that will hold the history bars. Close the card with a legend row of tiny colour swatches and the labels "60 days ago" and "Today" pushed to opposite ends. Then add JavaScript that renders the bars from data instead of markup: use a small seeded pseudo-random generator so the same history appears on every load, mark roughly 2% of days as an outage and 4% as degraded, paint each day green, amber or red, give each bar a title tooltip with its date and status, compute the uptime percentage per service by weighting degraded days as partial, and downgrade the header pill to amber if any service is not fully green.
```

## ⭐ Week-over-week delta table

`stats/stats-week-over-week-delta-table` · [preview](stats-week-over-week-delta-table.html) · [source](https://vibeprompts.dev/stats/stats-week-over-week-delta-table/)

> Compact metric table with signed changes — a free stats bar prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a compact comparison table with Tailwind CSS for a weekly metrics email or dashboard. Inside a bordered rounded-2xl card, add a header with a title, a muted subtitle naming the two weeks being compared, and a small ghost button reading "Export". The table has four columns — metric, this week, last week and change — with a neutral-50 header row in small uppercase letters, hairline dividers between rows, and figures right-aligned in monospace. Include six rows covering signups, activation rate, weekly active teams, revenue, support tickets and median response time. The change column shows an arrow glyph with a signed percentage in green for improvements and red for regressions, remembering that fewer tickets and faster responses are improvements. Add a footnote under the table explaining that revenue is normalised to constant currency.
```
