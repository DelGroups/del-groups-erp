# Blog (18)

Each section: the prompt from vibeprompts.dev and a link to the standalone preview (`.html`, open in a browser). ⭐ = used in `docs/SaaS-Commercialization-Plan.md`.

## Article end matter with share rail

`blog/blog-article-end-matter-with-share-rail` · [preview](blog-article-end-matter-with-share-rail.html) · [source](https://vibeprompts.dev/blog/blog-article-end-matter-with-share-rail/) · has JavaScript

> What sits under the last paragraph of a post — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build the closing section of an article with Tailwind CSS — everything after the final paragraph. Start with a horizontal rule, then an author card: an avatar, a name with a role line, two sentences of bio, and a bordered follow button on the right. Below, a share row with a small "Share this" label on the left and four bordered glyph buttons plus a "Copy link" button on the right. Then a bordered call-to-action strip with a heading, one line of copy and an inline email input with a dark button. Finish with a "Keep reading" block: a small heading and a three-column grid of related post cards, each with a category label, a title of up to two lines, and a footer of date and reading time. Then add JavaScript that copies the current URL when the copy button is clicked and swaps its label to "Copied" for two seconds.
```

## Article prose layout

`blog/blog-article-prose-layout` · [preview](blog-article-prose-layout.html) · [source](https://vibeprompts.dev/blog/blog-article-prose-layout/)

> Readable single-column post body — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a readable article layout with Tailwind CSS: a centered max-w-2xl column with a category label, a large title, a byline row (avatar, name, date, read time), a cover image, and a body using the typography plugin classes (prose) with headings, paragraphs, a blockquote, and a list. Keep line length comfortable.
```

## Article with margin notes

`blog/blog-article-with-margin-notes` · [preview](blog-article-with-margin-notes.html) · [source](https://vibeprompts.dev/blog/blog-article-with-margin-notes/)

> Sidenotes and footnotes beside the prose — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a long-form article layout with Tailwind CSS that puts notes in the margin. Use a grid with a wide prose column and a narrow right column on xl screens, collapsing to a single column below where notes appear inline as bordered blocks instead. The prose has a title, a byline row, and four paragraphs at a comfortable measure with a superscript reference marker inside two of them. Each margin note is a small block with a matching superscript number, two lines of muted text, and one containing a link. Include a pull quote spanning both columns, and a bordered aside with a glyph for a caution. End with a footnotes section: a hairline, a small heading, and three numbered entries with back-links to the marker. Keep the type generous and the notes visually quieter than the body.
```

## Article with sticky contents

`blog/blog-article-with-sticky-contents` · [preview](blog-article-with-sticky-contents.html) · [source](https://vibeprompts.dev/blog/blog-article-with-sticky-contents/) · has JavaScript

> Reading progress bar and live table of contents — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a long-form article layout with Tailwind CSS. Pin a 2px reading-progress bar to the very top of the viewport with a dark fill that starts at zero width. Below a header block (category pill, headline, byline row with avatar, date and reading time), lay out two columns from lg up: the article itself and a sticky sidebar at top-24 holding an "On this page" label, an empty list for generated links, and a small bordered share card with three quiet buttons. The article body uses generous vertical rhythm — lead paragraph in larger grey type, h2 section headings with scroll-mt-24 and ids, body paragraphs, one pull-quote with a left border, and a code-ish callout box. Then add JavaScript that reads every h2 in the article, builds the contents list from their text, scrolls smoothly to a section when a link is clicked, highlights whichever heading is currently nearest the top of the viewport as you scroll, and updates the progress bar from how far the article has been scrolled through rather than the whole document.
```

## Author profile with posts

`blog/blog-author-profile-with-posts` · [preview](blog-author-profile-with-posts.html) · [source](https://vibeprompts.dev/blog/blog-author-profile-with-posts/)

> Byline page pairing a bio with recent writing — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create an author page with Tailwind CSS. The top block is a card with a large avatar circle on the left, and on the right the name as a heading, a role line, a two-sentence bio, a row of three small social links with glyphs, and a bordered "Follow" button aligned to the right on wider screens. Under it, a thin stats row of three items separated by vertical rules — posts published, first post year and topics covered. Then a two-column layout from lg: the wide column lists five posts, each a row with a category label, a title in medium weight, a two-line excerpt and a footer of date and reading time; the narrow column is a sticky sidebar with a "Topics" list of five tag pills with counts, and a small bordered card promoting the author newsletter with a one-line pitch and a compact input and button.
```

## Blog card grid

`blog/blog-blog-card-grid` · [preview](blog-blog-card-grid.html) · [source](https://vibeprompts.dev/blog/blog-blog-card-grid/)

> Cover image, tag, title, meta — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a blog post grid with Tailwind CSS: three article cards, each with a rounded cover image placeholder, a small category tag, a title, a two-line excerpt, and a footer row with a tiny author avatar, name, and date. Cards lift slightly on hover. Responsive 1/2/3 columns.
```

## Case study layout

`blog/blog-case-study-layout` · [preview](blog-case-study-layout.html) · [source](https://vibeprompts.dev/blog/blog-case-study-layout/)

> Client facts in a rail beside the narrative — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a customer case study page with Tailwind CSS. The header spans full width: a small "Case study" label, a headline naming the outcome, a subhead, and a row of three headline metrics separated by vertical rules. Below, a two-column grid: the narrative column carries three labelled sections — The situation, What we did, What changed — each with a small uppercase heading, two paragraphs, and one section containing a bulleted list of four items with check glyphs; the sticky rail on the right holds a client card with a wordmark, industry, size and region rows, a quote block with an avatar and attribution, and a bordered "Download the PDF" button. Close with a full-width strip carrying a related-story link on the left and a dark "Talk to us about your rollout" button on the right.
```

## Changelog timeline

`blog/blog-changelog-timeline` · [preview](blog-changelog-timeline.html) · [source](https://vibeprompts.dev/blog/blog-changelog-timeline/)

> Release notes down a dated rail — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a product changelog page with Tailwind CSS built on a vertical rail. A header with the page title, a line about the release cadence, and an "Subscribe to updates" outline button on the right. Below, entries laid out as a grid on md: a left column holding the date and a monospaced version pill, and a right column with a border-left rail, a small dot marker sitting on the line, and the entry card. Each entry card carries a headline, a row of category chips (New, Improved, Fixed, Breaking) in tinted colours, a short paragraph, and a bullet list where each item starts with a small arrow glyph; one entry should include an inline "Breaking" callout box in amber explaining the migration step. Keep three entries so the rail reads as a timeline, then finish with a muted "Older releases →" link at the bottom.
```

## Choose-your-path field guide

`blog/blog-choose-your-path-field-guide` · [preview](blog-choose-your-path-field-guide.html) · [source](https://vibeprompts.dev/blog/blog-choose-your-path-field-guide/) · has JavaScript

> Tailor a long-form reading route to the reader’s goal — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a choose-your-path field guide with Tailwind CSS. Start with an editorial article introduction and three reader-goal cards: plan a migration, lead a team, or evaluate risk. After selection, reveal a tailored three-chapter reading route with estimated times, key questions, progress markers, and a reset control. Add JavaScript that changes the route from structured data, marks chapters complete, updates total progress, and reflects the chosen path in the URL hash.
```

## ⭐ Comment thread with replies

`blog/blog-comment-thread-with-replies` · [preview](blog-comment-thread-with-replies.html) · [source](https://vibeprompts.dev/blog/blog-comment-thread-with-replies/) · has JavaScript

> Discussion under an article, one level deep — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a comment section with Tailwind CSS. The header row shows a heading with the comment count and a small sort select for newest and oldest. Under it, a compose box: an avatar beside a bordered textarea with a placeholder, and a footer row with a muted markdown hint on the left and a dark Post button on the right that is disabled while the textarea is empty. Then four top-level comments, each with an avatar, a name with a small "Author" or "Moderator" pill where relevant, a relative timestamp, the comment body in relaxed prose, and an action row with an upvote count, a reply link and a report link. Two comments carry one indented reply each, marked by a left hairline. Close with a muted line about the code of conduct. Then add JavaScript that enables the Post button once text is entered, toggles upvote counts, and opens a small inline reply box under the comment when Reply is clicked.
```

## Content search results

`blog/blog-content-search-results` · [preview](blog-content-search-results.html) · [source](https://vibeprompts.dev/blog/blog-content-search-results/)

> Matches across posts, docs and videos — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a search results page with Tailwind CSS. The header holds a large search field pre-filled with a query and a clear cross, plus a line reading the result count and the time taken in monospace. Under it, a row of type filter chips — All, Articles, Docs, Videos, Changelog — with counts in each, and a sort select on the right. Results are ten rows separated by hairlines: each has a small type label with a matching glyph, a title with the matched term wrapped in a highlighted span, a two-line excerpt also highlighting the term, and a footer of a breadcrumb path in monospace and a date. Two results show a small "Updated recently" pill. Below, pagination with previous and next buttons and page numbers, then a bordered strip suggesting a related query with a link.
```

## Featured post with side list

`blog/blog-featured-post-with-side-list` · [preview](blog-featured-post-with-side-list.html) · [source](https://vibeprompts.dev/blog/blog-featured-post-with-side-list/)

> One large story plus compact runners-up — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a blog index hero with Tailwind CSS: a two-thirds featured article on the left with a tall rounded cover placeholder, a category tag, a large title, a two-line excerpt, and an author-plus-date row. On the right third, a "More this week" heading over a divided list of three compact posts, each showing a small square thumbnail, a tight two-line title, and a date. Collapse to a single column on mobile with the featured post first.
```

## Filterable post index

`blog/blog-filterable-post-index` · [preview](blog-filterable-post-index.html) · [source](https://vibeprompts.dev/blog/blog-filterable-post-index/) · has JavaScript

> Topic pills over a dense row list — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Create a lean blog archive with Tailwind CSS: a page title with a post count, a row of topic filter pills where one is active and dark, and a divided list of posts rendered as full-width rows rather than cards. Each row carries a data-topic attribute and shows the date in a fixed-width muted column on the left, the title and a one-line excerpt in the middle, a topic chip, and an arrow that slides right on hover. Add a bordered "Load more" button centered at the bottom. Then add JavaScript that filters the list when a pill is clicked, moves the active pill styling, updates the visible post count in the header, hides the Load more button when a filter is narrowing the list, and reflects the current topic in the URL query string so a filtered view can be linked and restored on load.
```

## Guide library with difficulty tags

`blog/blog-guide-library-with-difficulty-tags` · [preview](blog-guide-library-with-difficulty-tags.html) · [source](https://vibeprompts.dev/blog/blog-guide-library-with-difficulty-tags/)

> Learning content sorted by level and length — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Design a guide library with Tailwind CSS. The header has a heading, a subline about learning paths, and a filter row with three level chips — Beginner, Intermediate, Advanced — plus a muted result count on the right. Below, a three-column responsive grid of guide cards: each card is a bordered rounded-xl tile with a small monospaced step count at the top right, a glyph tile, a title, a two-line description, and a footer row separated by a hairline showing a level pill in a tint appropriate to its difficulty and a reading time in muted small text. Include nine guides across the levels. Under the grid, a wide bordered strip suggesting a structured path, with a heading, one line of copy, three numbered mini-steps in a row, and a dark button reading "Start the path".
```

## Newsletter archive list

`blog/blog-newsletter-archive-list` · [preview](blog-newsletter-archive-list.html) · [source](https://vibeprompts.dev/blog/blog-newsletter-archive-list/)

> Numbered issues with subjects and open rates — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a newsletter archive page with Tailwind CSS. The header block has a heading, a paragraph about what the letter covers and how often it lands, and an inline subscribe row of an email input and a dark button with a muted line under it giving the subscriber count. Below, a list of eight issues rendered as rows separated by hairlines rather than cards: each row has a monospaced issue number on the left in a fixed-width column, then the subject line in medium weight with a muted one-line summary underneath, and on the right the send date in muted small text with a tiny "Read" link that appears on hover. Give the most recent issue a small green "Latest" pill beside its subject. Under the list, a centred bordered "Load older issues" button and a muted line noting the archive goes back to 2023.
```

## Personal reading queue

`blog/blog-personal-reading-queue` · [preview](blog-personal-reading-queue.html) · [source](https://vibeprompts.dev/blog/blog-personal-reading-queue/) · has JavaScript

> Save, prioritize, and resume long-form articles — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a personal reading-queue page with Tailwind CSS. Include currently reading with progress, saved articles grouped into Next and Later, estimated reading time, topic tags, and a compact completion archive. Add JavaScript that moves articles between priority groups, updates reading progress, marks an article complete, and persists queue state in localStorage with guarded storage access.
```

## Podcast episode list

`blog/blog-podcast-episode-list` · [preview](blog-podcast-episode-list.html) · [source](https://vibeprompts.dev/blog/blog-podcast-episode-list/)

> Player rows with duration and show notes link — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a podcast episode index with Tailwind CSS. The header pairs a square show artwork tile drawn as a dark gradient block with the show title, a two-line description, a row of four small platform links as bordered pills, and a muted line giving the release cadence. Below, a list of five episode rows in a bordered card, divided by hairlines: each row has a circular play button on the left, then the episode number and title stacked with a two-line summary, then guest names as small muted text, and on the right the duration in monospace with a date under it. Give the first row an expanded state showing a slim progress bar with elapsed and remaining times under the title, and a currently-playing label with a small equaliser of three animated bars. Finish with a "Browse all 84 episodes" link and an RSS pill.
```

## Series navigation for a post

`blog/blog-series-navigation-for-a-post` · [preview](blog-series-navigation-for-a-post.html) · [source](https://vibeprompts.dev/blog/blog-series-navigation-for-a-post/)

> Part three of five, with the whole arc visible — a free blog layout prompt with ready-to-paste Tailwind CSS code for your AI tool.

```text
Build a series navigation block with Tailwind CSS that sits inside a multi-part article. Use a bordered rounded-2xl card with a header row holding a small "Part 3 of 5" pill, the series title in medium weight, and a muted line giving the total reading time. The body is a list of five parts: each row has a numbered circle — filled dark and ticked for read parts, outlined and dark-bordered for the current one, plain for later parts — the part title, a muted one-line summary, and a reading time on the right; the current row has a neutral-50 background and no link styling. Under the list, a two-cell footer with previous and next part links pointing in opposite directions. Add a small note explaining parts can be read out of order but build on each other.
```
