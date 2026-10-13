/**
 * Payment providers (prompt 13, plan §4.5). The billing job, the panel and the payment
 * webhook only talk to this interface, so a gateway can be added or swapped without touching
 * invoicing or dunning. Amounts are integer minor units (qəpik/cents).
 *
 * Implementations: ManualBankTransfer (bank details on the invoice; an admin marks it paid)
 * and the local card gateway stub (cardGateway.ts), filled in once the gateway is chosen.
 */

export interface CheckoutInvoice {
  id: string;
  number: string;
  tenantId: string;
  /** Still to pay. */
  amountCents: number;
  currency: string;
  description: string;
}

export type Checkout =
  /** Send the payer to the gateway's payment page. */
  | { kind: "redirect"; url: string; reference: string }
  /** Pay outside the system (bank transfer); show these details. */
  | { kind: "instructions"; reference: string; lines: { label: string; value: string }[] };

export interface SavedCard {
  id: string;
  /** The gateway's token for the card (from Vault, never logged). */
  token: string;
}

export type ChargeResult =
  | { status: "succeeded"; reference: string }
  | { status: "failed"; reference: string | null; reason: string };

export type RefundResult = { status: "refunded" | "pending"; reference: string | null };

/** A payment event reported by the gateway, after its signature was checked. */
export interface PaymentEvent {
  type: "payment.succeeded" | "payment.failed" | "payment.refunded";
  /** The gateway's own id of the payment (idempotency key in payments). */
  reference: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  occurredAt: string;
  failureReason?: string;
  /** Present when the payer saved the card for later charges. */
  savedCard?: { token: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };
}

export interface WebhookRequest {
  headers: Pick<Headers, "get">;
  rawBody: string;
  now: number;
}

export interface PaymentProvider {
  /** Stored in subscriptions.payment_provider and payments.provider. */
  readonly id: string;
  readonly supportsSavedCards: boolean;
  /** Missing env settings; empty when the provider can be used. */
  readonly missing: readonly string[];
  createCheckout(invoice: CheckoutInvoice, options: { returnUrl: string | null }): Promise<Checkout>;
  chargeSavedCard(invoice: CheckoutInvoice, card: SavedCard): Promise<ChargeResult>;
  refund(payment: { reference: string; amountCents: number; currency: string }): Promise<RefundResult>;
  /** The event of a genuine webhook call, or null when the signature or body is not valid. */
  verifyWebhook(request: WebhookRequest): Promise<PaymentEvent | null>;
}

export class PaymentProviderError extends Error {
  readonly code: "not_configured" | "not_supported" | "not_implemented" | "gateway_error";
  constructor(code: PaymentProviderError["code"], message: string) {
    super(message);
    this.name = "PaymentProviderError";
    this.code = code;
  }
}
