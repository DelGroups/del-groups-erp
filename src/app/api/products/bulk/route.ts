import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { buildProductInsert } from "@/lib/products/api";
import { upsertProductsWithSchemaFallback } from "@/lib/products/bulkUpsertSchema";
import { generateProductBarcode } from "@/lib/products/generateBarcode";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { ProductInsert } from "@/types/database.types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface BulkProductInput extends Partial<ProductInsert> {
  code?: string;
  name?: string;
}

function toUpsertPayload(built: ProductInsert) {
  return {
    code: built.code,
    name: built.name,
    category: built.category,
    subcategory: built.subcategory,
    unit: built.unit,
    buy_price: built.buy_price,
    buy_price_cut: built.buy_price_cut,
    sell_price: built.sell_price,
    sell_price_cut: built.sell_price_cut,
    stock: built.stock,
    min_stock: built.min_stock,
    min_stock_level: built.min_stock_level,
    barcode: built.barcode,
    qr_code: built.qr_code,
    brand: built.brand,
    country_of_origin: built.country_of_origin,
    extra_info: built.extra_info,
    is_dimensional: built.is_dimensional,
    base_length: built.base_length,
    base_width: built.base_width,
    parent_id: built.parent_id ?? null,
    is_service: built.is_service,
    is_composite: built.is_composite,
  } satisfies ProductInsert;
}

export function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const auth = await requirePermissionApi("can_manage_products");
  if (auth.error) return auth.error;

  let body: { products?: BulkProductInput[] };
  try {
    body = (await request.json()) as { products?: BulkProductInput[] };
  } catch {
    return NextResponse.json({ success: false, error: "Sorğu formatı yanlışdır" }, { status: 400 });
  }

  const incoming = body.products ?? [];
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return NextResponse.json(
      { success: false, error: "Yükləmək üçün etibarlı məhsul sətiri tapılmadı" },
      { status: 400 }
    );
  }

  const prepared = incoming
    .filter((row) => row.code?.trim() && row.name?.trim())
    .map((row) => {
      const barcode = row.barcode?.trim() || generateProductBarcode();
      const built = buildProductInsert({
        code: row.code,
        name: row.name!,
        category: row.category,
        subcategory: row.subcategory,
        unit: row.unit,
        buy_price: row.buy_price,
        buy_price_cut: row.buy_price_cut,
        sell_price: row.sell_price,
        sell_price_cut: row.sell_price_cut,
        brand: row.brand,
        barcode,
        stock: 0,
        min_stock: 0,
        is_dimensional: row.is_dimensional,
        base_length: row.base_length,
        base_width: row.base_width,
        extra_info: row.extra_info,
      });

      return toUpsertPayload(built);
    });

  if (prepared.length === 0) {
    return NextResponse.json(
      { success: false, error: "Yükləmək üçün etibarlı məhsul sətiri tapılmadı" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { data, error, schemaWarnings } = await upsertProductsWithSchemaFallback(admin, prepared);

  if (error) {
    const hint =
      error.message.includes("schema cache") || error.message.includes("Could not find")
        ? " Supabase-də `supabase/migrations` fayllarını (xüsusən `20260915170000_product_extended_metadata.sql`) tətbiq edin."
        : "";
    return NextResponse.json(
      { success: false, error: `${error.message}${hint}` },
      { status: 400 }
    );
  }

  const insertedRows = data ?? [];
  const inserted = insertedRows.length;
  const skipped = prepared.length - inserted;
  const warning = schemaWarnings.length > 0 ? schemaWarnings.join(" ") : undefined;

  return NextResponse.json({
    success: true,
    inserted,
    skipped,
    total: prepared.length,
    warning,
  });
}
