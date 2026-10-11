# vibeprompts.dev UI library (local copy)

Full copy of the 286 free prompts and Tailwind snippets from [vibeprompts.dev](https://vibeprompts.dev/), taken 2026-10-11, so Claude Code can read them offline.

- Every component has a standalone preview: `<category>/<slug>.html` (open it in a browser; it loads Tailwind from its CDN).
- Every category has a `README.md` with each prompt text.
- ⭐ marks the components the plan maps to ERP screens (section 6.3 of `docs/SaaS-Commercialization-Plan.md`).
- **How to use:** these are references. Rebuild them as typed React components in `src/design-system` with our tokens, Radix and `motion`; do not paste the vanilla JS or the preview HTML into the app.

| Category | Count | ⭐ used |
|---|---|---|
| [Auth forms](auth/README.md) | 19 | 6 |
| [Pricing](pricing/README.md) | 19 | 5 |
| [Features](features/README.md) | 19 | 1 |
| [Hero](hero/README.md) | 19 | 0 |
| [CTA banners](cta/README.md) | 18 | 3 |
| [Stats](stats/README.md) | 18 | 10 |
| [Navigation](nav/README.md) | 18 | 6 |
| [Testimonials](testimonials/README.md) | 19 | 0 |
| [Footer](footer/README.md) | 18 | 0 |
| [FAQ](faq/README.md) | 18 | 0 |
| [Dashboards](dashboards/README.md) | 18 | 13 |
| [Onboarding](onboarding/README.md) | 18 | 7 |
| [Blog](blog/README.md) | 18 | 1 |
| [Contact](contact/README.md) | 18 | 1 |
| [Bonus components](bonus/README.md) | 29 | 8 |
