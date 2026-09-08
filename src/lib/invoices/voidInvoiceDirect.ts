import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import type { PermissionKey } from "@/types/database.types";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export type VoidInvoiceResult = { success: boolean; error?: string };

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type CashTransactionRow = {
  id: string;
  account_id: string | null;
  type: string;
  amount: number;
};

async function requireAnyPermission(...permissions: PermissionKey[]): Promise<void> {
  let lastError: ActionAuthError | null = null;
  for (const permission of permissions) {
    try {
      await requirePermissionAction(permission);
      return;
    } catch (err) {
      if (err instanceof ActionAuthError) {
        lastError = err;
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new ActionAuthError("İcazəniz yoxdur");
}

async function reverseAndDeleteTransactions(
  client: SupabaseClient,
  transactions: CashTransactionRow[]
): Promise<void> {
  if (transactions.length === 0) return;

  const accountDeltas = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.account_id) continue;
    const amount = Number(tx.amount) || 0;
    const delta = tx.type === "Mədaxil" ? -amount : amount;
    accountDeltas.set(tx.account_id, (accountDeltas.get(tx.account_id) || 0) + delta);
  }

  for (const [accountId, delta] of accountDeltas) {
    const { data: account, error: fetchError } = await client
      .from("accounts")
      .select("balance")
      .eq("id", accountId)
      .single();

    if (fetchError || !account) {
      throw new Error(fetchError?.message || "Hesab tapılmadı");
    }

    const nextBalance = Math.max(0, (Number(account.balance) || 0) + delta);
    const { error: updateError } = await client
      .from("accounts")
      .update({ balance: nextBalance })
      .eq("id", accountId);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  const ids = transactions.map((tx) => tx.id);
  const { error: deleteError } = await client.from("transactions").delete().in("id", ids);
  if (deleteError) {
    throw new Error(deleteError.message);
  }
}

async function deleteDocumentCashTransactions(
  client: SupabaseClient,
  sourceType: "sale" | "purchase",
  sourceId: string,
  docLabel: string
): Promise<void> {
  const { data: linked, error: linkedError } = await client
    .from("transactions")
    .select("id, account_id, type, amount")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);

  if (linkedError) {
    throw new Error(linkedError.message);
  }

  const rows: CashTransactionRow[] = [...(linked || [])];
  const seen = new Set(rows.map((row) => row.id));

  if (docLabel.trim()) {
    const { data: legacy, error: legacyError } = await client
      .from("transactions")
      .select("id, account_id, type, amount, source_type, source_id")
      .is("source_type", null)
      .is("source_id", null)
      .ilike("notes", `%${docLabel.trim()}%`);

    if (legacyError) {
      throw new Error(legacyError.message);
    }

    for (const row of legacy || []) {
      if (!seen.has(row.id)) {
        rows.push(row);
        seen.add(row.id);
      }
    }
  }

  await reverseAndDeleteTransactions(client, rows);
}

async function restoreSaleStock(client: SupabaseClient, saleId: string): Promise<void> {
  const { data: items, error } = await client
    .from("sale_items")
    .select("product_id, quantity, polywood_sale_mode")
    .eq("sale_id", saleId);

  if (error) {
    throw new Error(error.message);
  }

  for (const item of items || []) {
    if (!item.product_id || item.polywood_sale_mode) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    const { data: product, error: productError } = await client
      .from("products")
      .select("stock")
      .eq("id", item.product_id)
      .single();

    if (productError || !product) continue;

    const { error: updateError } = await client
      .from("products")
      .update({ stock: (Number(product.stock) || 0) + qty })
      .eq("id", item.product_id);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }
}

async function revertPurchaseStock(client: SupabaseClient, purchaseId: string): Promise<void> {
  const { data: items, error } = await client
    .from("purchase_items")
    .select("product_id, quantity")
    .eq("purchase_id", purchaseId);

  if (error) {
    throw new Error(error.message);
  }

  for (const item of items || []) {
    if (!item.product_id) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    const { data: product, error: productError } = await client
      .from("products")
      .select("stock")
      .eq("id", item.product_id)
      .single();

    if (productError || !product) continue;

    const { error: updateError } = await client
      .from("products")
      .update({ stock: Math.max(0, (Number(product.stock) || 0) - qty) })
      .eq("id", item.product_id);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }
}

async function refreshCustomerArBalance(
  client: SupabaseClient,
  customerId: string
): Promise<void> {
  const { data: rows, error } = await client
    .from("sales")
    .select("remaining_balance")
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(error.message);
  }

  const openAr = (rows || []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.remaining_balance) || 0),
    0
  );

  const { error: updateError } = await client
    .from("customers")
    .update({ balance: openAr })
    .eq("id", customerId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

async function revertSupplierDebt(
  client: SupabaseClient,
  supplierId: string,
  debtAmount: number
): Promise<void> {
  if (debtAmount <= 0.001) return;

  const { data: supplier, error: fetchError } = await client
    .from("suppliers")
    .select("balance")
    .eq("id", supplierId)
    .single();

  if (fetchError || !supplier) {
    throw new Error(fetchError?.message || "Təchizatçı tapılmadı");
  }

  const { error: updateError } = await client
    .from("suppliers")
    .update({
      balance: Math.max(0, (Number(supplier.balance) || 0) - debtAmount),
    })
    .eq("id", supplierId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

async function deleteLinkedWarehouseSlips(
  client: SupabaseClient,
  sourceType: "sale" | "purchase",
  sourceId: string
): Promise<void> {
  const { error } = await client
    .from("warehouse_slips")
    .delete()
    .eq("source_type", sourceType)
    .eq("source_document_id", sourceId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function voidSaleInvoiceDirect(saleId: string): Promise<VoidInvoiceResult> {
  if (!saleId?.trim()) {
    return { success: false, error: "Satış tapılmadı" };
  }

  try {
    await requireAnyPermission("can_delete_sales", "can_edit_sales");
    const client = await createSupabaseServerClient();

    const { data: sale, error: fetchError } = await client
      .from("sales")
      .select("id, doc_no, invoice_number, customer_id")
      .eq("id", saleId)
      .single();

    if (fetchError || !sale) {
      return { success: false, error: fetchError?.message || "Satış fakturası tapılmadı" };
    }

    const docLabel =
      (typeof sale.doc_no === "string" && sale.doc_no.trim()) ||
      (typeof sale.invoice_number === "string" && sale.invoice_number.trim()) ||
      saleId;

    await restoreSaleStock(client, saleId);
    await deleteDocumentCashTransactions(client, "sale", saleId, docLabel);
    await deleteLinkedWarehouseSlips(client, "sale", saleId);

    const { error: deleteItemsError } = await client
      .from("sale_items")
      .delete()
      .eq("sale_id", saleId);

    if (deleteItemsError) {
      return { success: false, error: deleteItemsError.message };
    }

    const { error: deleteSaleError } = await client.from("sales").delete().eq("id", saleId);

    if (deleteSaleError) {
      return { success: false, error: deleteSaleError.message };
    }

    if (sale.customer_id) {
      await refreshCustomerArBalance(client, sale.customer_id);
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Satış fakturası silinmədi",
    };
  }
}

export async function voidPurchaseInvoiceDirect(
  purchaseId: string
): Promise<VoidInvoiceResult> {
  if (!purchaseId?.trim()) {
    return { success: false, error: "Alış tapılmadı" };
  }

  try {
    await requireAnyPermission("can_delete_purchases", "can_edit_purchases");
    const client = await createSupabaseServerClient();

    const { data: purchase, error: fetchError } = await client
      .from("purchases")
      .select("id, invoice_number, supplier_id, debt_amount")
      .eq("id", purchaseId)
      .single();

    if (fetchError || !purchase) {
      return { success: false, error: fetchError?.message || "Alış fakturası tapılmadı" };
    }

    const docLabel =
      (typeof purchase.invoice_number === "string" && purchase.invoice_number.trim()) ||
      purchaseId;

    await revertPurchaseStock(client, purchaseId);
    await deleteDocumentCashTransactions(client, "purchase", purchaseId, docLabel);

    if (purchase.supplier_id) {
      await revertSupplierDebt(
        client,
        purchase.supplier_id,
        Number(purchase.debt_amount) || 0
      );
    }

    await deleteLinkedWarehouseSlips(client, "purchase", purchaseId);

    const { error: deleteItemsError } = await client
      .from("purchase_items")
      .delete()
      .eq("purchase_id", purchaseId);

    if (deleteItemsError) {
      return { success: false, error: deleteItemsError.message };
    }

    const { error: deletePurchaseError } = await client
      .from("purchases")
      .delete()
      .eq("id", purchaseId);

    if (deletePurchaseError) {
      return { success: false, error: deletePurchaseError.message };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Alış fakturası silinmədi",
    };
  }
}
