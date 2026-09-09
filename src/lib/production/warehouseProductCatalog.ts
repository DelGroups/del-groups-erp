import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import {
  resolveCatalogWarehouseStock,
  warehouseStockBalancesFromMovements,
} from "@/lib/production/warehouseStock";
import type { Product } from "@/types/database.types";

type StockAdminClient = ReturnType<
  typeof import("@/lib/supabaseAdmin").createSupabaseAdminClient
>;

const CATALOG_SELECT_ATTEMPTS = [
  "id,code,name,unit,buy_price,stock,inventory_mode,barcode,qr_code",
  "id,code,name,unit,buy_price,stock,inventory_mode,barcode",
  "id,code,name,unit,buy_price,stock,inventory_mode",
  "id,code,name,unit,buy_price,stock",
  "id,name,unit,buy_price,stock",
] as const;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isPolywoodProduct(product: Product): boolean {
  return product.inventory_mode === POLYWOOD_INVENTORY_MODE;
}

function isServiceProduct(product: Product): boolean {
  return product.is_service === true;
}

/** Fetch products with progressive column fallback — never filters by stock level. */
export async function safeFetchCatalogProducts(
  admin: StockAdminClient,
  options?: { polywoodOnly?: boolean }
): Promise<Product[]> {
  for (const fields of CATALOG_SELECT_ATTEMPTS) {
    const { data, error } = await admin
      .from("products")
      .select(fields)
      .order("name")
      .limit(500);

    if (error || !data?.length) continue;

    let rows = (data as Product[]).filter((row) => row.name && !isServiceProduct(row));

    if (options?.polywoodOnly && fields.includes("inventory_mode")) {
      const polywoodRows = rows.filter(isPolywoodProduct);
      return polywoodRows.length ? polywoodRows : rows;
    }

    if (!options?.polywoodOnly && fields.includes("inventory_mode")) {
      const standardRows = rows.filter((row) => !isPolywoodProduct(row));
      return standardRows.length ? standardRows : rows;
    }

    return rows;
  }

  return [];
}

export type WarehouseCatalogItem = {
  id: string;
  product_id: string;
  code: string | null;
  name: string;
  unit: string;
  buy_price: number;
  cost_price: number;
  realStock: number;
  unitCost: number;
  stock: number;
  stock_quantity: number;
  inventory_mode: string | null;
  barcode: string | null;
  qr_code: string | null;
};

export function mapCatalogProduct(
  product: Product,
  realStock: number,
  unitOverride?: string
): WarehouseCatalogItem {
  const unitCost = num(product.buy_price);
  const stockQty = Math.round(Math.max(0, realStock) * 100) / 100;
  const unit = unitOverride || product.unit || "ədəd";

  return {
    id: product.id,
    product_id: product.id,
    code: product.code || null,
    name: product.name,
    unit,
    buy_price: unitCost,
    cost_price: unitCost,
    realStock: stockQty,
    unitCost,
    stock: stockQty,
    stock_quantity: stockQty,
    inventory_mode: product.inventory_mode || null,
    barcode: product.barcode || null,
    qr_code: product.qr_code || product.barcode || null,
  };
}

export async function fetchStandardWarehouseCatalog(
  admin: StockAdminClient,
  warehouseId: string
): Promise<WarehouseCatalogItem[]> {
  const products = await safeFetchCatalogProducts(admin, { polywoodOnly: false });
  if (!products.length) return [];

  let movementBalances = new Map<string, number>();
  try {
    movementBalances = await warehouseStockBalancesFromMovements(admin, warehouseId);
  } catch {
    movementBalances = new Map();
  }

  return products.map((product) => {
    const realStock = resolveCatalogWarehouseStock(
      movementBalances,
      product.id,
      Number(product.stock) || 0
    );
    return mapCatalogProduct(product, realStock);
  });
}

export async function fetchPolywoodWarehouseCatalog(
  admin: StockAdminClient,
  warehouseId: string
): Promise<WarehouseCatalogItem[]> {
  const products = await safeFetchCatalogProducts(admin, { polywoodOnly: true });
  if (!products.length) return [];

  const stockByProduct = new Map<string, number>();
  const { data: pieces, error: piecesError } = await admin
    .from("polywood_pieces")
    .select("product_id, length_m")
    .eq("warehouse_id", warehouseId)
    .eq("status", "available");

  if (!piecesError && pieces?.length) {
    for (const piece of pieces as { product_id?: string; length_m?: number }[]) {
      if (!piece.product_id) continue;
      stockByProduct.set(
        piece.product_id,
        (stockByProduct.get(piece.product_id) || 0) + (Number(piece.length_m) || 0)
      );
    }
  }

  return products.map((product) => {
    const fromPieces = stockByProduct.get(product.id);
    const realStock =
      fromPieces !== undefined
        ? Math.round(fromPieces * 100) / 100
        : resolveCatalogWarehouseStock(new Map(), product.id, Number(product.stock) || 0);
    return mapCatalogProduct(product, realStock, product.unit || "m");
  });
}
