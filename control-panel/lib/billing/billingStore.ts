/**
 * BillingStore (run.ts) on the control plane through a Supabase client: the signed-in admin's
 * in the panel (RLS: platform admins), or a service-role client in the daily job and the
 * payment webhook. Invoice PDFs go to the private Storage bucket "invoices".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleInfo } from "./pricing.ts";
import type { InvoiceDocument } from "./pdf.ts";
import type { BillingStore, PaymentRecorded, SettingsRow, WorkItem } from "./run.ts";
import { isLocale } from "../i18n/messages.ts";

export const INVOICE_BUCKET = "invoices";

function check<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export const INVOICE_DOCUMENT_SELECT =
  "id, number, status, currency, language, issued_at, due_date, period_start, period_end, subtotal, tax, total, amount_paid, notes, seller, buyer, invoice_lines(position, description, quantity, unit_price, amount)";

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  currency: string;
  language: string;
  issued_at: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  subtotal: number | string;
  tax: number | string;
  total: number | string;
  amount_paid: number | string;
  notes: string | null;
  seller: InvoiceDocument["seller"] | null;
  buyer: InvoiceDocument["buyer"] | null;
  invoice_lines: { position: number; description: string; quantity: number | string; unit_price: number | string; amount: number | string }[];
}

export function toInvoiceDocument(row: InvoiceRow): InvoiceDocument {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    currency: row.currency,
    language: isLocale(row.language) ? row.language : "az",
    issued_at: row.issued_at,
    due_date: row.due_date,
    period_start: row.period_start,
    period_end: row.period_end,
    subtotal: Number(row.subtotal),
    tax: Number(row.tax),
    total: Number(row.total),
    amount_paid: Number(row.amount_paid),
    notes: row.notes,
    seller: row.seller ?? {},
    buyer: row.buyer ?? {},
    lines: [...(row.invoice_lines ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price), amount: Number(l.amount) })),
  };
}

export function pdfPath(tenantId: string, number: string): string {
  return `${tenantId}/${number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
}

export function supabaseBillingStore(supabase: SupabaseClient): BillingStore {
  return {
    async settings() {
      return check(await supabase.from("billing_settings").select("*").eq("id", true).single()) as SettingsRow;
    },
    async worklist() {
      return (check(await supabase.rpc("billing_worklist")) ?? []) as WorkItem[];
    },
    async workItem(tenantId) {
      return (check(await supabase.rpc("billing_work_item", { p_tenant_id: tenantId })) ?? null) as WorkItem | null;
    },
    async catalog() {
      const rows = check(await supabase.from("modules").select("id, depends, is_core").eq("is_active", true).order("id")) as {
        id: string;
        depends: string[] | null;
        is_core: boolean;
      }[];
      return rows.map((m): ModuleInfo => ({ id: m.id, depends: m.depends ?? [], isCore: m.is_core }));
    },
    async markOverdue(today) {
      return Number(check(await supabase.rpc("mark_overdue_invoices", { p_today: today })) ?? 0);
    },
    async issueInvoice(input) {
      return check(await supabase.rpc("issue_invoice", { p: input })) as { id: string; number: string; created: boolean };
    },
    async advancePeriod(subscriptionId, fromEnd, newEnd) {
      return Boolean(
        check(await supabase.rpc("advance_subscription_period", { p_subscription_id: subscriptionId, p_from_end: fromEnd, p_new_end: newEnd }))
      );
    },
    async invoiceDocument(invoiceId) {
      return toInvoiceDocument(check(await supabase.from("invoices").select(INVOICE_DOCUMENT_SELECT).eq("id", invoiceId).single()) as InvoiceRow);
    },
    async savePdf(invoice, pdf) {
      const path = pdfPath(invoice.tenantId, invoice.number);
      check(await supabase.storage.from(INVOICE_BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: true }));
      check(await supabase.from("invoices").update({ pdf_path: path }).eq("id", invoice.id));
      return path;
    },
    async setStatus(tenantId, status) {
      return Boolean(check(await supabase.rpc("set_billing_status", { p_tenant_id: tenantId, p_status: status })));
    },
    async recordPayment(input) {
      return check(await supabase.rpc("record_payment", { p: input })) as PaymentRecorded;
    },
    async noteChargeAttempt(invoiceId) {
      const row = check(await supabase.from("invoices").select("charge_attempts").eq("id", invoiceId).single()) as { charge_attempts: number };
      check(
        await supabase
          .from("invoices")
          .update({ charge_attempts: row.charge_attempts + 1, last_charge_attempt_at: new Date().toISOString() })
          .eq("id", invoiceId)
      );
    },
    async defaultCard(tenantId, provider) {
      const method = check(
        await supabase.from("payment_methods").select("id").eq("tenant_id", tenantId).eq("provider", provider).eq("is_default", true).maybeSingle()
      ) as { id: string } | null;
      if (!method) return null;
      // Only the service role may read a token; in an admin session there is no card to charge.
      const token = await supabase.rpc("payment_method_token", { p_payment_method_id: method.id });
      return token.error || !token.data ? null : { id: method.id, token: String(token.data) };
    },
    async claimEmail(row) {
      const inserted = await supabase.from("billing_emails").insert({ ...row, status: "pending" }).select("id").single();
      if (!inserted.error) return (inserted.data as { id: string }).id;
      if (inserted.error.code !== "23505") throw new Error(inserted.error.message);
      // Already on record: send again only if the last try failed.
      const retried = check(
        await supabase
          .from("billing_emails")
          .update({ status: "pending", error: null, recipient: row.recipient, subject: row.subject })
          .eq("invoice_id", row.invoice_id as string)
          .eq("kind", row.kind)
          .eq("status", "failed")
          .select("id")
      ) as { id: string }[];
      return retried[0]?.id ?? null;
    },
    async finishEmail(id, result) {
      check(
        await supabase
          .from("billing_emails")
          .update({ ...result, sent_at: result.status === "sent" ? new Date().toISOString() : null })
          .eq("id", id)
      );
    },
  };
}
