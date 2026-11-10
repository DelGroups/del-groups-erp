## پرامپت GUARD-4: نظارت دائمی با pg_cron

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: make the Accounting Guard run by itself. Branch: saas/accounting-guard-schedule. Requires
GUARD-1..3. Open a PR.

Migration <unique prefix>_accounting_guard_cron.sql (suggested 20261120130000; check first):
- If the pg_cron extension is not installed, RAISE NOTICE with the steps for Del and exit without
  error (the migration must not fail on a database without pg_cron, including CI and new tenants).
- Otherwise schedule (idempotent: unschedule by name first):
  guard-incremental every 30 minutes: guard_scan(NULL,'scheduled') limited to documents and entries
  changed since the last successful run (pass p_since to each rule; rules that must see the whole
  ledger, such as A9/A10/C1, run only in the nightly job);
  guard-full nightly at 22:00 UTC (02:00 Baku): full scan with auto-resolve.
- A system_settings key 'accounting_guard' {enabled, incremental_minutes, nightly_hour_utc}; the
  scheduled job does nothing when enabled=false (default false, so merging changes nothing).
- Retention: delete auto_resolved findings and runs older than 365 days (configurable).
Rules tab gets a "Schedule" card to turn it on/off and see the next run (reads cron.job if present).
Tests: incremental scan only touches changed rows; the migration passes on a database without
pg_cron. Run npm run lint, npm test, npm run build.
PR description: exact steps for Del (enable pg_cron in Supabase dashboard, then run the SQL, then
switch it on in the Rules tab), on the test database first.
```
