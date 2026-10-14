import { fetchPurchaseById, fetchPurchaseList } from "../lib/fetchPurchases";
import { purchasesDefinition, purchasesModel } from "../views/purchases";

/** The purchases view definition (NEW_UI), read through the module's own fetchers. */
export const PURCHASES_DEFINITION = purchasesDefinition(
  purchasesModel({
    fetchAll: async () => (await fetchPurchaseList()) as unknown as Record<string, unknown>[],
    fetchOne: async (id) => ((await fetchPurchaseById(id)) as unknown as Record<string, unknown> | null) ?? null,
  })
);
