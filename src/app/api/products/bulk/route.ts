import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { buildProductInsert } from "@/lib/products/api";
import {
  applyBulkImportOpeningStock,
  resolveBulkImportWarehouseByLabel,
  resolveBulkImportWarehouseId,
} from "@/lib/products/bulkImportOpeningStock";
import type { BulkImportStockMode } from "@/lib/products/bulkImportUnits";
import { upsertProductsWithSchemaFallback } from "@/lib/products/bulkUpsertSchema";
import { generateProductBarcode } from "@/lib/products/generateBarcode";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { Product, ProductInsert } from "@/types/database.types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface BulkProductInput extends Partial<ProductInsert> {
  code?: string;
  name?: string;
  _bulk?: {
    stock?: {
      mode?: BulkImportStockMode;
      initialCount?: number;
      meterPieces?: number[];
      warehouseLabel?: string | null;
    };
  };
}

const CODE_LOOKUP_CHUNK = 200;

async function loadProductIdsByCode(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  codes: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];

  for (let i = 0; i < unique.length; i += CODE_LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + CODE_LOOKUP_CHUNK);
    const { data, error } = await admin.from("products").select("id, code").in("code", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const code = (row.code ?? "").trim();
      if (code) map.set(code.toLowerCase(), row.id as string);
    }
  }

  return map;
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

      return {
        payload: toUpsertPayload(built),
        stock: {
          mode: row._bulk?.stock?.mode ?? "piece",
          initialCount: Math.max(0, Number(row._bulk?.stock?.initialCount) || 0),
          meterPieces: row._bulk?.stock?.meterPieces ?? [],
          warehouseLabel: row._bulk?.stock?.warehouseLabel ?? null,
        },
      };
    });

  if (prepared.length === 0) {
    return NextResponse.json(
      { success: false, error: "Yükləmək üçün etibarlı məhsul sətiri tapılmadı" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const {
    data,
    error,
    schemaWarnings,
  } = await upsertProductsWithSchemaFallback(
    admin,
    prepared.map((row) => row.payload)
  );

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

  const defaultWarehouseId = await resolveBulkImportWarehouseId(admin);
  let stockEntries = 0;
  const warehouseResolveWarnings: string[] = [];

  let productIdsByCode: Map<string, string>;
  try {
    productIdsByCode = await loadProductIdsByCode(
      admin,
      prepared.map((row) => row.payload.code ?? "")
    );
  } catch (lookupError) {
    return NextResponse.json(
      {
        success: false,
        error: lookupError instanceof Error ? lookupError.message : "Məhsul kodları tapılmadı",
      },
      { status: 400 }
    );
  }

  if (defaultWarehouseId) {
    for (const source of prepared) {
      const codeKey = source.payload.code?.trim().toLowerCase();
      if (!codeKey) continue;

      const productId = productIdsByCode.get(codeKey);
      if (!productId) continue;

      const hasPieceStock = source.stock.mode === "piece" && source.stock.initialCount > 0;
      const hasMeterStock =
        source.stock.mode === "meter" && source.stock.meterPieces.length > 0;

      const warehouseId =
        (await resolveBulkImportWarehouseByLabel(admin, source.stock.warehouseLabel)) ??
        defaultWarehouseId;

      if (source.stock.warehouseLabel?.trim() && warehouseId === defaultWarehouseId) {
        warehouseResolveWarnings.push(source.payload.code ?? codeKey);
      }

      if (warehouseId) {
        await admin.from("products").update({ warehouse_id: warehouseId }).eq("id", productId);
      }

      if (!hasPieceStock && !hasMeterStock) continue;

      const { data: productRecord, error: productError } = await admin
        .from("products")
        .select("*")
        .eq("id", productId)
        .maybeSingle();

      if (productError || !productRecord) {
        return NextResponse.json(
          { success: false, error: productError?.message || "Məhsul tapılmadı" },
          { status: 400 }
        );
      }

      try {
        const applied = await applyBulkImportOpeningStock({
          admin,
          productId,
          product: productRecord as Product,
          warehouseId: warehouseId ?? defaultWarehouseId,
          mode: source.stock.mode,
          initialCount: source.stock.initialCount,
          meterPieces: source.stock.meterPieces,
          userId: auth.user?.id ?? null,
        });
        if (applied) stockEntries += 1;
      } catch (stockError) {
        return NextResponse.json(
          {
            success: false,
            error:
              stockError instanceof Error
                ? stockError.message
                : "İlkin qalıq yazılmadı",
          },
          { status: 400 }
        );
      }
    }
  }

  const needsStock = prepared.some(
    (row) =>
      (row.stock.mode === "piece" && row.stock.initialCount > 0) ||
      (row.stock.mode === "meter" && row.stock.meterPieces.length > 0)
  );

  const stockWarning =
    !defaultWarehouseId && needsStock
      ? "Məhsullar əlavə edildi, lakin anbar tapılmadığı üçün ilkin qalıq yazılmadı"
      : undefined;
  const schemaWarning = schemaWarnings.length > 0 ? schemaWarnings.join(" ") : undefined;
  const warehouseWarning =
    warehouseResolveWarnings.length > 0
      ? `Bəzi sətirlərdə anbar adı uyğunlaşdırılmadı (default anbar): ${warehouseResolveWarnings.slice(0, 5).join(", ")}${warehouseResolveWarnings.length > 5 ? "…" : ""}`
      : undefined;
  const warning = [stockWarning, schemaWarning, warehouseWarning].filter(Boolean).join(" ") || undefined;

  return NextResponse.json({
    success: true,
    inserted,
    skipped,
    stockEntries,
    total: prepared.length,
    warning,
  });
}
