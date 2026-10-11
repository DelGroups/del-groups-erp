# Pricing (19)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Base plan with add-ons

`pricing/pricing-base-plan-with-add-ons` · [preview](pricing-base-plan-with-add-ons.html) · [source](https://vibeprompts.dev/pricing/pricing-base-plan-with-add-ons/) · has JavaScript

> Core price plus optional modules — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an à-la-carte pricing block with Tailwind CSS. A dark rounded-2xl base plan card on the left showing the plan name, price, and what is included. On the right, a stacked list of optional add-on rows, each a label wrapping a checkbox carrying a data-price attribute, with a name, a one-line description, and a price on the far right; one row is pre-checked and highlighted with a ring. Below the list show a running total row and a checkout button. Then add JavaScript that recalculates the total from the base fee plus every checked add-on, moves the selected ring styling onto the rows that are actually checked, and updates the checkout button to name how many add-ons are included.
```

## ⭐ Change plan with prorated preview

`pricing/pricing-change-plan-with-prorated-preview` · [preview](pricing-change-plan-with-prorated-preview.html) · [source](https://vibeprompts.dev/pricing/pricing-change-plan-with-prorated-preview/) · has JavaScript

> What the upgrade actually costs today — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a change-plan panel with Tailwind CSS for an in-app billing settings page. Use a max-w-2xl card. The header states "Change plan" with a muted line naming the current plan and renewal date. Below, three selectable plan rows as radio-style cards: each shows the plan name, a short line of positioning copy, the price on the right, and the current plan carries a "Current" pill while the selected one gets a neutral-900 ring and a filled radio dot. Under the list, a neutral-50 breakdown card titled "Due today" listing the new plan charge for the remaining period, an unused-time credit as a negative green line, and a bold total, followed by a muted line explaining the next full charge and its date. Close with a right-aligned pair of buttons, Cancel and a dark Confirm upgrade. Then add JavaScript that switches the selection styling and recalculates the proration figures from the days left in the billing period.
```

## ⭐ Comparison table

`pricing/pricing-comparison-table` · [preview](pricing-comparison-table.html) · [source](https://vibeprompts.dev/pricing/pricing-comparison-table/)

> Feature matrix across plans — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a pricing comparison table with Tailwind CSS. A sticky header row with three plan columns (Free, Pro, Business) and their prices/CTAs, then grouped feature rows with checkmarks or dashes per plan. Use zebra striping, a left-aligned feature column, and center-aligned plan cells. Make it horizontally scrollable on small screens.
```

## Credit pack top-up

`pricing/pricing-credit-pack-top-up` · [preview](pricing-credit-pack-top-up.html) · [source](https://vibeprompts.dev/pricing/pricing-credit-pack-top-up/) · has JavaScript

> One-time bundles with volume discounts — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a prepaid credit purchase block with Tailwind CSS. A centered heading, then three selectable pack cards built as labels wrapping hidden radio inputs — Starter 1,000, Growth 5,000, Scale 25,000 — each showing the credit count in large type, its one-time price, and a small saving pill on the discounted packs; use peer-checked variants so the chosen card gets a dark border and a ring. Underneath, a grey summary panel with a quantity stepper (minus, count, plus) on the right of its heading row, a line-item list for credits, effective rate and volume discount, a bold "Total today" row, a full-width dark buy button, and a footnote that credits never expire. Carry the credit count and price on each radio as data attributes. Then add JavaScript that reprices everything whenever the pack or quantity changes: multiply the pack by the quantity, format the credit count with thousands separators, show the effective per-credit rate to three decimals, compare it against the $0.02 list rate to show the saving (hiding that row when there is none), clamp the stepper between 1 and 20, and write the total into the summary.
```

## Device plus plan pricing

`pricing/pricing-device-plus-plan-pricing` · [preview](pricing-device-plus-plan-pricing.html) · [source](https://vibeprompts.dev/pricing/pricing-device-plus-plan-pricing/)

> Hardware up front or spread across the term — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a hardware-and-subscription pricing block with Tailwind CSS. Use a max-w-3xl card split into two halves by a hairline. The upper half is the device: a square product placeholder drawn as a neutral gradient tile on the left, and on the right the device name, two lines of description, a payment toggle of two segmented options — pay in full or spread over 24 months — and the resulting price shown as a large figure with a muted secondary line giving the alternative. The lower half is the plan: three compact rows with radio-style circles for Basic, Plus and Pro, each with a name, a one-line description and a monthly price, the middle one preselected. Under both, a total strip on neutral-50 giving the due-today figure and the monthly figure side by side, a dark checkout button and a muted line about the 30-day return window and cancellation terms.
```

## Discount programmes panel

`pricing/pricing-discount-programmes-panel` · [preview](pricing-discount-programmes-panel.html) · [source](https://vibeprompts.dev/pricing/pricing-discount-programmes-panel/)

> Reduced rates for the groups that qualify — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a discount eligibility section with Tailwind CSS. Start with a heading, a paragraph explaining that the standard price is not the only price, and a muted line naming how many organisations are on a reduced rate. Below, a grid of four programme cards: education, registered non-profits, early-stage startups and open-source maintainers. Each card is a bordered rounded-xl tile with a glyph tile, the programme name, the discount as a bold percentage or "free", two lines describing who qualifies, and a footer row with a small "What we need from you" line and a text link to apply. Give the open-source card a neutral-900 background with inverted text so one option stands out. Under the grid, a three-step application strip — apply, we verify, discount applied within two working days — laid out with numerals and hairline separators, plus a line about annual re-verification.
```

## Enterprise quote request panel

`pricing/pricing-enterprise-quote-request-panel` · [preview](pricing-enterprise-quote-request-panel.html) · [source](https://vibeprompts.dev/pricing/pricing-enterprise-quote-request-panel/)

> Sales-assisted tier with a short qualifying form — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design an enterprise pricing panel with Tailwind CSS built as a two-column card on a dark background. The left column, on a neutral-950 surface, carries a small "Enterprise" label, a large headline reading "Priced around your estate, not your seat count", a short paragraph, a list of four inclusions with check glyphs in a lighter grey, and at the bottom a bordered mini-card holding an account executive avatar, name, role and a line saying replies usually land within one business day. The right column is a white form with a heading, two-up fields for work email and company, a full-width select for company size, a select for the main driver — compliance, scale, migration or something else — a textarea for context, a dark submit button reading "Request pricing", and a footnote that no sales sequence is triggered. Keep labels small and medium weight, inputs rounded-xl with clear focus rings, and stack the columns below the lg breakpoint.
```

## Marketplace take-rate tiers

`pricing/pricing-marketplace-take-rate-tiers` · [preview](pricing-marketplace-take-rate-tiers.html) · [source](https://vibeprompts.dev/pricing/pricing-marketplace-take-rate-tiers/)

> Commission that falls as volume climbs — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a commission pricing section with Tailwind CSS for a marketplace. Open with a heading, a paragraph explaining there is no monthly fee and the platform only earns when the seller does, and a small pill reading "No listing fees". Below, a bordered rounded-2xl table with four rows: monthly sales volume bands on the left, the take rate as a large percentage in the middle, and the effective fee on a sample order on the right; highlight the second row as the typical band with a neutral-50 background and a small "Most sellers" pill. Under the table, three explainer cards in a grid covering payout timing, chargeback handling and what the rate includes, each with a glyph tile and two lines of copy. Finish with a worked example strip on neutral-900: a sale amount, the commission, the payment processing cost and the seller payout, laid out as four cells separated by vertical rules.
```

## ⭐ Module bundle builder

`pricing/pricing-module-bundle-builder` · [preview](pricing-module-bundle-builder.html) · [source](https://vibeprompts.dev/pricing/pricing-module-bundle-builder/) · has JavaScript

> Tick the parts you need and watch the total settle — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a modular pricing configurator with Tailwind CSS. Use a max-w-4xl two-column grid. The left column is a list of six selectable module cards: each a bordered rounded-xl row with a checkbox on the left, a module name and a one-line description, and a price on the right; the core module is pre-selected and disabled with a muted "Required" label. Selected cards gain a neutral-900 border and a faint background. The right column is a sticky summary card listing the chosen modules as rows with names and prices, a bundle discount line in green that appears from three modules, a bold total, a dark checkout button and a muted note about monthly billing. Then add JavaScript that toggles modules, rebuilds the summary rows, applies a ten percent discount at three modules and fifteen at five, and updates the total and the button label with the module count.
```

## One-time licence versus subscription

`pricing/pricing-one-time-licence-versus-subscription` · [preview](pricing-one-time-licence-versus-subscription.html) · [source](https://vibeprompts.dev/pricing/pricing-one-time-licence-versus-subscription/)

> Two purchase models weighed side by side — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a two-option purchase comparison with Tailwind CSS for a product sold either as a subscription or as a perpetual licence. Use a max-w-4xl section with a centred heading and a muted subline about choosing how to pay. Underneath, two equal cards in a grid. The left card is the subscription: a small label, price per year, a short paragraph, and a bulleted list where every line is a check. The right card is the perpetual licence, visually heavier with a neutral-900 border and a small dark "Own it" ribbon in the corner: a one-time price, a paragraph explaining updates are included for twelve months, and a mixed list where two lines carry a muted cross glyph to show what stops after a year. Under both cards, a full-width neutral-50 strip with three columns comparing cost after one, three and five years, with the cheaper figure in each column set in medium neutral-900 and the other muted.
```

## Outcome-based fee simulator

`pricing/pricing-outcome-based-fee-simulator` · [preview](pricing-outcome-based-fee-simulator.html) · [source](https://vibeprompts.dev/pricing/pricing-outcome-based-fee-simulator/) · has JavaScript

> Model a base fee plus performance upside — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an outcome-based pricing simulator with Tailwind CSS for a conversion service. Include inputs for current monthly revenue, expected uplift, and engagement tier. Show the fixed platform fee, projected incremental revenue, success fee, total monthly cost, and net value retained. Add a horizontal value split bar and JavaScript that formats currency, validates inputs, applies different success-fee rates by tier, and updates all figures live.
```

## ⭐ Per-seat pricing with quantity stepper

`pricing/pricing-per-seat-pricing-with-quantity-stepper` · [preview](pricing-per-seat-pricing-with-quantity-stepper.html) · [source](https://vibeprompts.dev/pricing/pricing-per-seat-pricing-with-quantity-stepper/) · has JavaScript

> Team size drives the monthly total — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a per-seat pricing card with Tailwind CSS. Centre a max-w-lg white card with rounded-2xl corners. The header holds a small "Team plan" pill, a headline price built from a large figure and a muted "per seat / month" suffix, and a one-line description. Under it a bordered control row: the label "How many seats?" on the left and on the right a stepper made of a minus button, a wide monospaced number and a plus button, with the minus disabled at the floor of two seats. Below, a summary block with three lines — seats times unit price, a volume discount line that only appears above ten seats, and a bold total — separated by a hairline. Finish with a full-width dark "Start 14-day trial" button, a muted note that seats can be changed any time and are billed pro rata, and three feature check rows. Then add JavaScript that steps the seat count between 2 and 250, applies a 10 percent discount from 10 seats and 20 percent from 50, recalculates every figure, shows or hides the discount line, and disables the minus button at the floor.
```

## Plan slider with feature reveal

`pricing/pricing-plan-slider-with-feature-reveal` · [preview](pricing-plan-slider-with-feature-reveal.html) · [source](https://vibeprompts.dev/pricing/pricing-plan-slider-with-feature-reveal/) · has JavaScript

> Drag a range to land on the right tier — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a pricing block with Tailwind CSS where a range slider chooses the plan. Centre a max-w-xl card. Above the slider, a question reading "How many events do you send a month?" and the current value as a large number with a muted unit. The range input is styled full width with an accent-neutral-900 accent colour, tick labels under it at 10k, 100k, 1M and 10M, and the matched plan shown beneath as a bordered strip with the plan name, its monthly price, and a muted line describing what it includes. Below that, a two-column list of the features unlocked at that tier, where features above the current tier are shown greyed with a muted lock note. Finish with a dark call-to-action button and a small line offering a custom quote above 10M events. Then add JavaScript that maps the slider position to four tiers, formats the event count, swaps the plan strip content and dims features that belong to higher tiers.
```

## ⭐ Prices in local currency

`pricing/pricing-prices-in-local-currency` · [preview](pricing-prices-in-local-currency.html) · [source](https://vibeprompts.dev/pricing/pricing-prices-in-local-currency/) · has JavaScript

> Region switcher that converts every plan — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a pricing section with Tailwind CSS that adapts to the visitor's region. Above the three plan cards, a right-aligned control row with a small globe glyph and a native select listing US Dollar, Euro, British Pound, Japanese Yen, and Indian Rupee. Each of the three cards (Starter, Team, Business) shows a plan name, a large price with a /mo suffix, a per-extra-seat line, a short description, a feature list, and a button; give every element that holds money a data-usd attribute with its dollar amount so nothing is hard-coded twice. Under the grid, a muted footnote about the tax treatment of the selected region. Then add JavaScript holding one record per currency — exchange rate, locale, tax note — that on change converts each data-usd amount, rounds sensibly (whole units for western currencies, nearest hundred for yen and rupee), formats it with Intl.NumberFormat so the symbol and separators match the locale, and swaps the footnote text.
```

## Reserved capacity planner

`pricing/pricing-reserved-capacity-planner` · [preview](pricing-reserved-capacity-planner.html) · [source](https://vibeprompts.dev/pricing/pricing-reserved-capacity-planner/) · has JavaScript

> Compare flexible usage with committed capacity — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a reserved-capacity pricing planner with Tailwind CSS. Include a workload slider, a region selector, three commitment cards for flexible, one-year, and three-year terms, and a cost summary comparing the selected term against flexible pricing. Show monthly cost, effective hourly rate, savings percentage, and break-even utilization. Add JavaScript that recalculates every card as capacity and region change, makes cards keyboard-selectable radio options, and updates the summary with annual savings.
```

## Single plan focus

`pricing/pricing-single-plan-focus` · [preview](pricing-single-plan-focus.html) · [source](https://vibeprompts.dev/pricing/pricing-single-plan-focus/) · has JavaScript

> One bold plan with a monthly/yearly toggle — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a single-plan pricing block with Tailwind CSS. Centered card with a monthly/annual toggle (annual shows a "Save 20%" pill), a large price, a feature checklist in two columns, and one prominent CTA. Add a small "14-day money-back guarantee" note under the button. Give each toggle button a data-period attribute and ids to the price and the billing note, then add JavaScript that swaps the active pill styling and rewrites the price when the period changes — $29/mo billed monthly, $23/mo when billed annually — and shows the annual total charged up front in the note line.
```

## Sliding scale supporter pricing

`pricing/pricing-sliding-scale-supporter-pricing` · [preview](pricing-sliding-scale-supporter-pricing.html) · [source](https://vibeprompts.dev/pricing/pricing-sliding-scale-supporter-pricing/) · has JavaScript

> Pay what the project is worth to you — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a pay-what-you-can pricing block with Tailwind CSS for an independent or open-source product. Centre a max-w-2xl card with a heading, a paragraph explaining the software is the same at every price and the higher tiers fund the lower ones, and a row of three preset amount cards — Supporter, Standard and Patron — each with a monthly figure, a one-line description of who it is for, and a small label; the middle one is preselected with a neutral-900 border. Under them, a custom amount row with a currency addon and a numeric input, plus a slider tied to the same value. Then a distribution strip showing three thin bars labelled with the share of users at each tier. Finish with a dark button whose label carries the chosen amount and a muted line saying the price can be changed or paused at any time, no questions asked.
```

## Three-tier with highlight

`pricing/pricing-three-tier-with-highlight` · [preview](pricing-three-tier-with-highlight.html) · [source](https://vibeprompts.dev/pricing/pricing-three-tier-with-highlight/)

> Classic 3 plans, middle one featured — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a 3-column pricing section with Tailwind CSS. Each card has a plan name, price with /mo, a short description, a feature list with check icons, and a CTA button. Make the middle "Pro" card visually featured — dark background, a "Most popular" badge, and lifted with a ring/shadow. The outer cards are white with borders. Responsive: stack on mobile, three columns on lg.
```

## Usage-based estimator

`pricing/pricing-usage-based-estimator` · [preview](pricing-usage-based-estimator.html) · [source](https://vibeprompts.dev/pricing/pricing-usage-based-estimator/) · has JavaScript

> Slider that prices metered consumption — a free pricing section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a usage-based pricing estimator with Tailwind CSS. A wide rounded-3xl card split into two parts: on the left a range slider labelled "Monthly API calls" with the current value shown large above it and min/max hints below, plus a second slider for seats. On the right a bordered summary panel listing base platform fee, metered usage, and seats as line items, a divider, and a bold estimated monthly total with a per-unit footnote and a CTA button. Style the sliders with accent-neutral-900 and give every value that changes its own id. Then add JavaScript that recomputes the estimate on every slider input: map the call slider through a quadratic curve from 100K to 10M so the low end stays fine-grained, charge $0.05 per 1K calls beyond a 500K included tier, add $12 per seat on top of a $49 platform fee, and write the formatted call count, line items, and total back into the panel.
```
