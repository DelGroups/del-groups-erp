# Bonus components (29)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Agent run trace

`bonus/bonus-agent-run-trace` · [preview](bonus-agent-run-trace.html) · [source](https://vibeprompts.dev/bonus/bonus-agent-run-trace/) · has JavaScript

> Expandable tool-call timeline for an AI run — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an agent run trace with Tailwind CSS for inspecting what an AI agent actually did. Use a max-w-3xl card with a header carrying the run title, a green completed pill, a monospace run id with the agent name and step count, then right-aligned duration and token totals and a replay button. Below it, an ordered list of steps joined by a thin vertical rail: each row has a small round status dot, a monospace kind badge reading thought, tool or output, the step name, a truncated one-line result, and right-aligned duration and token figures. Clicking a row expands a dark monospace panel underneath showing the raw input and output for that step. Then add JavaScript that renders the steps from an array, toggles one panel at a time, and makes replay clear the totals and reveal the steps one after another with a short stagger, adding each step duration and token count to the header as it lands.
```

## ⭐ Command palette

`bonus/bonus-command-palette` · [preview](bonus-command-palette.html) · [source](https://vibeprompts.dev/bonus/bonus-command-palette/) · has JavaScript

> Spotlight-style ⌘K search overlay — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a command palette overlay with Tailwind CSS: a dimmed backdrop with a blur, and a centered max-w-xl panel positioned toward the top of the screen with a heavy shadow and rounded-2xl corners. The panel has a search row with a leading glyph, a borderless input, and an Esc key hint; below it a scrollable results area grouped by small uppercase section labels, where each row shows an icon tile, a label, and a right-aligned keyboard shortcut, with the first row highlighted as the active selection. Close with a footer bar showing navigation hints using kbd elements. Then add the JavaScript a palette actually needs: filter rows as you type and hide any group heading left with no matches, move the highlight with the arrow keys wrapping at both ends and scrolling the active row into view, activate the highlighted row on Enter, follow the mouse so hover and keyboard selection never disagree, close on Escape or a click on the backdrop, and reopen on ⌘K / Ctrl-K with the query reset and the input focused.
```

## Cookie consent

`bonus/bonus-cookie-consent` · [preview](bonus-cookie-consent.html) · [source](https://vibeprompts.dev/bonus/bonus-cookie-consent/) · has JavaScript

> Bottom privacy banner — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a cookie-consent banner with Tailwind CSS: a fixed bottom bar with a short privacy message and a link, plus "Accept all" and "Reject" buttons. Keep it unobtrusive with a soft shadow and rounded corners. Then add the JavaScript that gives it meaning: record the choice and the timestamp in localStorage, hide the banner with a slide-down transition once a choice is made, skip showing it at all on later visits, wrap every storage call in try/catch so private-mode browsers do not throw, and dispatch a custom cookie-consent event carrying the decision so analytics or embeds can subscribe rather than being hard-wired into the banner.
```

## Cron schedule builder

`bonus/bonus-cron-schedule-builder` · [preview](bonus-cron-schedule-builder.html) · [source](https://vibeprompts.dev/bonus/bonus-cron-schedule-builder/) · has JavaScript

> Plain-English controls that emit a cron expression — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a schedule builder with Tailwind CSS that produces a cron expression. Use a max-w-xl card with a heading and a muted line saying the expression updates as you choose. The controls are a frequency select with hourly, daily, weekly and monthly options; a minute select; an hour select hidden for hourly; a row of seven weekday toggle chips shown only for weekly; and a day-of-month select shown only for monthly. Under the controls, a dark result panel showing the cron expression in large monospaced text with a copy button, and beneath it a plain-English summary sentence and a muted line listing the next three run times. Then add JavaScript that shows and hides the relevant controls per frequency, assembles the five cron fields, writes the human summary, computes three upcoming runs from the current time, and copies the expression with a brief confirmation.
```

## Design token swatch sheet

`bonus/bonus-design-token-swatch-sheet` · [preview](bonus-design-token-swatch-sheet.html) · [source](https://vibeprompts.dev/bonus/bonus-design-token-swatch-sheet/) · has JavaScript

> Palette, spacing and radii with copyable values — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a design token reference sheet with Tailwind CSS. Start with a heading, a muted line naming the version, and a segmented control for three sections — colour, spacing, radius. The colour section is a grid of swatch cards: each has a tall block of the colour, then the token name in monospace, the hex value in muted monospace, and a small contrast note reading the ratio against white or black. Include eleven neutrals and four accents. The spacing section is a list of rows showing the token name, a bar whose width equals the value, and the pixel and rem values in monospace. The radius section is a row of six squares with increasing corner rounding and their token names beneath. Then add JavaScript that copies a token name on click and flashes a small check overlay on the swatch that was copied.
```

## ⭐ Drag-to-reorder priority stack

`bonus/bonus-drag-to-reorder-priority-stack` · [preview](bonus-drag-to-reorder-priority-stack.html) · [source](https://vibeprompts.dev/bonus/bonus-drag-to-reorder-priority-stack/) · has JavaScript

> Pointer and keyboard reordering with live ranks — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a reorderable priority list with Tailwind CSS. Use a max-w-lg card headed by a title, a count of the items and a reset button. Each row is a card with a grip handle on the left, a large monospace rank number, the item title with a one-line note under it, an owner initial in a round badge on the right, and a small "Up next" pill on whichever row sits at the top. Rows lift slightly on hover and the one being dragged goes semi-transparent with a dark ring. Add a hint line explaining that the handle can be dragged or focused and moved with the arrow keys, and a visually hidden live region. Then add JavaScript using pointer events: capture the pointer on the handle, reorder by comparing the pointer against the midpoints of the other rows, renumber the ranks and move the pill as the order changes, support arrow-key moves from a focused handle, keep focus on the handle after a keyboard move, and announce the new position in the live region. Reset restores the original order.
```

## ⭐ Empty state

`bonus/bonus-empty-state` · [preview](bonus-empty-state.html) · [source](https://vibeprompts.dev/bonus/bonus-empty-state/)

> Friendly no-data placeholder — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an empty-state block with Tailwind CSS: centered content with a rounded icon badge, a heading, a supporting sentence, and a primary action button, optionally a secondary link below. Wrap it in a dashed-border rounded-2xl area to signal an empty container.
```

## Feature flag rollout dial

`bonus/bonus-feature-flag-rollout-dial` · [preview](bonus-feature-flag-rollout-dial.html) · [source](https://vibeprompts.dev/bonus/bonus-feature-flag-rollout-dial/) · has JavaScript

> Percentage slider with a live bucket grid — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a feature flag rollout control with Tailwind CSS. Use a max-w-xl card headed by the flag name, its monospace key, and a switch on the right that arms or kills the flag entirely. Under it, a three-way segmented control for development, staging and production. Then the dial: an oversized percentage figure with a range slider beneath it, and below that a grid of a hundred small rounded squares, twenty to a row, each standing for one percent of traffic, filled squares showing who currently gets the flag. Add a line reading the estimated audience against the environment total, an amber note that only appears past half of production traffic, and a short list of override rules with their own pills. Then add JavaScript that redraws the grid and the audience count as the slider moves, swaps the environment totals, shows the warning by threshold, and greys the whole dial out with the flag reading off when the kill switch is thrown.
```

## ⭐ File upload dropzone

`bonus/bonus-file-upload-dropzone` · [preview](bonus-file-upload-dropzone.html) · [source](https://vibeprompts.dev/bonus/bonus-file-upload-dropzone/) · has JavaScript

> Drag area with in-progress file rows — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a file upload component with Tailwind CSS: a large dashed-border rounded-2xl dropzone with a centered icon tile, a bold "Drag files here" line, an underlined browse link, and a muted constraint line about accepted formats and max size, plus an empty list beneath it and a hidden row template. Then add the JavaScript that makes it a real uploader: highlight the zone while a file is dragged over it and reset on leave or drop, accept files from both the drop event and the file input, reject anything over the size limit with a red error row and a Retry link, and otherwise add a row showing the file-type badge, name, and human-readable size with a progress bar that fills as the upload advances before settling into a green completed state. Stub the actual transfer behind one clearly marked function so it can be swapped for a real XHR or fetch upload.
```

## Fluid type scale calculator

`bonus/bonus-fluid-type-scale-calculator` · [preview](bonus-fluid-type-scale-calculator.html) · [source](https://vibeprompts.dev/bonus/bonus-fluid-type-scale-calculator/) · has JavaScript

> Generate responsive clamp values with a live hierarchy — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a fluid typography scale calculator with Tailwind CSS. Include minimum and maximum viewport widths, base font sizes, and a modular ratio selector. Generate four responsive type steps, display each computed CSS clamp value, and show a live editorial preview. Add JavaScript that validates the ranges, calculates linear interpolation for clamp, updates the preview through CSS custom properties, and copies any generated declaration.
```

## HTTP cache policy simulator

`bonus/bonus-http-cache-policy-simulator` · [preview](bonus-http-cache-policy-simulator.html) · [source](https://vibeprompts.dev/bonus/bonus-http-cache-policy-simulator/) · has JavaScript

> Visualize fresh, stale, and expired response behavior — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an HTTP cache-policy simulator with Tailwind CSS. Include controls for public or private caching, max-age, stale-while-revalidate, and immutable behavior. Show the generated Cache-Control header, a request-age slider, response outcome badge, browser and CDN decision steps, and a horizontal freshness timeline. Add JavaScript that recalculates HIT, STALE, REVALIDATE, or MISS behavior from the policy, updates the header, and explains each decision in plain language.
```

## Inline workspace slug editor

`bonus/bonus-inline-workspace-slug-editor` · [preview](bonus-inline-workspace-slug-editor.html) · [source](https://vibeprompts.dev/bonus/bonus-inline-workspace-slug-editor/) · has JavaScript

> Edit, validate, and save a URL without leaving the page — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an inline workspace-slug editor with Tailwind CSS inside a compact settings card. The resting state shows the current public URL, a green Available badge, and an Edit button. The editing state replaces it with a fixed domain prefix, a focused text input, a live character counter, helper text describing the allowed format, and Cancel / Save buttons. Add a small preview line beneath the control so people can see the final URL before saving. Then add JavaScript that opens the editor, normalizes pasted or typed text to lowercase kebab-case, validates a 3–32 character slug, rejects a short list of reserved words, updates the preview and character counter live, supports Escape to cancel and Enter to save, preserves the original value on cancel, and simulates an asynchronous save with a Saving… state before returning to the read-only view.
```

## JSON tree viewer

`bonus/bonus-json-tree-viewer` · [preview](bonus-json-tree-viewer.html) · [source](https://vibeprompts.dev/bonus/bonus-json-tree-viewer/) · has JavaScript

> Collapsible nodes with types and counts — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a JSON viewer with Tailwind CSS. Use a max-w-2xl card with a toolbar holding a title, a muted node count, and two small buttons for expand all and collapse all, plus a copy button. The body renders a nested structure as indented rows: object and array nodes are buttons with a rotating chevron, the key in a medium weight, a muted type label, and a count of children in brackets; leaf rows show the key, a colon, and the value coloured by type — strings in green, numbers in blue, booleans in purple and null in muted grey — with strings quoted. Indentation is done with left padding and a faint vertical guide line per level. Then add JavaScript that renders the tree from an object literal, toggles a node open or closed, implements expand and collapse all, and copies the formatted JSON to the clipboard.
```

## Keyboard shortcut recorder

`bonus/bonus-keyboard-shortcut-recorder` · [preview](bonus-keyboard-shortcut-recorder.html) · [source](https://vibeprompts.dev/bonus/bonus-keyboard-shortcut-recorder/) · has JavaScript

> Capture accessible key combinations and flag conflicts — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a keyboard-shortcut recorder with Tailwind CSS inside a settings card. Show three existing actions in tidy rows, each with its current key combination rendered as kbd caps and a Change button. Clicking Change should replace that row with a focused recording surface that says “Press a key combination”, plus Cancel and Clear actions. Include a compact warning area for reserved browser shortcuts or conflicts with another action, and a footer note explaining that at least one modifier is required. Then add JavaScript that captures keydown events without typing into the page, ignores bare modifier presses, requires Ctrl, Alt, Shift, or Meta for letter and number shortcuts, normalizes modifier order, displays platform-aware Meta labels, detects duplicate bindings, rejects common browser commands such as new tab and reload, supports Escape to cancel, lets Backspace clear a binding, and commits a valid shortcut immediately.
```

## ⭐ Keyboard shortcuts sheet

`bonus/bonus-keyboard-shortcuts-sheet` · [preview](bonus-keyboard-shortcuts-sheet.html) · [source](https://vibeprompts.dev/bonus/bonus-keyboard-shortcuts-sheet/) · has JavaScript

> A searchable cheat sheet in a dialog — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a keyboard shortcuts dialog with Tailwind CSS. Use a fixed overlay with a dark backdrop centring a max-w-3xl white card. The header holds a title, a muted line naming the platform detected, a search field and a close cross. The body is a two-column grid of four groups — General, Navigation, Editing and View — each with a small uppercase heading and five rows; every row has the action name on the left and its keys on the right rendered as separate kbd elements with a muted plus between them. The footer shows a hint that the sheet opens with a question mark and a link to full documentation. Then add JavaScript that filters rows live on the search text, hides any group that empties, closes on Escape, on the cross and on a backdrop click, and reopens the dialog when the question mark key is pressed.
```

## Markdown live preview

`bonus/bonus-markdown-live-preview` · [preview](bonus-markdown-live-preview.html) · [source](https://vibeprompts.dev/bonus/bonus-markdown-live-preview/) · has JavaScript

> Split editor rendering as you type — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a split markdown editor with Tailwind CSS. Use a bordered rounded-2xl card with a toolbar holding a document title on the left, a word and character count in the middle, and on the right a two-option segmented control for Split and Preview plus a small "Copy HTML" button. Below, a two-column grid: the left pane is a monospaced textarea on a faint background with no border and a comfortable line height, pre-filled with a short sample document; the right pane is the rendered output on white with sensible typographic spacing. Then add JavaScript implementing a small markdown renderer covering headings up to level three, bold, italic, inline code, links, unordered lists, blockquotes and fenced code blocks, escaping HTML first so pasted markup cannot inject; re-render on input with a short debounce, keep the counts current, switch layout when Preview is selected, and copy the generated HTML.
```

## One-time API key reveal

`bonus/bonus-one-time-api-key-reveal` · [preview](bonus-one-time-api-key-reveal.html) · [source](https://vibeprompts.dev/bonus/bonus-one-time-api-key-reveal/) · has JavaScript

> Shown once, with a countdown and a copy gate — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a one-time secret reveal panel with Tailwind CSS. Use a max-w-lg card. The header pairs a key-like glyph tile with a heading reading "Your new API key" and a muted line saying it will not be shown again. Below, a dark rounded-xl panel holding the key in monospace, initially masked as a row of dots, with a "Reveal" button and a copy button side by side on the right. Under the panel, a warning strip in amber tint noting that the key grants full write access and should go straight into a secret manager. Then a bordered detail list of three rows — key name, scopes as small pills, and created date. Close with a checkbox that must be ticked to enable the dark "I have stored it safely" button. Then add JavaScript that reveals the key, starts a thirty second countdown after which it re-masks, copies to the clipboard with a confirmation, and gates the confirm button on the checkbox.
```

## Passphrase generator

`bonus/bonus-passphrase-generator` · [preview](bonus-passphrase-generator.html) · [source](https://vibeprompts.dev/bonus/bonus-passphrase-generator/) · has JavaScript

> Word-based secrets with a live strength readout — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a passphrase generator with Tailwind CSS. Use a max-w-lg card with a heading and a muted line explaining that four common words beat one mangled one. The output is a dark rounded-xl panel showing the generated phrase in large monospace with a regenerate button carrying a refresh glyph and a copy button. Under it, controls: a range slider for word count from three to eight with the value shown beside the label, and three toggle rows with small switches for adding a number, adding a separator symbol and capitalising each word. Then a strength block with a four-segment bar that fills according to the estimated entropy, a label reading the strength band, and a monospaced line giving the entropy in bits and an estimated offline cracking time. Then add JavaScript that builds the phrase from a small word list, recomputes entropy from the pool size and word count, updates the bar and wording, and copies with a confirmation.
```

## Pricing badge / callout

`bonus/bonus-pricing-badge-callout` · [preview](bonus-pricing-badge-callout.html) · [source](https://vibeprompts.dev/bonus/bonus-pricing-badge-callout/)

> Small promo strip — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a slim promo callout with Tailwind CSS: a full-width rounded bar with a gradient or solid accent background, a short bold message, a supporting phrase, and an inline arrow link. Great for announcements or limited-time offers.
```

## Prompt token counter

`bonus/bonus-prompt-token-counter` · [preview](bonus-prompt-token-counter.html) · [source](https://vibeprompts.dev/bonus/bonus-prompt-token-counter/) · has JavaScript

> Live estimate against a model context window — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a token counter with Tailwind CSS for people writing prompts. Use a max-w-2xl card with a heading, a model select of four options with their context sizes, and a large monospaced textarea. Under it, a stats row of four cells separated by vertical rules — characters, words, estimated tokens and estimated cost — each with a figure and a tiny label. Below that, a context usage bar with a fill that turns amber past seventy percent and red past ninety, a label reading tokens used against the window, and a muted line giving the tokens remaining. Finish with three small notes about the estimate being approximate, whitespace counting, and the response sharing the same window. Then add JavaScript that recomputes everything on input with a debounce, estimates tokens at roughly four characters each, prices per million tokens from the selected model, and updates the bar colour by threshold.
```

## Regex tester

`bonus/bonus-regex-tester` · [preview](bonus-regex-tester.html) · [source](https://vibeprompts.dev/bonus/bonus-regex-tester/) · has JavaScript

> Pattern, flags and highlighted matches — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a regular expression tester with Tailwind CSS. Use a max-w-2xl card with a heading and a muted line. The pattern row is a bordered field with monospaced slashes rendered as muted addons on either side of the input, and a small flags input after the closing slash. Under it, a textarea of test text pre-filled with a few lines. Below, a result panel showing the subject text with every match wrapped in a highlighted span, then a match list where each entry shows an index, the matched text in monospace and any capture groups as small pills. A status line reports the match count or a red parse error. Then add JavaScript that compiles the pattern on every keystroke inside a try-catch, escapes the subject before injecting highlights, always forces the global flag for the highlight pass, guards against zero-length matches looping forever, and lists up to twenty matches.
```

## Release notes composer

`bonus/bonus-release-notes-composer` · [preview](bonus-release-notes-composer.html) · [source](https://vibeprompts.dev/bonus/bonus-release-notes-composer/) · has JavaScript

> Conventional commits to a version bump — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a release notes composer with Tailwind CSS that turns conventional commits into a version bump. Use a max-w-4xl card with a two-column layout: on the left a monospace textarea seeded with a handful of commits and a caption explaining the accepted format, on the right a summary panel showing the current version arrowing into the computed next one, a bump pill reading major, minor or patch, three counters for features, fixes and breaking changes, and a rendered changelog grouped under those headings. Put a copy button above the changelog. Then add JavaScript that parses each line into type, optional scope, breaking marker and subject, ignores anything malformed, promotes the bump to major on an exclamation mark or a breaking-change footer and to minor on any feat, rebuilds the summary on every keystroke behind a short debounce, and copies the changelog as markdown with a clipboard fallback and a two-second confirmation on the button.
```

## Selective diff staging

`bonus/bonus-selective-diff-staging` · [preview](bonus-selective-diff-staging.html) · [source](https://vibeprompts.dev/bonus/bonus-selective-diff-staging/) · has JavaScript

> Review and stage individual code hunks — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a compact selective diff-staging panel with Tailwind CSS. The header names a changed file, shows its branch path, a green additions count and red deletions count, plus a master checkbox. Below, render two code hunks as bordered groups with monospaced line numbers and tinted addition/deletion rows; each hunk gets its own checkbox and a concise context label. Finish with a sticky-looking footer that reports how many hunks are selected and has a dark “Stage selected” button. Then add JavaScript that keeps the master checkbox synchronized, including its indeterminate state, updates the selected count and button label, disables the action when nothing is checked, and on staging replaces each selected hunk with a calm staged confirmation row while recalculating the remaining totals. Use semantic checkbox labels and an aria-live status so the interaction remains accessible.
```

## ⭐ Skeleton loading state

`bonus/bonus-skeleton-loading-state` · [preview](bonus-skeleton-loading-state.html) · [source](https://vibeprompts.dev/bonus/bonus-skeleton-loading-state/) · has JavaScript

> Pulsing placeholders that swap for content — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a skeleton loading pattern with Tailwind CSS for a list of projects. Build the same card twice inside one bordered panel: a visible skeleton version and a hidden loaded version. The panel header has a title, a muted "Refresh" button, and a small status line. The skeleton holds four rows, each an avatar circle plus two grey bars of differing widths and a short bar on the right, all sharing animate-pulse and rounded-full bars in neutral-200 — vary the widths row to row so it does not read as a table. The loaded version holds the real rows: an initials avatar, a project name with a repository path underneath, a status chip (Passing, Running, Failed) and a relative timestamp. Then add JavaScript that swaps the skeleton for the content after a short delay to mimic a fetch, writes the loaded row count into the status line, and lets the Refresh button put the panel back into its skeleton state and reload so the transition can be seen again.
```

## Timezone overlap planner

`bonus/bonus-timezone-overlap-planner` · [preview](bonus-timezone-overlap-planner.html) · [source](https://vibeprompts.dev/bonus/bonus-timezone-overlap-planner/) · has JavaScript

> Four cities lined up to find a workable hour — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a meeting time planner with Tailwind CSS. Use a bordered rounded-2xl card with a header holding a title, a muted line explaining that shaded blocks are working hours, and a small select for the reference city. The body is a grid of four rows, one per city: the left column shows the city name, its UTC offset and the local time of the current selection in monospace; the right column is a track of twenty-four thin cells, coloured neutral-100 outside working hours, neutral-200 for the local working day, and neutral-900 for the currently selected hour, with tiny labels every six cells. Under the rows, a summary strip naming the best overlapping window and how many cities it suits. Then add JavaScript that lets a click or drag on any track pick an hour, recomputes each local time from its offset, marks the selected column across all rows, and updates the summary with how many cities have that hour inside working time.
```

## ⭐ Toast notification

`bonus/bonus-toast-notification` · [preview](bonus-toast-notification.html) · [source](https://vibeprompts.dev/bonus/bonus-toast-notification/) · has JavaScript

> Floating success message — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a toast notification with Tailwind CSS: a floating card fixed to the bottom-right with an icon dot, a title, a short description, a close button, and a thin timer bar along the bottom. Use a subtle shadow and rounded-xl. Then add JavaScript exposing a small toast(title, message, variant) function that clones a hidden template into a stack, so several toasts can sit above one another, each sliding in, counting its timer bar down over five seconds, then sliding out and removing itself — pausing the countdown while the pointer is over it, and dismissing immediately on the close button. Include success and error variants that swap the icon colours.
```

## ⭐ Type-to-confirm delete dialog

`bonus/bonus-type-to-confirm-delete-dialog` · [preview](bonus-type-to-confirm-delete-dialog.html) · [source](https://vibeprompts.dev/bonus/bonus-type-to-confirm-delete-dialog/) · has JavaScript

> Destructive action gated by an exact match — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a destructive confirmation dialog with Tailwind CSS. A fixed inset-0 overlay with a black/50 backdrop centring a max-w-md white card with rounded-2xl corners. Inside: a red-tinted warning tile with an exclamation glyph beside a title reading "Delete acme/payments-api", a paragraph explaining the action cannot be undone, and a bordered list of exactly what disappears — 3 environments, 412 build records, 8 API tokens — each row with a small red dot. Then an instruction line asking the person to type the repository name to confirm, with the name shown in a monospaced pill they can copy, a text input under it, a footer with a Cancel button and a red Delete button that starts disabled and faded, and a small line noting the action is logged in the audit trail. Then add JavaScript that compares the input against the required name on every keystroke, enabling the delete button only on an exact match, adding a red ring to the input once the typing diverges from the target, allowing Enter to submit when it matches, closing on Cancel, Escape or a backdrop click, and putting the dialog into a "Deleting…" state with the button disabled when it fires.
```

## WCAG contrast checker

`bonus/bonus-wcag-contrast-checker` · [preview](bonus-wcag-contrast-checker.html) · [source](https://vibeprompts.dev/bonus/bonus-wcag-contrast-checker/) · has JavaScript

> Test color pairs with live accessibility results — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a polished WCAG contrast checker with Tailwind CSS. Use a two-column card with foreground and background controls, each combining a native color input and an editable hex field, plus a swap-colors button between them. Under the controls, show a generous live preview containing large heading text, body copy, and a button using the chosen colors. Finish with a results strip that shows the contrast ratio and four pass/fail badges for AA normal, AA large, AAA normal, and AAA large text. Then add JavaScript that accepts three- or six-digit hex colors, keeps the native pickers and text fields synchronized, marks invalid input without breaking the last valid preview, swaps the colors, calculates relative luminance and contrast using the WCAG formula, formats the ratio to two decimals, and updates every pass badge against the correct 3.0, 4.5, and 7.0 thresholds.
```

## Webhook delivery inspector

`bonus/bonus-webhook-delivery-inspector` · [preview](bonus-webhook-delivery-inspector.html) · [source](https://vibeprompts.dev/bonus/bonus-webhook-delivery-inspector/) · has JavaScript

> Delivery log with backoff-aware retries — a free UI component prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a webhook delivery inspector with Tailwind CSS. Use a max-w-4xl card split into a narrow left column listing recent deliveries and a wider right panel for the selected one. Each list row shows a coloured status dot, the event name in monospace, the response code and a relative timestamp, with the active row picked out by a tinted background. The right panel has a header with the event name, a status pill and a retry button, a small definition grid of endpoint, attempt count, signature and duration, then the request payload and the response body in dark monospace blocks. Beneath them, a row of attempt chips recording every try. Then add JavaScript that switches deliveries, and makes retry run a real exponential backoff — a countdown of two, four then eight seconds shown on the button, a new attempt chip each round that survives the repaint, and a failing delivery that finally returns two hundred on the third attempt and flips every status in the panel and the list to succeeded.
```
