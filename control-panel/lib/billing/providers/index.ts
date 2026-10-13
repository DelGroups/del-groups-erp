/**
 * The payment providers this deployment can use, by id. Bank transfer is always there; the
 * card gateway only once its env settings are filled in.
 */
import { cardGateway } from "./cardGateway.ts";
import { manualBankTransfer, type BankDetails } from "./manualBankTransfer.ts";
import type { PaymentProvider } from "./types.ts";

export const MANUAL_PROVIDER_ID = "manual_bank_transfer";

export interface ProviderRegistry {
  get(id: string): PaymentProvider | null;
  /** Providers that can be chosen for a subscription (configured ones). */
  available(): PaymentProvider[];
  /** The card gateway, configured or not (for its missing settings). */
  card: PaymentProvider;
}

export function providerRegistry(env: Readonly<Record<string, string | undefined>>, bank: () => Promise<BankDetails>): ProviderRegistry {
  const manual = manualBankTransfer(bank);
  const card = cardGateway(env);
  const usable = [manual, ...(card.missing.length ? [] : [card])];
  return {
    get: (id) => usable.find((p) => p.id === id) ?? null,
    available: () => usable,
    card,
  };
}

export type { PaymentProvider } from "./types.ts";
