# CTA banners (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## App download CTA with QR

`cta/cta-app-download-cta-with-qr` · [preview](cta-app-download-cta-with-qr.html) · [source](https://vibeprompts.dev/cta/cta-app-download-cta-with-qr/)

> Desktop visitors get a code, phones get the buttons — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an app download call-to-action with Tailwind CSS as a dark rounded-2xl panel split into two columns. The left column holds a small label, a heading about picking up where you left off, a short paragraph, two store buttons drawn as bordered blocks with a glyph and stacked labels, and a muted line listing supported versions. The right column is a white rounded-2xl tile centred on the panel holding a QR code drawn purely in CSS — a grid of small squares with three larger finder squares in the corners built from nested divs — and under it a caption reading "Point your camera here". Hide the QR tile below the sm breakpoint since a phone cannot scan its own screen, and hide nothing on desktop. Keep the panel inside a max-w-5xl container with generous padding.
```

## Community join banner

`cta/cta-community-join-banner` · [preview](cta-community-join-banner.html) · [source](https://vibeprompts.dev/cta/cta-community-join-banner/)

> Live member count and a preview of the chatter — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a community invitation banner with Tailwind CSS. Use a max-w-4xl rounded-2xl card with a hairline border and a soft neutral-50 background, split into two columns from md up. The left column carries a small pill with a green pulse dot reading how many members are online, a heading inviting people into the community, a paragraph about what happens there, a dark join button and a muted line about the code of conduct. The right column is a stack of three faux chat messages, each a white rounded-xl card with a coloured avatar circle, a name and timestamp row, and one line of message text — one of them carrying a small reaction pill with an emoji-free glyph and a count. Rotate the cards very slightly in alternating directions with transform utilities so the stack feels informal, and straighten them on hover.
```

## Countdown launch banner

`cta/cta-countdown-launch-banner` · [preview](cta-countdown-launch-banner.html) · [source](https://vibeprompts.dev/cta/cta-countdown-launch-banner/) · has JavaScript

> Live timer over an early-access signup — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a dark launch countdown banner with Tailwind CSS, full width with a rounded-3xl inner card. Centre a small "Early access closes soon" pill, a two-line headline, and a countdown row of four tiles — days, hours, minutes, seconds — each a translucent rounded box with a large monospaced number above a tiny uppercase label. Under the timer, an inline email form (single field plus a white submit button) that stays side by side from sm up, then a muted line about seats remaining. Give each number tile an id and wrap the whole timer in a container that can be replaced when it reaches zero. Then add JavaScript that counts down to a launch timestamp every second: pad each unit to two digits, stop the interval at zero and swap the timer for a "We are live" message with a changed button label, and keep the seat line honest by decrementing it on a slow interval.
```

## Exit-intent offer modal

`cta/cta-exit-intent-offer-modal` · [preview](cta-exit-intent-offer-modal.html) · [source](https://vibeprompts.dev/cta/cta-exit-intent-offer-modal/) · has JavaScript

> One-shot offer as the visitor leaves — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an exit-intent offer modal with Tailwind CSS. Markup: a fixed inset-0 overlay with a black/40 backdrop, hidden by default, centring a max-w-md white card with rounded-3xl corners and a shadow. The card holds a small close ✕ in the corner, a rounded discount badge, a headline offering 20% off the first three months, a short supporting line, an email field with a full-width dark claim button, a row of two reassurance items with check glyphs, and a muted "No thanks, I'll pay full price" text button underneath. Then add JavaScript that shows it at most once per session: arm the trigger after a few seconds on the page, open when the pointer leaves through the top of the window or when the visitor scrolls past 60% of the document, remember the shown state in sessionStorage so a reload does not nag, close on the ✕, the decline link, a backdrop click, or Escape, and move focus into the email field when it opens.
```

## Free shipping progress bar

`cta/cta-free-shipping-progress-bar` · [preview](cta-free-shipping-progress-bar.html) · [source](https://vibeprompts.dev/cta/cta-free-shipping-progress-bar/) · has JavaScript

> How far the basket is from the threshold — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a shopping incentive bar with Tailwind CSS. Use a max-w-2xl bordered rounded-2xl card. The top row pairs a small van-like glyph tile with a sentence reading how much more is needed for free delivery, the remaining amount emphasised in medium weight, and the current basket total on the right in monospace. Under it, a thin track with a neutral-900 fill at seventy-two percent carrying three tick markers with tiny labels beneath — free delivery, free returns and a gift, the first two below the current position and rendered in green with check glyphs. Then a horizontal strip of three suggested products to close the gap, each a compact bordered tile with a small square placeholder, a name, a price and an "Add" text button. Finish with a muted line noting the delivery estimate and a link to the returns policy. Then add JavaScript that adds a product price to the basket when Add is clicked, moves the progress fill, rewrites the sentence, and switches it to a green "You have unlocked free delivery" state once the threshold is passed.
```

## Full-width dark banner

`cta/cta-full-width-dark-banner` · [preview](cta-full-width-dark-banner.html) · [source](https://vibeprompts.dev/cta/cta-full-width-dark-banner/)

> Bold end-of-page call to action — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a full-width CTA banner with Tailwind CSS: a dark rounded-3xl panel with centered white heading, a supporting line, and two buttons (solid white primary, ghost outline secondary). Add generous padding and a subtle inner ring. Contain it in a max-width wrapper with margin.
```

## Gated asset download

`cta/cta-gated-asset-download` · [preview](cta-gated-asset-download.html) · [source](https://vibeprompts.dev/cta/cta-gated-asset-download/)

> A report preview traded for an email address — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a gated content block with Tailwind CSS in two columns. The left column shows the asset: a rounded-xl bordered card angled slightly with a transform, containing a mock report cover — a small publisher line, a bold title over three lines, a thin rule, and a footer with a page count and year — with a second card peeking from behind it to suggest depth. The right column carries a small "Free report" label, a heading, a paragraph on what is inside, a bulleted list of four findings with check glyphs, an email field with a dark "Send me the report" button beneath it, and a two-line consent note in small text explaining exactly what the email will be used for and offering an alternative link to read it in the browser without giving an address. Keep the tone honest — the alternative link should be genuinely prominent, not hidden.
```

## Hiring call-to-action

`cta/cta-hiring-call-to-action` · [preview](cta-hiring-call-to-action.html) · [source](https://vibeprompts.dev/cta/cta-hiring-call-to-action/)

> Open roles listed under a short pitch — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a careers call-to-action with Tailwind CSS. Use a max-w-4xl neutral-900 card with rounded-2xl corners. The upper block is centred: a small pill reading how many roles are open, a heading, a paragraph in light grey about how the team works, and a row of four tiny facts separated by dots — remote policy, size, funding stage and the four-day-week note. Under a neutral-800 divider, a list of five role rows, each a link with the job title in white medium weight on the left, a muted line under it giving the team and location, and on the right a small bordered pill with the employment type and an arrow that shifts on hover. Close with a footer row holding a muted line about speculative applications with an email link, and a bordered "See all openings" button on the right.
```

## ⭐ In-app upgrade nudge

`cta/cta-in-app-upgrade-nudge` · [preview](cta-in-app-upgrade-nudge.html) · [source](https://vibeprompts.dev/cta/cta-in-app-upgrade-nudge/)

> Usage meter that makes the limit concrete — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design an in-product upgrade banner with Tailwind CSS, the kind shown when an account approaches a plan limit. Use a rounded-2xl bordered card with a subtle amber left accent border. The top row pairs a warning glyph tile with a heading reading "You have used 84% of your API quota" and a dismiss cross on the far right. Under it, a usage meter: a thin track with an amber fill at eighty-four percent, and beneath it a flex row with the used and total figures on the left in monospace and the reset date on the right in muted text. Then a two-line paragraph explaining what happens at the limit — requests start returning 429 rather than failing silently. Finish with a button row: a dark "Upgrade to Scale" primary, a bordered "Compare plans" secondary, and a muted text link for adjusting alert thresholds. Keep the whole thing comfortable inside a max-w-2xl container.
```

## Inline newsletter

`cta/cta-inline-newsletter` · [preview](cta-inline-newsletter.html) · [source](https://vibeprompts.dev/cta/cta-inline-newsletter/)

> Text left, email form right — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an inline newsletter CTA with Tailwind CSS: a bordered rounded-2xl card with a two-part flex layout — heading and subtext on the left, an email input plus subscribe button on the right. On mobile it stacks. Include a tiny privacy note under the form.
```

## Maintenance window opt-in

`cta/cta-maintenance-window-opt-in` · [preview](cta-maintenance-window-opt-in.html) · [source](https://vibeprompts.dev/cta/cta-maintenance-window-opt-in/) · has JavaScript

> Schedule a safe upgrade window from a focused banner — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a maintenance-window opt-in CTA with Tailwind CSS for a database upgrade. Include the version change, expected downtime, recommended window, timezone, alternative slots, and a status badge. Add JavaScript that lets the user pick a window, converts the displayed time between local and UTC, confirms the schedule, and changes the banner into a booked state with an Add to calendar action.
```

## Referral link CTA

`cta/cta-referral-link-cta` · [preview](cta-referral-link-cta.html) · [source](https://vibeprompts.dev/cta/cta-referral-link-cta/) · has JavaScript

> Copyable invite link with a reward tracker — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a referral call-to-action with Tailwind CSS. Use a max-w-3xl rounded-2xl card with a neutral-900 left rail on md and up carrying a rotated or stacked label, or simply a two-part layout: a top block with a gift-like glyph tile, a heading reading "Give a month, get a month", and a supporting line explaining both sides get credit. Below, a copy row: a bordered rounded-xl field showing the referral URL in monospace with the domain part muted, and a dark Copy button on the right that swaps to a green Copied state. Under the row, three small share buttons for email, X and LinkedIn drawn as bordered pills with glyphs. Then a progress block: a label with invites accepted out of five, a thin neutral-100 track with a neutral-900 fill at forty percent, and a muted line saying two more unlock the next reward. Then add JavaScript that copies the link, flips the button state for two seconds, and selects the field text on click.
```

## ⭐ Renewal reminder banner

`cta/cta-renewal-reminder-banner` · [preview](cta-renewal-reminder-banner.html) · [source](https://vibeprompts.dev/cta/cta-renewal-reminder-banner/)

> Contract end date with the two decisions available — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design an account renewal notice with Tailwind CSS. Use a max-w-3xl bordered rounded-2xl card with a neutral-900 header strip holding a calendar glyph, a heading reading "Your annual plan renews in 21 days" and the exact date in a monospaced pill on the right. The body is a two-column grid on sm: the left column lists the renewal terms as three labelled rows — plan, seats and amount, each with the value in medium weight and one showing a small "up from 20" note; the right column is a bordered neutral-50 block explaining what happens if nothing is done, in two short sentences. Below, a button row with a dark "Renew now and lock this rate", a bordered "Change plan" and a muted text link reading "Cancel renewal", plus a final line noting that a purchase order or updated billing details can be sent to the finance mailbox.
```

## ⭐ Seat limit collaboration nudge

`cta/cta-seat-limit-collaboration-nudge` · [preview](cta-seat-limit-collaboration-nudge.html) · [source](https://vibeprompts.dev/cta/cta-seat-limit-collaboration-nudge/) · has JavaScript

> Contextual upgrade prompt when a workspace fills up — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an in-product seat-limit CTA with Tailwind CSS. Show a nearly full avatar stack, 9 of 10 seats used, a progress bar, the next teammate waiting to join, and two actions to review members or add five seats. Include transparent prorated pricing. Add JavaScript that removes the nudge when dismissed, opens a compact cost confirmation when adding seats, and updates the seat count after confirmation.
```

## Sticky bottom conversion bar

`cta/cta-sticky-bottom-conversion-bar` · [preview](cta-sticky-bottom-conversion-bar.html) · [source](https://vibeprompts.dev/cta/cta-sticky-bottom-conversion-bar/) · has JavaScript

> Persistent offer strip with dismiss — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a sticky bottom conversion bar with Tailwind CSS: a fixed bar pinned to the bottom of the viewport with a blurred translucent dark background and a top border. Inside a max-width row, show a bold short offer on the left with a strikethrough original price and a highlighted discounted price, a countdown chip in the middle, a primary light button on the right, and a small dismiss X. Hide the countdown chip below sm. Then add JavaScript that ticks the countdown down to a fixed deadline once per second in days/hours/minutes/seconds, swaps the chip to an "Offer ended" state when it reaches zero, and dismisses the bar with a slide-down transition — remembering the dismissal in localStorage so it stays gone on the next visit.
```

## Trial CTA with reassurance

`cta/cta-trial-cta-with-reassurance` · [preview](cta-trial-cta-with-reassurance.html) · [source](https://vibeprompts.dev/cta/cta-trial-cta-with-reassurance/)

> Big ask, softened by four small promises — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a conversion block with Tailwind CSS centred on a neutral-50 background. Stack a small uppercase label, a large tight headline of no more than seven words, and a single paragraph of supporting copy at a comfortable measure. Under it, a primary dark button and a ghost link with an arrow, side by side and wrapping on small screens. Below the buttons, a row of four reassurance items laid out as a responsive grid: each has a check glyph in a small green-tinted circle, a bold micro-heading and a muted second line — no card required, cancel in one click, data export any time, and a real person answering support. Finish with a bordered strip holding four small avatars overlapping on the left and a line of text saying how many teams started this week, with the number in medium weight.
```

## Two-path CTA split

`cta/cta-two-path-cta-split` · [preview](cta-two-path-cta-split.html) · [source](https://vibeprompts.dev/cta/cta-two-path-cta-split/)

> Self-serve versus talk-to-sales cards — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a two-path call to action with Tailwind CSS: two side-by-side cards offering different next steps. The left card is dark and self-serve — heading, one line of copy, a white button, and a small note about no credit card. The right card is white with a border and sales-led — heading, copy, an outline button, and a line about typical response time. Give each card a small label chip at the top and equal height with flex.
```

## Webinar registration strip

`cta/cta-webinar-registration-strip` · [preview](cta-webinar-registration-strip.html) · [source](https://vibeprompts.dev/cta/cta-webinar-registration-strip/)

> Session details and a two-field signup — a free CTA banner prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a webinar registration block with Tailwind CSS as a wide bordered card split into two parts. The left part carries a small "Live session" pill with a red dot, a heading naming the session, a two-line description, a row of three detail items with glyph tiles for date, duration and format, and a line of speaker credits with two small overlapping avatars and their names and roles. The right part is a neutral-50 panel with a heading reading "Save your seat", an email field, a company field, a dark full-width register button, and under it a muted line saying the recording is sent to everyone who registers even if they cannot attend. Add a bottom bar across the whole card showing three past-session links with dates in monospace and a link to the full archive on the right.
```
