"use client";

/**
 * Database side of the lookup field: search, read one row by id, and the quick-create writes.
 * Reads go through the browser Supabase client (RLS applies, like every classic form). Writes
 * use the same path as the full pages: customers / suppliers / warehouses / categories insert
 * like their pages, products go through POST /api/products (the full product form's route),
 * accounts and expense categories through their server actions.
 */
import { supabase } from "@/lib/supabase";
import { createAccountAction, quickCreateExpenseCategoryAction } from "@/lib/actions/finance";
import { createPartnerAction } from "@/lib/actions/partners";
import { saveConsignmentPartnerAction } from "@/modules/consignment";
import { buildProductInsert } from "@/lib/products/api";
import { toEmployeeDbRow } from "@/types/database.types";
import { buildSearchFilter, LOOKUP_LIMIT, partyPayload, type PartyDraft } from "./logic";
import { lookupDef, type LookupEntity, type LookupRecord, type LookupWhere } from "./registry";

// The generated table types do not cover every table the registry reads; the lookups only need
// the untyped builder (filters by column name, rows as records).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyWhere(query: any, where: LookupWhere | undefined) {
  let q = query;
  for (const [column, value] of Object.entries(where ?? {})) {
    if (value === null) q = q.is(column, null);
    // false also matches NULL: "not a service" includes rows where the flag was never set.
    else if (value === false) q = q.not(column, "is", true);
    else q = q.eq(column, value);
  }
  return q;
}

export async function searchLookup(
  entity: LookupEntity,
  query: string,
  options: { where?: LookupWhere; signal?: AbortSignal; limit?: number } = {}
): Promise<LookupRecord[]> {
  const def = lookupDef(entity);
  let q = db().from(def.table).select(def.select);
  q = applyWhere(q, def.baseWhere);
  q = applyWhere(q, options.where);
  const filter = buildSearchFilter(query, def.searchColumns);
  if (filter) q = q.or(filter);
  q = q.order(def.order.column, { ascending: def.order.ascending }).limit(options.limit ?? LOOKUP_LIMIT);
  if (options.signal) q = q.abortSignal(options.signal);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as LookupRecord[];
}

export async function fetchLookupById(entity: LookupEntity, id: string): Promise<LookupRecord | null> {
  const def = lookupDef(entity);
  const { data, error } = await db().from(def.table).select(def.select).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LookupRecord | null) ?? null;
}

/** Rows by id (recent picks), in one request. */
export async function fetchLookupByIds(entity: LookupEntity, ids: readonly string[]): Promise<LookupRecord[]> {
  if (ids.length === 0) return [];
  const def = lookupDef(entity);
  let q = db().from(def.table).select(def.select).in("id", ids);
  q = applyWhere(q, def.baseWhere);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as LookupRecord[];
}

type CreateResult = { ok: true; record: LookupRecord } | { ok: false; error: string };

async function insertRow(table: string, row: Record<string, unknown>): Promise<CreateResult> {
  const { data, error } = await db().from(table).insert([row]).select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };
  return { ok: true, record: data as LookupRecord };
}

export function createCustomer(draft: PartyDraft & { address?: string }): Promise<CreateResult> {
  const payload = partyPayload(draft, "CUST");
  return insertRow("customers", {
    ...payload,
    name: payload.full_name,
    address: draft.address?.trim() || null,
    default_price_tier: "retail",
    balance: 0,
  });
}

export function createSupplierRecord(draft: PartyDraft & { address?: string }): Promise<CreateResult> {
  const payload = partyPayload(draft, "SUP");
  return insertRow("suppliers", {
    ...payload,
    phone: payload.phone ?? "",
    company_name: payload.company_name ?? "",
    address: draft.address?.trim() ?? "",
    balance: 0,
  });
}

/** Partners go through createPartnerAction (it also keeps the customer / supplier rows in step). */
export async function createPartnerRecord(input: { name: string; phone: string; voen: string; address: string; isCustomer: boolean; isSupplier: boolean }): Promise<CreateResult> {
  const result = await createPartnerAction({
    name: input.name.trim(),
    phone: input.phone.trim() || undefined,
    voen: input.voen.trim() || undefined,
    address: input.address.trim() || undefined,
    is_customer: input.isCustomer,
    is_supplier: input.isSupplier,
  });
  if (!result.success || !result.data) return { ok: false, error: (!result.success && result.error) || "partner" };
  const record = await fetchLookupById("partner", result.data.id);
  return record ? { ok: true, record } : { ok: false, error: "partner" };
}

export async function createConsignmentPartnerRecord(input: { name: string; companyName: string; phone: string; voen: string; address: string }): Promise<CreateResult> {
  const result = await saveConsignmentPartnerAction({
    name: input.name,
    company_name: input.companyName || null,
    phone: input.phone || null,
    voen: input.voen || null,
    address: input.address || null,
  });
  if (!result.success) return { ok: false, error: result.error };
  if (!result.data) return { ok: false, error: "partner" };
  return { ok: true, record: result.data as unknown as LookupRecord };
}

export function createWarehouse(input: { name: string; code: string; location: string }): Promise<CreateResult> {
  return insertRow("warehouses", {
    code: input.code.trim() || `WH-${Math.floor(100 + Math.random() * 900)}`,
    name: input.name.trim(),
    location: input.location.trim() || null,
    is_default: false,
  });
}

export async function createProductCategory(input: { name: string }): Promise<CreateResult> {
  return insertRow("categories", { name: input.name.trim(), parent_id: null });
}

export async function createEmployeeRecord(input: { fullName: string; role: string; phone: string }): Promise<CreateResult> {
  const row = toEmployeeDbRow({
    employee_code: "",
    full_name: input.fullName,
    role: input.role,
    department: "general",
    phone: input.phone,
    base_salary: 0,
    default_commission: 0,
    status: "active",
    fin_code: null,
    iban: null,
    bank_name: null,
    hire_date: null,
    contract_end_date: null,
    emergency_phone: null,
    documents_json: {},
  } as Parameters<typeof toEmployeeDbRow>[0]);
  return insertRow("employees", row as unknown as Record<string, unknown>);
}

export async function createAccountRecord(input: { name: string; type: "Kassa" | "Bank" }): Promise<CreateResult> {
  const result = await createAccountAction({ name: input.name, type: input.type, balance: 0 });
  if (!result.success) return { ok: false, error: result.error };
  if (!result.data) return { ok: false, error: "account" };
  const record = await fetchLookupById("account", result.data.accountId);
  return record ? { ok: true, record } : { ok: false, error: "account" };
}

export async function createExpenseCategory(input: { name: string }): Promise<CreateResult> {
  const result = await quickCreateExpenseCategoryAction(input.name);
  if (!result.success) return { ok: false, error: result.error };
  if (!result.data) return { ok: false, error: "category" };
  return { ok: true, record: { ...result.data, type: "EXPENSE", is_active: true } as LookupRecord };
}

export interface ProductDraft {
  name: string;
  code: string;
  unit: string;
  category: string;
  categoryId: string | null;
  /** Sheet / bar length in metres, for metric units. */
  sheetLength: number | null;
  sellPrice: number | null;
}

/** The full product form's route (POST /api/products): the same validation and code rules. */
export async function createProductRecord(draft: ProductDraft): Promise<CreateResult & { duplicate?: boolean }> {
  const metric = draft.unit === "Metr" || draft.unit === "Kvadrat Metr";
  const product = buildProductInsert({
    name: draft.name,
    code: draft.code,
    unit: draft.unit,
    category: draft.category || "Ümumi",
    category_id: draft.categoryId,
    sell_price: draft.sellPrice ?? 0,
    is_dimensional: metric,
    base_length: metric ? draft.sheetLength : null,
    stock: 0,
    min_stock: 0,
  });
  const response = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product, bomRows: [], isComposite: false }),
  });
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; errorCode?: string; data?: LookupRecord };
  if (!response.ok || !body.success || !body.data) {
    return { ok: false, error: body.error ?? "product", duplicate: body.errorCode === "duplicate" };
  }
  return { ok: true, record: body.data };
}

/** Stockable products with the same name (F4 check), for the quick-create warning. */
export async function findProductsByName(name: string): Promise<LookupRecord[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const { data } = await db()
    .from("products")
    .select("id, code, name, stock, is_service, is_composite")
    .ilike("name", trimmed.replace(/[%_\\]/g, (c: string) => `\\${c}`))
    .limit(5);
  return (data ?? []) as LookupRecord[];
}
