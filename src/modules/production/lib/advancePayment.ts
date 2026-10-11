import { erpIdempotencyKey } from "@/lib/finance/erpEvents";

export function productionAdvanceIdempotencyKey(orderId: string): string {
  return erpIdempotencyKey("production_advance", orderId);
}

export type ProcessProductionAdvanceResponse = {
  success?: boolean;
  error?: string;
  skipped?: boolean;
  already_posted?: boolean;
  transaction_id?: string;
  amount?: number;
  event_id?: string;
};

/** Untyped admin client — RPC may not be in generated Database types yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => any };

export async function recordProductionAdvancePayment(
  client: RpcClient,
  input: {
    orderId: string;
    accountId: string;
    amount?: number;
    idempotencyKey?: string;
  }
): Promise<{ ok: true; transactionId?: string; alreadyPosted?: boolean } | { ok: false; error: string }> {
  const { data, error } = await client.rpc("process_production_advance_payment_event", {
    p_payload: {
      order_id: input.orderId,
      account_id: input.accountId,
      amount: input.amount,
      idempotency_key: input.idempotencyKey || productionAdvanceIdempotencyKey(input.orderId),
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const result = (data ?? null) as ProcessProductionAdvanceResponse | null;
  if (result?.success === false && result.error) {
    return { ok: false, error: String(result.error) };
  }

  return {
    ok: true,
    transactionId: result?.transaction_id ? String(result.transaction_id) : undefined,
    alreadyPosted: Boolean(result?.already_posted),
  };
}
