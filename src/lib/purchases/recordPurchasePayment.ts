import { supabase } from "@/lib/supabase";

export interface RecordPurchasePaymentInput {
  purchaseId: string;
  invoiceNumber: string;
  supplierId: string | null;
  amount: number;
  accountId: string;
  method: string;
  notes?: string;
  currentPaid: number;
  totalAmount: number;
  currentDebt: number;
}

export async function recordPurchasePayment(
  input: RecordPurchasePaymentInput
): Promise<{ success: boolean; error?: string }> {
  if (input.amount <= 0) return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
  if (input.amount > input.currentDebt + 0.001) {
    return { success: false, error: `Qalan borc: ${input.currentDebt.toFixed(2)} AZN` };
  }

  const newPaid = input.currentPaid + input.amount;
  const newDebt = Math.max(0, input.totalAmount - newPaid);
  const status = newDebt > 0 ? "Borclu" : "Ödənilib";

  const { error: purchaseError } = await supabase
    .from("purchases")
    .update({
      paid_amount: newPaid,
      debt_amount: newDebt,
      status,
    })
    .eq("id", input.purchaseId);

  if (purchaseError) return { success: false, error: purchaseError.message };

  const { error: txError } = await supabase.from("transactions").insert([
    {
      account_id: input.accountId,
      type: "Məxaric",
      amount: input.amount,
      category: "Alış Ödənişi",
      notes: input.notes || `Alış fakturası ${input.invoiceNumber} — ${input.method}`,
    },
  ]);

  if (txError) return { success: false, error: txError.message };

  const { data: account } = await supabase
    .from("accounts")
    .select("balance")
    .eq("id", input.accountId)
    .single();

  if (account) {
    await supabase
      .from("accounts")
      .update({ balance: (Number(account.balance) || 0) - input.amount })
      .eq("id", input.accountId);
  }

  if (input.supplierId && input.amount > 0) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("balance")
      .eq("id", input.supplierId)
      .single();
    if (supplier) {
      await supabase
        .from("suppliers")
        .update({ balance: Math.max(0, (Number(supplier.balance) || 0) - input.amount) })
        .eq("id", input.supplierId);
    }
  }

  return { success: true };
}
