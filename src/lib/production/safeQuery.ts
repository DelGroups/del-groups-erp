import { canonicalizeProductionOrderWrite } from "@/lib/production/ordersClient";
import { withNormalizedProductionOrderWrite } from "@/lib/production/types";

/** PostgREST PGRST204: column missing from schema cache. */

export const PRODUCTION_ORDER_OPTIONAL_TEXT_COLUMNS = [
  "project_scope",
  "terms",
  "terms_and_conditions",
  "notes",
] as const;

/** Derived in app code — never required on the live table. */
export const PRODUCTION_ORDER_COMPUTED_COLUMNS = ["remaining_balance"] as const;

export const PRODUCTION_ORDER_OPTIONAL_COLUMNS = [
  ...PRODUCTION_ORDER_OPTIONAL_TEXT_COLUMNS,
] as const;

export const PRODUCTION_ORDER_CORE_COLUMNS = [
  "id",
  "order_no",
  "production_model",
  "type",
  "custom_workflow",
  "status",
  "project_name",
  "customer_id",
  "customer_name",
  "ousta_id",
  "subcontractor_id",
  "subcontractor_fee_percent",
  "subcontractor_fee_amount",
  "finished_product_id",
  "finished_product_name",
  "custom_product_id",
  "quantity",
  "warehouse_id",
  "warehouse_name",
  "raw_material_warehouse_id",
  "furniture_warehouse_id",
  "total_project_price",
  "installation_fee",
  "advance_payment",
  "advance_account_id",
  "advance_posted_at",
  "advance_transaction_id",
  "expected_delivery_date",
  "materials_allocated",
  "finished_goods_posted",
  "sale_id",
  "delivered_at",
  "created_by",
  "created_at",
  "updated_at",
] as const;

type QueryError = { message?: string; code?: string } | null | undefined;

export function missingColumnFromError(error?: QueryError): string | null {
  const message = error?.message || "";
  const cacheMatch = message.match(/Could not find the '([^']+)' column/i);
  if (cacheMatch?.[1]) return cacheMatch[1];
  const pgMatch = message.match(/column (?:[\w]+\.)?"?(\w+)"? does not exist/i);
  if (pgMatch?.[1]) return pgMatch[1];
  if (error?.code === "PGRST204") return "";
  return null;
}

export function missingTableFromError(error?: QueryError): string | null {
  const message = error?.message || "";
  const cacheMatch = message.match(/Could not find the table '(?:public\.)?([^']+)'/i);
  if (cacheMatch?.[1]) return cacheMatch[1];
  const relationMatch = message.match(/relation "([^"]+)" does not exist/i);
  if (relationMatch?.[1]) return relationMatch[1];
  if (error?.code === "PGRST205") return "";
  return null;
}

export function isMissingTableError(error?: QueryError, table?: string): boolean {
  const missing = missingTableFromError(error);
  if (!missing) return false;
  if (!table) return true;
  return missing === table;
}

export function isSchemaCacheColumnError(error?: QueryError): boolean {
  return Boolean(missingColumnFromError(error) || /schema cache/i.test(error?.message || ""));
}

export function omitEmptyOptionalText(
  payload: Record<string, unknown>,
  keys: readonly string[] = PRODUCTION_ORDER_OPTIONAL_TEXT_COLUMNS
): Record<string, unknown> {
  const next = { ...payload };
  for (const key of keys) {
    const value = next[key];
    if (value == null || value === "") delete next[key];
  }
  return next;
}

export function omitComputedColumns(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  for (const key of PRODUCTION_ORDER_COMPUTED_COLUMNS) delete next[key];
  return next;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FromClient = { from: (table: string) => any };

async function selectWithColumnFallback(
  run: (columns: string) => Promise<{ data: unknown; error: QueryError }>,
  coreColumns: readonly string[],
  optionalColumns: readonly string[]
): Promise<{ data: unknown; error: QueryError }> {
  const dropped = new Set<string>();
  let columns = [...coreColumns, ...optionalColumns].join(",");

  for (let attempt = 0; attempt < 16; attempt++) {
    const result = await run(columns);
    if (!result.error) return result;

    const missing = missingColumnFromError(result.error);
    if (!missing) {
      if (columns !== "*") {
        const star = await run("*");
        if (!star.error) return star;
      }
      return result;
    }
    if (dropped.has(missing)) return result;
    dropped.add(missing);

    columns = [...coreColumns, ...optionalColumns].filter((column) => !dropped.has(column)).join(",");
    if (!columns) return result;
  }

  return { data: null, error: { message: "Failed" } };
}

export async function selectProductionOrders(
  admin: FromClient,
  opts?: { id?: string; orderCreatedAtDesc?: boolean; maybeSingle?: boolean; limit?: number }
): Promise<{ data: unknown; error: QueryError }> {
  return selectWithColumnFallback(
    (columns) => {
      let query = admin.from("production_orders").select(columns);
      if (opts?.id) query = query.eq("id", opts.id);
      if (opts?.orderCreatedAtDesc) query = query.order("created_at", { ascending: false });
      if (opts?.limit && !opts.maybeSingle) query = query.limit(Math.max(1, opts.limit));
      return opts?.maybeSingle ? query.maybeSingle() : query;
    },
    PRODUCTION_ORDER_CORE_COLUMNS,
    PRODUCTION_ORDER_OPTIONAL_COLUMNS
  );
}

export async function mutateOmittingMissingColumns<T>(
  execute: (
    payload: Record<string, unknown>
  ) => Promise<{ data: T | null; error: QueryError }>,
  payload: Record<string, unknown>,
  options?: { foldText?: Record<string, string> }
): Promise<{ data: T | null; error: string | null }> {
  const isInsert = "order_no" in payload;
  let body = withNormalizedProductionOrderWrite(omitComputedColumns({ ...payload }), {
    forceType: isInsert,
    forceStatus: isInsert,
  });

  for (let attempt = 0; attempt < 16; attempt++) {
    body = canonicalizeProductionOrderWrite(body, { insert: isInsert });
    const { data, error } = await execute(body);
    if (!error) return { data, error: null };

    const column = missingColumnFromError(error);
    if (!column || !(column in body)) {
      return { data: null, error: error?.message || "Failed" };
    }

    if (column === "status" || column === "type") {
      return { data: null, error: error?.message || "Failed" };
    }

    const foldInto = options?.foldText?.[column];
    if (foldInto) {
      const extra = body[column];
      if (typeof extra === "string" && extra.trim()) {
        const existing = typeof body[foldInto] === "string" ? String(body[foldInto]).trim() : "";
        body[foldInto] = existing ? `${existing}\n\n${extra.trim()}` : extra.trim();
      }
    }
    delete body[column];
  }

  return { data: null, error: "Failed" };
}
