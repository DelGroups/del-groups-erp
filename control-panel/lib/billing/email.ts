/**
 * Billing emails (prompt 13): the text of each step in the tenant's language, and the sender.
 *
 * Every email is first written to billing_emails (once per invoice and step, see run.ts), so
 * the panel shows what was or would have been sent. Delivery is optional: without
 * BILLING_EMAIL_API_KEY / BILLING_EMAIL_FROM the row is marked "skipped" and nothing leaves.
 * The sender speaks the Resend-style HTTP API (POST {from, to, subject, text, html,
 * attachments[{filename, content(base64)}]} with a Bearer key); BILLING_EMAIL_API_URL points it
 * at another compatible service. Server only.
 */
import { MESSAGES, translate, type Locale } from "../i18n/messages.ts";
import { bankTransferLines, type BankDetails } from "./providers/manualBankTransfer.ts";
import { formatDocDate, formatDocMoney } from "./docFormat.ts";

export const EMAIL_KINDS = [
  "invoice_issued",
  "payment_received",
  "payment_failed",
  "past_due",
  "read_only",
  "suspended",
  "reactivated",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface EmailSender {
  /** Missing settings; empty when emails are delivered. */
  readonly missing: readonly string[];
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export interface EmailContext {
  language: Locale;
  company: string;
  seller: string;
  number: string;
  amount: number;
  currency: string;
  /** ISO dates */
  dueDate: string | null;
  readOnlyOn?: string | null;
  suspendOn?: string | null;
  daysOverdue?: number;
  /** Bank details for "pay by bank transfer" (invoice and dunning emails). */
  bank?: BankDetails | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PAY_STEPS = new Set<EmailKind>(["invoice_issued", "payment_failed", "past_due", "read_only", "suspended"]);

export function billingEmail(kind: EmailKind, ctx: EmailContext): { subject: string; text: string; html: string } {
  const messages = MESSAGES[ctx.language] ?? MESSAGES.az;
  const tr = (key: string, vars?: Record<string, string | number>) => translate(messages, `billingEmail.${key}`, vars);
  const vars = {
    company: ctx.company,
    seller: ctx.seller,
    number: ctx.number,
    amount: formatDocMoney(ctx.amount, ctx.currency),
    due: formatDocDate(ctx.dueDate),
    readOnlyOn: formatDocDate(ctx.readOnlyOn),
    suspendOn: formatDocDate(ctx.suspendOn),
    days: ctx.daysOverdue ?? 0,
  };
  const subject = tr(`${kind}.subject`, vars);
  const body = tr(`${kind}.body`, vars);
  const bank = PAY_STEPS.has(kind) && ctx.bank ? bankTransferLines(ctx.bank, ctx.number) : [];
  const bankRows = bank.length > 1 ? bank.map((r) => [translate(messages, `invoiceDoc.bank.${r.label}`), r.value] as const) : [];

  const text = [
    tr("greeting", vars),
    "",
    body,
    ...(bankRows.length ? ["", tr("payWith"), ...bankRows.map(([l, v]) => `${l}: ${v}`)] : []),
    "",
    tr("closing", vars),
  ].join("\n");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1c2129">`,
    `<p>${escapeHtml(tr("greeting", vars))}</p>`,
    `<p>${escapeHtml(body)}</p>`,
    bankRows.length
      ? `<p><strong>${escapeHtml(tr("payWith"))}</strong></p><table style="border-collapse:collapse">${bankRows
          .map(([l, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#6b7280">${escapeHtml(l)}</td><td>${escapeHtml(v)}</td></tr>`)
          .join("")}</table>`
      : "",
    `<p>${escapeHtml(tr("closing", vars)).replace(/\n/g, "<br>")}</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

const EMAIL_ENV = ["BILLING_EMAIL_API_KEY", "BILLING_EMAIL_FROM"] as const;
const DEFAULT_API_URL = "https://api.resend.com/emails";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function emailSenderFromEnv(env: Readonly<Record<string, string | undefined>>, fetchImpl: Fetch): EmailSender {
  const key = (env.BILLING_EMAIL_API_KEY ?? "").trim();
  const from = (env.BILLING_EMAIL_FROM ?? "").trim();
  const url = (env.BILLING_EMAIL_API_URL ?? "").trim() || DEFAULT_API_URL;
  const missing = EMAIL_ENV.filter((k) => !(env[k] ?? "").trim());
  return {
    missing,
    async send(message) {
      if (missing.length) throw new Error(`email not configured: set ${missing.join(", ")}`);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: (message.attachments ?? []).map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content).toString("base64"),
          })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) throw new Error(`email API HTTP ${response.status}${body.message ? `: ${body.message}` : ""}`);
      return { id: typeof body.id === "string" ? body.id : null };
    },
  };
}

/** For tests and the local rehearsal: keeps what would have been sent. */
export function memoryEmailSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    missing: [],
    sent,
    async send(message) {
      sent.push(message);
      return { id: `mem-${sent.length}` };
    },
  };
}
