"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchProductsCatalog } from "@/lib/products/api";
import { fetchPolywoodSummariesByWarehouse } from "@/lib/polywood/inventory";
import { POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";
import { queryKeys } from "@/lib/query/keys";

export function useProductsCatalog() {
  return useQuery({
    queryKey: queryKeys.products.catalog,
    queryFn: fetchProductsCatalog,
  });
}

export function usePolywoodSummaries(warehouseId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.products.polywoodSummaries(warehouseId || "none"),
    queryFn: async () => {
      if (!warehouseId) return new Map();
      return fetchPolywoodSummariesByWarehouse(warehouseId);
    },
    enabled: Boolean(warehouseId),
    staleTime: 30_000,
  });
}

export function usePolywoodWarehouseId(warehouses: { id: string; warehouse_type?: string | null }[]) {
  return warehouses.find((row) => row.warehouse_type === POLYWOOD_WAREHOUSE_TYPE)?.id ?? null;
}
