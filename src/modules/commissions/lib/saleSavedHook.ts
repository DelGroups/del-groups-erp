import type { SaleSavedHook } from "@/modules/sales";
import { recordSaleCommissions } from "./recordSaleCommissions";

/** Records the commissions of a saved sale; the sales route passes it when commissions is enabled. */
export const recordCommissionsAfterSale: SaleSavedHook = (sale) =>
  recordSaleCommissions(sale.saleId, sale.docNo, sale.sellerId, sale.sellerName, sale.items);
