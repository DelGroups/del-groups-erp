# Auth forms (19)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Account chooser

`auth/auth-account-chooser` · [preview](auth-account-chooser.html) · [source](https://vibeprompts.dev/auth/auth-account-chooser/)

> Pick a signed-in identity or add another — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an account chooser screen with Tailwind CSS, the kind shown when several accounts are already signed in. Centre a max-w-sm card on a neutral-50 page with a small brand tile, a "Choose an account" heading and a line naming the app requesting access. List three accounts as full-width rows: a coloured circular avatar with initials, the display name in medium weight, the email in muted small text, and on the right either a green "Active" pill or a muted "Signed out" label. Rows lift on hover with a neutral-50 background and keep a clear focus ring. Under the list, a dashed-border row with a plus glyph labelled "Use another account", then a footer with a "Sign out of all accounts" link and a line of legal text linking terms and privacy.
```

## Account locked with recovery

`auth/auth-account-locked-with-recovery` · [preview](auth-account-locked-with-recovery.html) · [source](https://vibeprompts.dev/auth/auth-account-locked-with-recovery/) · has JavaScript

> Too many attempts, and the way back in — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a locked-account screen with Tailwind CSS. Centre a max-w-md card led by a red-tinted round tile with a shield glyph, a heading reading "Too many attempts", and a paragraph explaining the account is locked for fifteen minutes after five failed sign-ins. Under it, a bordered neutral-50 panel showing a countdown as a large monospaced figure with a thin progress track beneath it that empties as the timer runs, plus a muted caption naming the time the lock lifts. Below, a "Cannot wait?" section with three recovery rows as bordered buttons — email a sign-in link, use a recovery code, contact an administrator — each with a glyph tile, a label and a one-line description. Finish with a muted footer line saying the attempt was logged with its IP and location. Then add JavaScript that counts down from fifteen minutes, updates the figure and the track each second, and swaps the panel for a green "You can try again" state with a button when it reaches zero.
```

## ⭐ Active sessions manager

`auth/auth-active-sessions-manager` · [preview](auth-active-sessions-manager.html) · [source](https://vibeprompts.dev/auth/auth-active-sessions-manager/)

> Every signed-in device, with a way to end it — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a security settings panel with Tailwind CSS listing active sessions. The header holds a heading, a muted line giving the count of signed-in devices, and a bordered red-toned button reading "Sign out everywhere else". Below, a list of five session rows in a bordered card: each row has a device glyph tile, the device and browser on one line with a small green "This device" pill on the current one, a muted second line giving the IP, city and last-active time, and on the right either a muted "Current" label or a ghost "Sign out" button. Give one row an amber left accent and a small warning line reading that the location is unusual. Under the list, a bordered neutral-50 note explaining that signing out revokes the refresh token immediately and that API keys are unaffected, with a link to the API keys page.
```

## Centered card sign-up

`auth/auth-centered-card-sign-up` · [preview](auth-centered-card-sign-up.html) · [source](https://vibeprompts.dev/auth/auth-centered-card-sign-up/)

> Minimal boxed form, great for modals too — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a centered sign-up card with Tailwind CSS on a soft neutral background. The card is max-w-md, rounded-2xl, with a shadow and a thin border. Include a title, a subtitle with a "Sign in" link, full name / email / password fields, a small password hint, a full-width gradient-free dark submit button, and a legal line about Terms and Privacy at the bottom. Keep spacing generous and inputs comfortable.
```

## Dual email change verification

`auth/auth-dual-email-change-verification` · [preview](auth-dual-email-change-verification.html) · [source](https://vibeprompts.dev/auth/auth-dual-email-change-verification/) · has JavaScript

> Confirm an address change from both inboxes — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a dual email-change verification flow with Tailwind CSS. Show old and new email addresses as two numbered steps, each with a six-digit code input, verification badge, and resend control. A progress line should connect the steps and the final Update email button should remain disabled until both codes are verified. Add JavaScript that formats numeric codes, verifies the demo codes 142857 and 620319 independently, updates the step states, runs a 20-second resend countdown per address, and announces when the email change is ready to submit.
```

## Guest or account checkout gate

`auth/auth-guest-or-account-checkout-gate` · [preview](auth-guest-or-account-checkout-gate.html) · [source](https://vibeprompts.dev/auth/auth-guest-or-account-checkout-gate/)

> Three ways past the sign-in wall — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a checkout identity step with Tailwind CSS offering three routes. Use a max-w-lg card with a small step label reading "Step 1 of 3", a heading, and a muted line saying an account is optional. The first block is the recommended route: a bordered card with a neutral-900 ring holding a heading, an email field, a dark "Continue as guest" button and a muted line explaining an account can be created afterwards from the receipt. Below a divider labelled "or", two compact routes side by side: a bordered card for signing in with an email field, a password field and an outline button, and a bordered card for social sign-in with two full-width provider buttons. At the bottom, a row of three trust notes with glyphs — encrypted payment, order tracking by email, and no marketing without consent — plus a line linking terms and privacy.
```

## Magic link request

`auth/auth-magic-link-request` · [preview](auth-magic-link-request.html) · [source](https://vibeprompts.dev/auth/auth-magic-link-request/)

> Passwordless email sign-in card — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a passwordless sign-in card with Tailwind CSS. Centered on a soft neutral background, max-w-sm, rounded-2xl with a thin border. Include a small rounded logo badge, a headline about signing in without a password, one email field, a full-width dark submit button, a muted info panel explaining that the link expires in 10 minutes and works once, and a footer line offering to use a password instead. Keep the tone calm and the spacing generous.
```

## New device approval

`auth/auth-new-device-approval` · [preview](auth-new-device-approval.html) · [source](https://vibeprompts.dev/auth/auth-new-device-approval/)

> Approve or block a sign-in from another machine — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a device approval screen with Tailwind CSS, shown on a trusted device when a sign-in is attempted elsewhere. Centre a max-w-md white card. Lead with an amber-tinted round tile holding a bell glyph, a heading reading "Approve this sign-in?" and a muted subline saying someone is trying to sign in to the account. Below, a bordered detail block listing four labelled rows — device, browser, location and time — with the label in muted small text on the left and the value right-aligned in medium neutral-900, plus a small amber note under the location row saying it does not match recent activity. Then two buttons side by side, a neutral outline "It was not me" and a dark "Yes, approve", followed by a monospaced two-digit-style code the person is asked to match with the one on the other screen, and a last line saying the request expires in two minutes.
```

## OAuth consent screen

`auth/auth-oauth-consent-screen` · [preview](auth-oauth-consent-screen.html) · [source](https://vibeprompts.dev/auth/auth-oauth-consent-screen/)

> Granting an app access, scope by scope — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an OAuth authorisation screen with Tailwind CSS. Centre a max-w-md card. At the top, two rounded tiles side by side with a small connecting arrow between them — the third-party app on the left and your product on the right — then a heading reading "Sunbeam wants to access your workspace" and a muted line naming the account it would connect. Below, a bordered list of four permission rows, each with a glyph tile, a scope title in medium weight, a plain-English explanation and, on two of them, a small "Read only" pill. Under the list, a warning-toned line reminding the person that access can be revoked at any time from settings. Finish with a full-width dark "Allow access" button, a bordered "Cancel" button under it, and a footnote in small text giving the developer name and the redirect host in monospace.
```

## One-time code (OTP)

`auth/auth-one-time-code-otp` · [preview](auth-one-time-code-otp.html) · [source](https://vibeprompts.dev/auth/auth-one-time-code-otp/) · has JavaScript

> Six-digit verification input — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an OTP verification screen with Tailwind CSS. Centered card explaining a 6-digit code was sent to an email. Show six separate square inputs (size-12, text-center, large font) in a row, an active-state focus ring, a "Verify" button, and a muted line "Didn't get it? Resend in 0:30". Keep it clean and centered. Then add JavaScript for the behaviour people expect from a real code field: advance to the next box as each digit is typed, step back on Backspace from an empty box, move with the arrow keys, spread a pasted 6-digit code across all six boxes at once, strip anything that is not a digit, keep the Verify button disabled until all six are filled, and run the resend line down from 0:30 to a live "Resend code" button.
```

## Passkey sign-in with fallback

`auth/auth-passkey-sign-in-with-fallback` · [preview](auth-passkey-sign-in-with-fallback.html) · [source](https://vibeprompts.dev/auth/auth-passkey-sign-in-with-fallback/)

> Biometric prompt first, password as the escape hatch — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a passkey-first sign-in card with Tailwind CSS. Centre a max-w-sm white card with rounded-2xl corners and a soft border on a neutral-50 page. Inside: a small dark rounded logo tile, a heading reading "Sign in to Northwind", and a muted line saying the account uses a passkey. Show the remembered account as a bordered row with a round avatar initial, the email address, and a "Not you?" link on the right. Under it, a full-width dark button labelled "Continue with passkey" carrying a shield glyph, then a caption explaining the device will ask for Face ID, a fingerprint or the device PIN. Add a hairline divider with the word "or", two outline buttons for "Use a one-time code" and "Sign in with password", and a footer line about security keys. Keep every control at least 44px tall and give the buttons visible focus rings.
```

## Recovery code sign-in

`auth/auth-recovery-code-sign-in` · [preview](auth-recovery-code-sign-in.html) · [source](https://vibeprompts.dev/auth/auth-recovery-code-sign-in/) · has JavaScript

> Emergency access with a single-use backup code — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a recovery-code sign-in card with Tailwind CSS. Include a security icon, clear explanation, a segmented-looking code input, remaining-code notice, primary Verify button, and links back to authenticator sign-in or support. Add JavaScript that uppercases and formats the code as XXXX-XXXX, validates eight alphanumeric characters, shows an inline error after an invalid attempt, disables the button while checking, and replaces the form with a success state when the demo code SAFE2026 is entered.
```

## ⭐ Reset password with strength meter

`auth/auth-reset-password-with-strength-meter` · [preview](auth-reset-password-with-strength-meter.html) · [source](https://vibeprompts.dev/auth/auth-reset-password-with-strength-meter/) · has JavaScript

> New password form with live requirements — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a reset-password card with Tailwind CSS. Include a title, a line naming the account being reset, a new password field, a four-segment strength meter bar that starts empty, a small strength label, a confirm field, and a requirements checklist whose items each carry a data-rule attribute. Finish with a full-width dark submit button and a back-to-sign-in link. Then add JavaScript that scores the password on every keystroke — length, a number, a symbol, mixed case — paints that many meter segments amber then green, writes Weak / Fair / Good / Strong into the label, flips each checklist row between a muted dot and a green check as its rule passes, and keeps the submit button disabled until every rule passes including the two fields matching.
```

## ⭐ Split-screen with visual

`auth/auth-split-screen-with-visual` · [preview](auth-split-screen-with-visual.html) · [source](https://vibeprompts.dev/auth/auth-split-screen-with-visual/)

> Form on one side, brand imagery on the other — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a full-height split-screen sign-in page with Tailwind CSS. On the left, a centered login card (~360px wide) with a logo, an email and password field, a "Remember me" checkbox with a "Forgot password?" link on the same row, a full-width primary button, and a divider before a "Continue with Google" outline button. On the right half, a solid brand-colored panel with a large headline and a short testimonial, hidden below the lg breakpoint. Use rounded-xl inputs, subtle borders, and clear focus rings.
```

## ⭐ Trial signup with plan summary

`auth/auth-trial-signup-with-plan-summary` · [preview](auth-trial-signup-with-plan-summary.html) · [source](https://vibeprompts.dev/auth/auth-trial-signup-with-plan-summary/)

> Form on the left, what you are getting on the right — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a trial signup page with Tailwind CSS in two columns. The left column is the form on white: a wordmark, a heading, a muted line with a link for people who already have an account, then fields for work email, password with a hint, and company; a checkbox for product emails that is unticked by default; a dark full-width "Start free trial" button; and a divider with a Google button. The right column is a neutral-50 summary panel, sticky from lg up: a "Your trial" label, the plan name with a price line reading fourteen days free then a monthly figure, a bordered white card listing four included items with check glyphs, a small timeline of three dated bullets showing today, day eleven and day fourteen, and at the bottom a muted line saying no card is required and the trial does not convert automatically.
```

## ⭐ Two-factor setup with QR

`auth/auth-two-factor-setup-with-qr` · [preview](auth-two-factor-setup-with-qr.html) · [source](https://vibeprompts.dev/auth/auth-two-factor-setup-with-qr/) · has JavaScript

> Pair an authenticator, then save backup codes — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a two-factor enrolment card with Tailwind CSS, max-w-xl on a soft neutral background. Above the fold: a small uppercase "Security" eyebrow, a headline, and a line naming a few authenticator apps. The pairing panel puts a square QR placeholder (a 5-column grid of small rounded squares inside a bordered tile) beside a column holding a "Can't scan it?" hint, the setup key in a monospaced pill with a Copy button, and a six-digit confirmation input with wide letter-spacing. Footer row: a muted Cancel link and a dark "Turn on" button. Below it, a hidden success panel with a green confirmation strip, a grid of one-time backup codes, and a "Copy all codes" button. Then add JavaScript that copies the setup key to the clipboard and flips the button label to "Copied" for a moment, strips non-digits from the confirmation field and keeps the "Turn on" button disabled until six digits are present, and on confirm swaps the pairing panel for the backup-code panel and wires its copy button to put every code on the clipboard as separate lines.
```

## Verify email with resend timer

`auth/auth-verify-email-with-resend-timer` · [preview](auth-verify-email-with-resend-timer.html) · [source](https://vibeprompts.dev/auth/auth-verify-email-with-resend-timer/) · has JavaScript

> Waiting state with a cooling-off resend button — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an email verification waiting screen with Tailwind CSS. Centre a max-w-sm card holding a neutral-tinted round tile with an envelope glyph, a heading reading "Check your inbox", and a line saying a verification link was sent to an address shown in medium weight with a small "change" link beside it. Add three muted hint rows with check glyphs — the link works once, it expires in an hour, and the tab can be closed once verified. Then a full-width outline "Resend email" button that starts disabled with a countdown in its label, a small muted line reporting how many times it has been sent, and a footer link to contact support. Then add JavaScript that starts a thirty second countdown, updates the button label each second, enables it when the countdown ends, and on click increments the send counter, updates the "sent" line and restarts the countdown from a longer interval each time.
```

## ⭐ Workspace invite acceptance

`auth/auth-workspace-invite-acceptance` · [preview](auth-workspace-invite-acceptance.html) · [source](https://vibeprompts.dev/auth/auth-workspace-invite-acceptance/)

> Join a team from an emailed invitation link — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build an invitation acceptance card with Tailwind CSS for someone opening a team invite link. Centre a max-w-md white card on a neutral-50 page. At the top, two overlapping circles — the inviter avatar and the workspace logo tile — with a small dark check badge between them, then a heading reading "Jules invited you to Studioform" and a muted line with the workspace domain. Add a bordered summary block showing the role being granted as a pill, the number of teammates already in the workspace as a row of stacked avatars with a plus-two counter, and the invited email address in monospace. Under it, a full-width dark "Accept invitation" button, a ghost "Decline" button beneath it, and a small print line explaining the invite expires in seven days and that the workspace admin can see when it is accepted.
```

## Workspace SSO gate

`auth/auth-workspace-sso-gate` · [preview](auth-workspace-sso-gate.html) · [source](https://vibeprompts.dev/auth/auth-workspace-sso-gate/) · has JavaScript

> Email first, then SSO or password — a free auth form prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an email-first sign-in card with Tailwind CSS, max-w-sm on a neutral background. Start with a logo badge, a "Sign in to Northwind" heading, and a line explaining that the work email decides the sign-in method. The form holds an email field with a hidden inline error line, a hidden identity row that shows the confirmed address in a grey pill with a "Change" button, a hidden password field, a full-width dark Continue button, and a hidden note about single sign-on. Finish with a "Create an account" link. Then add JavaScript for the two-step flow: on Continue, validate the address and reveal the error if it is malformed; otherwise lock the email into the identity pill and look up its domain in a small map of SSO-enabled companies — matched domains relabel the button "Continue with Okta" (or whichever provider) and reveal the SSO note, unmatched domains reveal the password field and relabel the button "Sign in". "Change" restores the first step, and the button label always reflects the current step.
```
