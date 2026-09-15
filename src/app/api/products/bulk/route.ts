import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { buildProductInsert } from "@/lib/products/api";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { ProductInsert } from "@/types/database.types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface BulkProductInput {
  code?: string;
  name?: string;
  category?: string;
  unit?: string;
  buy_price?: number;
  sell_price?: number;
  brand?: string | null;
  barcode?: string | null;
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

  const payloads = incoming
    .filter((row) => row.code?.trim() && row.name?.trim())
    .map((row) => {
      const built = buildProductInsert({
        code: row.code,
        name: row.name!,
        category: row.category,
        unit: row.unit,
        buy_price: row.buy_price,
        sell_price: row.sell_price,
        brand: row.brand,
        barcode: row.barcode,
        stock: 0,
        min_stock: 0,
      });
      return {
        code: built.code,
        name: built.name,
        category: built.category,
        subcategory: built.subcategory,
        unit: built.unit,
        buy_price: built.buy_price,
        sell_price: built.sell_price,
        stock: built.stock,
        min_stock: built.min_stock,
        min_stock_level: built.min_stock_level,
        barcode: built.barcode,
        qr_code: built.qr_code,
        brand: built.brand,
        country_of_origin: built.country_of_origin,
        is_dimensional: built.is_dimensional,
        is_service: built.is_service,
        is_composite: built.is_composite,
      } satisfies ProductInsert;
    });

  if (payloads.length === 0) {
    return NextResponse.json(
      { success: false, error: "Yükləmək üçün etibarlı məhsul sətiri tapılmadı" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("products")
    .upsert(payloads, { onConflict: "code", ignoreDuplicates: true })
    .select("id, code");

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }

  const inserted = data?.length ?? 0;
  const skipped = payloads.length - inserted;

  return NextResponse.json({
    success: true,
    inserted,
    skipped,
    total: payloads.length,
  });
}
