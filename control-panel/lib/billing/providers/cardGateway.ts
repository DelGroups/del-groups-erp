/**
 * STUB of the local card gateway (Payriff, Epoint, a bank's e-commerce gateway, …), to be
 * completed once Del chooses the gateway and shares its API docs. Until then:
 * - the settings are read from env (server only, never NEXT_PUBLIC_, never in the database);
 * - createCheckout, chargeSavedCard and refund throw PaymentProviderError("not_implemented");
 * - verifyWebhook already checks a provisional signature (HMAC-SHA256 over "<t>.<body>" with
 *   CARD_GATEWAY_WEBHOOK_SECRET, header x-gateway-signature: t=<ms>,v1=<hex>, at most five
 *   minutes old) and reads a provisional event body, so the webhook route, the idempotent
 *   payment recording and the reactivation can be tested end to end. Replace both with the
 *   gateway's real scheme when its docs arrive.
 *
 * Env: CARD_GATEWAY_ID (short id, e.g. payriff), CARD_GATEWAY_API_URL, CARD_GATEWAY_MERCHANT_ID,
 * CARD_GATEWAY_SECRET_KEY, CARD_GATEWAY_WEBHOOK_SECRET.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProviderError, type PaymentEvent, type PaymentProvider, type WebhookRequest } from "./types.ts";

export const CARD_GATEWAY_ENV = [
  "CARD_GATEWAY_ID",
  "CARD_GATEWAY_API_URL",
  "CARD_GATEWAY_MERCHANT_ID",
  "CARD_GATEWAY_SECRET_KEY",
  "CARD_GATEWAY_WEBHOOK_SECRET",
] as const;

export const CARD_GATEWAY_SIGNATURE_HEADER = "x-gateway-signature";
const MAX_AGE_MS = 5 * 60_000;

export interface CardGatewayConfig {
  id: string;
  apiUrl: string;
  merchantId: string;
  secretKey: string;
  webhookSecret: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export function cardGatewayConfig(env: Env): { config: CardGatewayConfig | null; missing: string[] } {
  const value = (k: (typeof CARD_GATEWAY_ENV)[number]) => (env[k] ?? "").trim();
  const missing = CARD_GATEWAY_ENV.filter((k) => !value(k));
  const id = value("CARD_GATEWAY_ID");
  if (id && !/^[a-z][a-z0-9_]{0,39}$/.test(id)) missing.push("CARD_GATEWAY_ID");
  if (missing.length) return { config: null, missing: [...new Set(missing)] };
  return {
    config: {
      id,
      apiUrl: value("CARD_GATEWAY_API_URL").replace(/\/+$/, ""),
      merchantId: value("CARD_GATEWAY_MERCHANT_ID"),
      secretKey: value("CARD_GATEWAY_SECRET_KEY"),
      webhookSecret: value("CARD_GATEWAY_WEBHOOK_SECRET"),
    },
    missing: [],
  };
}

/** Provisional signature header value (also used by tests and the local rehearsal). */
export function signGatewayWebhook(rawBody: string, secret: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: PaymentEvent["type"][] = ["payment.succeeded", "payment.failed", "payment.refunded"];

/** Provisional event body: {type, reference, invoice_id, amount_cents, currency, occurred_at, failure_reason?, card?}. */
export function parseGatewayEvent(rawBody: string): PaymentEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const type = text(body.type) as PaymentEvent["type"];
  const reference = text(body.reference);
  const invoiceId = text(body.invoice_id);
  const amountCents = Number(body.amount_cents);
  const currency = text(body.currency).toUpperCase();
  if (!TYPES.includes(type) || !reference || reference.length > 200 || !UUID.test(invoiceId)) return null;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  const event: PaymentEvent = {
    type,
    reference,
    invoiceId,
    amountCents,
    currency,
    occurredAt: text(body.occurred_at) || new Date(0).toISOString(),
  };
  if (text(body.failure_reason)) event.failureReason = text(body.failure_reason).slice(0, 500);
  const card = body.card as Record<string, unknown> | undefined;
  if (card && typeof card === "object" && text(card.token)) {
    const n = (v: unknown) => (Number.isInteger(Number(v)) && v !== null && v !== "" ? Number(v) : null);
    const last4 = text(card.last4);
    event.savedCard = {
      token: text(card.token),
      brand: text(card.brand) || null,
      last4: /^[0-9]{4}$/.test(last4) ? last4 : null,
      expMonth: n(card.exp_month),
      expYear: n(card.exp_year),
    };
  }
  return event;
}

export function verifyGatewaySignature(request: WebhookRequest, secret: string): boolean {
  const header = request.headers.get(CARD_GATEWAY_SIGNATURE_HEADER) ?? "";
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!secret || !parts.v1 || !Number.isFinite(t) || Math.abs(request.now - t) > MAX_AGE_MS) return false;
  return safeEqual(parts.v1, signGatewayWebhook(request.rawBody, secret, t).split("v1=")[1]);
}

export function cardGateway(env: Env): PaymentProvider {
  const { config, missing } = cardGatewayConfig(env);
  const unavailable = (): never => {
    if (!config) throw new PaymentProviderError("not_configured", `card gateway not configured: set ${missing.join(", ")}`);
    throw new PaymentProviderError("not_implemented", `card gateway "${config.id}" is a stub until its API is wired in`);
  };
  return {
    id: config?.id ?? "card_gateway",
    supportsSavedCards: true,
    missing,
    async createCheckout() {
      // TODO(gateway docs): create a payment order for invoice.amountCents with the invoice id
      // as the merchant reference and options.returnUrl, and return { kind: "redirect", url }.
      return unavailable();
    },
    async chargeSavedCard() {
      // TODO(gateway docs): charge card.token for invoice.amountCents (recurring / MIT).
      return unavailable();
    },
    async refund() {
      // TODO(gateway docs): refund payment.reference by payment.amountCents.
      return unavailable();
    },
    async verifyWebhook(request) {
      if (!config) return null;
      if (!verifyGatewaySignature(request, config.webhookSecret)) return null;
      return parseGatewayEvent(request.rawBody);
    },
  };
}
