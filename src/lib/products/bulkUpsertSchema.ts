import type { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { ProductInsert } from "@/types/database.types";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

/** Columns added in later migrations — omitted when PostgREST schema cache lacks them. */
const OPTIONAL_PRODUCT_COLUMNS = [
  "brand",
  "country_of_origin",
  "parent_id",
  "mfg_date",
  "exp_date",
  "buy_price_cut",
  "sell_price_cut",
  "min_stock_level",
  "is_dimensional",
  "base_length",
  "base_width",
  "qr_code",
] as const;

type OptionalProductColumn = (typeof OPTIONAL_PRODUCT_COLUMNS)[number];

const CODE_LOOKUP_CHUNK = 200;

function appendBrandToExtraInfo(extra: string | null | undefined, brand: string): string {
  const line = `Brend: ${brand.trim()}`;
  const text = (extra ?? "").trim();
  if (!text) return line;
  if (text.includes(line)) return text;
  return `${text}\n${line}`;
}

function omitColumnFromRow(row: ProductInsert, column: OptionalProductColumn): ProductInsert {
  const next = { ...row };
  const value = next[column as keyof ProductInsert];
  delete (next as Record<string, unknown>)[column];

  if (column === "brand" && typeof value === "string" && value.trim()) {
    next.extra_info = appendBrandToExtraInfo(next.extra_info, value);
  }

  return next;
}

function missingColumnFromError(message: string): OptionalProductColumn | null {
  for (const column of OPTIONAL_PRODUCT_COLUMNS) {
    if (message.includes(`'${column}'`)) return column;
  }
  return null;
}

function isOnConflictConstraintError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("on conflict") || lower.includes("no unique or exclusion constraint");
}

async function loadExistingProductCodes(
  admin: SupabaseAdmin,
  codes: string[]
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < codes.length; i += CODE_LOOKUP_CHUNK) {
    const chunk = codes.slice(i, i + CODE_LOOKUP_CHUNK);
    const { data, error } = await admin.from("products").select("code").in("code", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const code = (row.code ?? "").trim().toLowerCase();
      if (code) existing.add(code);
    }
  }
  return existing;
}

function filterRowsToInsert(payloads: ProductInsert[], existingCodes: Set<string>): ProductInsert[] {
  const seenInBatch = new Set<string>();
  return payloads.filter((row) => {
    const code = row.code?.trim();
    if (!code) return false;
    const key = code.toLowerCase();
    if (existingCodes.has(key) || seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });
}

/**
 * Inserts new products by SKU only (skips existing codes).
 * Avoids PostgREST upsert — partial unique index on `code` does not support ON CONFLICT.
 */
async function insertNewProductsByCode(
  admin: SupabaseAdmin,
  payloads: ProductInsert[]
): Promise<{ data: { id: string; code: string | null }[] | null; error: { message: string } | null }> {
  const codes = [
    ...new Set(
      payloads.map((row) => row.code?.trim()).filter((code): code is string => Boolean(code))
    ),
  ];

  if (codes.length === 0) {
    return { data: [], error: null };
  }

  let existingCodes: Set<string>;
  try {
    existingCodes = await loadExistingProductCodes(admin, codes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mövcud SKU-lar oxunmadı";
    return { data: null, error: { message } };
  }

  const toInsert = filterRowsToInsert(payloads, existingCodes);
  if (toInsert.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await admin.from("products").insert(toInsert).select("id, code");
  if (error) {
    return { data: null, error };
  }

  return { data: data ?? [], error: null };
}

export interface BulkUpsertResult {
  data: { id: string; code: string | null }[] | null;
  error: { message: string } | null;
  schemaWarnings: string[];
}

export async function upsertProductsWithSchemaFallback(
  admin: SupabaseAdmin,
  rows: ProductInsert[]
): Promise<BulkUpsertResult> {
  let payloads = rows;
  const schemaWarnings: string[] = [];
  const stripped = new Set<OptionalProductColumn>();

  for (let attempt = 0; attempt <= OPTIONAL_PRODUCT_COLUMNS.length; attempt += 1) {
    const { data, error } = await insertNewProductsByCode(admin, payloads);

    if (!error) {
      return { data, error: null, schemaWarnings };
    }

    const missing = missingColumnFromError(error.message);
    if (missing && !stripped.has(missing)) {
      stripped.add(missing);
      schemaWarnings.push(
        `«${missing}» sütunu bazada tapılmadı; import uyğunlaşdırıldı (migrasiyaları tətbiq edin).`
      );
      payloads = payloads.map((row) => omitColumnFromRow(row, missing));
      continue;
    }

    if (isOnConflictConstraintError(error.message)) {
      schemaWarnings.push(
        "SKU upsert bazada dəstəklənmir; yalnız yeni məhsul kodları əlavə edildi."
      );
      const retry = await insertNewProductsByCode(admin, payloads);
      if (!retry.error) {
        return { data: retry.data, error: null, schemaWarnings };
      }
    }

    return { data: null, error, schemaWarnings };
  }

  return {
    data: null,
    error: { message: "Məhsul yükləməsi uğursuz oldu" },
    schemaWarnings,
  };
}
