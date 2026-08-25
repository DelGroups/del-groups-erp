import { supabase } from "@/lib/supabase";
import type { SalePayment } from "@/types/database.types";
import { toSalePaymentsJson } from "@/types/database.types";

export interface RecordSalePaymentInput {
  saleId: string;
  docNo: string;
  customerId?: string | null;
  amount: number;
  accountId: string;
  method: string;
  notes?: string;
  currentPaid: number;
  totalAmount: number;
  existingPayments: SalePayment[];
}

export async function recordSalePayment(
  input: RecordSalePaymentInput
): Promise<{ success: boolean; error?: string }> {
  const remaining = Math.max(0, input.totalAmount - input.currentPaid);
  if (input.amount <= 0) return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
  if (input.amount > remaining + 0.001) {
    return { success: false, error: `Qalan borc: ${remaining.toFixed(2)} AZN` };
  }

  const newPaid = input.currentPaid + input.amount;
  const newRemaining = Math.max(0, input.totalAmount - newPaid);
  const newPayment: SalePayment = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    account_id: input.accountId,
    method: input.method,
    amount: input.amount,
  };
  const updatedPayments = [...input.existingPayments, newPayment];

  const { error: saleError } = await supabase
    .from("sales")
    .update({
      paid_amount: newPaid,
      remaining_balance: newRemaining,
      payments: toSalePaymentsJson(updatedPayments),
    })
    .eq("id", input.saleId);

  if (saleError) return { success: false, error: saleError.message };

  const { error: txError } = await supabase.from("transactions").insert([
    {
      account_id: input.accountId,
      type: "Mədaxil",
      amount: input.amount,
      category: "Satış Ödənişi",
      notes: input.notes || `Satış fakturası ${input.docNo} — ${input.method}`,
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
      .update({ balance: (Number(account.balance) || 0) + input.amount })
      .eq("id", input.accountId);
  }

  if (input.customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("balance")
      .eq("id", input.customerId)
      .single();
    if (customer) {
      await supabase
        .from("customers")
        .update({ balance: Math.max(0, (Number(customer.balance) || 0) - input.amount) })
        .eq("id", input.customerId);
    }
  }

  return { success: true };
}
