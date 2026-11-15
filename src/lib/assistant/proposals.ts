import type Anthropic from "@anthropic-ai/sdk";

/**
 * Proposals of Del Assistant (AST-4, plan section 2 principle 2). The model can only PROPOSE a document;
 * the user sees every field and confirms; their own browser then saves a DRAFT with the functions the forms
 * use. Posting stays a button on the document. Nothing here posts, deletes, reverses or moves money
 * (a partner payment has no draft state, so the assistant does not propose payments).
 *
 * Pure module: input checks, totals, name matching, the fingerprint's canonical form, tool definitions.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const PROPOSAL_KINDS = ["sale_draft", "purchase_draft", "customer", "expense_draft"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** The permission each kind needs (the database checks the same at confirm time). */
export const PROPOSAL_PERMISSION: Record<ProposalKind, string> = {
  sale_draft: "can_create_invoice",
  purchase_draft: "can_create_purchase",
  customer: "can_manage_customers",
  expense_draft: "can_manage_expenses",
};

export const PROPOSAL_TOOL_KIND: Record<string, ProposalKind> = {
  propose_sale_draft: "sale_draft",
  propose_purchase_draft: "purchase_draft",
  propose_customer: "customer",
  propose_expense: "expense_draft",
};

export const DEFAULT_CONFIRM_LIMIT_AZN = 10_000;

/** Above this amount (AZN) the user confirms twice (ASSISTANT_CONFIRM_LIMIT_AZN, default 10 000). */
export function assistantConfirmLimit(env: Env = process.env): number {
  const n = Number((env.ASSISTANT_CONFIRM_LIMIT_AZN ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONFIRM_LIMIT_AZN;
}

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// ─── Payloads ────────────────────────────────────────────────────────────────

export interface ProposalLine {
  product_id: string;
  product_code: string | null;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  /** quantity × price − discount, without VAT */
  net: number;
  vat: number;
  total: number;
}

export interface SaleDraftPayload {
  customer_id: string;
  customer_name: string;
  doc_date: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  note: string;
  lines: ProposalLine[];
  subtotal: number;
  vat_total: number;
  total: number;
}

export interface PurchaseDraftPayload {
  supplier_id: string;
  supplier_name: string;
  doc_date: string;
  warehouse_id: string;
  warehouse_name: string;
  note: string;
  lines: ProposalLine[];
  subtotal: number;
  vat_total: number;
  total: number;
}

export interface CustomerPayload {
  full_name: string;
  company_name: string;
  phone: string;
  voen: string;
  address: string;
}

export interface ExpenseDraftPayload {
  expense_date: string;
  category_id: string;
  category_name: string;
  net_amount: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  payee: string;
  description: string;
}

export type ProposalPayload = SaleDraftPayload | PurchaseDraftPayload | CustomerPayload | ExpenseDraftPayload;

/** What the panel shows (sent in the chat stream; never trusted back: the server keeps its own copy). */
export interface ProposalCard {
  id: string;
  kind: ProposalKind;
  summary: string;
  amount: number;
  payload: ProposalPayload;
  /** SHA-256 of canonicalJson(payload): the card sends back the fingerprint of what it showed. */
  hash: string;
  secondConfirm: boolean;
  limit: number;
}

/** JSON with sorted keys, so the same payload always has the same fingerprint (server and browser). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Totals of the lines: net = qty × price × (1 − discount %), VAT on the net. */
export function computeLine(input: Omit<ProposalLine, "net" | "vat" | "total">): ProposalLine {
  const net = round2(input.quantity * input.unit_price * (1 - input.discount_percent / 100));
  const vat = round2((net * input.vat_rate) / 100);
  return { ...input, net, vat, total: round2(net + vat) };
}

export function documentTotals(lines: readonly ProposalLine[]): { subtotal: number; vat_total: number; total: number } {
  const subtotal = round2(lines.reduce((s, l) => s + l.net, 0));
  const vat_total = round2(lines.reduce((s, l) => s + l.vat, 0));
  return { subtotal, vat_total, total: round2(subtotal + vat_total) };
}

export type ExecuteError = "hash_mismatch" | "already_decided" | "forbidden" | "expired" | "second_confirm_required" | "not_found" | "failed";

/** The reason of a refused claim, from the database's error text. */
export function claimError(message: string): ExecuteError {
  for (const code of ["hash_mismatch", "already_decided", "forbidden", "expired", "second_confirm_required", "not_found"] as const) {
    if (message.includes(code)) return code;
  }
  return "failed";
}

// ─── Input checks ────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface LineArg {
  product: string;
  quantity: number;
  price: number | null;
  discount_percent: number;
  vat_rate: number;
}

export type ArgsCheck<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function checkLines(raw: unknown): ArgsCheck<LineArg[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Give at least one line (product and quantity)." };
  if (raw.length > 30) return { ok: false, error: "At most 30 lines in one proposal." };
  const out: LineArg[] = [];
  for (const [i, r] of (raw as Array<Record<string, unknown>>).entries()) {
    const product = text(r?.product, 120);
    const quantity = num(r?.quantity);
    const price = num(r?.price);
    const discount = num(r?.discount_percent) ?? 0;
    const vat = num(r?.vat_rate) ?? 0;
    if (!product) return { ok: false, error: `Line ${i + 1}: which product?` };
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: `Line ${i + 1}: the quantity must be above zero.` };
    if (price !== null && (!Number.isFinite(price) || price < 0)) return { ok: false, error: `Line ${i + 1}: the price cannot be negative.` };
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) return { ok: false, error: `Line ${i + 1}: the discount is 0–100 %.` };
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) return { ok: false, error: `Line ${i + 1}: the VAT rate is 0–100 %.` };
    out.push({ product, quantity, price, discount_percent: discount, vat_rate: vat });
  }
  return { ok: true, value: out };
}

function checkDate(raw: unknown, today: string): ArgsCheck<string> {
  const d = text(raw, 10);
  if (!d) return { ok: true, value: today };
  return ISO_DATE.test(d) && !Number.isNaN(Date.parse(d)) ? { ok: true, value: d } : { ok: false, error: "The date must be YYYY-MM-DD." };
}

export interface DocumentArgs {
  partner: string;
  date: string;
  warehouse: string;
  note: string;
  lines: LineArg[];
}

export function checkDocumentArgs(raw: Record<string, unknown>, partnerKey: "customer" | "supplier", today: string): ArgsCheck<DocumentArgs> {
  const partner = text(raw[partnerKey], 120);
  if (!partner) return { ok: false, error: `Which ${partnerKey}? Ask the user.` };
  const date = checkDate(raw.date, today);
  if (!date.ok) return date;
  const lines = checkLines(raw.lines);
  if (!lines.ok) return lines;
  return { ok: true, value: { partner, date: date.value, warehouse: text(raw.warehouse, 120), note: text(raw.note, 500), lines: lines.value } };
}

export function checkCustomerArgs(raw: Record<string, unknown>): ArgsCheck<CustomerPayload> {
  const full_name = text(raw.full_name, 150);
  if (full_name.length < 2) return { ok: false, error: "The customer's name is needed." };
  const voen = text(raw.voen, 20).replace(/\s/g, "");
  if (voen && !/^\d{10}$/.test(voen)) return { ok: false, error: "VÖEN has 10 digits." };
  return { ok: true, value: { full_name, company_name: text(raw.company_name, 150), phone: text(raw.phone, 40), voen, address: text(raw.address, 300) } };
}

export interface ExpenseArgs {
  category: string;
  date: string;
  amount: number;
  vat_rate: number;
  payee: string;
  description: string;
}

export function checkExpenseArgs(raw: Record<string, unknown>, today: string): ArgsCheck<ExpenseArgs> {
  const category = text(raw.category, 120);
  if (!category) return { ok: false, error: "Which expense category? Ask the user." };
  const amount = num(raw.amount);
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: "The amount must be above zero." };
  const vat = num(raw.vat_rate) ?? 0;
  if (!Number.isFinite(vat) || vat < 0 || vat > 100) return { ok: false, error: "The VAT rate is 0–100 %." };
  const date = checkDate(raw.date, today);
  if (!date.ok) return date;
  return { ok: true, value: { category, date: date.value, amount: round2(amount), vat_rate: vat, payee: text(raw.payee, 200), description: text(raw.description, 500) } };
}

// ─── Matching names to records (never a guess) ───────────────────────────────

export type Match<R> = { status: "one"; row: R } | { status: "none" } | { status: "many"; options: string[] };

/**
 * One record for a name: an exact (case-insensitive) match wins; a single partial match is taken; several
 * partial matches or none mean the assistant asks the user instead of guessing.
 */
export function pickOne<R>(rows: readonly R[], name: string, labels: (r: R) => Array<string | null | undefined>): Match<R> {
  const want = name.trim().toLowerCase();
  const exact = rows.filter((r) => labels(r).some((l) => (l ?? "").trim().toLowerCase() === want));
  if (exact.length === 1) return { status: "one", row: exact[0] };
  if (exact.length > 1) return { status: "many", options: exact.slice(0, 8).map((r) => labels(r).filter(Boolean).join(" / ")) };
  if (rows.length === 1) return { status: "one", row: rows[0] };
  if (rows.length === 0) return { status: "none" };
  return { status: "many", options: rows.slice(0, 8).map((r) => labels(r).filter(Boolean).join(" / ")) };
}

/** A search word safe inside a PostgREST or() filter. */
export function searchTerm(name: string): string {
  return name.replace(/[%_,()*\\:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** The message the model gets when a name matched nothing or several records: it must ask, not guess. */
export function askBack(what: string, name: string, match: Match<unknown>): string {
  if (match.status === "none") return `No ${what} matches "${name}". Ask the user for the exact name (or, for a new customer, propose_customer).`;
  if (match.status === "many") return `Several ${what}s match "${name}": ${(match as { options: string[] }).options.join("; ")}. Ask the user which one; do not guess.`;
  return "";
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const LINES_SCHEMA = {
  type: "array",
  description: "1–30 lines",
  items: {
    type: "object",
    properties: {
      product: { type: "string", description: "product name or code as the user said it" },
      quantity: { type: "number" },
      price: { type: "number", description: "unit price without VAT; leave out to use the product's price" },
      discount_percent: { type: "number" },
      vat_rate: { type: "number", description: "VAT % of the line, e.g. 18, or 0" },
    },
    required: ["product", "quantity"],
  },
} as const;

const TOOL_DEFS: Record<ProposalKind, Anthropic.Beta.BetaTool> = {
  sale_draft: {
    name: "propose_sale_draft",
    description:
      "Prepare a DRAFT sales invoice for the user to check and confirm in a card. Nothing is saved until they press Create draft; posting stays their click on the document. Names are matched to records; if a name is unclear you get a question to ask back.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD, default today" },
        warehouse: { type: "string", description: "optional warehouse name" },
        note: { type: "string" },
        lines: LINES_SCHEMA as unknown as Record<string, unknown>,
      },
      required: ["customer", "lines"],
    },
  },
  purchase_draft: {
    name: "propose_purchase_draft",
    description: "Prepare a DRAFT purchase invoice (goods received from a supplier) for the user to confirm. Nothing is saved until they confirm.",
    input_schema: {
      type: "object",
      properties: {
        supplier: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD, default today" },
        warehouse: { type: "string", description: "warehouse name; needed when there are several" },
        note: { type: "string" },
        lines: LINES_SCHEMA as unknown as Record<string, unknown>,
      },
      required: ["supplier", "lines"],
    },
  },
  customer: {
    name: "propose_customer",
    description: "Prepare a new customer card for the user to confirm. Check first that the customer does not exist.",
    input_schema: {
      type: "object",
      properties: {
        full_name: { type: "string" },
        company_name: { type: "string" },
        phone: { type: "string" },
        voen: { type: "string", description: "10 digits" },
        address: { type: "string" },
      },
      required: ["full_name"],
    },
  },
  expense_draft: {
    name: "propose_expense",
    description: "Prepare a DRAFT expense (not posted, no cash movement) for the user to confirm.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "expense category name" },
        amount: { type: "number", description: "net amount without VAT, AZN" },
        vat_rate: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD, default today" },
        payee: { type: "string" },
        description: { type: "string" },
      },
      required: ["category", "amount"],
    },
  },
};

/** The proposal tools this user may use (a tool they may not use is not even offered). */
export function proposalToolsFor(can: (permission: string) => boolean): Anthropic.Beta.BetaTool[] {
  return PROPOSAL_KINDS.filter((k) => can(PROPOSAL_PERMISSION[k])).map((k) => TOOL_DEFS[k]);
}

export const PROPOSAL_TOOL_NAMES = new Set(Object.keys(PROPOSAL_TOOL_KIND));

/** What the tool tells the model after a proposal is shown. */
export const WAITING_FOR_USER =
  "The proposal is shown to the user as a card. It is NOT saved yet: wait for them to press Create draft. Tell them in one sentence what you prepared and that they confirm it in the card; never say it was created.";
