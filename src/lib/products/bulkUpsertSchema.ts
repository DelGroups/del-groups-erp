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
    const { data, error } = await admin
      .from("products")
      .upsert(payloads, { onConflict: "code", ignoreDuplicates: true })
      .select("id, code");

    if (!error) {
      return { data, error: null, schemaWarnings };
    }

    const missing = missingColumnFromError(error.message);
    if (!missing || stripped.has(missing)) {
      return { data: null, error, schemaWarnings };
    }

    stripped.add(missing);
    schemaWarnings.push(
      `«${missing}» sütunu bazada tapılmadı; import uyğunlaşdırıldı (migrasiyaları tətbiq edin).`
    );
    payloads = payloads.map((row) => omitColumnFromRow(row, missing));
  }

  return {
    data: null,
    error: { message: "Məhsul yükləməsi uğursuz oldu" },
    schemaWarnings,
  };
}
