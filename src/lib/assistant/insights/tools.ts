import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  coPurchasePairs,
  debtorsAgeing,
  dormantCustomers,
  employeeOverview,
  grossMarginByProduct,
  previousPeriod,
  priceChanges,
  salesByPeriod,
  stockCover,
  type AuditCountRow,
  type ProductRow,
  type SaleLineRow,
  type SaleRow,
  type SalesGroup,
  type WatchCountRow,
} from "./compute";

/**
 * The insights skill's tools (AST-6): read-only analysis for admins and users with
 * can_view_financial_reports. Rows come through the user's own Supabase client (RLS applies as in the
 * reports); the numbers are computed in compute.ts and returned compactly; the model writes the analysis.
 * employee_overview is for admins only.
 */

export type InsightDb = Pick<SupabaseClient, "from">;
type Out = { content: string; isError: boolean; links: Array<{ label: string; href: string }> };

const MAX_SALES = 20_000;
const PAGE = 1_000;
const MAX_CHARS = 12_000;

const iso = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const lim = (v: unknown, d = 10) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : d;
};

const RANGE = {
  date_from: { type: "string", description: "YYYY-MM-DD, inclusive. Default: 30 days before date_to." },
  date_to: { type: "string", description: "YYYY-MM-DD, inclusive. Default: today." },
} as const;
const LIMIT = { limit: { type: "integer", description: "Rows to return (1-30, default 10)." } } as const;
const schema = (properties: Record<string, unknown>): Anthropic.Tool.InputSchema => ({ type: "object", properties, required: [], additionalProperties: false });

export const INSIGHT_TOOLS: Anthropic.Tool[] = [
  {
    name: "sales_compare",
    description: "Sales of a period compared with the previous period of the same length: totals, and the top rows by customer, product or month with the change in percent.",
    input_schema: schema({ ...RANGE, group_by: { type: "string", enum: ["total", "customer", "product", "month"], description: "Default: customer." }, ...LIMIT }),
  },
  {
    name: "gross_margin",
    description: "Revenue, cost and gross margin per product for a period (FIFO cost where recorded, else estimated from the buy price). order: 'margin' (largest first) or 'margin_pct_low' (weakest first).",
    input_schema: schema({ ...RANGE, order: { type: "string", enum: ["margin", "margin_pct_low"] }, ...LIMIT }),
  },
  {
    name: "debtors_ageing",
    description: "What customers still owe on posted invoices, by age (0-30, 31-60, 61-90, over 90 days), with the overdue part and each customer's oldest invoice.",
    input_schema: schema({ ...LIMIT }),
  },
  {
    name: "stock_cover",
    description: "Days of stock left at the last 60 days' selling rate (products running out within 14 days or below their minimum) and slow movers (stock but no sale in 90 days) with their value at buy price.",
    input_schema: schema({ ...LIMIT }),
  },
  {
    name: "dormant_customers",
    description: "Customers who bought at least 3 times but nothing in the last 60 days, largest buyers first (who to call).",
    input_schema: schema({ ...LIMIT }),
  },
  {
    name: "bought_together",
    description: "Pairs of products on the same invoice at least 3 times in a period, with how often each comes with the other (for cross-selling). Default period: the last 180 days.",
    input_schema: schema({ ...RANGE, ...LIMIT }),
  },
  {
    name: "price_changes",
    description: "Average selling price and margin per product in a period against the previous period of the same length; the largest price moves first.",
    input_schema: schema({ ...RANGE, ...LIMIT }),
  },
  {
    name: "employee_overview",
    description: "Admins only. For each employee in a period (default: the last 7 days): documents created by kind, documents changed, and warnings of the active watch they fixed at least twice. Facts only; never score or rank people.",
    input_schema: schema({ ...RANGE }),
  },
];

export const INSIGHT_TOOL_NAMES = new Set(INSIGHT_TOOLS.map((t) => t.name));
export const ADMIN_ONLY_INSIGHT_TOOLS = new Set(["employee_overview"]);

/** Who may use the skill: admins, or users who may see financial reports; the tenant needs the sales module. */
export function canUseInsights(input: { isAdmin: boolean; can: (permission: string) => boolean; enabledModules: ReadonlySet<string> }): boolean {
  if (!input.enabledModules.has("sales")) return false;
  return input.isAdmin || input.can("can_view_financial_reports");
}

/** The tools this user gets (employee_overview only for admins). */
export function insightToolsFor(isAdmin: boolean): Anthropic.Tool[] {
  return INSIGHT_TOOLS.filter((t) => isAdmin || !ADMIN_ONLY_INSIGHT_TOOLS.has(t.name));
}

// ─── Reading rows (the user's own client) ───────────────────────────────────

class InsightError extends Error {}

async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, max: number): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let start = 0; start < max; start += PAGE) {
    const { data, error } = await build(start, start + PAGE - 1);
    if (error) throw new InsightError(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const SALE_COLUMNS = "id, doc_no, doc_date, due_date, customer_id, customer_name, total_amount, paid_amount, status";

export async function readSales(db: InsightDb, from: string | null, to: string | null) {
  return pages<SaleRow>((a, b) => {
    let q = db.from("sales").select(SALE_COLUMNS).eq("status", "posted");
    if (from) q = q.gte("doc_date", from);
    if (to) q = q.lte("doc_date", to);
    return q.order("doc_date", { ascending: true }).order("id", { ascending: true }).range(a, b);
  }, MAX_SALES);
}

export async function readLines(db: InsightDb, saleIds: string[]): Promise<SaleLineRow[]> {
  const out: SaleLineRow[] = [];
  let withCogs = true;
  for (let i = 0; i < saleIds.length; i += 200) {
    const chunk = saleIds.slice(i, i + 200);
    const cols: string = "sale_id, product_id, product_name, quantity, unit_price, line_total, total_price";
    type Res = { data: unknown; error: { message: string } | null };
    const read = (columns: string) => db.from("sale_items").select(columns).in("sale_id", chunk).limit(10_000) as unknown as PromiseLike<Res>;
    let res = await read(withCogs ? `${cols}, cogs_amount` : cols);
    if (res.error && withCogs && res.error.message.includes("cogs_amount")) {
      withCogs = false;
      res = await read(cols);
    }
    if (res.error) throw new InsightError(res.error.message);
    for (const r of (res.data ?? []) as unknown as Array<Record<string, unknown>>) {
      out.push({
        sale_id: String(r.sale_id),
        product_id: (r.product_id as string) ?? null,
        product_name: (r.product_name as string) ?? null,
        quantity: Number(r.quantity) || 0,
        unit_price: Number(r.unit_price) || 0,
        line_total: Number(r.line_total ?? r.total_price) || 0,
        cogs_amount: withCogs && r.cogs_amount !== undefined && r.cogs_amount !== null ? Number(r.cogs_amount) : null,
      });
    }
  }
  return out;
}

export async function readProducts(db: InsightDb): Promise<ProductRow[]> {
  const { rows } = await pages<ProductRow>((a, b) => db.from("products").select("id, code, name, unit, stock, min_stock, buy_price, sell_price").order("id").range(a, b), 20_000);
  return rows.map((p) => ({ ...p, stock: Number(p.stock) || 0 }));
}

// ─── Running a tool ─────────────────────────────────────────────────────────

function period(args: Record<string, unknown>, today: string, defaultDays: number) {
  const to = iso(args.date_to) ?? today;
  let from = iso(args.date_from) ?? addDays(to, -(defaultDays - 1));
  if (from > to) from = to;
  return { from, to };
}

const truncNote = (truncated: boolean) => (truncated ? [`Only the first ${MAX_SALES} invoices were read; narrow the period for exact totals.`] : []);

export async function runInsightTool(
  db: InsightDb,
  name: string,
  rawArgs: unknown,
  input: { today: string; isAdmin: boolean; allowed: boolean }
): Promise<Out> {
  if (!INSIGHT_TOOL_NAMES.has(name)) return { content: `Unknown tool: ${name}`, isError: true, links: [] };
  if (!input.allowed || (ADMIN_ONLY_INSIGHT_TOOLS.has(name) && !input.isAdmin)) return { content: "Permission denied for this user.", isError: true, links: [] };
  const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
  const limit = lim(args.limit);
  const today = input.today;
  try {
    let data: unknown;
    let links: Out["links"] = [];
    if (name === "sales_compare" || name === "gross_margin" || name === "price_changes" || name === "bought_together") {
      const p = period(args, today, name === "bought_together" ? 180 : 30);
      const readFrom = name === "sales_compare" || name === "price_changes" ? previousPeriod(p.from, p.to).from : p.from;
      const { rows: sales, truncated } = await readSales(db, readFrom, p.to);
      const group = (["total", "customer", "product", "month"].includes(String(args.group_by)) ? args.group_by : "customer") as SalesGroup;
      const needsLines = name !== "sales_compare" || group === "product";
      const lines = needsLines ? await readLines(db, sales.map((s) => s.id)) : [];
      const products = name === "gross_margin" || name === "price_changes" ? await readProducts(db) : [];
      if (name === "sales_compare") data = salesByPeriod({ sales, lines, from: p.from, to: p.to, group, limit });
      else if (name === "gross_margin") data = grossMarginByProduct({ sales, lines, products, from: p.from, to: p.to, limit, order: args.order === "margin_pct_low" ? "margin_pct_low" : "margin" });
      else if (name === "price_changes") data = priceChanges({ sales, lines, products, from: p.from, to: p.to, limit });
      else data = coPurchasePairs({ sales, lines, from: p.from, to: p.to, limit });
      (data as { caveats?: string[] }).caveats = [...(((data as { caveats?: string[] }).caveats) ?? []), ...truncNote(truncated)];
      links = [{ label: "Satışlar", href: "/sales" }];
    } else if (name === "debtors_ageing") {
      const { rows: sales, truncated } = await readSales(db, null, today);
      const r = debtorsAgeing({ sales: sales.filter((s) => (Number(s.total_amount) || 0) - (Number(s.paid_amount) || 0) > 0.005), today, limit });
      data = { ...r, caveats: [...r.caveats, ...truncNote(truncated)] };
      links = r.rows.slice(0, 3).flatMap((x) => (x.oldest_sale_id ? [{ label: x.oldest_doc ?? x.name, href: `/sales/${x.oldest_sale_id}` }] : []));
    } else if (name === "stock_cover") {
      const { rows: sales } = await readSales(db, addDays(today, -365), today);
      const [lines, products] = await Promise.all([readLines(db, sales.map((s) => s.id)), readProducts(db)]);
      data = stockCover({ sales, lines, products, today, limit });
      links = [{ label: "Məhsullar", href: "/products" }];
    } else if (name === "dormant_customers") {
      const { rows: sales } = await readSales(db, addDays(today, -730), today);
      data = dormantCustomers({ sales, today, limit });
      links = [{ label: "Müştərilər", href: "/customers" }];
    } else {
      const p = period(args, today, 7);
      const [audit, watch, people] = await Promise.all([
        pages<AuditCountRow>((a, b) => db.from("audit_logs").select("user_id, action, table_name, created_at").gte("created_at", `${p.from}T00:00:00`).lte("created_at", `${p.to}T23:59:59.999`).range(a, b), 50_000),
        pages<WatchCountRow>((a, b) => db.from("assistant_watch_events").select("user_id, code, action, created_at").gte("created_at", `${p.from}T00:00:00`).lte("created_at", `${p.to}T23:59:59.999`).range(a, b), 20_000).catch(() => ({ rows: [] as WatchCountRow[], truncated: false })),
        db.from("profiles").select("id, full_name, email, is_active").eq("is_active", true).limit(500),
      ]);
      const list = ((people.data ?? []) as Array<{ id: string; full_name?: string | null; email?: string | null }>).map((x) => ({ id: x.id, name: (x.full_name || x.email || "—").trim() }));
      data = employeeOverview({ audit: audit.rows, watch: watch.rows, people: list, from: p.from, to: p.to });
    }
    let content = JSON.stringify(data);
    if (content.length > MAX_CHARS) content = `${content.slice(0, MAX_CHARS)}… [truncated; ask for fewer rows]`;
    return { content, isError: false, links };
  } catch (err) {
    if (!(err instanceof InsightError)) console.warn(`[assistant] insight tool ${name}`, err);
    return { content: err instanceof InsightError ? `Query failed: ${err.message}` : "Query failed.", isError: true, links: [] };
  }
}
