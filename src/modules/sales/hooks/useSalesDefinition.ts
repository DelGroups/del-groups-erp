import { fetchSaleById, fetchSalesListWithMeta } from "../lib/fetchSales";
import { salesDefinition, salesModel } from "../views/sales";

/**
 * The sales view definition (NEW_UI). Rows come from the module's own fetchers, so the new
 * screens show exactly what the classic ones show (cancelled invoices hidden, same columns).
 */
export const SALES_DEFINITION = salesDefinition(
  salesModel({
    fetchAll: async () => {
      const { sales, error } = await fetchSalesListWithMeta();
      if (error) throw new Error(error);
      return sales as unknown as Record<string, unknown>[];
    },
    fetchOne: async (id) => ((await fetchSaleById(id)) as unknown as Record<string, unknown> | null) ?? null,
  })
);
