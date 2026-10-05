import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { userHasLegacyPermission } from "@/lib/auth/permissionMatrix";
import { isCriticalStock, productMinStock } from "@/lib/inventory/safetyStock";
import { normalizeUnifiedTransactionType } from "@/lib/finance/unifiedLedger";
import { isValidUuid } from "@/lib/auth/validate";
import type { PermissionKey, UserProfile } from "@/types/database.types";

/**
 * Read-only tool registry for the native assistant.
 *
 * Every tool runs through the signed-in user's Supabase client, so RLS
 * (public.require_permission) applies exactly as in the UI, and each tool also
 * checks the matching app permission before touching the database. No tool
 * writes data; write tools arrive in a later phase with explicit confirmation.
 */

export type ToolContext = {
  client: SupabaseClient;
  profile: UserProfile | null;
};

export type ToolOutput = {
  /** JSON-serialisable payload returned to the model. */
  data: unknown;
  /** Internal links the UI may show under the answer. */
  links?: Array<{ label: string; href: string }>;
};

type ToolDef = {
  name: string;
  description: string;
  permission: PermissionKey;
  input_schema: Anthropic.Tool.InputSchema;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
};

const MAX_ROWS = 50;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function str(value: unknown, max = 80): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Strip characters that would break a PostgREST `or=` filter. */
function ilikeTerm(value: unknown): string {
  return str(value).replace(/[%_,()*\\]/g, "").trim();
}

function limitOf(value: unknown, fallback = 20): number {
  const n = Math.floor(num(value));
  if (n <= 0) return fallback;
  return Math.min(n, MAX_ROWS);
}

function isoDate(value: unknown): string | null {
  const text = str(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

class ToolError extends Error {}

function check<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new ToolError(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

type Row = Record<string, unknown>;

const TOOLS: ToolDef[] = [
  {
    name: "search_products",
    description:
      "Find products by name, code or barcode. Returns code, name, unit, stock on hand, minimum stock and prices.",
    permission: "can_view_products",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of the product name, code or barcode." },
        limit: { type: "integer", description: "Max rows (1-50, default 20)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async run(input, { client }) {
      const term = ilikeTerm(input.query);
      if (term.length < 1) throw new ToolError("query is empty");
      const rows = check<Row[]>(
        await client
          .from("products")
          .select("id, code, name, unit, stock, min_stock, sell_price, buy_price, category")
          .or(`name.ilike.%${term}%,code.ilike.%${term}%,barcode.ilike.%${term}%`)
          .order("name")
          .limit(limitOf(input.limit)),
        "products"
      );
      return {
        data: rows.map((row) => ({
          code: row.code,
          name: row.name,
          unit: row.unit,
          stock: num(row.stock),
          min_stock: num(row.min_stock),
          sell_price: num(row.sell_price),
          buy_price: num(row.buy_price),
          category: row.category,
        })),
        links: rows.slice(0, 5).map((row) => ({ label: `${row.code || ""} ${row.name || ""}`.trim(), href: "/products" })),
      };
    },
  },
  {
    name: "stock_alerts",
    description:
      "List products that are out of stock or below their minimum stock level, plus totals. Use for questions about low, critical or zero stock.",
    permission: "can_view_products",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max products listed (1-50, default 20)." },
      },
      required: [],
      additionalProperties: false,
    },
    async run(input, { client }) {
      const rows = check<Row[]>(
        await client
          .from("products")
          .select("id, code, name, stock, min_stock, min_stock_level, is_service")
          .order("name")
          .limit(2000),
        "products"
      );
      const goods = rows.filter((row) => !row.is_service);
      const critical = goods.filter((row) => isCriticalStock(row as Parameters<typeof isCriticalStock>[0]));
      const zero = goods.filter((row) => num(row.stock) <= 0);
      return {
        data: {
          products_checked: goods.length,
          zero_stock_count: zero.length,
          below_minimum_count: critical.length,
          below_minimum: critical.slice(0, limitOf(input.limit)).map((row) => ({
            code: row.code,
            name: row.name,
            stock: num(row.stock),
            min_stock: productMinStock(row as Parameters<typeof productMinStock>[0]),
          })),
        },
        links: [{ label: "Anbar", href: "/inventory" }],
      };
    },
  },
  {
    name: "search_customers",
    description: "Find customers by name, company, phone, code or VÖEN. Returns contact data and current balance (debt).",
    permission: "can_view_customers",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of the name, company, phone, code or VÖEN." },
        limit: { type: "integer", description: "Max rows (1-50, default 20)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async run(input, { client }) {
      const term = ilikeTerm(input.query);
      if (!term) throw new ToolError("query is empty");
      const rows = check<Row[]>(
        await client
          .from("customers")
          .select("id, code, full_name, name, company_name, phone, voen, balance")
          .or(
            `full_name.ilike.%${term}%,name.ilike.%${term}%,company_name.ilike.%${term}%,phone.ilike.%${term}%,code.ilike.%${term}%,voen.ilike.%${term}%`
          )
          .limit(limitOf(input.limit)),
        "customers"
      );
      return {
        data: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.full_name || row.name || row.company_name,
          company: row.company_name,
          phone: row.phone,
          voen: row.voen,
          balance: num(row.balance),
        })),
        links: [{ label: "Müştərilər", href: "/customers" }],
      };
    },
  },
  {
    name: "top_debtors",
    description: "List customers with the highest outstanding balance (receivables), largest first.",
    permission: "can_view_customers",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max rows (1-50, default 10)." },
      },
      required: [],
      additionalProperties: false,
    },
    async run(input, { client }) {
      const rows = check<Row[]>(
        await client
          .from("customers")
          .select("id, code, full_name, name, company_name, balance")
          .gt("balance", 0)
          .order("balance", { ascending: false })
          .limit(limitOf(input.limit, 10)),
        "customers"
      );
      return {
        data: rows.map((row) => ({
          code: row.code,
          name: row.full_name || row.name || row.company_name,
          balance: num(row.balance),
        })),
        links: [{ label: "Müştərilər", href: "/customers" }],
      };
    },
  },
  {
    name: "list_sales",
    description:
      "List sales invoices with optional filters (date range on doc_date, status, customer name, document number) and return the rows plus totals (amount, paid, remaining).",
    permission: "can_view_sales",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "YYYY-MM-DD, inclusive." },
        date_to: { type: "string", description: "YYYY-MM-DD, inclusive." },
        status: { type: "string", description: "Exact status value, e.g. posted, draft, cancelled." },
        customer: { type: "string", description: "Part of the customer name." },
        doc_no: { type: "string", description: "Part of the document or invoice number." },
        limit: { type: "integer", description: "Max rows listed (1-50, default 20). Totals cover up to 1000 rows." },
      },
      required: [],
      additionalProperties: false,
    },
    async run(input, { client }) {
      let query = client
        .from("sales")
        .select("id, doc_no, invoice_number, doc_date, created_at, customer_name, status, total_amount, paid_amount, remaining_balance, currency")
        .order("doc_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      const from = isoDate(input.date_from);
      const to = isoDate(input.date_to);
      if (from) query = query.gte("doc_date", from);
      if (to) query = query.lte("doc_date", to);
      if (str(input.status)) query = query.eq("status", str(input.status, 40));
      const customer = ilikeTerm(input.customer);
      if (customer) query = query.ilike("customer_name", `%${customer}%`);
      const docNo = ilikeTerm(input.doc_no);
      if (docNo) query = query.or(`doc_no.ilike.%${docNo}%,invoice_number.ilike.%${docNo}%`);
      const rows = check<Row[]>(await query, "sales");
      const totals = rows.reduce<{ total: number; paid: number; remaining: number }>(
        (acc, row) => ({
          total: acc.total + num(row.total_amount),
          paid: acc.paid + num(row.paid_amount),
          remaining: acc.remaining + num(row.remaining_balance),
        }),
        { total: 0, paid: 0, remaining: 0 }
      );
      const listed = rows.slice(0, limitOf(input.limit));
      return {
        data: {
          count: rows.length,
          totals: { total: round2(totals.total), paid: round2(totals.paid), remaining: round2(totals.remaining) },
          rows: listed.map((row) => ({
            id: row.id,
            doc_no: row.doc_no || row.invoice_number,
            date: row.doc_date || str(row.created_at, 10),
            customer: row.customer_name,
            status: row.status,
            total: num(row.total_amount),
            paid: num(row.paid_amount),
            remaining: num(row.remaining_balance),
            currency: row.currency || "AZN",
            href: isValidUuid(String(row.id)) ? `/sales/${row.id}` : "/sales",
          })),
        },
        links: listed.slice(0, 5).map((row) => ({
          label: String(row.doc_no || row.invoice_number || row.id),
          href: isValidUuid(String(row.id)) ? `/sales/${row.id}` : "/sales",
        })),
      };
    },
  },
  {
    name: "get_sale",
    description: "Get one sales invoice with its lines, by id or document number.",
    permission: "can_view_sales",
    input_schema: {
      type: "object",
      properties: {
        id_or_doc_no: { type: "string", description: "Sale UUID or document/invoice number." },
      },
      required: ["id_or_doc_no"],
      additionalProperties: false,
    },
    async run(input, { client }) {
      const key = str(input.id_or_doc_no, 60);
      if (!key) throw new ToolError("id_or_doc_no is empty");
      const base = client
        .from("sales")
        .select(
          "id, doc_no, invoice_number, doc_date, customer_name, status, subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance, currency, warehouse_name, warehouse_slip_status, note, notes"
        );
      const safe = ilikeTerm(key);
      const sales = check<Row[]>(
        await (isValidUuid(key) ? base.eq("id", key) : base.or(`doc_no.eq.${safe},invoice_number.eq.${safe}`)).limit(1),
        "sales"
      );
      const sale = sales[0];
      if (!sale) return { data: { found: false } };
      const items = check<Row[]>(
        await client
          .from("sale_items")
          .select("product_code, product_name, quantity, unit, unit_price, discount_amount, vat_amount, total_price, line_total")
          .eq("sale_id", String(sale.id))
          .limit(200),
        "sale_items"
      );
      return {
        data: {
          found: true,
          sale,
          lines: items.map((item) => ({
            code: item.product_code,
            name: item.product_name,
            quantity: num(item.quantity),
            unit: item.unit,
            unit_price: num(item.unit_price),
            discount: num(item.discount_amount),
            vat: num(item.vat_amount),
            total: num(item.line_total ?? item.total_price),
          })),
        },
        links: [{ label: String(sale.doc_no || sale.invoice_number || sale.id), href: `/sales/${sale.id}` }],
      };
    },
  },
  {
    name: "finance_summary",
    description:
      "Cash and bank account balances and income/expense totals from transactions, optionally for a date range (created_at).",
    permission: "can_view_finance",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "YYYY-MM-DD, inclusive." },
        date_to: { type: "string", description: "YYYY-MM-DD, inclusive." },
      },
      required: [],
      additionalProperties: false,
    },
    async run(input, { client }) {
      let txQuery = client.from("transactions").select("type, unified_type, amount, created_at").limit(5000);
      const from = isoDate(input.date_from);
      const to = isoDate(input.date_to);
      if (from) txQuery = txQuery.gte("created_at", `${from}T00:00:00`);
      if (to) txQuery = txQuery.lte("created_at", `${to}T23:59:59.999`);
      const [txRes, accountsRes] = await Promise.all([
        txQuery,
        client.from("accounts").select("name, type, balance").order("name").limit(60),
      ]);
      const txs = check<Row[]>(txRes, "transactions");
      const accounts = check<Row[]>(accountsRes, "accounts");
      let income = 0;
      let expense = 0;
      for (const row of txs) {
        const kind = normalizeUnifiedTransactionType(row.unified_type as string, row.type as string);
        if (kind === "INCOME") income += num(row.amount);
        if (kind === "EXPENSE") expense += num(row.amount);
      }
      return {
        data: {
          period: { from, to },
          transactions_counted: txs.length,
          income: round2(income),
          expense: round2(expense),
          net: round2(income - expense),
          accounts: accounts.map((row) => ({ name: row.name, type: row.type, balance: num(row.balance) })),
        },
        links: [{ label: "Maliyyə", href: "/finance" }],
      };
    },
  },
  {
    name: "production_orders",
    description:
      "List production orders with optional status or text filter (order no, document no, project, customer), with counts by status.",
    permission: "can_view_production",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Exact status value." },
        query: { type: "string", description: "Part of order no, document no, project or customer name." },
        limit: { type: "integer", description: "Max rows listed (1-50, default 20)." },
      },
      required: [],
      additionalProperties: false,
    },
    async run(input, { client }) {
      let query = client
        .from("production_orders")
        .select("id, order_no, document_no, project_name, customer_name, status, priority, total_project_price, total_cost, expected_delivery_date, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (str(input.status)) query = query.eq("status", str(input.status, 40));
      const term = ilikeTerm(input.query);
      if (term) {
        query = query.or(
          `order_no.ilike.%${term}%,document_no.ilike.%${term}%,project_name.ilike.%${term}%,customer_name.ilike.%${term}%`
        );
      }
      const rows = check<Row[]>(await query, "production_orders");
      const byStatus: Record<string, number> = {};
      for (const row of rows) {
        const status = String(row.status || "Draft");
        byStatus[status] = (byStatus[status] || 0) + 1;
      }
      const listed = rows.slice(0, limitOf(input.limit));
      return {
        data: {
          count: rows.length,
          by_status: byStatus,
          rows: listed.map((row) => ({
            order_no: row.order_no || row.document_no,
            project: row.project_name,
            customer: row.customer_name,
            status: row.status,
            priority: row.priority,
            price: num(row.total_project_price),
            cost: num(row.total_cost),
            expected_delivery: row.expected_delivery_date,
            href: `/production/${row.id}`,
          })),
        },
        links: listed.slice(0, 5).map((row) => ({
          label: String(row.order_no || row.document_no || row.id),
          href: `/production/${row.id}`,
        })),
      };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Tools this user may call, in a fixed order (keeps the prompt cache stable per permission set). */
export function toolsForProfile(profile: UserProfile | null): Anthropic.Tool[] {
  return TOOLS.filter((tool) => userHasLegacyPermission(profile, tool.permission)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
    strict: true,
  }));
}

const MAX_RESULT_CHARS = 12_000;

export type ToolRunResult = {
  content: string;
  isError: boolean;
  links: Array<{ label: string; href: string }>;
};

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolRunResult> {
  const tool = BY_NAME.get(name);
  if (!tool) return { content: `Unknown tool: ${name}`, isError: true, links: [] };
  if (!userHasLegacyPermission(ctx.profile, tool.permission)) {
    return { content: "Permission denied for this user.", isError: true, links: [] };
  }
  const input = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  try {
    const output = await tool.run(input, ctx);
    let content = JSON.stringify(output.data);
    if (content.length > MAX_RESULT_CHARS) {
      content = `${content.slice(0, MAX_RESULT_CHARS)}… [truncated; ask for a narrower filter]`;
    }
    return { content, isError: false, links: output.links || [] };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : "Query failed.";
    if (!(err instanceof ToolError)) console.warn(`[ai-native] tool ${name}`, err);
    return { content: message, isError: true, links: [] };
  }
}
