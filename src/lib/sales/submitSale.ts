import {
  normalizeSaleItemProductId,
  resolveSaleItemProductId,
  validateSaleItemsHaveProductIds,
} from "@/lib/sales/saleItemProductId";
import { validateCashPaymentsRequireAccount } from "@/lib/finance/accountLedger";
import { saleInvoiceIdempotencyKey } from "@/lib/finance/erpEvents";
import {
  documentExpensesToRpcPayload,
  type DocumentAdditionalExpense,
} from "@/lib/forms/documentExpenses";
import { supabase } from "@/lib/supabase";
import { recordSaleCommissions } from "@/lib/commissions/recordSaleCommissions";
import { DEFAULT_FULL_SHEET_LENGTH_M } from "@/lib/polywood/constants";
import {
  processMixedDimensionalSaleRpc,
  type MixedDimensionalItemType,
  type MixedDimensionalSaleMode,
} from "@/lib/polywood/processMixedDimensionalSale";
import type { SaleInsert, SaleItem, SalePayment } from "@/types/database.types";
import { toSalePaymentsJson } from "@/types/database.types";

export interface SubmitSalePayload {
  header: SaleInsert;
  items: SaleItem[];
  payments: SalePayment[];
  docNo: string;
  decrementStock?: boolean;
  additionalExpenses?: DocumentAdditionalExpense[];
}

export interface SubmitSaleResult {
  success: boolean;
  error?: string;
  saleId?: string;
}

type CreateSaleAtomicItemPayload = {
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  line_total: number;
  extra_info: string | null;
  polywood_sale_mode?: string | null;
  polywood_length_m?: number | null;
  skip_stock: boolean;
};

function mapSaleItemToRpcPayload(
  item: SaleItem,
  decrementStock: boolean
): CreateSaleAtomicItemPayload {
  const base: CreateSaleAtomicItemPayload = {
    product_id: resolveSaleItemProductId(item),
    product_code: item.product_code || null,
    product_name: item.product_name || null,
    warehouse_id: item.warehouse_id || null,
    warehouse_name: item.warehouse_name || null,
    quantity: item.quantity,
    unit: item.unit || "Ədəd",
    unit_price: item.unit_price,
    discount_percent: item.discount_percent,
    vat_rate: item.vat_rate,
    line_total: item.total,
    extra_info: item.extra_info || null,
    skip_stock: !decrementStock || isCustomInventoryHandledItem(item),
  };

  if (!item.polywood_sale_mode) {
    return base;
  }

  const polywoodLengthM =
    item.polywood_length_m ??
    (item.polywood_sale_mode === "linear_m"
      ? item.quantity
      : item.polywood_sale_mode === "full_sheet"
        ? (item.polywood_full_sheet_length_m ?? DEFAULT_FULL_SHEET_LENGTH_M) * item.quantity
        : null);

  return {
    ...base,
    polywood_sale_mode: item.polywood_sale_mode,
    polywood_length_m: polywoodLengthM ?? null,
  };
}

type ProcessSalesInvoiceEventResponse = {
  sale_id?: string;
  doc_no?: string;
  event_id?: string;
  journal_entry_id?: string;
  items?: Array<{
    index?: number;
    id?: string;
    product_id?: string | null;
    polywood_sale_mode?: string | null;
  }>;
  success?: boolean;
  error?: string;
};

function isPolywoodSaleItem(item: SaleItem): boolean {
  return item.polywood_sale_mode === "linear_m" || item.polywood_sale_mode === "full_sheet";
}

/** True for any line item whose stock effect is handled by process_mixed_dimensional_sale
 *  (dimensional auto-cut, accessory deduction, service no-op) instead of the generic
 *  quantity decrement inside process_sales_invoice_event. */
function isCustomInventoryHandledItem(item: SaleItem): boolean {
  return (
    item.sale_item_type === "dimensional" ||
    item.sale_item_type === "accessory" ||
    item.sale_item_type === "service" ||
    isPolywoodSaleItem(item)
  );
}

interface MixedDimensionalCallPlan {
  itemType: MixedDimensionalItemType;
  saleMode?: MixedDimensionalSaleMode | null;
  amount: number;
  pieceCount: number;
}

function resolveMixedDimensionalCall(item: SaleItem): MixedDimensionalCallPlan | null {
  if (item.sale_item_type === "service") {
    return {
      itemType: "service",
      amount: item.quantity,
      pieceCount: Math.max(1, Math.round(item.quantity) || 1),
    };
  }
  if (item.sale_item_type === "accessory") {
    return { itemType: "accessory", amount: item.quantity, pieceCount: 1 };
  }
  if (item.sale_item_type === "dimensional") {
    if (item.polywood_sale_mode === "full_sheet") {
      return { itemType: "dimensional", saleMode: "full_sheet", amount: item.quantity, pieceCount: 1 };
    }
    // Meter mode: `quantity` is the number of identical cuts, `polywood_length_m` is
    // the length (in metres) of each individual cut.
    const perPieceLength = item.polywood_length_m || item.quantity;
    return {
      itemType: "dimensional",
      saleMode: "meter",
      amount: perPieceLength,
      pieceCount: item.piece_count || Math.round(item.quantity) || 1,
    };
  }
  if (isPolywoodSaleItem(item)) {
    // Legacy dedicated Polywood invoice: `quantity` is the amount itself
    // (sheet count or total metres for a single contiguous cut).
    return {
      itemType: "dimensional",
      saleMode: item.polywood_sale_mode as MixedDimensionalSaleMode,
      amount: item.quantity,
      pieceCount: 1,
    };
  }
  return null;
}

function buildRpcPayload(payload: SubmitSalePayload, validItems: SaleItem[]) {
  const decrementStock = payload.decrementStock !== false;
  const paymentsJson = toSalePaymentsJson(payload.payments);

  const docNo = payload.header.doc_no || payload.docNo;

  return {
    idempotency_key: saleInvoiceIdempotencyKey(docNo),
    decrement_stock: decrementStock,
    header: {
      ...payload.header,
      doc_no: payload.header.doc_no || payload.docNo,
      payments: paymentsJson,
    },
    items: validItems.map((item) => mapSaleItemToRpcPayload(item, decrementStock)),
    payments: payload.payments.map((pay) => ({
      account_id: pay.account_id || null,
      method: pay.method || "",
      amount: pay.amount,
      id: pay.id,
    })),
    additional_expenses: documentExpensesToRpcPayload(payload.additionalExpenses || []),
  };
}

/**
 * Applies the dimensional auto-cut / accessory / service stock effects for a
 * submitted invoice via the atomic `process_mixed_dimensional_sale` RPC.
 * Covers both the dedicated Polywood invoice (invoiceMode="polywood",
 * `polywood_sale_mode` set) and the generic mixed-grid items
 * (`sale_item_type` set) used by the multi-category dimensional invoice.
 */
async function applyDimensionalAndAccessoryDeductions(
  validItems: SaleItem[],
  insertedItems: ProcessSalesInvoiceEventResponse["items"]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const byIndex = new Map<number, NonNullable<ProcessSalesInvoiceEventResponse["items"]>[number]>();
  for (const row of insertedItems || []) {
    if (typeof row.index === "number") byIndex.set(row.index, row);
  }

  for (let index = 0; index < validItems.length; index += 1) {
    const item = validItems[index];
    const inserted = byIndex.get(index);
    const plan = resolveMixedDimensionalCall(item);
    if (!plan) continue;

    if (plan.itemType === "service") {
      const productId = resolveSaleItemProductId(item);
      if (!productId || !inserted?.id) continue;

      const result = await processMixedDimensionalSaleRpc({
        productId,
        warehouseId: item.warehouse_id || null,
        itemType: "service",
        amount: plan.amount,
        pieceCount: plan.pieceCount,
        saleItemId: inserted.id,
      });

      if (!result.ok) {
        return {
          ok: false,
          error: `${item.product_name}: ${result.error || "Xidmət sətri emal edilmədi"}`,
        };
      }

      await supabase
        .from("sale_items")
        .update({
          sale_item_type: "service",
          piece_count: plan.pieceCount,
        })
        .eq("id", inserted.id);
      continue;
    }

    const productId = resolveSaleItemProductId(item);
    if (!productId || !inserted?.id) continue;

    const result = await processMixedDimensionalSaleRpc({
      productId,
      warehouseId: item.warehouse_id || null,
      itemType: plan.itemType,
      saleMode: plan.saleMode,
      amount: plan.amount,
      pieceCount: plan.pieceCount,
      saleItemId: inserted.id,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: `${item.product_name}: ${result.error || "Anbar əməliyyatı alınmadı"}`,
      };
    }

    if (item.sale_item_type) {
      await supabase
        .from("sale_items")
        .update({ sale_item_type: item.sale_item_type, piece_count: plan.pieceCount })
        .eq("id", inserted.id);
    }
  }

  return { ok: true };
}

export async function submitSale(payload: SubmitSalePayload): Promise<SubmitSaleResult> {
  const validItems = payload.items
    .filter((i) => i.product_id || i.product_name.trim())
    .map((item) => normalizeSaleItemProductId(item));

  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  const productIdError = validateSaleItemsHaveProductIds(validItems);
  if (productIdError) {
    return { success: false, error: productIdError };
  }

  const paymentCheck = validateCashPaymentsRequireAccount(payload.payments);
  if (!paymentCheck.ok) {
    return { success: false, error: paymentCheck.error };
  }

  const rpcPayload = buildRpcPayload(payload, validItems);
  console.log("SALE_PAYLOAD_ITEMS:", rpcPayload.items);

  const { data, error } = await supabase.rpc("process_sales_invoice_event", {
    p_payload: rpcPayload,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = (data ?? null) as ProcessSalesInvoiceEventResponse | null;
  if (result && result.success === false && result.error) {
    return { success: false, error: String(result.error) };
  }

  const saleId = result?.sale_id ? String(result.sale_id) : "";
  if (!saleId) {
    return { success: false, error: "Satış RPC cavab vermədi (sale_id yoxdur)" };
  }

  const docNo = result?.doc_no ? String(result.doc_no) : payload.docNo;

  if (payload.decrementStock !== false) {
    const dimensional = await applyDimensionalAndAccessoryDeductions(validItems, result?.items);
    if (!dimensional.ok) {
      return {
        success: false,
        saleId,
        error: `${dimensional.error} (Satış #${docNo} yaradıldı, amma anbar əməliyyatı tamamlanmadı)`,
      };
    }
  }

  await recordSaleCommissions(
    saleId,
    docNo,
    payload.header.seller_id,
    payload.header.seller_name,
    validItems
  );

  return { success: true, saleId };
}
