import { supabase } from "@/lib/supabase";
import type { Product, Warehouse } from "@/types/database.types";

export type WarehouseStockStatus = "in_stock" | "low" | "out";

export interface WarehouseStockRow {
  id: string;
  productId: string;
  sku: string;
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

  if (productsError) throw new Error(productsError.message);
  if (warehousesError) throw new Error(warehousesError.message);
  if (warehouseStocksError && !warehouseStocksError.message.includes("does not exist")) {
    throw new Error(warehouseStocksError.message);
  }
  if (reservationsError && !reservationsError.message.includes("does not exist")) {
    throw new Error(reservationsError.message);
  }

  const warehouseList = (warehouses as Warehouse[]) || [];
  const warehouseById = new Map(warehouseList.map((w) => [w.id, w]));
  const defaultWarehouse =
    warehouseList.find((w) => w.is_default) ?? warehouseList[0] ?? null;

  const stockByProduct = new Map<string, WarehouseStockRecord>();
  for (const row of (warehouseStocks as WarehouseStockRecord[]) || []) {
    stockByProduct.set(row.product_id, row);
  }

  const reservedByKey = new Map<string, number>();
  for (const row of (reservations as ReservationRecord[]) || []) {
    const key = reservationKey(row.product_id, row.warehouse_id);
    reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + num(row.quantity));
  }

  const categories = new Set<string>();
  const rows: WarehouseStockRow[] = [];

  for (const product of (products as Product[]) || []) {
    if (product.is_service) continue;

    const category = product.category?.trim() || null;
    if (category) categories.add(category);

    const stockRow = stockByProduct.get(product.id);
    const warehouseId =
      stockRow?.warehouse_id ?? product.warehouse_id ?? defaultWarehouse?.id ?? null;
    const warehouseName =
      (warehouseId ? warehouseById.get(warehouseId)?.name : null) ??
      defaultWarehouse?.name ??
      "—";

    const totalPhysical = num(stockRow?.current_stock ?? product.stock);
    const reserved = reservedByKey.get(reservationKey(product.id, warehouseId)) ?? 0;
    const available = Math.max(0, totalPhysical - reserved);
    const minLimit = num(
      stockRow?.min_stock_level ?? product.min_stock_level ?? product.min_stock
    );
    const buyPrice = num(product.buy_price);
    const status = resolveWarehouseStockStatus(totalPhysical, minLimit);

    rows.push({
      id: product.id,
      productId: product.id,
      sku: product.code || "—",
      name: product.name,
      category,
      warehouseId,
      warehouseName,
      unit: product.unit,
      totalPhysical,
      reserved,
      available,
      minLimit,
      buyPrice,
      valuation: totalPhysical * buyPrice,
      status,
    });
  }

  return {
    rows,
    warehouses: warehouseList,
    categories: Array.from(categories).sort((a, b) => a.localeCompare(b, "az")),
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
    totalDistinctItems: rows.length,
    lowStockCount: rows.filter((r) => r.status === "low").length,
    outOfStockCount: rows.filter((r) => r.status === "out").length,
    totalValuation: rows.reduce((sum, row) => sum + row.valuation, 0),
  };
}
