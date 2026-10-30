"use server";

import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { canViewFinancials } from "@/lib/auth/permissionMatrix";
import { isNewImportsEnabled } from "@/lib/features/newImports";
import { IMPORTS_CONFIG_KEY, parseImportsConfig } from "@/lib/imports/config";
import { fetchProfileDisplayNames, type ProfileNamesClient } from "@/lib/profiles/displayNames";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { PermissionKey } from "@/types/database.types";
import { costPayload, parsePostingError } from "../lib/posting";
import { isUuid, parseShipmentDraft, type CostLineDraft } from "../lib/shipment";
import { shipmentFromRows } from "../lib/rows";

/**
 * IMP-2 server actions: posting (confirm, receive, costs after confirmation, pay, close, reopen,
 * cancel) and the shipment's payables, receipts and journal. The posting functions run with the
 * user's session (each checks imports.approve / imports.manage and periods itself, and records
 * the user); the reads use the service role after the same checks as IMP-1. Errors are i18n keys
 * (importPosting.errors.<code>) with the database's detail text.
 */

export type PostingResult<T = void> = { success: true; data: T } | { success: false; error: string; detail?: string };

type Row = Record<string, unknown>;
type Query = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  select: (columns?: string) => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, values: readonly unknown[]) => Query;
  like: (column: string, pattern: string) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  maybeSingle: () => Query;
};
type Client = { from: (table: string) => Query; rpc: (fn: string, args?: Row) => Query };

async function guard(permission: PermissionKey) {
  if (!isNewImportsEnabled()) throw new ActionAuthError("imports.errors.disabled");
  const ctx = await requirePermissionAction(permission, { module: "imports" });
  if (!canViewFinancials(ctx.profile)) throw new ActionAuthError("imports.errors.financialsRequired");
  return ctx;
}

function fail(err: unknown): { success: false; error: string; detail?: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message.startsWith("imports.") ? err.message : "imports.errors.forbidden" };
  console.error("[imports posting]", err);
  return { success: false, error: "imports.errors.failed" };
}

/** Calls a posting function as the signed-in user. */
async function rpc(fn: string, args: Row): Promise<PostingResult<Row>> {
  const client = (await createSupabaseServerClient()) as unknown as Client;
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const { code, detail } = parsePostingError(error.message);
    return { success: false, error: code ? `importPosting.errors.${code}` : "imports.errors.failed", detail };
  }
  return { success: true, data: (data as Row) ?? {} };
}

const key = (k: unknown) => (typeof k === "string" && k.length >= 8 && k.length <= 200 ? k : null);
const date = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

async function rows(q: Query): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Row[] | null) ?? [];
}

// ── Posting ─────────────────────────────────────────────────────────────────

export async function confirmShipmentAction(id: string, onDate: string | null, idempotencyKey: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_approve_imports");
    if (!isUuid(id)) return { success: false, error: "imports.errors.notFound" };
    return await rpc("confirm_import_shipment", { p_id: id, p_date: date(onDate), p_idempotency_key: key(idempotencyKey) });
  } catch (err) {
    return fail(err);
  }
}

export interface ReceivePayloadLine {
  shipment_line_id: string;
  warehouse_id: string;
  qty_stock_unit: number;
  expected_qty_stock_unit: number;
}

export async function receiveShipmentAction(id: string, lines: ReceivePayloadLine[], onDate: string | null, note: string | null, idempotencyKey: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_approve_imports");
    if (!isUuid(id) || !Array.isArray(lines)) return { success: false, error: "imports.errors.invalid" };
    const clean = lines
      .slice(0, 500)
      .filter((l) => isUuid(l?.shipment_line_id) && isUuid(l?.warehouse_id) && Number(l?.qty_stock_unit) > 0)
      .map((l) => ({ shipment_line_id: l.shipment_line_id, warehouse_id: l.warehouse_id, qty_stock_unit: Number(l.qty_stock_unit), expected_qty_stock_unit: Number(l.expected_qty_stock_unit) || null }));
    return await rpc("receive_import_shipment", {
      p_id: id,
      p_lines: clean,
      p_date: date(onDate),
      p_note: typeof note === "string" ? note.slice(0, 1000) : null,
      p_idempotency_key: key(idempotencyKey),
    });
  } catch (err) {
    return fail(err);
  }
}

/** Reads the stored shipment and the tenant's settings, to split a new or settled cost. */
async function draftAndConfig(id: string) {
  const admin = (await createSupabaseAdminClient()) as unknown as Client;
  const { data: header } = await admin.from("import_shipments").select("*").eq("id", id).maybeSingle();
  if (!header) return null;
  const [lines, costs, settings] = await Promise.all([
    rows(admin.from("import_shipment_lines").select("*").eq("shipment_id", id).order("position")),
    rows(admin.from("import_cost_lines").select("*").eq("shipment_id", id).order("position")),
    admin.from("system_settings").select("value").eq("key", IMPORTS_CONFIG_KEY).maybeSingle(),
  ]);
  const costIds = costs.map((c) => c.id);
  const allocations = costIds.length ? await rows(admin.from("import_cost_allocations").select("*").in("cost_line_id", costIds)) : [];
  return {
    draft: shipmentFromRows(header as Row, lines, costs, allocations, true),
    config: parseImportsConfig((settings.data as { value?: unknown } | null)?.value),
  };
}

export interface PaySplitInput {
  account_id: string;
  amount: number;
}

const cleanSplits = (splits: unknown): PaySplitInput[] | null =>
  Array.isArray(splits)
    ? splits.slice(0, 20).filter((s) => isUuid(s?.account_id) && Number(s?.amount) > 0).map((s) => ({ account_id: s.account_id, amount: Math.round(Number(s.amount) * 100) / 100 }))
    : null;

/** A cost added after confirmation; split here with the shipment's other costs. */
export async function addCostAction(shipmentId: string, costInput: unknown, splits: unknown, onDate: string | null, idempotencyKey: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_manage_imports");
    if (!isUuid(shipmentId)) return { success: false, error: "imports.errors.notFound" };
    const loaded = await draftAndConfig(shipmentId);
    if (!loaded) return { success: false, error: "imports.errors.notFound" };
    const cost = parseShipmentDraft({ costs: [costInput] }).costs[0] as CostLineDraft;
    const paid = cleanSplits(splits);
    return await rpc("add_import_cost", {
      p_shipment_id: shipmentId,
      p_cost: costPayload(loaded.draft, loaded.config, cost),
      p_splits: paid && paid.length ? paid : null,
      p_date: date(onDate),
      p_idempotency_key: key(idempotencyKey),
    });
  } catch (err) {
    return fail(err);
  }
}

/** An estimate becomes the actual amount (amount, currency, rate, VAT). */
export async function finalizeCostAction(shipmentId: string, costLineId: string, actual: unknown, onDate: string | null, idempotencyKey: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_manage_imports");
    if (!isUuid(shipmentId) || !isUuid(costLineId)) return { success: false, error: "imports.errors.notFound" };
    const loaded = await draftAndConfig(shipmentId);
    const current = loaded?.draft.costs.find((c) => c.key === costLineId);
    if (!loaded || !current) return { success: false, error: "imports.errors.notFound" };
    const a = (actual && typeof actual === "object" ? actual : {}) as Record<string, unknown>;
    const settled = parseShipmentDraft({
      costs: [{ ...current, amount: a.amount ?? current.amount, currencyCode: a.currencyCode ?? current.currencyCode, rateToAzn: a.rateToAzn ?? current.rateToAzn, vatAmountAzn: a.vatAmountAzn ?? current.vatAmountAzn, isEstimate: false, key: current.key }],
    }).costs[0];
    const payload = costPayload(loaded.draft, loaded.config, settled);
    return await rpc("finalize_import_cost", {
      p_cost_line_id: costLineId,
      p_actual: { amount: payload.amount, currency_code: payload.currency_code, rate_to_azn: payload.rate_to_azn, vat_amount_azn: payload.vat_amount_azn, allocations: payload.allocations },
      p_date: date(onDate),
      p_idempotency_key: key(idempotencyKey),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function payPayableAction(payableId: string, onDate: string | null, note: string | null, splits: unknown, idempotencyKey: string, amountFc?: number | null, rate?: number | null): Promise<PostingResult<Row>> {
  try {
    await guard("can_manage_imports");
    if (!isUuid(payableId)) return { success: false, error: "imports.errors.notFound" };
    const paid = cleanSplits(splits);
    if (!paid || !paid.length) return { success: false, error: "importPosting.errors.splits_required" };
    return await rpc("pay_import_payable", {
      p_payable_id: payableId,
      p_payment_date: date(onDate),
      p_note: typeof note === "string" ? note.slice(0, 500) : null,
      p_splits: paid,
      p_idempotency_key: key(idempotencyKey),
      // IMP-3: a foreign-currency payable needs the amount in its currency and the payment-date rate.
      p_amount_fc: Number(amountFc) > 0 ? Number(amountFc) : null,
      p_rate: Number(rate) > 0 ? Number(rate) : null,
    });
  } catch (err) {
    return fail(err);
  }
}

/** IMP-3: a supplier prepayment while the shipment is a draft (amount in its currency, rate). */
export async function prepayAction(shipmentId: string, onDate: string | null, note: string | null, amountFc: number, rate: number, splits: unknown, idempotencyKey: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_manage_imports");
    if (!isUuid(shipmentId)) return { success: false, error: "imports.errors.notFound" };
    const paid = cleanSplits(splits);
    if (!paid || !paid.length) return { success: false, error: "importPosting.errors.splits_required" };
    return await rpc("prepay_import_supplier", {
      p_shipment_id: shipmentId,
      p_payment_date: date(onDate),
      p_note: typeof note === "string" ? note.slice(0, 500) : null,
      p_amount_fc: Number(amountFc) || 0,
      p_rate: Number(rate) || 0,
      p_splits: paid,
      p_idempotency_key: key(idempotencyKey),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function closeShipmentAction(id: string, idempotencyKey: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_approve_imports");
    return await rpc("close_import_shipment", { p_id: id, p_idempotency_key: key(idempotencyKey) });
  } catch (err) {
    return fail(err);
  }
}

export async function reopenShipmentAction(id: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_approve_imports");
    return await rpc("reopen_import_shipment", { p_id: id });
  } catch (err) {
    return fail(err);
  }
}

export async function cancelShipmentAction(id: string, reason: string, idempotencyKey: string): Promise<PostingResult<Row>> {
  try {
    await guard("can_approve_imports");
    return await rpc("cancel_import_shipment", { p_id: id, p_reason: String(reason ?? "").slice(0, 500), p_idempotency_key: key(idempotencyKey) });
  } catch (err) {
    return fail(err);
  }
}

// ── What a shipment posted ──────────────────────────────────────────────────

export interface PayableView {
  id: string;
  partnerId: string;
  partnerName: string;
  source: "goods" | "cost";
  costLineId: string | null;
  costType: string | null;
  documentDate: string;
  currencyCode: string;
  amountFc: number;
  bookingRate: number;
  amountAzn: number;
  paidAzn: number;
  openAzn: number;
  /** IMP-3: the running balance in the payable's currency. */
  paidFc: number;
  openFc: number;
  status: "open" | "paid" | "cancelled";
}

export interface PrepaymentView {
  id: string;
  paymentDate: string;
  currencyCode: string;
  amountFc: number;
  rate: number;
  amountAzn: number;
  status: "open" | "applied" | "cancelled";
  note: string | null;
}

export interface ReceiptView {
  id: string;
  number: string;
  receiptDate: string;
  note: string | null;
  createdByName: string | null;
  lines: { id: string; shipmentLineId: string; warehouseId: string; qtyStockUnit: number; expectedQtyStockUnit: number | null; valueAzn: number }[];
}

export interface JournalLineView {
  code: string;
  name: string;
  debit: number;
  credit: number;
  memo: string | null;
  partnerName: string | null;
}

export interface JournalEntryView {
  id: string;
  entryNo: string;
  entryDate: string;
  documentType: string;
  description: string | null;
  reversalOf: string | null;
  reversedBy: string | null;
  lines: JournalLineView[];
}

export interface PostingView {
  payables: PayableView[];
  payments: {
    id: string;
    payableId: string;
    paymentDate: string;
    amountAzn: number;
    note: string | null;
    currencyCode: string | null;
    amountFc: number | null;
    paymentRate: number | null;
    fxDifferenceAzn: number;
    splits: { accountId: string; amountAzn: number }[];
  }[];
  prepayments: PrepaymentView[];
  receipts: ReceiptView[];
  journal: JournalEntryView[];
  transitBalance: number;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function getPostingViewAction(shipmentId: string): Promise<PostingResult<PostingView>> {
  try {
    await guard("can_view_imports");
    if (!isUuid(shipmentId)) return { success: false, error: "imports.errors.notFound" };
    const admin = (await createSupabaseAdminClient()) as unknown as Client;
    const [payables, payments, receipts, entries, costs, transit, prepayments] = await Promise.all([
      rows(admin.from("import_payables").select("*").eq("shipment_id", shipmentId).order("created_at")),
      rows(admin.from("import_payments").select("*").eq("shipment_id", shipmentId).order("payment_date")),
      rows(admin.from("import_receipts").select("*").eq("shipment_id", shipmentId).order("created_at")),
      rows(admin.from("journal_entries").select("id, entry_no, entry_date, document_type, description, reversal_of, reversed_by, posted_at").eq("document_id", shipmentId).like("document_type", "import_%").order("posted_at")),
      rows(admin.from("import_cost_lines").select("id, cost_type").eq("shipment_id", shipmentId)),
      admin.rpc("import_shipment_transit_balance", { p_shipment_id: shipmentId }),
      rows(admin.from("import_prepayments").select("*").eq("shipment_id", shipmentId).order("payment_date")),
    ]);
    const paymentIds = payments.map((p) => p.id);
    const receiptIds = receipts.map((r) => r.id);
    const entryIds = entries.map((e) => e.id);
    const [splits, receiptLines, journalLines] = await Promise.all([
      paymentIds.length ? rows(admin.from("import_payment_splits").select("*").in("payment_id", paymentIds)) : Promise.resolve([] as Row[]),
      receiptIds.length ? rows(admin.from("import_receipt_lines").select("*").in("receipt_id", receiptIds)) : Promise.resolve([] as Row[]),
      entryIds.length ? rows(admin.from("journal_entry_lines").select("journal_entry_id, coa_id, debit, credit, line_memo, partner_id").in("journal_entry_id", entryIds)) : Promise.resolve([] as Row[]),
    ]);
    const coaIds = [...new Set(journalLines.map((l) => l.coa_id).filter(isUuid))];
    const partnerIds = [...new Set(journalLines.map((l) => l.partner_id).filter(isUuid))];
    const supplierIds = [...new Set(payables.map((p) => p.partner_id).filter(isUuid))];
    const [coa, partners, suppliers] = await Promise.all([
      coaIds.length ? rows(admin.from("chart_of_accounts").select("id, code, name").in("id", coaIds)) : Promise.resolve([] as Row[]),
      partnerIds.length ? rows(admin.from("partners").select("id, name").in("id", partnerIds)) : Promise.resolve([] as Row[]),
      supplierIds.length ? rows(admin.from("suppliers").select("id, full_name, company_name").in("id", supplierIds)) : Promise.resolve([] as Row[]),
    ]);
    const creators = [...new Set(receipts.map((r) => r.created_by).filter(isUuid))];
    const names = creators.length ? await fetchProfileDisplayNames(admin as unknown as ProfileNamesClient, creators) : new Map<string, string>();
    const coaById = new Map(coa.map((c) => [String(c.id), c]));
    const partnerName = new Map(partners.map((p) => [String(p.id), String(p.name ?? "")]));
    const supplierName = new Map(suppliers.map((s) => [String(s.id), String(s.company_name || s.full_name || "")]));
    const costType = new Map(costs.map((c) => [String(c.id), String(c.cost_type)]));

    return {
      success: true,
      data: {
        payables: payables.map((p) => {
          const amount = num(p.amount_azn);
          const paid = num(p.paid_azn);
          return {
            id: String(p.id),
            partnerId: String(p.partner_id),
            partnerName: supplierName.get(String(p.partner_id)) ?? "",
            source: p.source === "cost" ? "cost" : "goods",
            costLineId: isUuid(p.cost_line_id) ? p.cost_line_id : null,
            costType: isUuid(p.cost_line_id) ? costType.get(p.cost_line_id) ?? null : null,
            documentDate: String(p.document_date),
            currencyCode: String(p.currency_code),
            amountFc: num(p.amount_fc),
            bookingRate: num(p.booking_rate),
            amountAzn: amount,
            paidAzn: paid,
            openAzn: Math.round((amount - paid) * 100) / 100,
            paidFc: num(p.paid_fc),
            openFc: Math.round((num(p.amount_fc) - num(p.paid_fc)) * 100) / 100,
            status: p.status === "paid" || p.status === "cancelled" ? p.status : "open",
          } satisfies PayableView;
        }),
        payments: payments.map((p) => ({
          id: String(p.id),
          payableId: String(p.payable_id),
          paymentDate: String(p.payment_date),
          amountAzn: num(p.amount_azn),
          note: (p.note as string | null) ?? null,
          currencyCode: (p.currency_code as string | null) ?? null,
          amountFc: p.amount_fc === null || p.amount_fc === undefined ? null : num(p.amount_fc),
          paymentRate: p.payment_rate === null || p.payment_rate === undefined ? null : num(p.payment_rate),
          fxDifferenceAzn: num(p.fx_difference_azn),
          splits: splits.filter((s) => s.payment_id === p.id).map((s) => ({ accountId: String(s.account_id), amountAzn: num(s.amount_azn) })),
        })),
        receipts: receipts.map((r) => ({
          id: String(r.id),
          number: String(r.number),
          receiptDate: String(r.receipt_date),
          note: (r.note as string | null) ?? null,
          createdByName: isUuid(r.created_by) ? names.get(r.created_by) ?? null : null,
          lines: receiptLines
            .filter((l) => l.receipt_id === r.id)
            .map((l) => ({
              id: String(l.id),
              shipmentLineId: String(l.shipment_line_id),
              warehouseId: String(l.warehouse_id),
              qtyStockUnit: num(l.qty_stock_unit),
              expectedQtyStockUnit: l.expected_qty_stock_unit === null || l.expected_qty_stock_unit === undefined ? null : num(l.expected_qty_stock_unit),
              valueAzn: num(l.value_azn),
            })),
        })),
        journal: entries.map((e) => ({
          id: String(e.id),
          entryNo: String(e.entry_no),
          entryDate: String(e.entry_date),
          documentType: String(e.document_type),
          description: (e.description as string | null) ?? null,
          reversalOf: isUuid(e.reversal_of) ? e.reversal_of : null,
          reversedBy: isUuid(e.reversed_by) ? e.reversed_by : null,
          lines: journalLines
            .filter((l) => l.journal_entry_id === e.id)
            .map((l) => {
              const c = coaById.get(String(l.coa_id));
              return {
                code: String(c?.code ?? ""),
                name: String(c?.name ?? ""),
                debit: num(l.debit),
                credit: num(l.credit),
                memo: (l.line_memo as string | null) ?? null,
                partnerName: isUuid(l.partner_id) ? partnerName.get(l.partner_id) ?? null : null,
              };
            })
            .sort((a, b) => b.debit - a.debit),
        })),
        transitBalance: num((transit as { data?: unknown }).data),
        prepayments: prepayments.map((p) => ({
          id: String(p.id),
          paymentDate: String(p.payment_date),
          currencyCode: String(p.currency_code),
          amountFc: num(p.amount_fc),
          rate: num(p.rate),
          amountAzn: num(p.amount_azn),
          status: p.status === "applied" || p.status === "cancelled" ? p.status : "open",
          note: (p.note as string | null) ?? null,
        })),
      },
    };
  } catch (err) {
    return fail(err);
  }
}
