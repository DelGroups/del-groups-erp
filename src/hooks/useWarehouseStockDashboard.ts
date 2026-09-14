"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchWarehouseStockDashboard } from "@/lib/inventory/fetchWarehouseStockDashboard";

export const warehouseStockDashboardKey = ["inventory", "warehouse-stock-dashboard"] as const;

export function useWarehouseStockDashboard() {
  return useQuery({
    queryKey: warehouseStockDashboardKey,
    queryFn: fetchWarehouseStockDashboard,
    staleTime: 30_000,
  });
}
