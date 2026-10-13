/**
 * Daily billing run (prompt 13). See control-panel/lib/billing/run.ts.
 *
 *   npm run tenants:billing                          # every auto-billed tenant, today (UTC)
 *   npm run tenants:billing -- --local [--today YYYY-MM-DD]
 *       local Postgres rehearsal: CONTROL_PLANE_DB_URL, BILLING_LOCAL_PDF_DIR (invoice PDFs),
 *       BILLING_LOCAL_OUTBOX (a file the emails are appended to, as JSON lines)
 *
 * For each tenant whose subscription has automatic billing on (never a billing_exempt one):
 * issues the renewal invoice when due, stores its PDF and emails it, charges a saved card when
 * the provider supports it, and moves unpaid tenants through dunning (past_due → read_only →
 * suspended) or back to active, telling the ERP at once. Runs in GitHub Actions (billing
 * workflow) with CONTROL_PLANE_URL and CONTROL_PLANE_SERVICE_ROLE_KEY; emails need
 * BILLING_EMAIL_API_KEY and BILLING_EMAIL_FROM, the ERP notice ERP_TENANT_WEBHOOK_URL and
 * TENANT_WEBHOOK_SECRET, the card gateway CARD_GATEWAY_* (all optional).
 *
 * Exit code: 0 all tenants done, 1 a tenant failed (the others still ran), 2 bad settings.
 */
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBilling, type BillingDeps, type BillingSummary } from "../../control-panel/lib/billing/run.ts";
import { supabaseBillingStore } from "../../control-panel/lib/billing/billingStore.ts";
import { emailSenderFromEnv, type EmailSender } from "../../control-panel/lib/billing/email.ts";
import { renderInvoicePdf, fontDir } from "../../control-panel/lib/billing/pdf.ts";
import { providerRegistry } from "../../control-panel/lib/billing/providers/index.ts";
import { notifyErpTenantChanged } from "../../control-panel/lib/erpWebhook.ts";
import { redactSecrets } from "../../control-panel/lib/provisioning/managementApi.ts";
import { refuseHosted } from "./local.ts";
import { localBillingStore } from "./local-billing.ts";

function fail(message: string): never {
  console.error(`billing-run: ${message}`);
  process.exit(2);
}
const env = (name: string): string => (process.env[name] ?? "").trim() || fail(`${name} is not set`);
const SECRET_ENV = ["CONTROL_PLANE_SERVICE_ROLE_KEY", "BILLING_EMAIL_API_KEY", "CARD_GATEWAY_SECRET_KEY", "CARD_GATEWAY_WEBHOOK_SECRET", "TENANT_WEBHOOK_SECRET"];

function pdfRenderer() {
  const dir = fontDir(process.env, process.cwd());
  return (doc: Parameters<typeof renderInvoicePdf>[0]) => renderInvoicePdf(doc, { fontDir: dir });
}

async function remoteDeps(): Promise<BillingDeps> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(env("CONTROL_PLANE_URL"), env("CONTROL_PLANE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Parameters<typeof supabaseBillingStore>[0];
  const store = supabaseBillingStore(supabase);
  return {
    store,
    providers: providerRegistry(process.env, () => store.settings()),
    email: emailSenderFromEnv(process.env, (input, init) => fetch(input, init)),
    renderPdf: pdfRenderer(),
    notifyTenantChanged: notifyErpTenantChanged,
    onEvent: (line) => console.log(line),
    secrets: SECRET_ENV.map((k) => process.env[k] ?? ""),
  };
}

/** Appends each email to a file instead of sending it (local rehearsal). */
function fileOutbox(path: string): EmailSender {
  return {
    missing: [],
    async send(message) {
      appendFileSync(path, `${JSON.stringify({ to: message.to, subject: message.subject, attachments: (message.attachments ?? []).map((a) => a.filename) })}\n`);
      return { id: null };
    },
  };
}

function localDeps(): BillingDeps {
  const cp = env("CONTROL_PLANE_DB_URL");
  refuseHosted(cp, fail);
  const pdfDir = (process.env.BILLING_LOCAL_PDF_DIR ?? "").trim() || mkdtempSync(join(tmpdir(), "invoices-"));
  const outbox = (process.env.BILLING_LOCAL_OUTBOX ?? "").trim();
  const store = localBillingStore(cp, pdfDir);
  return {
    store,
    providers: providerRegistry({}, () => store.settings()),
    email: outbox ? fileOutbox(outbox) : emailSenderFromEnv({}, () => Promise.reject(new Error("no email in local mode"))),
    renderPdf: pdfRenderer(),
    onEvent: (line) => console.log(line),
  };
}

function report(s: BillingSummary): string {
  const lines = [
    `### Billing ${s.date}`,
    "",
    `Invoices marked overdue: ${s.overdueMarked}`,
    "",
    "| Tenant | Issued | Periods moved | Card charges | Status | Emails | Notes | Error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of s.results) {
    const cell = (v: string) => v.replace(/\|/g, "\\|");
    lines.push(
      `| ${r.slug} | ${r.issued.join(", ")} | ${r.advanced || ""} | ${r.charged.join(", ")} | ${r.statusTo ? `${r.statusFrom} → ${r.statusTo}` : r.statusFrom} | ${r.emails.map((e) => `${e.kind} (${e.status})`).join(", ")} | ${cell(r.notes.join("; "))} | ${cell(r.error ?? "")} |`
    );
  }
  if (!s.results.length) lines.push("| — | | | | | | No tenant has automatic billing on. | |");
  lines.push("", s.ok ? "Result: OK" : "Result: FAILED");
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  let today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--local") continue;
    if (args[i] === "--today" && local && /^\d{4}-\d{2}-\d{2}$/.test(args[i + 1] ?? "")) {
      today = args[++i];
      continue;
    }
    fail(`unknown option ${args[i]} (--today only with --local)`);
  }
  const deps = local ? localDeps() : await remoteDeps();
  const summary = await runBilling(deps, today);
  const text = report(summary);
  console.log(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`billing-run: ${redactSecrets(message, SECRET_ENV.map((k) => process.env[k] ?? ""))}`);
  process.exit(1);
});
