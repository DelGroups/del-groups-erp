# FAQ (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Accordion list

`faq/faq-accordion-list` · [preview](faq-accordion-list.html) · [source](https://vibeprompts.dev/faq/faq-accordion-list/) · has JavaScript

> Expandable questions using <details> — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an FAQ accordion with Tailwind CSS using native <details>/<summary> elements so it works without JavaScript. Each item is a bordered row with a question in the summary, a rotating chevron via marker or a span, and an answer paragraph that reveals on open. Stack items with dividers inside a max-w-2xl column and a heading on top. Then layer on optional JavaScript that turns it into a true accordion: when one item opens, close whichever one was open, so only a single answer shows at a time. Everything still works with the script removed — that is the point of building on details.
```

## Accordion with helpful votes

`faq/faq-accordion-with-helpful-votes` · [preview](faq-accordion-with-helpful-votes.html) · [source](https://vibeprompts.dev/faq/faq-accordion-with-helpful-votes/) · has JavaScript

> Answers that collect feedback as they close — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an FAQ accordion with Tailwind CSS where each answer asks whether it helped. Use native details/summary elements inside a bordered, divided card: the summary row is a flex line with the question in medium weight and a plus glyph that rotates when open, and the answer body is relaxed grey prose. Under every answer add a feedback row — a muted "Was this helpful?" label, a Yes and a No button as small bordered pills, and a right-aligned tally line reading something like "18 of 21 found this helpful". Give the details elements a shared name-like data attribute and each feedback row a data-votes pair of numbers. Then add JavaScript that keeps only one answer open at a time, and on a vote replaces the two buttons with a quiet "Thanks — this helps us rewrite it" note while incrementing the tally and recomputing the ratio, ignoring further clicks in that row.
```

## Billing FAQ with plan recap

`faq/faq-billing-faq-with-plan-recap` · [preview](faq-billing-faq-with-plan-recap.html) · [source](https://vibeprompts.dev/faq/faq-billing-faq-with-plan-recap/)

> Answers beside a sticky summary of the current plan — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a billing help section with Tailwind CSS in two columns from lg. The narrow left column is a sticky card summarising the current plan: a plan name with a pill, the monthly figure, three detail rows for seats, next invoice and payment method with muted labels, a full-width outline button reading "Manage billing" and a small link to download invoices. The wide right column is a heading followed by two labelled groups of questions — Payments and Cancellation — each rendered as details elements with a chevron that rotates when open, hairline dividers instead of card borders, and answers in relaxed grey prose. One answer should contain a small bordered table of three rows showing when charges land for monthly, annual and usage plans. Stack to one column below lg with the plan card first.
```

## Conversational FAQ bubbles

`faq/faq-conversational-faq-bubbles` · [preview](faq-conversational-faq-bubbles.html) · [source](https://vibeprompts.dev/faq/faq-conversational-faq-bubbles/)

> Questions and answers styled as a chat thread — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an FAQ laid out as a conversation with Tailwind CSS. Use a max-w-2xl column with a small header row showing a support avatar, a name, and a green dot with the words "usually replies in minutes". Below, alternating message bubbles: questions are right-aligned neutral-900 bubbles with white text and a rounded-2xl shape squared on the bottom-right; answers are left-aligned neutral-100 bubbles with dark text squared on the bottom-left, each preceded by a small avatar. Include five exchanges, keeping the answers two or three sentences, and give one answer a small bordered white card inside it listing three bullet points. Between exchanges add tiny centred timestamps in muted text. End the thread with a typing indicator of three animated dots and a disabled input row with a send button, making clear it is a decorative representation rather than a live chat.
```

## FAQ card grid with support tile

`faq/faq-faq-card-grid-with-support-tile` · [preview](faq-faq-card-grid-with-support-tile.html) · [source](https://vibeprompts.dev/faq/faq-faq-card-grid-with-support-tile/)

> Three-up answers plus a contact card — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an FAQ presented as a card grid with Tailwind CSS: a heading and intro, then a responsive grid of question cards where each card has a small numbered badge, a bold question, and a two or three line answer. Make the final grid cell a contrasting dark support tile with a short prompt, an avatar pair, and a light CTA button for contacting the team. Keep card heights even with flex and give the dark tile the same corner radius.
```

## FAQ tabs by audience

`faq/faq-faq-tabs-by-audience` · [preview](faq-faq-tabs-by-audience.html) · [source](https://vibeprompts.dev/faq/faq-faq-tabs-by-audience/) · has JavaScript

> Different answers for buyers, admins and developers — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an FAQ with Tailwind CSS that splits its questions by who is asking. Centre a max-w-3xl column with a heading and a muted subline. Under it, a segmented control of three options — For buyers, For admins, For developers — rendered as a bordered rounded-xl inline group where the active segment has a neutral-900 background and white text. Below, a panel showing four questions for the active audience as details elements with hairline dividers, plus a small footer line naming a relevant next step for that audience with an arrow link. Then add JavaScript that holds three sets of question and answer pairs in a data structure, renders the active set, moves the segment styling, closes any open answer when switching, and reflects the choice in the URL query string so the tab survives a refresh.
```

## FAQ with category rail

`faq/faq-faq-with-category-rail` · [preview](faq-faq-with-category-rail.html) · [source](https://vibeprompts.dev/faq/faq-faq-with-category-rail/)

> Sticky topic list beside grouped answers — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a help-centre style FAQ with Tailwind CSS in two columns from lg up. The left column is a sticky rail (top-24, self-start) holding a small "Browse by topic" label and a list of category links — Billing, Accounts, Security, Data — each a rounded row with the topic name and a muted count badge, the first one carrying an active neutral-100 background; underneath, a bordered "Still stuck?" mini-card with a line of copy and a dark contact button. The right column is the content: for each category, an anchor-linked heading with a rule under it and two or three question-and-answer blocks, where the question is medium-weight neutral-900 and the answer is relaxed grey prose with the occasional inline link. Give each section an id matching its rail link so the anchors work, and collapse the rail above the content on smaller screens.
```

## FAQ with copy-link anchors

`faq/faq-faq-with-copy-link-anchors` · [preview](faq-faq-with-copy-link-anchors.html) · [source](https://vibeprompts.dev/faq/faq-faq-with-copy-link-anchors/) · has JavaScript

> Each answer has its own shareable URL — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an FAQ list with Tailwind CSS where every question can be linked to directly. Use a max-w-3xl column with a heading and a muted subline. Each item is a details element styled as a bordered rounded-xl card with the summary as a flex row holding the question in medium weight, a small link glyph button that appears on hover, and a plus that rotates to a cross when open. The answer is relaxed grey prose with an occasional inline link. Give every item an id derived from its question. Then add JavaScript that copies the absolute URL with the anchor to the clipboard when the link button is clicked, showing a small floating "Link copied" chip near the button for a moment, opens and scrolls to the matching item when the page loads with a hash, and closes other open items so only one answer is expanded at a time.
```

## FAQ with demo video cards

`faq/faq-faq-with-demo-video-cards` · [preview](faq-faq-with-demo-video-cards.html) · [source](https://vibeprompts.dev/faq/faq-faq-with-demo-video-cards/)

> Short clips answering the visual questions — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a hybrid FAQ with Tailwind CSS mixing written answers and short video cards. Open with a heading and a subline explaining that some answers are easier watched than read. Then a grid of three video cards: each is a bordered rounded-xl card with a dark 16-by-9 thumbnail area drawn with a gradient, a centred circular play button, a duration pill in the corner, and below it a question as the card title, a one-line summary and a small transcript link. Under the videos, a heading for written answers and five accordion items in a bordered card with hairline dividers, one containing an inline monospaced snippet. Finish with a row of two links, one to the full video library and one to the documentation, and a muted line noting every clip is captioned.
```

## FAQ with expand-all control

`faq/faq-faq-with-expand-all-control` · [preview](faq-faq-with-expand-all-control.html) · [source](https://vibeprompts.dev/faq/faq-faq-with-expand-all-control/) · has JavaScript

> Counter and a single switch for every answer — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an FAQ block with Tailwind CSS that gives readers bulk control. The header row has a heading on the left and, on the right, a muted count reading how many of the questions are open plus a small bordered button that toggles between "Expand all" and "Collapse all". Below, seven details elements as bordered cards with the question in medium weight, a muted one-line preview of the answer that is hidden once the item opens, and a chevron that rotates. Answers are relaxed grey prose. Add a footer row with a bordered box offering a link to the full documentation and a support email. Then add JavaScript that keeps the counter in sync with any toggle, switches the button label and behaviour depending on whether every item is already open, and updates the preview visibility when an item opens or closes.
```

## FAQ with related articles rail

`faq/faq-faq-with-related-articles-rail` · [preview](faq-faq-with-related-articles-rail.html) · [source](https://vibeprompts.dev/faq/faq-faq-with-related-articles-rail/)

> Answers beside the documentation they point to — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a support FAQ with Tailwind CSS in a two-column layout. The wide left column holds a heading, a muted subline and six accordion questions as bordered cards with a plus that rotates; two answers include an inline bordered callout with a glyph and one sentence of extra caution. The narrow right column is a sticky rail containing three stacked cards: a "Popular articles" card listing five links with small chevrons, a "Still stuck?" card with a support email, a live chat button and the current median reply time, and a compact "Status" card showing a green dot with an operational line and a link to the status page. Stack the rail below the questions on small screens, and keep the rail cards visually lighter than the questions so the hierarchy is obvious.
```

## Glossary index A to Z

`faq/faq-glossary-index-a-to-z` · [preview](faq-glossary-index-a-to-z.html) · [source](https://vibeprompts.dev/faq/faq-glossary-index-a-to-z/) · has JavaScript

> Terms defined, jumpable by first letter — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a glossary page with Tailwind CSS. The header has a heading, a muted line giving the term count, and a search field. Under it, an alphabet rail of twenty-six small letter buttons in a wrapping row, with letters that have no entries dimmed and non-interactive. The body lists entries grouped by letter: each group has a large letter heading with a hairline beside it, then two or three definition rows in a bordered card, each row holding the term in medium weight with an optional small "Also called" note, a two-line definition, and a footer of up to two related-term links. Include groups for A, B, C and D. Then add JavaScript that filters entries live from the search box, hides any group left empty, scrolls smoothly to a letter when its rail button is clicked, and shows a muted no-results line.
```

## Inline definition FAQ

`faq/faq-inline-definition-faq` · [preview](faq-inline-definition-faq.html) · [source](https://vibeprompts.dev/faq/faq-inline-definition-faq/) · has JavaScript

> Answer terminology questions inside a readable glossary — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an inline-definition FAQ with Tailwind CSS for a technical product. Present a short introductory paragraph containing highlighted terms; clicking a term updates a definition panel with the plain-language meaning, practical example, related terms, and a documentation link. Add JavaScript for mouse and keyboard selection, active styling, and URL hash updates so definitions can be linked directly.
```

## Release-specific answer finder

`faq/faq-release-specific-answer-finder` · [preview](faq-release-specific-answer-finder.html) · [source](https://vibeprompts.dev/faq/faq-release-specific-answer-finder/) · has JavaScript

> Version-aware support answers with change notices — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a version-aware FAQ with Tailwind CSS. Include a product-version selector, search field, answer cards tagged by applicable versions, and a visible changed-in-this-release callout. Add JavaScript that filters answers by both selected version and query, updates result counts, highlights release changes, and shows a helpful empty state.
```

## Searchable FAQ with filters

`faq/faq-searchable-faq-with-filters` · [preview](faq-searchable-faq-with-filters.html) · [source](https://vibeprompts.dev/faq/faq-searchable-faq-with-filters/) · has JavaScript

> Search field, topic pills, results list — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a searchable help centre FAQ with Tailwind CSS: a centered heading, a prominent search input with a leading magnifier glyph, and a row of scrollable topic filter pills where the first is active and dark. Below, a results count line, then a list of question rows built from native details and summary elements, each tagged with a data-topic attribute and showing the question, a small topic chip on the right, and an answer that reveals on open with a "Was this helpful?" thumbs row underneath. Then add the JavaScript that makes the search and pills real: filter rows on every keystroke by matching the typed text against both question and answer, intersect that with the selected topic pill, keep the results count in sync, and render an empty state when a query matches nothing.
```

## Shipping and returns FAQ

`faq/faq-shipping-and-returns-faq` · [preview](faq-shipping-and-returns-faq.html) · [source](https://vibeprompts.dev/faq/faq-shipping-and-returns-faq/)

> Policy answers with a delivery cost table — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a shipping and returns FAQ with Tailwind CSS for a shop. Start with a heading and a muted line naming the dispatch cutoff. Then a bordered rounded-2xl table of delivery options with four rows and columns for service, estimated days, cost and tracking, where free options show a green "Free" pill and one row carries a small "Most chosen" label. Under the table, two columns of accordion questions grouped under headings Delivery and Returns, four questions each, rendered as details elements with hairline dividers and a plus that rotates. One returns answer should contain a small three-step ordered list. Close with a bordered strip holding a returns portal button on the right and, on the left, a line about the sixty-day window and who pays for the label.
```

## Troubleshooting decision tree

`faq/faq-troubleshooting-decision-tree` · [preview](faq-troubleshooting-decision-tree.html) · [source](https://vibeprompts.dev/faq/faq-troubleshooting-decision-tree/) · has JavaScript

> One question at a time until the answer appears — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a guided troubleshooting widget with Tailwind CSS. Use a max-w-xl bordered card with a heading reading "Let us narrow it down", a muted subline, and a breadcrumb row of answered steps rendered as small pills with the chosen answers and a reset link on the right. The body shows one question at a time: a question in medium weight and two or three full-width answer buttons as bordered rows with a chevron. The final state replaces the question with a resolution panel — a tinted box with a title, two paragraphs, a monospaced command where relevant, and two buttons for marking it solved or contacting support. Then add JavaScript holding the tree as a nested object, rendering the current node, appending each answer to the breadcrumb, allowing a click on any breadcrumb pill to rewind to that point, and resetting the whole flow from the reset link.
```

## Two-column FAQ

`faq/faq-two-column-faq` · [preview](faq-two-column-faq.html) · [source](https://vibeprompts.dev/faq/faq-two-column-faq/)

> Heading left, questions right — a free FAQ section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a two-column FAQ layout with Tailwind CSS: on the left a sticky heading block with a title, a short intro, and a "Contact support" link; on the right a stacked list of question/answer pairs (static, no accordion). Stack to one column on mobile.
```
