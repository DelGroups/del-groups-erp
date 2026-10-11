# Navigation (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Anchor nav with scroll spy

`nav/nav-anchor-nav-with-scroll-spy` · [preview](nav-anchor-nav-with-scroll-spy.html) · [source](https://vibeprompts.dev/nav/nav-anchor-nav-with-scroll-spy/) · has JavaScript

> Section links that follow the reader down the page — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a marketing page anchor navigation with Tailwind CSS. The nav is a sticky bar under the header holding five section links in a horizontal row on a white background with a hairline bottom border and, on the right, a small dark "Get started" button that only appears once the page has scrolled past the hero. Links are small and muted, with the active one in neutral-900 carrying a subtle neutral-100 pill background. Below the nav, five demonstration sections with ids, each a tall block with a heading and a paragraph so the behaviour can be seen. Then add JavaScript that observes the sections with IntersectionObserver using a root margin biased toward the top of the viewport, marks the matching link active, reveals the button after 400 pixels of scroll, and scrolls smoothly with an offset that accounts for the sticky bar when a link is clicked.
```

## ⭐ App bar with search and tabs

`nav/nav-app-bar-with-search-and-tabs` · [preview](nav-app-bar-with-search-and-tabs.html) · [source](https://vibeprompts.dev/nav/nav-app-bar-with-search-and-tabs/) · has JavaScript

> Product header plus section tabs — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a two-row application header with Tailwind CSS. The top row holds a workspace switcher chip with a small avatar and a chevron, a wide centered search input showing a right-aligned keyboard shortcut hint, a notification bell with a red unread dot, and a user avatar. The second row is a set of underline tabs where the active tab has a dark bottom border and dark text while the others are muted, plus a right-aligned settings link. Separate the rows with a subtle border and let the tab row scroll horizontally on small screens. Then add JavaScript that wires up the two affordances the markup promises: make the ⌘K / Ctrl-K shortcut focus and select the search field (and Escape blur it), showing the correct modifier for the visitor platform in the hint, and move the active underline between tabs on click.
```

## ⭐ Bottom tab bar

`nav/nav-bottom-tab-bar` · [preview](nav-bottom-tab-bar.html) · [source](https://vibeprompts.dev/nav/nav-bottom-tab-bar/) · has JavaScript

> Mobile app navigation pinned to the bottom edge — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a mobile bottom navigation with Tailwind CSS. Draw a narrow phone-shaped frame with a rounded border on a neutral background, containing a scrollable content area of placeholder blocks and, fixed to the bottom of the frame, a tab bar. The bar has five items with a glyph above a tiny label; the active item is neutral-900 with a small dot under the label while the others are muted, one carries a red notification dot on its glyph, and the middle item is a raised circular dark button with a plus glyph that sits slightly above the bar line. Add a safe-area strip below the tabs. Then add JavaScript that switches the active tab on tap, moves the indicator dot, updates the heading in the content area, and clears the notification dot the first time its tab is opened.
```

## ⭐ Breadcrumb page header

`nav/nav-breadcrumb-page-header` · [preview](nav-breadcrumb-page-header.html) · [source](https://vibeprompts.dev/nav/nav-breadcrumb-page-header/)

> Location, title and the actions for this record — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design an application page header with Tailwind CSS. The top line is a breadcrumb of four levels separated by chevrons, the last one in medium neutral-900 and the earlier ones muted links, with a small overflow ellipsis button standing in for a collapsed middle level. Below it, a flex row that wraps: on the left a record title as a large heading with a small status pill beside it and, underneath, a muted metadata line with three items separated by dots — owner, created date and identifier in monospace; on the right, a button group of a bordered "Duplicate", a bordered "Share" and a dark primary "Publish", plus a square more-actions button with three dots. Under everything, a row of five tabs with a bottom border where the active tab carries a neutral-900 underline, and one tab shows a small count badge.
```

## Collapsible sidebar nav

`nav/nav-collapsible-sidebar-nav` · [preview](nav-collapsible-sidebar-nav.html) · [source](https://vibeprompts.dev/nav/nav-collapsible-sidebar-nav/) · has JavaScript

> Grouped vertical menu that shrinks to icons — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a vertical application sidebar with Tailwind CSS: a fixed-height 260px-wide column with a border on the right. The top holds a brand mark and a chevron button that collapses the rail. Below it, a search box, then two labelled groups ("Workspace" and "Insights"), each a button header with a caret and a list of links; every link is a rounded row with a monospaced icon glyph, a label, and optionally a count badge, and one link carries the active treatment of a neutral-100 background and a dark left accent. Pin a user chip with an avatar, a name, and a plan line to the bottom. Mark every text element that should disappear when collapsed with a data-label attribute, and give each group header a data-group attribute pointing at its list. Then add JavaScript that toggles a group open or closed with its caret rotating and aria-expanded following, collapses the whole rail to a 72px icon-only strip that hides labels, badges and group headers and centres the icons, keeps the chosen width in localStorage so it survives a reload, and moves the active class to whichever link is clicked.
```

## Docs bar with version switcher

`nav/nav-docs-bar-with-version-switcher` · [preview](nav-docs-bar-with-version-switcher.html) · [source](https://vibeprompts.dev/nav/nav-docs-bar-with-version-switcher/) · has JavaScript

> Breadcrumb, version dropdown, older-release notice — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a documentation header with Tailwind CSS. A sticky top bar with a light backdrop blur holds, from the left: a logo mark, a "Docs" wordmark, and a version switcher button showing the current version with a caret and a rounded border; on the right, links for Guides, API and Changelog plus a small "Ask AI ⌘K" pill. The version button opens an absolutely positioned dropdown card listing four versions, each row with the version number, a short label such as "Latest" or "Maintenance", and a check on the current one. Under the bar, a breadcrumb row — Docs / Deploying / Preview environments — and a hidden amber notice strip warning that an older version is being viewed with a link back to the latest. Then add JavaScript that opens and closes the dropdown, closes it on an outside click or Escape and restores focus to the button, marks the chosen version with the check and writes it into the button label, and reveals the amber notice for anything other than the latest release.
```

## Floating pill nav

`nav/nav-floating-pill-nav` · [preview](nav-floating-pill-nav.html) · [source](https://vibeprompts.dev/nav/nav-floating-pill-nav/)

> Detached rounded bar over the page — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a floating pill navigation with Tailwind CSS: a fixed, centered, fully rounded bar that hovers a few pixels below the top of the viewport with a translucent white background, backdrop blur, a hairline border, and a soft shadow. Inside, a compact logo mark, a divider, three or four links with rounded hover backgrounds and one active link with a filled pill, then a small dark CTA button at the end. Keep the whole bar to a width that hugs its content and hide the middle links below md.
```

## ⭐ Mobile drawer menu

`nav/nav-mobile-drawer-menu` · [preview](nav-mobile-drawer-menu.html) · [source](https://vibeprompts.dev/nav/nav-mobile-drawer-menu/) · has JavaScript

> Hamburger that slides a full-height panel in — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a mobile navigation with Tailwind CSS. The bar itself is a sticky top row with a wordmark on the left, a horizontal link list hidden below md, a "Sign in" link and a dark "Get started" button on the right also hidden below md, and a hamburger button of three stacked lines shown only on small screens. The drawer is a fixed inset-0 layer containing a black backdrop with a blur and a right-hand panel of eighty percent width, max-w-xs, full height, white, holding a header with the wordmark and a close cross, a stack of large tappable links with hairline dividers, a small section labelled Resources with three muted links, and a footer with the two buttons stacked full width. Then add JavaScript that opens and closes the drawer with a translate-x transition and a fading backdrop, locks body scroll while open, closes on backdrop click, on Escape and on any link click, and moves focus to the close button on open.
```

## ⭐ Multi-product launcher nav

`nav/nav-multi-product-launcher-nav` · [preview](nav-multi-product-launcher-nav.html) · [source](https://vibeprompts.dev/nav/nav-multi-product-launcher-nav/) · has JavaScript

> Suite navigation with a searchable product switcher — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a multi-product suite navigation bar with Tailwind CSS. Include a product launcher button, current product wordmark, contextual links, search, help, and account controls. The launcher opens a polished grid of six products with icons, descriptions, recent badge, and a footer link for administration. Add JavaScript for opening, outside-click and Escape closing, and filtering products from a search field.
```

## Nav with announcement bar

`nav/nav-nav-with-announcement-bar` · [preview](nav-nav-with-announcement-bar.html) · [source](https://vibeprompts.dev/nav/nav-nav-with-announcement-bar/) · has JavaScript

> Dismissible notice sitting above the header — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a two-tier site header with Tailwind CSS. The top tier is a neutral-900 announcement bar with centred small text carrying a bold label pill, a sentence about a release, an inline underlined link with an arrow, and a dismiss cross positioned at the right edge. The second tier is the main nav on white with a hairline bottom border: a wordmark, a centre group of five links where one carries a small green "New" badge, and a right group with a search glyph button, a "Sign in" text link and a dark rounded button. Make the whole header sticky as one unit so both tiers scroll together. Then add JavaScript that removes the announcement bar when the cross is clicked, remembers the dismissal in localStorage under a versioned key so a new announcement can reappear, and restores the hidden state on load before paint.
```

## Nav with currency and language

`nav/nav-nav-with-currency-and-language` · [preview](nav-nav-with-currency-and-language.html) · [source](https://vibeprompts.dev/nav/nav-nav-with-currency-and-language/) · has JavaScript

> International storefront controls in the bar — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a header for an international site with Tailwind CSS. The bar holds a wordmark on the left, five centre links, and on the right a locale group: a bordered pill button showing a globe glyph with the language code and a chevron, a second pill showing the currency code with its symbol, a vertical hairline, then a sign-in link and a dark button. Below the bar, an inline panel that is normally hidden and expands to show two columns of options — twelve languages as a grid of small buttons with the native name and the code, and eight currencies as rows with the code, name and symbol — with the current choices ringed. Then add JavaScript that opens and closes the panel from either pill, marks and stores the selection, updates both pill labels, closes on Escape or an outside click, and shows a small muted line naming the shipping region implied by the currency.
```

## Nav with mega dropdown

`nav/nav-nav-with-mega-dropdown` · [preview](nav-nav-with-mega-dropdown.html) · [source](https://vibeprompts.dev/nav/nav-nav-with-mega-dropdown/)

> Hover panel of grouped links — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a navigation bar with Tailwind CSS that includes a "Products" item revealing a mega-menu dropdown on hover/focus. The dropdown is a wide rounded panel with two columns of link items, each item having a small icon square, a title, and a subtitle. Use group-hover to toggle visibility with a soft transition.
```

## Presence-aware collaboration nav

`nav/nav-presence-aware-collaboration-nav` · [preview](nav-presence-aware-collaboration-nav.html) · [source](https://vibeprompts.dev/nav/nav-presence-aware-collaboration-nav/)

> Document navigation with live editors and sync state — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a presence-aware document navigation bar with Tailwind CSS. Include breadcrumb navigation, saved-state indicator, overlapping collaborator avatars with active tooltips, a Share button, comments count, and a View or Edit mode switch. Make the center title truncate gracefully and provide a compact mobile layout.
```

## Shop nav with cart badge

`nav/nav-shop-nav-with-cart-badge` · [preview](nav-shop-nav-with-cart-badge.html) · [source](https://vibeprompts.dev/nav/nav-shop-nav-with-cart-badge/)

> Category row, search and a basket count — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a retail site header with Tailwind CSS in two tiers. The upper tier is a slim neutral-900 strip with centred small text about free delivery over fifty and, at the right on larger screens, links for order tracking and help. The main tier is white with a hairline bottom border: a wordmark on the left, a wide bordered search field in the centre with a magnifier glyph and a placeholder naming a product category, and on the right three icon buttons for account, wishlist with a small count bubble, and basket with a neutral-900 count badge, the basket also showing a subtotal on larger screens. Under it, a third row of eight category links with generous spacing that scrolls horizontally on small screens without a visible scrollbar, one carrying a small red "Sale" label. Keep the whole header sticky.
```

## Shrink-on-scroll nav

`nav/nav-shrink-on-scroll-nav` · [preview](nav-shrink-on-scroll-nav.html) · [source](https://vibeprompts.dev/nav/nav-shrink-on-scroll-nav/) · has JavaScript

> Tall header that compacts once the page moves — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a header with Tailwind CSS that starts tall and compacts on scroll. At rest the bar is roughly 88 pixels tall with a transparent background, a large wordmark, spaced-out links in slightly larger text and an outline call-to-action. Once the page has scrolled past 40 pixels it becomes 60 pixels tall with a white background, a hairline bottom border, a soft shadow, a smaller wordmark and a filled dark button, all handled by class toggles on a single container with transition utilities on height, padding, background and shadow. Add a thin reading-progress line pinned to the bottom edge of the header, filling in neutral-900 as the page scrolls. Include a page of placeholder blocks below so the behaviour is visible. Then add JavaScript that toggles the compact classes past the threshold using a passive scroll listener, and updates the progress line width from the scroll ratio.
```

## Sliding underline tabs

`nav/nav-sliding-underline-tabs` · [preview](nav-sliding-underline-tabs.html) · [source](https://vibeprompts.dev/nav/nav-sliding-underline-tabs/) · has JavaScript

> Indicator that animates between sections — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a page-level tab bar with Tailwind CSS where the active underline slides. Wrap a max-w-4xl container: above the tabs, a small page title row with a heading and a muted record count. The tab strip is a relative flex row over a hairline bottom border with six tab buttons in small medium-weight text, plus an absolutely positioned two-pixel neutral-900 bar at the bottom that is moved and resized rather than re-rendered. Under the strip, a panel area showing a short paragraph and a bordered placeholder block for the active tab. Then add JavaScript that measures the active button offset and width and applies them to the indicator via inline left and width styles with a transition, switches the panel copy, keeps the indicator correct on window resize, and supports left and right arrow keys for moving between tabs.
```

## Sticky top nav

`nav/nav-sticky-top-nav` · [preview](nav-sticky-top-nav.html) · [source](https://vibeprompts.dev/nav/nav-sticky-top-nav/) · has JavaScript

> Logo, links, and CTA — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a sticky top navigation bar with Tailwind CSS: a translucent, blurred, bordered bar. Left: logo mark + wordmark. Center/right: horizontal nav links (hidden on mobile). Far right: a ghost "Sign in" link and a solid "Get started" button. Include a hamburger button that appears below md, and a collapsed mobile panel underneath repeating the links and actions. Then add JavaScript to make the hamburger work: toggle the panel, swap the icon between bars and an X, keep aria-expanded and aria-controls honest, close the panel when a link inside it is tapped or when Escape is pressed, and close it automatically if the viewport grows past the md breakpoint while it is open.
```

## ⭐ Workspace switcher nav

`nav/nav-workspace-switcher-nav` · [preview](nav-workspace-switcher-nav.html) · [source](https://vibeprompts.dev/nav/nav-workspace-switcher-nav/) · has JavaScript

> App bar with a searchable tenant dropdown — a free navigation prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design an application top bar with Tailwind CSS built around a workspace switcher. The bar holds, on the left, a small square logo tile then a switcher button showing the current workspace avatar, its name, a muted plan label and a chevron. On the right, a breadcrumb-free set of controls: a bordered search field with a keyboard hint, a bell button with a red unread dot, and a round user avatar. The dropdown is an absolutely positioned max-w-xs card under the switcher: a search input at the top, a scrollable list of five workspaces each with an avatar, name, member count and a check glyph on the active one, then a divider and two actions — create a workspace and manage workspaces — each with a leading glyph. Then add JavaScript that toggles the dropdown, filters the list from the input, closes on outside click and on Escape, and swaps the button label when a workspace is chosen.
```
