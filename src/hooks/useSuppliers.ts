"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { fetchSuppliers, upsertSupplier, type SupplierUpsertInput } from "@/lib/suppliers/api";
import type { Supplier } from "@/types/database.types";

export function useSuppliers() {
  return useQuery({
    queryKey: queryKeys.suppliers.all,
    queryFn: fetchSuppliers,
  });
}

export function useUpsertSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: upsertSupplier,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.suppliers.all });
      const previous = queryClient.getQueryData<Supplier[]>(queryKeys.suppliers.all);

      const optimistic: Supplier = {
        id: input.id || `optimistic-${Date.now()}`,
        code: input.code,
        full_name: input.full_name,
        phone: input.phone,
        company_name: input.company_name,
        address: input.address,
        voen: input.voen,
        entity_type: input.entity_type,
        balance: input.balance,
        created_at: new Date().toISOString(),
        quality_score: null,
        delivery_speed_score: null,
      };

      queryClient.setQueryData<Supplier[]>(queryKeys.suppliers.all, (current = []) => {
        if (input.id) {
          return current.map((row) => (row.id === input.id ? { ...row, ...optimistic } : row));
        }
        return [optimistic, ...current];
      });

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.suppliers.all, context.previous);
      }
    },
    onSuccess: (saved, input) => {
      queryClient.setQueryData<Supplier[]>(queryKeys.suppliers.all, (current = []) => {
        if (input.id) {
          return current.map((row) => (row.id === input.id ? saved : row));
        }
        return [saved, ...current.filter((row) => !row.id.startsWith("optimistic-"))];
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
    },
  });
}

export type { SupplierUpsertInput };
