import { supabase } from "@/lib/supabase";
import type { Product, Warehouse } from "@/types/database.types";

export type WarehouseStockStatus = "in_stock" | "low" | "out";

export interface WarehouseStockRow {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  warehouseId: string | null;
  warehouseName: string;
  unit: string | null;
  totalPhysical: number;
  reserved: number;
  available: number;
  minLimit: number;
  buyPrice: number;
  valuation: number;
  status: WarehouseStockStatus;
}

export interface WarehouseStockDashboardData {
  rows: WarehouseStockRow[];
  warehouses: Warehouse[];
  categories: string[];
  /** Non-fatal issues (e.g. an optional ledger table is missing/unreadable) — surfaced to the UI, not thrown. */
  warnings: string[];
}

type WarehouseStockRecord = {
  product_id: string;
  warehouse_id: string | null;
  current_stock: number | null;
  min_stock_level: number | null;
};

type ReservationRecord = {
  product_id: string;
  warehouse_id: string | null;
  quantity: number | null;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function reservationKey(productId: string, warehouseId: string | null): string {
  return `${productId}::${warehouseId ?? ""}`;
}

export function resolveWarehouseStockStatus(
  totalPhysical: number,
  minLimit: number
): WarehouseStockStatus {
  if (totalPhysical <= 0) return "out";
  if (minLimit > 0 && totalPhysical <= minLimit) return "low";
  return "in_stock";
}

export async function fetchWarehouseStockDashboard(): Promise<WarehouseStockDashboardData> {
  const [
    { data: products, error: productsError },
    { data: warehouses, error: warehousesError },
    { data: warehouseStocks, error: warehouseStocksError },
    { data: reservations, error: reservationsError },
  ] = await Promise.all([
    supabase.from("products").select("*").order("name", { ascending: true }),
    supabase.from("warehouses").select("*").order("created_at", { ascending: true }),
    supabase.from("warehouse_stocks").select("product_id, warehouse_id, current_stock, min_stock_level"),
    supabase
      .from("production_stock_reservations")
      .select("product_id, warehouse_id, quantity")
      .eq("status", "reserved"),
  ]);

  // Products and warehouses are load-bearing — surface real failures instead of rendering an empty page.
  if (productsError) throw new Error(productsError.message);
  if (warehousesError) throw new Error(warehousesError.message);

  // The stock ledger and reservations are supplementary — degrade gracefully (fall back to
  // products.stock, treat reservations as zero) instead of blanking the whole page on any
  // hiccup with these tables (missing table, RLS denial, etc.), but keep the warning visible.
  const warnings: string[] = [];
  if (warehouseStocksError && !warehouseStocksError.message.includes("does not exist")) {
    warnings.push(`warehouse_stocks: ${warehouseStocksError.message}`);
  }
  if (reservationsError && !reservationsError.message.includes("does not exist")) {
    warnings.push(`production_stock_reservations: ${reservationsError.message}`);
  }

  const warehouseList = (warehouses as Warehouse[]) || [];
  const warehouseById = new Map(warehouseList.map((w) => [w.id, w]));
  const defaultWarehouse =
    warehouseList.find((w) => w.is_default) ?? warehouseList[0] ?? null;

  // A product can carry a stock ledger row per warehouse — keep every row instead of
  // collapsing them to one, otherwise multi-warehouse products lose quantity/value.
  const stockRowsByProduct = new Map<string, WarehouseStockRecord[]>();
  for (const row of (warehouseStocks as WarehouseStockRecord[]) || []) {
    const list = stockRowsByProduct.get(row.product_id);
    if (list) list.push(row);
    else stockRowsByProduct.set(row.product_id, [row]);
  }

  const reservedByKey = new Map<string, number>();
  for (const row of (reservations as ReservationRecord[]) || []) {
    const key = reservationKey(row.product_id, row.warehouse_id);
    reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + num(row.quantity));
  }

  const categories = new Set<string>();
  const rows: WarehouseStockRow[] = [];

  function pushRow(
    product: Product,
    warehouseId: string | null,
    totalPhysical: number,
    minLimit: number
  ) {
    const warehouseName =
      (warehouseId ? warehouseById.get(warehouseId)?.name : null) ??
      defaultWarehouse?.name ??
      "—";
    const reserved = reservedByKey.get(reservationKey(product.id, warehouseId)) ?? 0;
    const available = Math.max(0, totalPhysical - reserved);
    const buyPrice = num(product.buy_price);

    rows.push({
      id: `${product.id}::${warehouseId ?? "none"}`,
      productId: product.id,
      sku: product.code || "—",
      barcode: product.barcode?.trim() || null,
      name: product.name,
      category: product.category?.trim() || null,
      warehouseId,
      warehouseName,
      unit: product.unit,
      totalPhysical,
      reserved,
      available,
      minLimit,
      buyPrice,
      valuation: totalPhysical * buyPrice,
      status: resolveWarehouseStockStatus(totalPhysical, minLimit),
    });
  }

  for (const product of (products as Product[]) || []) {
    if (product.is_service) continue;

    const category = product.category?.trim() || null;
    if (category) categories.add(category);

    const stockRows = stockRowsByProduct.get(product.id);
    if (stockRows && stockRows.length > 0) {
      for (const stockRow of stockRows) {
        const warehouseId = stockRow.warehouse_id ?? product.warehouse_id ?? defaultWarehouse?.id ?? null;
        const minLimit = num(stockRow.min_stock_level ?? product.min_stock_level ?? product.min_stock);
        pushRow(product, warehouseId, num(stockRow.current_stock), minLimit);
      }
    } else {
      const warehouseId = product.warehouse_id ?? defaultWarehouse?.id ?? null;
      const minLimit = num(product.min_stock_level ?? product.min_stock);
      pushRow(product, warehouseId, num(product.stock), minLimit);
    }
  }

  return {
    rows,
    warehouses: warehouseList,
    categories: Array.from(categories).sort((a, b) => a.localeCompare(b, "az")),
    warnings,
  };
}

export interface WarehouseStockKpis {
  totalDistinctItems: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValuation: number;
}

export function computeWarehouseStockKpis(rows: WarehouseStockRow[]): WarehouseStockKpis {
  return {
    totalDistinctItems: new Set(rows.map((r) => r.productId)).size,
    lowStockCount: rows.filter((r) => r.status === "low").length,
    outOfStockCount: rows.filter((r) => r.status === "out").length,
    totalValuation: rows.reduce((sum, row) => sum + row.valuation, 0),
  };
}
