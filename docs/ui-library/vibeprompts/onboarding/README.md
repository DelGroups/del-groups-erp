# Onboarding (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Brand voice calibration step

`onboarding/onboarding-brand-voice-calibration-step` · [preview](onboarding-brand-voice-calibration-step.html) · [source](https://vibeprompts.dev/onboarding/onboarding-brand-voice-calibration-step/) · has JavaScript

> Teach a writing assistant the team’s preferred tone — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a brand-voice calibration onboarding step with Tailwind CSS. Present four pairs of alternative microcopy where the user chooses which version sounds more like the brand. Include progress, skip, back, and continue controls plus a live voice profile that updates across dimensions such as direct, warm, technical, and playful. Add JavaScript that records one choice per pair, updates the profile bars, and enables Continue only after every pair has an answer.
```

## ⭐ Brand your workspace step

`onboarding/onboarding-brand-your-workspace-step` · [preview](onboarding-brand-your-workspace-step.html) · [source](https://vibeprompts.dev/onboarding/onboarding-brand-your-workspace-step/) · has JavaScript

> Logo, colour and preview side by side — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a workspace branding step with Tailwind CSS in two columns. The left column is the form: a step label and heading, a workspace name field, a logo control showing a square preview tile with the current initial beside an outline "Upload" button and a muted "Remove" link plus a hint about file size, a colour picker row of eight round swatches where the selected one carries a ring, and a subdomain field with a fixed suffix rendered as a muted addon inside the input shell. The right column is a live preview: a small browser chrome with dots and an address bar showing the subdomain, then a mock app header using the chosen colour and initial, and two placeholder content rows. Then add JavaScript that mirrors the name, initial, colour and subdomain into the preview as they change, slugifies the subdomain field, and keeps the selected swatch ringed.
```

## ⭐ Checklist card

`onboarding/onboarding-checklist-card` · [preview](onboarding-checklist-card.html) · [source](https://vibeprompts.dev/onboarding/onboarding-checklist-card/) · has JavaScript

> Getting-started tasks with progress — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a getting-started checklist card with Tailwind CSS: a title with a progress label (e.g. "2 of 4 done"), a thin progress bar, and a list of tasks. Completed tasks show a filled check and strikethrough muted text; incomplete tasks show an empty circle and an action link on the right. Then add JavaScript that lets the list be completed: clicking a task or its action link toggles it done, which fills the marker, strikes the label, hides the action, animates the progress bar to the new percentage, and updates the "n of m done" count — with a small celebratory line replacing the count once everything is checked.
```

## Connect your stack step

`onboarding/onboarding-connect-your-stack-step` · [preview](onboarding-connect-your-stack-step.html) · [source](https://vibeprompts.dev/onboarding/onboarding-connect-your-stack-step/) · has JavaScript

> Integration tiles that flip to connected — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a "connect your tools" onboarding step with Tailwind CSS. Centre a heading, a subline explaining that connections can be changed later, and a live counter reading "0 of 6 connected". Below, a responsive grid of integration cards, each carrying a data-tool attribute: a rounded tile with a monospaced glyph on a tinted square, the tool name, a one-line category, and a small bordered Connect button in the corner. Underneath the grid, a muted note about read-only scopes, then a footer with a "Skip for now" link and a Continue button that starts disabled and faded. Then add JavaScript that toggles each card between connected and not: swap the button to a green "Connected ✓" state and back, ring the connected card, keep a set of connected tools, update the counter, and enable the Continue button once at least one tool is connected while rewriting its label to name the count.
```

## ⭐ CSV column mapping step

`onboarding/onboarding-csv-column-mapping-step` · [preview](onboarding-csv-column-mapping-step.html) · [source](https://vibeprompts.dev/onboarding/onboarding-csv-column-mapping-step/) · has JavaScript

> Match uploaded headers to expected fields — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a data import mapping step with Tailwind CSS. The header shows a step label, a heading reading "Match your columns", and a muted line naming the uploaded file with its row count and a "Replace file" link. Below, a bordered card holding a table with three columns: the field we expect with its name in medium weight and a "required" or "optional" tag under it, a select carrying the detected column names with an "Ignore this field" option, and a preview cell showing two example values in monospace muted text. Include six field rows. Above the table, a green tinted strip reporting how many columns were matched automatically. Under the card, a note about unmapped required fields and a footer with a ghost Back button and a dark Continue button. Then add JavaScript that recomputes the matched count on every change, blocks Continue while any required field is unmapped, and flags duplicate column assignments in red.
```

## Goal picker with chips

`onboarding/onboarding-goal-picker-with-chips` · [preview](onboarding-goal-picker-with-chips.html) · [source](https://vibeprompts.dev/onboarding/onboarding-goal-picker-with-chips/) · has JavaScript

> Multi-select intent that shapes the setup — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a goal selection onboarding step with Tailwind CSS. Centre a max-w-2xl column with a step label, a heading asking what the person wants to do first, and a muted line saying they can pick more than one. Below, a grid of nine selectable chips laid out two or three per row: each is a bordered rounded-xl button with a glyph tile, a short label and a muted one-line description, and when selected it gains a neutral-900 border, a soft neutral-50 background and a small check badge in the corner. Under the grid, a live line reading how many are selected with a minimum of one, and a footer with a ghost "Skip" and a dark Continue button that stays disabled until at least one chip is chosen. Then add JavaScript that toggles selection, caps the choice at four with a small inline note when the cap is reached, and keeps the counter and button state in sync.
```

## Install the CLI step

`onboarding/onboarding-install-the-cli-step` · [preview](onboarding-install-the-cli-step.html) · [source](https://vibeprompts.dev/onboarding/onboarding-install-the-cli-step/) · has JavaScript

> Copyable commands per operating system — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a developer onboarding step with Tailwind CSS for installing a command-line tool. The header has a step label, a heading and a muted line naming the current version and size. Below, a segmented control of three tabs — macOS, Linux and Windows — then a dark rounded-xl command block showing one or two monospaced lines with a leading prompt symbol in a dimmer colour and a copy button in the corner. Under it, a "Then verify" block with a second smaller command and the expected output shown in muted monospace. Then a three-item checklist that fills in as steps complete, each with a circle that becomes a green check. Finish with a footer of a ghost "Skip, I use Docker" button and a dark Continue that is disabled until the verification step is marked done. Then add JavaScript that switches command sets per platform, copies to the clipboard with confirmation, marks checklist items complete on copy, and enables Continue when all are done.
```

## ⭐ Invite teammates step

`onboarding/onboarding-invite-teammates-step` · [preview](onboarding-invite-teammates-step.html) · [source](https://vibeprompts.dev/onboarding/onboarding-invite-teammates-step/) · has JavaScript

> Add addresses, set roles, send or skip — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an "invite your team" onboarding step with Tailwind CSS, max-w-xl and centred. Above the heading, a step counter and a slim two-tone progress bar. Under the subline, an add row — an email field and a dark Add button side by side — plus a hidden inline error line and a hint that several addresses can be pasted at once. Below that, an empty list container for the invitees and a dashed empty-state panel saying nobody has been added yet. Each invitee row should render as an avatar circle with initials, the address, a role select (Admin, Member, Viewer), and a ✕ remove button. Finish with a footer row: a muted "I'll do this later" link on the left and a dark Continue button on the right. Then add JavaScript that splits pasted input on commas, semicolons and spaces, validates each address and shows the error for bad ones, ignores duplicates already in the list, derives the initials from the address, appends the row with a working remove button, swaps the empty state out once there is at least one invitee, and rewrites the Continue label to "Send 3 invites" or plain "Continue" depending on the count.
```

## Notification boundaries setup

`onboarding/onboarding-notification-boundaries-setup` · [preview](onboarding-notification-boundaries-setup.html) · [source](https://vibeprompts.dev/onboarding/onboarding-notification-boundaries-setup/) · has JavaScript

> Set working hours and escalation exceptions up front — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a notification-boundaries onboarding step with Tailwind CSS. Include timezone, weekday working hours, quiet-hour preview, channel preferences, and a critical-alert exception. Show a weekly timeline that visualizes active and quiet periods. Add JavaScript that updates the timeline from start and end times, toggles weekdays, and summarizes the chosen boundaries before continuing.
```

## Notification preferences step

`onboarding/onboarding-notification-preferences-step` · [preview](onboarding-notification-preferences-step.html) · [source](https://vibeprompts.dev/onboarding/onboarding-notification-preferences-step/) · has JavaScript

> Choosing what reaches you and where — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a notification preferences onboarding step with Tailwind CSS. The header has a step label, a heading and a muted line saying nothing is on by default except account security. The body is a table-like list with a header row of three channel columns — email, in-app and mobile push — and six category rows: product updates, mentions, comment replies, weekly digest, billing and security alerts. Each cell holds a small switch, and the security row switches are on and disabled with a muted "Required" label under the row name. Under the list, a quiet-hours block with a toggle and two time selects that dim when the toggle is off. Finish with a summary line reporting how many notifications are enabled, a ghost "Use recommended" button and a dark Continue. Then add JavaScript that counts enabled switches into the summary, applies a sensible recommended set, and enables or dims the quiet hours controls with its toggle.
```

## Product tour coachmark

`onboarding/onboarding-product-tour-coachmark` · [preview](onboarding-product-tour-coachmark.html) · [source](https://vibeprompts.dev/onboarding/onboarding-product-tour-coachmark/) · has JavaScript

> Spotlight tooltip anchored to a button — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a product-tour coachmark with Tailwind CSS: a mock toolbar with three buttons where the middle one is spotlighted by a ring. Anchored below it, a dark rounded popover positioned absolutely against the highlighted button, with an arrow notch made from a rotated square, a step counter such as "Step 2 of 4", a short title, a sentence of guidance, a row of four progress dots with the current one wider and lighter, and Skip tour plus Next actions. Because the popover is absolutely positioned it contributes no flow height, so add generous bottom padding on the wrapper to reserve room for it. Then add JavaScript holding the tour copy in an array so Next advances the counter, title, body, and dots, the last step reads Done, and either Done or Skip tour removes the coachmark.
```

## Resume onboarding banner

`onboarding/onboarding-resume-onboarding-banner` · [preview](onboarding-resume-onboarding-banner.html) · [source](https://vibeprompts.dev/onboarding/onboarding-resume-onboarding-banner/)

> Picking setup back up where it stopped — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design an in-app resume banner with Tailwind CSS for someone who abandoned setup partway. Use a max-w-4xl bordered rounded-2xl card with a neutral-50 background. The left side has a small "Setup unfinished" pill, a heading naming what remains, a one-line explanation of what unlocks when it is done, and a progress row with a thin track at forty percent, a "2 of 5 steps" label and the time estimate for the rest. The right side is a compact list of the five steps, each a row with a numbered circle that is filled and ticked for the two completed ones, the step name, and a muted status word — done, next, or a faint "later"; the next step carries a small dark "Continue" button. Under both, a bottom bar with a muted dismiss link on the left and a note that setup can be finished from the account menu at any time.
```

## Role picker cards

`onboarding/onboarding-role-picker-cards` · [preview](onboarding-role-picker-cards.html) · [source](https://vibeprompts.dev/onboarding/onboarding-role-picker-cards/)

> Selectable tiles that tailor the setup — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a role selection step with Tailwind CSS: a centered heading asking what the person does, a subline explaining it tailors the workspace, and a grid of selectable cards implemented as labels wrapping hidden radio inputs. Each card shows an icon tile, a role name, and a one-line description; use peer-checked variants so the chosen card gets a dark border, a ring, and a small check badge in the corner. Under the grid, a skip link on the left and a dark Continue button on the right.
```

## ⭐ Sample data or your own

`onboarding/onboarding-sample-data-or-your-own` · [preview](onboarding-sample-data-or-your-own.html) · [source](https://vibeprompts.dev/onboarding/onboarding-sample-data-or-your-own/)

> A fork in the road at the start of setup — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an onboarding fork with Tailwind CSS offering two ways to begin. Centre a max-w-3xl column with a step label, a heading asking how the person would like to start, and a muted line saying the choice is reversible. Below, two large selectable cards side by side: the left is "Explore with sample data" with a glyph tile, a paragraph, three bullet points with check glyphs, and a small "About 2 minutes" note; the right is "Connect my own data" with its own glyph, paragraph, three bullets, a note reading "About 15 minutes" and a small pill listing supported sources. The recommended card carries a neutral-900 ring and a small label. Under the cards, a bordered strip explaining that sample workspaces can be deleted in one click and that connecting real data later keeps everything already built. Finish with a ghost Back and a dark Continue.
```

## ⭐ Setup complete celebration

`onboarding/onboarding-setup-complete-celebration` · [preview](onboarding-setup-complete-celebration.html) · [source](https://vibeprompts.dev/onboarding/onboarding-setup-complete-celebration/)

> Closing screen with the obvious next actions — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a setup completion screen with Tailwind CSS. Centre a max-w-xl card with generous padding. At the top, a green tinted circle holding a large check glyph with a lighter ring around it, a heading reading "You are all set", and a muted line summarising what was configured. Below, a bordered rounded-xl recap list of four completed items, each with a small green check, a label and a muted value on the right — workspace name, region, connected source and teammates invited. Under that, a "What next" area with three action rows, each a bordered card with a glyph tile, a title, a one-line description and a chevron, covering building a first report, inviting more people and reading the quickstart. Finish with a full-width dark button to open the dashboard and a small centred line offering a link to book an onboarding call.
```

## ⭐ Stepper progress

`onboarding/onboarding-stepper-progress` · [preview](onboarding-stepper-progress.html) · [source](https://vibeprompts.dev/onboarding/onboarding-stepper-progress/) · has JavaScript

> Numbered steps with a current state — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an onboarding stepper with Tailwind CSS: a horizontal row of numbered step circles connected by lines, with completed steps filled dark, the current step ringed, and future steps muted. Below, a card with the current step title, a short description, and Back/Continue buttons. Then add JavaScript that actually walks the flow: hold the step copy in an array, repaint the circles and connector lines as done / current / upcoming when the index moves, swap the title and description, disable Back on the first step, and turn Continue into Finish on the last one before showing a completed state.
```

## Two-step account wizard

`onboarding/onboarding-two-step-account-wizard` · [preview](onboarding-two-step-account-wizard.html) · [source](https://vibeprompts.dev/onboarding/onboarding-two-step-account-wizard/) · has JavaScript

> Validated fields gate the next button — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a two-step signup wizard with Tailwind CSS. Centre a max-w-lg card. The header shows a step counter reading "Step 1 of 2" with a thin two-segment progress bar under it. Step one collects a full name, a work email and a password with a hint line about the minimum length; step two collects a company name, a team size select and a checkbox agreeing to terms. Only one step is visible at a time. The footer row has a ghost Back button, disabled on the first step, and a dark Next button that becomes Create account on the last step. Then add JavaScript that validates the visible step on input — a non-empty name, an email containing an at sign and a dot, a password of at least ten characters, and the checkbox on step two — enabling the primary button only when the step is valid, showing a small red message under any field left invalid after it has been touched, advancing the progress segments, and replacing the card contents with a success state on submit.
```

## Welcome tour modal

`onboarding/onboarding-welcome-tour-modal` · [preview](onboarding-welcome-tour-modal.html) · [source](https://vibeprompts.dev/onboarding/onboarding-welcome-tour-modal/) · has JavaScript

> A first-run dialog with three things to try — a free onboarding flow prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a first-run welcome modal with Tailwind CSS. Use a fixed inset-0 overlay with a blurred dark backdrop centring a max-w-lg white card with rounded-2xl corners. The card opens with a wide banner area drawn as a soft neutral gradient holding a large glyph and a small monospaced version tag in the corner. Under it, a heading welcoming the person by name, a paragraph of two sentences, and three suggested actions as bordered rows with a glyph tile, a title, a one-line description and a right chevron, the first row carrying a small "Start here" pill. The footer has a checkbox reading "Do not show this again" on the left and two buttons on the right, a ghost "Skip the tour" and a dark "Take the tour". Then add JavaScript that closes the modal on either button, on Escape and on a backdrop click, and remembers the checkbox choice in localStorage so a return visit skips it.
```
