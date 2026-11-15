"use client";

import { submitSale } from "@/modules/sales";
import { submitPurchase } from "@/modules/purchases";
import { saveExpenseAction } from "@/modules/expenses";
import { getSupabaseClient } from "@/lib/supabase";
import { RECORD_PARAM } from "@/views";
import {
  canonicalJson,
  claimError,
  type ExecuteError,
  type CustomerPayload,
  type ExpenseDraftPayload,
  type ProposalCard,
  type ProposalKind,
  type PurchaseDraftPayload,
  type SaleDraftPayload,
} from "@/lib/assistant/proposals";
import type { PurchaseLineItem, SaleItem } from "@/types/database.types";

/**
 * "Create draft" of a proposal card (AST-4), in the user's own browser session:
 *   1. assistant_proposal_claim with the fingerprint of what the card showed (owner, still open, 24 h,
 *      same payload, the permission again, second confirm above the limit; one claim only);
 *   2. the draft is saved with the SAME function the form uses (submitSale / submitPurchase in draft mode,
 *      the customer insert, saveExpenseAction without posting), with the payload the SERVER kept;
 *   3. assistant_proposal_finish records the result and writes the audit line "via: assistant".
 * Nothing is posted: posting stays the user's button on the document.
 */

export type { ExecuteError } from "@/lib/assistant/proposals";
export type ExecuteResult = { ok: true; id: string; docNo: string; href: string } | { ok: false; error: ExecuteError; detail?: string };

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Saved = { id: string; docNo: string; href: string } | { error: string };

async function saveSale(p: SaleDraftPayload): Promise<Saved> {
  const items = p.lines.map(
    (l) =>
      ({
        product_id: l.product_id,
        product_code: l.product_code ?? "",
        product_name: l.product_name,
        warehouse_id: p.warehouse_id,
        warehouse_name: p.warehouse_name ?? "",
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        discount_type: "percentage",
        vat_rate: l.vat_rate,
        total: l.total,
        extra_info: "",
        price_tier: "retail",
        currency: "AZN",
        exchange_rate: 1,
      }) as unknown as SaleItem
  );
  const result = await submitSale({
    header: {
      doc_no: "",
      doc_date: p.doc_date,
      customer_id: p.customer_id,
      customer_name: p.customer_name,
      warehouse_name: p.warehouse_name ?? "",
      subtotal: p.subtotal,
      discount_total: 0,
      vat_total: p.vat_total,
      total_amount: p.total,
      paid_amount: 0,
      remaining_balance: p.total,
      note: p.note,
      created_at: new Date().toISOString(),
    } as never,
    items,
    payments: [],
    docNo: "",
    mode: "draft",
  });
  if (!result.success || !result.saleId) return { error: result.error ?? "failed" };
  return { id: result.saleId, docNo: result.docNo ?? "", href: `/sales/${result.saleId}` };
}

async function savePurchase(p: PurchaseDraftPayload): Promise<Saved> {
  // The form's own next number (peek only; the database assigns the final one).
  const { data: next } = await getSupabaseClient().rpc("peek_next_purchase_doc_no" as never, { p_prefix: "AS" } as never);
  const invoiceNumber = typeof next === "string" ? next : "";
  const items = p.lines.map(
    (l) =>
      ({
        product_id: l.product_id,
        product_code: l.product_code ?? "",
        product_name: l.product_name,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        total: l.total,
        currency: "AZN",
        exchange_rate: 1,
      }) as unknown as PurchaseLineItem
  );
  const result = await submitPurchase({
    header: {
      invoice_number: invoiceNumber,
      supplier_id: p.supplier_id,
      warehouse_id: p.warehouse_id,
      doc_date: p.doc_date,
      due_date: null,
      total_amount: p.total,
      paid_amount: 0,
      debt_amount: p.total,
      status: "draft",
      notes: p.note || null,
      is_official: false,
      vat_mode: "none",
      subtotal_amount: p.subtotal,
      vat_amount: p.vat_total,
      grand_total: p.total,
    } as never,
    items,
    invoiceNumber,
    payments: [],
    mode: "draft",
  });
  if (!result.success || !result.purchaseId) return { error: result.error ?? "failed" };
  return { id: result.purchaseId, docNo: result.invoiceNumber ?? invoiceNumber, href: `/purchases?${RECORD_PARAM}=${encodeURIComponent(result.purchaseId)}` };
}

async function saveCustomer(p: CustomerPayload): Promise<Saved> {
  // The same row the sales form's "new customer" inserts.
  const { data, error } = await getSupabaseClient()
    .from("customers")
    .insert([
      {
        code: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
        full_name: p.full_name,
        name: p.full_name,
        phone: p.phone,
        company_name: p.company_name,
        address: p.address,
        voen: p.voen,
        balance: 0,
      } as never,
    ])
    .select("id, code")
    .single();
  if (error || !data) return { error: error?.message ?? "failed" };
  const row = data as { id: string; code?: string | null };
  return { id: row.id, docNo: row.code ?? p.full_name, href: "/customers" };
}

async function saveExpense(p: ExpenseDraftPayload): Promise<Saved> {
  const result = await saveExpenseAction({
    expenseDate: p.expense_date,
    categoryId: p.category_id,
    accountId: "",
    payee: p.payee,
    description: p.description,
    paymentMode: "company",
    netAmount: p.net_amount,
    vatRate: p.vat_rate,
    vatAmount: p.vat_amount,
    post: false,
    submit: false,
  } as never);
  if (!result.success || !result.data) return { error: result.success ? "failed" : result.error };
  return { id: result.data.id, docNo: result.data.code, href: `/expenses?${RECORD_PARAM}=${encodeURIComponent(result.data.id)}` };
}

const SAVERS: Record<ProposalKind, (payload: never) => Promise<Saved>> = {
  sale_draft: saveSale as (p: never) => Promise<Saved>,
  purchase_draft: savePurchase as (p: never) => Promise<Saved>,
  customer: saveCustomer as (p: never) => Promise<Saved>,
  expense_draft: saveExpense as (p: never) => Promise<Saved>,
};

export async function executeProposal(card: ProposalCard, secondConfirm: boolean): Promise<ExecuteResult> {
  const db = getSupabaseClient();
  const hash = await sha256Hex(canonicalJson(card.payload));
  const claim = await db.rpc("assistant_proposal_claim" as never, { p_id: card.id, p_hash: hash, p_second_confirm: secondConfirm } as never);
  if (claim.error) return { ok: false, error: claimError(claim.error.message), detail: claim.error.message };
  const claimed = (claim.data ?? {}) as { error?: string; kind?: ProposalKind; payload?: unknown };
  if (claimed.error === "expired") return { ok: false, error: "expired" };
  if (!claimed.kind || !claimed.payload) return { ok: false, error: "failed" };

  // The payload the server kept (the one whose fingerprint the user confirmed), never the card's copy.
  let saved: Saved;
  try {
    saved = await SAVERS[claimed.kind](claimed.payload as never);
  } catch (err) {
    saved = { error: err instanceof Error ? err.message : String(err) };
  }
  if ("error" in saved) {
    await db.rpc("assistant_proposal_finish" as never, { p_id: card.id, p_ok: false, p_result: null, p_error: saved.error } as never);
    return { ok: false, error: "failed", detail: saved.error };
  }
  await db.rpc("assistant_proposal_finish" as never, { p_id: card.id, p_ok: true, p_result: saved, p_error: null } as never);
  return { ok: true, ...saved };
}

export async function rejectProposal(id: string): Promise<boolean> {
  const { error } = await getSupabaseClient().rpc("assistant_proposal_reject" as never, { p_id: id } as never);
  return !error;
}
