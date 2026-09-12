"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { fetchSalesListWithMeta, type SaleRecord } from "@/lib/sales/fetchSales";

export function useSalesList() {
  return useQuery({
    queryKey: queryKeys.sales.list,
    queryFn: async () => {
      const { sales, error } = await fetchSalesListWithMeta();
      if (error) throw new Error(error);
      return sales;
    },
  });
}

export function useInvalidateSalesList() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.sales.list });
}

export function useUpdateSalesListCache() {
  const queryClient = useQueryClient();

  return {
    patchSale(saleId: string, patch: Partial<SaleRecord>) {
      queryClient.setQueryData<SaleRecord[]>(queryKeys.sales.list, (current = []) =>
        current.map((row) => (row.id === saleId ? { ...row, ...patch } : row))
      );
    },
    removeSale(saleId: string) {
      queryClient.setQueryData<SaleRecord[]>(queryKeys.sales.list, (current = []) =>
        current.filter((row) => row.id !== saleId)
      );
    },
  };
}
