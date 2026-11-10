## پرامپت GUARD-5: ایجنت حسابدار حرفه‌ای (Claude)

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: add the AI accountant to the Accounting Guard: it reviews findings and the books like a senior
accountant, writes saved reports, and explains findings on request. Branch:
saas/accounting-guard-agent. Requires GUARD-1..4. Open a PR.

Flags: ACCOUNTING_GUARD_AI=true (off by default) + ANTHROPIC_API_KEY (already used by
src/lib/ai/native). Reuse src/lib/ai/native (router, store, usage log, tenant AI limits); read the
claude-api skill for current model ids. Default model: the standard tier; the monthly review uses the
deep tier. Every call is logged in ai_usage_log and counted against the tenant AI limit.

Behaviour
- Read-only tools only (new file src/lib/guard/agentTools.ts): list_findings, get_finding,
  get_document (sale/purchase/payment with lines and payments), get_journal_entry, partner_ledger,
  trial_balance(date range), account_movements, product_history, guard_rules. Every tool runs as the
  calling admin (or the service role for the scheduled job) and returns compact JSON. No tool can
  write business data.
- System prompt: a careful, sceptical chartered accountant for an Azerbaijani trading company (AZN,
  VAT 18%), double-entry, never invents numbers, cites finding ids and document numbers for every
  claim, separates "error" from "suspicious" from "probably fine", proposes the correct fix in
  accounting terms (e.g. reversal entry + correct entry, never deletion) but never performs it,
  and writes in the admin's UI language (az/en/ru).
- Daily report: new and still-open findings, ranked by risk and money at stake, likely cause,
  recommended action, plus anomalies the fixed rules miss (unusual partners, margins, cash patterns)
  from aggregated data. Monthly report: trial balance sanity, receivables/payables ageing, cash
  movements, margins, period-close readiness. Saved to guard_reports (body Markdown, summary JSON,
  model, tokens, cost). Suggested false positives are stored as suggestions on the finding; only an
  admin can confirm.
- "Ask the accountant" in the finding drawer and on the Reports tab: a chat bound to the guard
  tools, saved in ai_conversations.
- Scheduled run: POST /api/guard/agent (route handler, read the Next 16 route docs) with header
  Authorization: Bearer GUARD_CRON_SECRET (env, compared in constant time, never logged); 401
  otherwise. New workflow .github/workflows/accounting-guard.yml like tenant-usage.yml: daily 23:00 UTC,
  monthly on day 1, only on main, only when repository variable ACCOUNTING_GUARD_AI_ENABLED is
  'true', secret GUARD_CRON_SECRET and ERP base URL from secrets. A new report notifies admins (bell).
- Migration only if guard_reports needs columns GUARD-1 did not create (prefix checked first).

Tests: tools refuse writes and non-admins; route refuses a wrong secret; report rendering; a mocked
Claude client test of the report flow (no real API call in CI). Run npm run lint, npm test,
npm run build. PR description: env vars and GitHub secrets/variables Del must set (names only,
never values), expected monthly AI cost estimate, how to switch it off.
```
