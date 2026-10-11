@AGENTS.md

## SaaS program rules

These rules apply to every task from `docs/claude-code-prompts.md` (plan: `docs/SaaS-Commercialization-Plan.md`).

1. Every task runs on its own branch (saas/<short-name>) and ends in a PR. Never push to main:
   every merge to main auto-deploys to production (erp.del-groups.com).
2. Before writing Next.js code, read the relevant guide in node_modules/next/dist/docs/ (this is Next 16;
   middleware is src/proxy.ts).
3. One SQL migration file per DB change, in supabase/migrations/. Its timestamp prefix must be unique:
   check `ls supabase/migrations` and the open PRs before choosing it.
4. Never run SQL or migrations against the production Supabase project. Write the migration, test it
   on a local or branch database, and say in the PR exactly what to run and in which order.
5. Never print, commit or ask for secrets. Read them from .env.local only.
6. New behaviour ships behind a feature flag or an admin-only page, off by default, so merging does
   not change what Del Groups staff see.
7. Before opening a PR run: npm run lint, npm test, npm run build. All must pass. Add tests for new logic.
8. Every UI string goes through src/i18n (az, en, ru).
9. Odoo is a reference for concepts and workflows only. Never copy Odoo code, icons, texts or branding.
10. UI references from vibeprompts.dev are copied locally in docs/ui-library/vibeprompts/
    (<category>/<slug>.html preview + <category>/README.md with the prompt). A reference written as
    "dashboards/dashboards-kanban-board-with-drag-and-drop" means that file. Rebuild them as typed React
    components using our design tokens, Radix and the motion library; never paste their vanilla JS.
11. PR description: what changed in plain words, how it was tested, and any manual step Del must do.
12. Keep each PR focused on its task. If you find unrelated problems, list them in the PR, don't fix them.
