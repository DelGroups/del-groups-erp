import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchActiveExpenseCategoryOptions } from "@/lib/finance/financialCategories";
import {
  askBack,
  canonicalJson,
  checkCustomerArgs,
  checkDocumentArgs,
  checkExpenseArgs,
  computeLine,
  documentTotals,
  pickOne,
  PROPOSAL_PERMISSION,
  PROPOSAL_TOOL_KIND,
  round2,
  searchTerm,
  WAITING_FOR_USER,
  type ProposalCard,
  type ProposalKind,
  type ProposalLine,
  type ProposalPayload,
} from "@/lib/assistant/proposals";

/**
 * Runs a proposal tool (AST-4). Every lookup uses the user's OWN client (RLS: they match only records they
 * can see); the proposal is stored by the server client, because users cannot write proposals themselves
 * (so nobody can forge one). The card goes to the panel; the model only hears "waiting for the user".
 */

type ToolOut = { content: string; isError: boolean; links: Array<{ label: string; href: string }> };
type Row = Record<string, unknown>;

export interface ProposalContext {
  /** The user's own client. */
  db: SupabaseClient;
  /** The server client: only to store the proposal. */
  admin: SupabaseClient;
  userId: string;
  conversationId: string | null;
  can: (permission: string) => boolean;
  today: string;
  confirmLimit: number;
  onProposal: (card: ProposalCard) => void;
}

const ask = (content: string): ToolOut => ({ content, isError: false, links: [] });
const fail = (content: string): ToolOut => ({ content, isError: true, links: [] });

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

async function search(db: SupabaseClient, table: string, columns: string, fields: string[], name: string): Promise<Row[]> {
  const term = searchTerm(name);
  if (!term) return [];
  const { data, error } = await db.from(table).select(columns).or(fields.map((f) => `${f}.ilike.%${term}%`).join(",")).limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row[];
}

async function resolveLines(db: SupabaseClient, lines: Array<{ product: string; quantity: number; price: number | null; discount_percent: number; vat_rate: number }>): Promise<ProposalLine[] | string> {
  const out: ProposalLine[] = [];
  for (const l of lines) {
    const rows = await search(db, "products", "id, name, code, unit, sell_price, buy_price", ["name", "code", "barcode"], l.product);
    const m = pickOne(rows, l.product, (r) => [r.name as string, r.code as string]);
    if (m.status !== "one") return askBack("product", l.product, m);
    const p = m.row;
    out.push(
      computeLine({
        product_id: String(p.id),
        product_code: (p.code as string | null) ?? null,
        product_name: String(p.name ?? l.product),
        unit: String(p.unit ?? "Ədəd"),
        quantity: l.quantity,
        unit_price: round2(l.price ?? Number(p.sell_price ?? 0)),
        discount_percent: l.discount_percent,
        vat_rate: l.vat_rate,
      })
    );
  }
  return out;
}

async function resolveWarehouse(db: SupabaseClient, name: string, required: boolean): Promise<{ id: string; name: string } | null | string> {
  if (name) {
    const rows = await search(db, "warehouses", "id, name, code, is_default", ["name", "code"], name);
    const m = pickOne(rows, name, (r) => [r.name as string, r.code as string]);
    if (m.status !== "one") return askBack("warehouse", name, m);
    return { id: String(m.row.id), name: String(m.row.name) };
  }
  if (!required) return null;
  const { data } = await db.from("warehouses").select("id, name, is_default").limit(50);
  const rows = (data ?? []) as Row[];
  const pick = rows.find((r) => r.is_default === true) ?? (rows.length === 1 ? rows[0] : null);
  if (!pick) return "Which warehouse do the goods go to? Ask the user.";
  return { id: String(pick.id), name: String(pick.name) };
}

async function build(kind: ProposalKind, args: Record<string, unknown>, ctx: ProposalContext): Promise<{ payload: ProposalPayload; summary: string; amount: number } | string> {
  if (kind === "sale_draft" || kind === "purchase_draft") {
    const partnerKey = kind === "sale_draft" ? "customer" : "supplier";
    const check = checkDocumentArgs(args, partnerKey, ctx.today);
    if (!check.ok) return check.error;
    const a = check.value;
    const table = kind === "sale_draft" ? "customers" : "suppliers";
    const partners = await search(ctx.db, table, "id, full_name, company_name, code", ["full_name", "company_name", "code"], a.partner);
    const pm = pickOne(partners, a.partner, (r) => [r.full_name as string, r.company_name as string, r.code as string]);
    if (pm.status !== "one") return askBack(partnerKey, a.partner, pm);
    const lines = await resolveLines(ctx.db, a.lines);
    if (typeof lines === "string") return lines;
    const wh = await resolveWarehouse(ctx.db, a.warehouse, kind === "purchase_draft");
    if (typeof wh === "string") return wh;
    const totals = documentTotals(lines);
    const partnerName = String(pm.row.full_name || pm.row.company_name || a.partner);
    if (kind === "sale_draft") {
      return {
        payload: { customer_id: String(pm.row.id), customer_name: partnerName, doc_date: a.date, warehouse_id: wh?.id ?? null, warehouse_name: wh?.name ?? null, note: a.note, lines, ...totals },
        summary: `Sale draft for ${partnerName}, ${lines.length} line(s), ${totals.total.toFixed(2)} AZN`,
        amount: totals.total,
      };
    }
    return {
      payload: { supplier_id: String(pm.row.id), supplier_name: partnerName, doc_date: a.date, warehouse_id: (wh as { id: string }).id, warehouse_name: (wh as { name: string }).name, note: a.note, lines, ...totals },
      summary: `Purchase draft from ${partnerName}, ${lines.length} line(s), ${totals.total.toFixed(2)} AZN`,
      amount: totals.total,
    };
  }
  if (kind === "customer") {
    const check = checkCustomerArgs(args);
    if (!check.ok) return check.error;
    const existing = await search(ctx.db, "customers", "id, full_name, company_name, code", ["full_name", "company_name"], check.value.full_name);
    const same = existing.find((r) => String(r.full_name ?? "").trim().toLowerCase() === check.value.full_name.toLowerCase());
    if (same) return `A customer named "${check.value.full_name}" already exists (${same.code ?? same.id}). Tell the user instead of creating a duplicate.`;
    return { payload: check.value, summary: `New customer ${check.value.full_name}`, amount: 0 };
  }
  const check = checkExpenseArgs(args, ctx.today);
  if (!check.ok) return check.error;
  const a = check.value;
  const categories = await fetchActiveExpenseCategoryOptions(ctx.db as never);
  const filtered = categories.filter((c) => c.name.toLowerCase().includes(a.category.toLowerCase()));
  const cm = pickOne(filtered, a.category, (c) => [c.name]);
  if (cm.status !== "one") return askBack("expense category", a.category, cm);
  const vat = round2((a.amount * a.vat_rate) / 100);
  return {
    payload: { expense_date: a.date, category_id: cm.row.id, category_name: cm.row.name, net_amount: a.amount, vat_rate: a.vat_rate, vat_amount: vat, total: round2(a.amount + vat), payee: a.payee, description: a.description },
    summary: `Expense draft: ${cm.row.name}, ${round2(a.amount + vat).toFixed(2)} AZN`,
    amount: round2(a.amount + vat),
  };
}

export async function runProposalTool(name: string, args: unknown, ctx: ProposalContext): Promise<ToolOut> {
  const kind = PROPOSAL_TOOL_KIND[name];
  if (!kind) return fail(`Unknown tool: ${name}`);
  // The permission again here: the tool list was filtered, but a forged call is refused too.
  if (!ctx.can(PROPOSAL_PERMISSION[kind])) return fail("Permission denied for this user.");
  let built: Awaited<ReturnType<typeof build>>;
  try {
    built = await build(kind, (args && typeof args === "object" ? args : {}) as Record<string, unknown>, ctx);
  } catch (err) {
    return fail(`Could not prepare it: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof built === "string") return ask(built);

  const hash = payloadHash(built.payload);
  const secondConfirm = built.amount > ctx.confirmLimit;
  const { data, error } = await ctx.admin
    .from("assistant_proposals")
    .insert({
      user_id: ctx.userId,
      conversation_id: ctx.conversationId,
      kind,
      payload: built.payload,
      payload_hash: hash,
      summary: built.summary,
      amount: built.amount,
      second_confirm_required: secondConfirm,
      idempotency_key: randomUUID(),
    } as never)
    .select("id")
    .single();
  if (error || !data) return fail(`Could not store the proposal: ${error?.message ?? "no id"}`);
  ctx.onProposal({ id: String((data as { id: string }).id), kind, summary: built.summary, amount: built.amount, payload: built.payload, hash, secondConfirm, limit: ctx.confirmLimit });
  return ask(`${WAITING_FOR_USER} (${built.summary})`);
}
