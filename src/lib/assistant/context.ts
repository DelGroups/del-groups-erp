import { isValidUuid } from "@/lib/auth/validate";

/**
 * What the user is looking at (AST-1). The browser sends `{ page, recordType, recordId }`; the server never
 * trusts a copy of the record from the browser: it reloads the record with the user's own client (RLS), and
 * an id the user cannot read simply gives no record.
 */

export interface ClientContext {
  page: string | null;
  recordType: string | null;
  recordId: string | null;
}

export interface TurnContext extends ClientContext {
  /** One short line for the prompt, e.g. "Sale SS-2026-00123 of Konik MMC, 15.11.2026, total 1 250.00 AZN". */
  summary: string | null;
}

const RECORD_TYPES = ["sale", "customer", "product", "production_order", "guard_finding"] as const;

/** Validates what the browser sent; anything odd is dropped, never passed on. */
export function parseClientContext(raw: unknown): ClientContext {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const page = typeof o.page === "string" && /^\/[A-Za-z0-9/_\-?=&.%]{0,200}$/.test(o.page) ? o.page : null;
  const recordType = typeof o.recordType === "string" && (RECORD_TYPES as readonly string[]).includes(o.recordType) ? o.recordType : null;
  const recordId = recordType && typeof o.recordId === "string" && isValidUuid(o.recordId) ? o.recordId : null;
  return { page, recordType: recordId ? recordType : null, recordId };
}

type Row = Record<string, unknown>;
export type ContextDb = {
  from: (table: string) => {
    select: (columns: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } };
  };
};

const LOADERS: Record<string, { table: string; columns: string; line: (r: Row) => string }> = {
  sale: {
    table: "sales",
    columns: "id, doc_no, invoice_number, doc_date, customer_name, status, total_amount, remaining_balance, currency",
    line: (r) =>
      `Sale ${r.doc_no ?? r.invoice_number ?? r.id} of ${r.customer_name ?? "?"}, ${r.doc_date ?? ""}, status ${r.status ?? "?"}, total ${r.total_amount ?? "?"} ${r.currency ?? ""}, unpaid ${r.remaining_balance ?? "?"}`,
  },
  customer: {
    table: "customers",
    columns: "id, full_name, name, company_name, balance",
    line: (r) => `Customer ${r.full_name ?? r.name ?? r.company_name ?? r.id}, balance ${r.balance ?? "?"}`,
  },
  product: {
    table: "products",
    columns: "id, name, code, unit, stock, sell_price",
    line: (r) => `Product ${r.name ?? r.id} (${r.code ?? "no code"}), price ${r.sell_price ?? "?"}, stock ${r.stock ?? "?"} ${r.unit ?? ""}`,
  },
  production_order: {
    table: "production_orders",
    columns: "id, order_no, status",
    line: (r) => `Production order ${r.order_no ?? r.id}, status ${r.status ?? "?"}`,
  },
  guard_finding: {
    table: "guard_findings",
    columns: "id, rule_code, severity, status, doc_no, amount",
    line: (r) => `Accounting Guard finding ${r.rule_code ?? "?"} (${r.severity ?? "?"}, ${r.status ?? "?"}) on ${r.doc_no ?? "?"}, amount ${r.amount ?? "?"}`,
  },
};

export async function loadTurnContext(db: ContextDb, ctx: ClientContext): Promise<TurnContext> {
  if (!ctx.recordType || !ctx.recordId) return { ...ctx, summary: null };
  const loader = LOADERS[ctx.recordType];
  try {
    const { data, error } = await db.from(loader.table).select(loader.columns).eq("id", ctx.recordId).maybeSingle();
    if (error || !data) return { ...ctx, recordType: null, recordId: null, summary: null };
    return { ...ctx, summary: loader.line(data as Row).replace(/\s+/g, " ").slice(0, 300) };
  } catch {
    return { ...ctx, recordType: null, recordId: null, summary: null };
  }
}
