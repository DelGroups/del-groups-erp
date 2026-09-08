import { postCashTransaction, validateCashPaymentsRequireAccount } from "@/lib/finance/accountLedger";
import { purchaseReceiptIdempotencyKey } from "@/lib/finance/erpEvents";
import {
  documentExpensesToRpcPayload,
  type DocumentAdditionalExpense,
} from "@/lib/forms/documentExpenses";
import type { OfficialDocumentFields } from "@/lib/finance/officialTransaction";
import { persistPurchaseOfficialFields } from "@/lib/finance/officialTransaction";
import { applyPurchaseStockDeltas } from "@/lib/inventory/stockAdjustment";
import { supabase } from "@/lib/supabase";
import type { PurchaseInsert, PurchaseLineItem } from "@/types/database.types";
import { fulfillProductionPurchaseRequestsByPurchaseId } from "@/lib/purchases/fulfillProductionRequests";
import { purchaseLineItemsToRows, type PurchasePaymentRow } from "@/lib/purchases/helpers";

export interface SubmitPurchasePayload {
  header: PurchaseInsert;
  items: PurchaseLineItem[];
  invoiceNumber: string;
  payments?: PurchasePaymentRow[];
  additionalExpenses?: DocumentAdditionalExpense[];
  officialFields?: OfficialDocumentFields;
}

export interface SubmitPurchaseResult {
  success: boolean;
  error?: string;
  purchaseId?: string;
}

type ProcessPurchaseReceiptEventResponse = {
  purchase_id?: string;
  invoice_number?: string;
  journal_entry_id?: string;
  event_id?: string;
  success?: boolean;
  error?: string;
};

function buildCreatePurchasePayload(payload: SubmitPurchasePayload, validItems: PurchaseLineItem[]) {
  return {
    idempotency_key: purchaseReceiptIdempotencyKey(payload.invoiceNumber),
    invoice_number: payload.invoiceNumber,
    header: {
      invoice_number: payload.header.invoice_number || payload.invoiceNumber,
      supplier_id: payload.header.supplier_id,
      warehouse_id: payload.header.warehouse_id ?? null,
      doc_date: payload.header.doc_date ?? null,
      responsible_id: payload.header.responsible_id ?? null,
      responsible_name: payload.header.responsible_name ?? null,
      total_amount: payload.header.total_amount,
      paid_amount: payload.header.paid_amount,
      debt_amount: payload.header.debt_amount,
      status: payload.header.status ?? null,
      notes: payload.header.notes ?? null,
    },
    items: validItems.map((item) => ({
      product_id: item.product_id,
      product_code: item.product_code || null,
      product_name: item.product_name || null,
      quantity: item.quantity,
      unit: item.unit || "Ədəd",
      unit_price: item.unit_price,
      total_price: item.total,
    })),
    payments: (payload.payments || []).map((pay) => ({
      account_id: pay.account_id || null,
      amount: pay.amount,
      payment_date: pay.payment_date || null,
      note: pay.note || "",
    })),
    additional_expenses: documentExpensesToRpcPayload(payload.additionalExpenses || []),
  };
}

function toPurchaseStockLines(items: PurchaseLineItem[]) {
  return items
    .filter((item) => item.product_id && item.quantity > 0)
    .map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));
}

function buildUnitPriceByProduct(items: PurchaseLineItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!item.product_id) continue;
    map.set(item.product_id, item.unit_price);
  }
  return map;
}

async function processPurchasePaymentsOnEdit(
  payments: PurchasePaymentRow[],
  invoiceNumber: string,
  purchaseId: string
): Promise<{ ok: boolean; error?: string }> {
  const validPayments = payments.filter((p) => p.account_id && p.amount > 0);
  const accountCheck = validateCashPaymentsRequireAccount(validPayments);
  if (!accountCheck.ok) return accountCheck;

  for (const pay of validPayments) {
    const noteText = [
      pay.payment_date,
      pay.note.trim() || `Alış fakturası ${invoiceNumber}`,
    ]
      .filter(Boolean)
      .join(" — ");

    const posted = await postCashTransaction({
      accountId: pay.account_id,
      type: "Məxaric",
      amount: pay.amount,
      category: "Alış Ödənişi",
      notes: noteText,
      sourceType: "purchase",
      sourceId: purchaseId,
    });

    if (!posted.success) {
      return { ok: false, error: posted.error || "Ödəniş qeydə alınmadı" };
    }
  }

  return { ok: true };
}

async function adjustSupplierBalance(
  supplierId: string,
  delta: number
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("balance")
    .eq("id", supplierId)
    .single();
  if (error || !data) return { ok: false, error: "Təchizatçı tapılmadı" };
  const newBalance = (Number(data.balance) || 0) + delta;
  const { error: updErr } = await supabase
    .from("suppliers")
    .update({ balance: newBalance })
    .eq("id", supplierId);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}

export async function submitPurchase(
  payload: SubmitPurchasePayload
): Promise<SubmitPurchaseResult> {
  const validItems = payload.items.filter((i) => i.product_id && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  const paymentCheck = validateCashPaymentsRequireAccount(payload.payments || []);
  if (!paymentCheck.ok) {
    return { success: false, error: paymentCheck.error };
  }

  const { data, error } = await supabase.rpc("process_purchase_receipt_event", {
    p_payload: buildCreatePurchasePayload(payload, validItems),
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = (data ?? null) as ProcessPurchaseReceiptEventResponse | null;
  if (result && result.success === false && result.error) {
    return { success: false, error: String(result.error) };
  }

  const purchaseId = result?.purchase_id ? String(result.purchase_id) : "";
  if (!purchaseId) {
    return { success: false, error: "Alış RPC cavab vermədi (purchase_id yoxdur)" };
  }

  if (payload.officialFields) {
    const persisted = await persistPurchaseOfficialFields(purchaseId, payload.officialFields);
    if (!persisted.ok) {
      return {
        success: false,
        purchaseId,
        error: persisted.error || "Rəsmi əməliyyat sahələri saxlanmadı",
      };
    }
  }

  await fulfillProductionPurchaseRequestsByPurchaseId(purchaseId);

  return { success: true, purchaseId };
}

/** Edit flow — still multi-step until update_purchase_atomic is implemented. */
export async function updatePurchase(
  purchaseId: string,
  payload: SubmitPurchasePayload,
  previousItems: PurchaseLineItem[],
  previousDebt: number,
  previousSupplierId: string
): Promise<SubmitPurchaseResult> {
  const validItems = payload.items.filter((i) => i.product_id && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  const stockResult = await applyPurchaseStockDeltas(
    supabase,
    toPurchaseStockLines(previousItems),
    toPurchaseStockLines(validItems),
    buildUnitPriceByProduct(validItems)
  );
  if (!stockResult.ok) {
    return { success: false, error: stockResult.error };
  }

  if (previousDebt > 0 && previousSupplierId) {
    await adjustSupplierBalance(previousSupplierId, -previousDebt);
  }

  if (payload.header.debt_amount > 0) {
    const balResult = await adjustSupplierBalance(
      payload.header.supplier_id,
      payload.header.debt_amount
    );
    if (!balResult.ok) return { success: false, error: balResult.error };
  }

  const { error: itemsDelErr } = await supabase
    .from("purchase_items")
    .delete()
    .eq("purchase_id", purchaseId);
  if (itemsDelErr) return { success: false, error: itemsDelErr.message };

  const { error: itemsInsErr } = await supabase
    .from("purchase_items")
    .insert(purchaseLineItemsToRows(purchaseId, validItems));
  if (itemsInsErr) return { success: false, error: itemsInsErr.message };

  const { error: updErr } = await supabase
    .from("purchases")
    .update({
      supplier_id: payload.header.supplier_id,
      warehouse_id: payload.header.warehouse_id,
      doc_date: payload.header.doc_date,
      responsible_id: payload.header.responsible_id,
      responsible_name: payload.header.responsible_name,
      total_amount: payload.header.total_amount,
      paid_amount: payload.header.paid_amount,
      debt_amount: payload.header.debt_amount,
      status: payload.header.status,
      notes: payload.header.notes,
      additional_expenses: documentExpensesToRpcPayload(payload.additionalExpenses || []),
      additional_expenses_total: (payload.additionalExpenses || []).reduce(
        (sum, row) => sum + (Number(row.amount) || 0),
        0
      ),
    })
    .eq("id", purchaseId);

  if (updErr) return { success: false, error: updErr.message };

  if (payload.payments?.length) {
    const payResult = await processPurchasePaymentsOnEdit(
      payload.payments,
      payload.invoiceNumber,
      purchaseId
    );
    if (!payResult.ok) return { success: false, error: payResult.error };
  }

  if (payload.officialFields) {
    const persisted = await persistPurchaseOfficialFields(purchaseId, payload.officialFields);
    if (!persisted.ok) {
      return {
        success: false,
        purchaseId,
        error: persisted.error || "Rəsmi əməliyyat sahələri saxlanmadı",
      };
    }
  }

  await fulfillProductionPurchaseRequestsByPurchaseId(purchaseId);

  return { success: true, purchaseId };
}
