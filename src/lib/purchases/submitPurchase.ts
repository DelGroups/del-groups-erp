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
import { applyMetricPurchaseReceipts } from "@/lib/polywood/metricReceive";

export interface SubmitPurchasePayload {
  header: PurchaseInsert & {
    due_date?: string | null;
    additional_expenses_total?: number;
    is_official?: boolean;
    contract_id?: string | null;
    vat_mode?: string | null;
    subtotal_amount?: number | null;
    vat_rate?: number | null;
    vat_amount?: number | null;
    grand_total?: number | null;
  };
  items: PurchaseLineItem[];
  invoiceNumber: string;
  payments?: PurchasePaymentRow[];
  additionalExpenses?: DocumentAdditionalExpense[];
  officialFields?: OfficialDocumentFields;
  mode?: "draft" | "post";
  purchaseId?: string | null;
}

export interface SubmitPurchaseResult {
  success: boolean;
  error?: string;
  purchaseId?: string;
  invoiceNumber?: string;
  status?: "draft" | "posted";
}

type ProcessPurchaseEventResponse = {
  purchase_id?: string;
  invoice_number?: string;
  journal_entry_id?: string;
  event_id?: string;
  success?: boolean;
  error?: string;
  status?: string;
};

function buildDraftRpcPayload(payload: SubmitPurchasePayload, validItems: PurchaseLineItem[]) {
  const payments = (payload.payments || []).map((pay) => ({
    account_id: pay.account_id || null,
    amount: pay.amount,
    payment_date: pay.payment_date || null,
    note: pay.note || "",
  }));

  return {
    purchase_id: payload.purchaseId || null,
    invoice_number: payload.invoiceNumber,
    header: {
      ...payload.header,
      invoice_number: payload.header.invoice_number || payload.invoiceNumber,
      additional_expenses_total: (payload.additionalExpenses || []).reduce(
        (sum, row) => sum + (Number(row.amount) || 0),
        0
      ),
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
    payments,
    additional_expenses: documentExpensesToRpcPayload(payload.additionalExpenses || []),
  };
}

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

async function applyPostedMetricReceipts(
  payload: SubmitPurchasePayload,
  validItems: PurchaseLineItem[],
  purchaseId: string
): Promise<SubmitPurchaseResult | null> {
  const warehouseId = payload.header.warehouse_id;
  if (!warehouseId) return null;
  const metricItems = validItems.filter((item) => item.metric_receive_mode);
  if (metricItems.length === 0) return null;
  const result = await applyMetricPurchaseReceipts(metricItems, warehouseId);
  if (!result.ok) {
    return { success: false, purchaseId, error: result.error };
  }
  return null;
}

async function persistOfficialFields(
  payload: SubmitPurchasePayload,
  purchaseId: string
): Promise<SubmitPurchaseResult | null> {
  if (!payload.officialFields) return null;
  const persisted = await persistPurchaseOfficialFields(purchaseId, payload.officialFields);
  if (!persisted.ok) {
    return {
      success: false,
      purchaseId,
      error: persisted.error || "Rəsmi əməliyyat sahələri saxlanmadı",
    };
  }
  return null;
}

export async function submitPurchase(
  payload: SubmitPurchasePayload
): Promise<SubmitPurchaseResult> {
  const validItems = payload.items.filter((i) => i.product_id && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  const mode = payload.mode || "post";
  const paymentCheck = validateCashPaymentsRequireAccount(payload.payments || []);
  if (mode !== "draft" && !paymentCheck.ok) {
    return { success: false, error: paymentCheck.error };
  }

  const draftPayload = buildDraftRpcPayload(payload, validItems);

  if (mode === "draft") {
    const { data, error } = await supabase.rpc("save_purchase_invoice_draft", {
      p_payload: draftPayload,
    });
    if (error) return { success: false, error: error.message };
    const result = (data ?? null) as ProcessPurchaseEventResponse | null;
    if (result && result.success === false && result.error) {
      return { success: false, error: String(result.error) };
    }
    const purchaseId = result?.purchase_id ? String(result.purchase_id) : "";
    if (!purchaseId) {
      return { success: false, error: "Alış draft RPC cavab vermədi (purchase_id yoxdur)" };
    }
    const officialError = await persistOfficialFields(payload, purchaseId);
    if (officialError) return officialError;
    return {
      success: true,
      purchaseId,
      invoiceNumber: result?.invoice_number
        ? String(result.invoice_number)
        : payload.invoiceNumber,
      status: "draft",
    };
  }

  if (payload.purchaseId) {
    const saved = await supabase.rpc("save_purchase_invoice_draft", {
      p_payload: { ...draftPayload, purchase_id: payload.purchaseId },
    });
    if (saved.error) return { success: false, error: saved.error.message };
    const savedResult = (saved.data ?? null) as ProcessPurchaseEventResponse | null;
    if (savedResult && savedResult.success === false && savedResult.error) {
      return { success: false, error: String(savedResult.error) };
    }

    const { data, error } = await supabase.rpc("post_purchase_invoice_draft", {
      p_purchase_id: payload.purchaseId,
    });
    if (error) return { success: false, error: error.message };
    const result = (data ?? null) as ProcessPurchaseEventResponse | null;
    if (result && result.success === false && result.error) {
      return { success: false, error: String(result.error) };
    }

    const officialError = await persistOfficialFields(payload, payload.purchaseId);
    if (officialError) return officialError;
    const metricError = await applyPostedMetricReceipts(payload, validItems, payload.purchaseId);
    if (metricError) return metricError;
    await fulfillProductionPurchaseRequestsByPurchaseId(payload.purchaseId);

    return {
      success: true,
      purchaseId: payload.purchaseId,
      invoiceNumber: result?.invoice_number
        ? String(result.invoice_number)
        : payload.invoiceNumber,
      status: "posted",
    };
  }

  const saved = await supabase.rpc("save_purchase_invoice_draft", {
    p_payload: { ...draftPayload, purchase_id: null },
  });
  if (saved.error) return { success: false, error: saved.error.message };
  const savedResult = (saved.data ?? null) as ProcessPurchaseEventResponse | null;
  if (savedResult && savedResult.success === false && savedResult.error) {
    return { success: false, error: String(savedResult.error) };
  }
  const draftId = savedResult?.purchase_id ? String(savedResult.purchase_id) : "";
  if (!draftId) {
    return { success: false, error: "Alış draft RPC cavab vermədi (purchase_id yoxdur)" };
  }

  const { data, error } = await supabase.rpc("post_purchase_invoice_draft", {
    p_purchase_id: draftId,
  });
  if (error) return { success: false, error: error.message };
  const result = (data ?? null) as ProcessPurchaseEventResponse | null;
  if (result && result.success === false && result.error) {
    return { success: false, error: String(result.error) };
  }

  const officialError = await persistOfficialFields(payload, draftId);
  if (officialError) return officialError;
  const metricError = await applyPostedMetricReceipts(payload, validItems, draftId);
  if (metricError) return metricError;
  await fulfillProductionPurchaseRequestsByPurchaseId(draftId);

  return {
    success: true,
    purchaseId: draftId,
    invoiceNumber: result?.invoice_number
      ? String(result.invoice_number)
      : savedResult?.invoice_number
        ? String(savedResult.invoice_number)
        : payload.invoiceNumber,
    status: "posted",
  };
}

/** Legacy immediate-post path (modal edit of already-posted documents). */
export async function submitPurchaseImmediate(
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

  const result = (data ?? null) as ProcessPurchaseEventResponse | null;
  if (result && result.success === false && result.error) {
    return { success: false, error: String(result.error) };
  }

  const purchaseId = result?.purchase_id ? String(result.purchase_id) : "";
  if (!purchaseId) {
    return { success: false, error: "Alış RPC cavab vermədi (purchase_id yoxdur)" };
  }

  const officialError = await persistOfficialFields(payload, purchaseId);
  if (officialError) return officialError;

  await fulfillProductionPurchaseRequestsByPurchaseId(purchaseId);

  return {
    success: true,
    purchaseId,
    invoiceNumber: result?.invoice_number
      ? String(result.invoice_number)
      : payload.invoiceNumber,
    status: "posted",
  };
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

  const officialError = await persistOfficialFields(payload, purchaseId);
  if (officialError) return officialError;

  await fulfillProductionPurchaseRequestsByPurchaseId(purchaseId);

  return { success: true, purchaseId };
}
