## پرامپت GUARD-3: بخش «نگهبان حسابداری»، دکمه سندهای مشکوک، اعلان و ویجت

```text
Before starting, check the list of available skills. Use every skill that fits this task.
At the end, say which skills you used, or that none fit.

Task: build the Accounting Guard section, the "Find suspicious documents" buttons, admin
notifications and a home widget. Branch: saas/accounting-guard-ui. Requires GUARD-1 and GUARD-2.
Behind ACCOUNTING_GUARD, admin only (pages 404 for others and when the flag is off). Open a PR.

Read first: node_modules/next/dist/docs/ (routing, server actions), docs/ui-standard.md (all of
part A and B), src/modules/inventory/components/StockIntegrityPage.tsx, src/components/shell/NewShell.tsx
(useNotifications / NotificationsButton), the home widget registry from PR #65, the DataGrid from UI-6.

Section /finance/guard (route + launcher entry under Finance, admin only), tabs:
1. Dashboard: health score (100 minus weighted open findings, explain the formula in a tooltip),
   open findings by severity and category, trend of the last 30 runs, top 10 open critical/high,
   last run time and a "Scan now" button.
2. Findings: DataGrid with filters (severity, category, rule, status, date range, partner, created
   by), search, column picker; row opens a drawer with details, the linked document (open
   sale/purchase/payment/journal entry in its own view), history from guard_finding_events, and
   actions Acknowledge / Resolved / False positive (reason required). Bulk acknowledge. Export the
   filtered list to Excel and PDF using the existing export helpers in src/lib/export.
3. Reports: list of guard_reports (empty until GUARD-5, then filled), view, export PDF/Excel.
   Also "Save current findings as report" (kind 'scan') for a dated snapshot.
4. Rules: enable/disable, severity, thresholds from params with validation.
5. Runs: run history with counts and errors.

Buttons: on the sales list and the purchase list (old and new UI), admin-only "Find suspicious
documents" that runs guard_scan(ARRAY['ledger','documents','cash','partners']) and opens the Findings
tab filtered to that module. In the sale/purchase document view, if open findings exist for that
document, show a small warning chip for admins that opens them.

Notifications: add guard items to the shell bell for admins: new critical/high findings since the
admin last opened the guard, and new reports. Store "last seen" per admin (small table
guard_notifications or a column, one migration only if needed, prefix checked first).
Home widget "Accounting Guard" for admins (score + open counts + link), registered like the other
widgets, hidden when the flag is off.

All strings through src/i18n (az, en, ru). Motion and Radix per the design system. Phone layout works.
Tests for score formula, filters, and permission gating. Playwright check of the pages at 1280 and
phone width with screenshots attached to the PR. Run npm run lint, npm test, npm run build.
PR description lists the UI rule ids touched.
```
