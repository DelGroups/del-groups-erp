# Contact (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Anonymous ethics report

`contact/contact-anonymous-ethics-report` · [preview](contact-anonymous-ethics-report.html) · [source](https://vibeprompts.dev/contact/contact-anonymous-ethics-report/) · has JavaScript

> Privacy-conscious reporting with a secure follow-up code — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an anonymous ethics reporting form with Tailwind CSS. Explain anonymity and data handling clearly, offer report category and relationship selectors, a detailed account field, optional safe-contact preference, attachment guidance, and an emergency disclaimer. Add a privacy summary panel and JavaScript that toggles contact fields, validates the account length, shows a character count, and returns a memorable private follow-up code after submission.
```

## Bug report form

`contact/contact-bug-report-form` · [preview](contact-bug-report-form.html) · [source](https://vibeprompts.dev/contact/contact-bug-report-form/)

> Severity, steps and environment in one submission — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a bug report form with Tailwind CSS. Use a max-w-2xl card with a heading, a muted line asking for one issue per report, and a link to the status page in case it is a known incident. The form has a summary field, a severity segmented control of four options from Low to Critical where the active one takes a tint matching its level, a textarea for steps to reproduce with monospaced placeholder text showing a numbered example, two-up fields for expected and actual behaviour, a dashed-border attachment dropzone with a paperclip glyph and a note about accepted types, and a collapsed details element revealing environment fields for browser, operating system and app version pre-filled with detected values. Finish with a submit row holding a dark button, a ghost "Save draft" and a muted line noting the report is visible to the workspace admins.
```

## ⭐ Demo booking with time slots

`contact/contact-demo-booking-with-time-slots` · [preview](contact-demo-booking-with-time-slots.html) · [source](https://vibeprompts.dev/contact/contact-demo-booking-with-time-slots/) · has JavaScript

> Pick a day, then a slot, then confirm — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a demo booking panel with Tailwind CSS: a left column with the host avatar, host name and role, the meeting length with a clock glyph, the timezone, and three bullet points about what the call covers. A right column shows a horizontal row of selectable day chips (weekday abbreviation over the date number) with one selected in dark, then a grid of time-slot buttons where one is disabled, and a full-width confirm button below. Stack the columns on mobile. Then add JavaScript that makes the picker behave: selecting a day highlights it and loads that day's slots — each day offers different availability, and a day with none shows a "fully booked" message — selecting a slot highlights it and clears when the day changes, and the confirm button stays disabled until both are chosen, then names the exact day and time it will book.
```

## Department directory table

`contact/contact-department-directory-table` · [preview](contact-department-directory-table.html) · [source](https://vibeprompts.dev/contact/contact-department-directory-table/)

> Who handles what, with a route for each — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a contact directory with Tailwind CSS. Start with a heading, a muted line saying every address reaches a person rather than a queue, and a search field. Then a bordered rounded-2xl table with rows for eight departments: columns for department with a glyph and a one-line description, the best contact route shown as an email or a link with a small type label, the typical response time, and hours. Zebra-stripe alternate rows faintly, and give one row an amber "Urgent only" pill in the response column. Under the table, a three-card row for the things that are not email — a phone number for urgent production issues, a postal address for legal notices, and a security disclosure address with a PGP fingerprint in monospace. Finish with a muted line about response times during holidays.
```

## Email preferences page

`contact/contact-email-preferences-page` · [preview](contact-email-preferences-page.html) · [source](https://vibeprompts.dev/contact/contact-email-preferences-page/)

> Unsubscribe options short of leaving entirely — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an email preferences page with Tailwind CSS, the destination of an unsubscribe link. Centre a max-w-xl card with a heading, a muted line naming the address being managed, and a small "You clicked unsubscribe in an email" note. The body offers four options as bordered radio rows: pause for thirty days, reduce to a monthly summary, keep only account and security email, and unsubscribe from everything; each has a title, a one-line consequence and a small tag where useful. The third option is preselected. Under the options, a collapsible "Choose individually" section revealing six checkboxes for specific lists. Finish with a dark Save button and a ghost "Keep everything as it is" link, plus a footnote noting that account and security messages cannot be switched off and explaining why.
```

## Feedback rating widget

`contact/contact-feedback-rating-widget` · [preview](contact-feedback-rating-widget.html) · [source](https://vibeprompts.dev/contact/contact-feedback-rating-widget/) · has JavaScript

> Score first, then a comment box appears — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a feedback widget with Tailwind CSS. Use a max-w-md bordered card with a heading asking how likely the person is to recommend the product, and a row of eleven small numbered buttons from zero to ten that wrap on narrow screens, with muted "Not likely" and "Very likely" labels at the ends. When a score is chosen it fills dark and a second stage appears: a short prompt whose wording depends on the score band, a textarea, an optional checkbox offering a follow-up conversation, and a dark submit button beside a ghost "Not now" link. Then add JavaScript that highlights the chosen number, reveals the second stage with a small height and opacity transition, changes the prompt for detractors, passives and promoters, keeps the score in a hidden field, and replaces the card contents with a short thank-you state on submit.
```

## Offices with live local time

`contact/contact-offices-with-live-local-time` · [preview](contact-offices-with-live-local-time.html) · [source](https://vibeprompts.dev/contact/contact-offices-with-live-local-time/) · has JavaScript

> City cards that know whether the desk is open — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an offices section with Tailwind CSS. A heading, a line inviting people to drop in, then a four-column grid of city cards. Each card carries a data-office attribute and shows the city name with the country under it, a two-line street address, a phone number and an email link, and a footer strip separated by a border holding a live local time in monospaced type on the left and an open/closed pill on the right. Keep the cards light — thin border, rounded-2xl, generous padding — and drop to two columns on sm and one on mobile. Then add JavaScript that stores each office's IANA time zone and opening hours, formats the current time in that zone with Intl.DateTimeFormat, decides whether the desk is open from the zone's own weekday and hour rather than the visitor's, paints the pill green for open and grey for closed with an "Opens 09:00" style hint when shut, and refreshes every thirty seconds so the clocks stay honest.
```

## Partnership enquiry form

`contact/contact-partnership-enquiry-form` · [preview](contact-partnership-enquiry-form.html) · [source](https://vibeprompts.dev/contact/contact-partnership-enquiry-form/)

> Qualifying questions with a budget range — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a partnership enquiry form with Tailwind CSS. Use a max-w-2xl card with a heading, a paragraph naming the three kinds of partnership on offer, and a form. The fields are: partnership type as three selectable tiles with glyphs — technology integration, reseller, and co-marketing; company name and website side by side; contact name and work email side by side; a budget or deal size select with five ranges and a "not sure yet" option; a timeline select; and a textarea for what they have in mind with a helper line asking for one specific outcome. Under the fields, a checkbox agreeing to be contacted, a dark submit button and a muted line stating that unqualified enquiries still get an answer, just a slower one. Add a right-aligned small note giving the current response time.
```

## Press and media contact

`contact/contact-press-and-media-contact` · [preview](contact-press-and-media-contact.html) · [source](https://vibeprompts.dev/contact/contact-press-and-media-contact/)

> Media enquiries beside downloadable brand assets — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a press contact section with Tailwind CSS in two columns. The left column holds a small "Press" label, a heading, a paragraph about what the team can help with, a direct press email as a large link, and a bordered card with a spokesperson: an avatar, name, title, and a line giving availability for interviews with a timezone. The right column is a stack of three download cards for the press kit, the logo pack and product screenshots: each a bordered rounded-xl row with a file glyph tile, a title, a muted line giving format and file size, and a download arrow on the right. Under them, a small bordered note about trademark usage with a link to the brand guidelines. Below both columns, a full-width row of three recent coverage links, each showing a publication name in uppercase, a headline and a date.
```

## Priority escalation card

`contact/contact-priority-escalation-card` · [preview](contact-priority-escalation-card.html) · [source](https://vibeprompts.dev/contact/contact-priority-escalation-card/)

> The route for something genuinely on fire — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an urgent support escalation panel with Tailwind CSS. Use a max-w-lg card with a red-tinted header strip holding a warning glyph, a heading reading "Production incident?" and a line stating this route wakes an on-call engineer. The body starts with a bordered checklist of three criteria that qualify — customer-facing outage, data loss risk, or a security incident — each with a check glyph, followed by a muted line asking people to use normal support otherwise, with a link. Then a phone number as a large monospaced link, a "Start a priority chat" dark button and a copyable incident reference in a bordered row. Under it, a two-column block giving the current on-call region and the average pickup time. Finish with a muted footnote about false alarms being fine and never held against anyone.
```

## Procurement review request

`contact/contact-procurement-review-request` · [preview](contact-procurement-review-request.html) · [source](https://vibeprompts.dev/contact/contact-procurement-review-request/) · has JavaScript

> Assemble the right security and legal package for a buyer — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a procurement review request form with Tailwind CSS. Ask for organization, expected seats, target purchase date, deployment region, and the buyer’s required materials. Provide selectable document cards for a security overview, DPA, accessibility report, insurance certificate, and vendor questionnaire. Show a live package summary with review owner and response target. Add JavaScript that updates the summary, requires at least one material, and replaces the form with a tracked request receipt on submission.
```

## Request a callback card

`contact/contact-request-a-callback-card` · [preview](contact-request-a-callback-card.html) · [source](https://vibeprompts.dev/contact/contact-request-a-callback-card/)

> Phone number, timezone and a preferred window — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a callback request card with Tailwind CSS. Use a max-w-lg bordered card with a phone glyph tile, a heading reading "We will call you", and a line saying most calls happen within the hour during office hours. The form has a phone field with a country code select rendered as an addon inside the input shell, a timezone select pre-filled with a detected zone, and a preferred window control: six time-slot chips in a two-row grid — this morning, this afternoon, this evening, tomorrow morning, tomorrow afternoon and "any time" — where the selected chip is dark and unavailable ones are dimmed and disabled. Under it, an optional one-line "what is it about" field, a submit button, and a small print row with a shield glyph noting the number is used only for this call and never added to a marketing list.
```

## Routed enquiry form

`contact/contact-routed-enquiry-form` · [preview](contact-routed-enquiry-form.html) · [source](https://vibeprompts.dev/contact/contact-routed-enquiry-form/) · has JavaScript

> Picking a department rewrites the form around it — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a contact form with Tailwind CSS that adapts to the chosen department. Use a max-w-xl card. At the top, a heading and a muted line about response times. The first control is a row of four selectable department tiles — Sales, Support, Billing and Press — each a bordered rounded-xl button with a glyph and a label, the active one dark. Under it, name and email fields side by side, a subject field, a message textarea, and a contextual helper block that changes with the department: a bordered neutral-50 note giving the expected reply time, a suggested self-serve link and, for Support only, an extra input asking for the workspace name. Finish with a submit button whose label names the department and a footnote about attachments. Then add JavaScript that switches the active tile, swaps the helper copy and links from a map, shows or hides the workspace field, and updates the button label.
```

## Simple support card

`contact/contact-simple-support-card` · [preview](contact-simple-support-card.html) · [source](https://vibeprompts.dev/contact/contact-simple-support-card/)

> Compact centered message form — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a compact centered contact card with Tailwind CSS: a small heading, a one-line subtitle, an email field, a message textarea, and a submit button, all inside a max-w-md bordered rounded-2xl card on a light background.
```

## Split contact form

`contact/contact-split-contact-form` · [preview](contact-split-contact-form.html) · [source](https://vibeprompts.dev/contact/contact-split-contact-form/)

> Info panel + form fields — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a contact section with Tailwind CSS: two columns. Left has a heading, a paragraph, and a small list of contact methods (email, phone, address) each with an icon square. Right is a form card with name, email, subject, and message textarea plus a submit button. Stack on mobile.
```

## Store locator with results

`contact/contact-store-locator-with-results` · [preview](contact-store-locator-with-results.html) · [source](https://vibeprompts.dev/contact/contact-store-locator-with-results/) · has JavaScript

> Postcode search beside a list of nearby shops — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a store locator with Tailwind CSS in two panes. The left pane has a search row with a location field carrying a pin glyph and a "Use my location" button, three filter chips for open now, click and collect, and repairs, and then five result cards: each with the shop name, a distance in monospace on the right, a two-line address, an open or closed pill with today hours, and a row of two small text links for directions and calling. The right pane is a stylised map placeholder built from a tinted grid with five numbered markers positioned absolutely and one highlighted larger in dark. Below the panes, a bordered strip about a shop that is temporarily closed, with a glyph and a date. Then add JavaScript that links list and map — hovering a card enlarges its marker, clicking selects both, and the selected card gains a neutral-900 ring.
```

## Support channel grid

`contact/contact-support-channel-grid` · [preview](contact-support-channel-grid.html) · [source](https://vibeprompts.dev/contact/contact-support-channel-grid/)

> Route people to the right team — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a support routing section with Tailwind CSS: a centered heading and subline, then a grid of three or four channel cards. Each card has an icon tile, a channel name, a one-line description, a response-time line in muted text, and an action link with an arrow; give one card a live-chat status chip with a green dot and another a muted "Offline until 9am" chip. Cards lift on hover with a shadow, and the grid collapses to one column on mobile.
```

## Support chat widget

`contact/contact-support-chat-widget` · [preview](contact-support-chat-widget.html) · [source](https://vibeprompts.dev/contact/contact-support-chat-widget/) · has JavaScript

> Floating bubble with a canned-reply thread — a free contact section prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a floating support chat widget with Tailwind CSS. A fixed bottom-right launcher button — a dark circle with a chat glyph and a small red unread dot — plus a chat panel above it that is hidden by default: a 22rem card with rounded-2xl corners and a shadow, a dark header with an agent avatar, the agent name, a green "Typically replies in 2 minutes" line and a close ✕, a scrollable message area seeded with one incoming bubble, a row of quick-reply chips, and a composer with a text input and a send button. Incoming messages are grey bubbles aligned left, outgoing ones are dark and aligned right. Then add JavaScript that opens and closes the panel (clearing the unread dot on first open and closing on Escape), appends the typed message as an outgoing bubble on submit, shows a three-dot typing indicator for a moment, then answers with a canned reply picked by matching keywords like "pricing", "bug" or "demo" against the message with a sensible fallback, sends a quick-reply chip as if it had been typed, and keeps the message area scrolled to the newest bubble.
```
