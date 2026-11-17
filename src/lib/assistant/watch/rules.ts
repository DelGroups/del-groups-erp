/**
 * The active watch's rules (AST-5, plan section 5): pure checks over the document being filled in, run in the
 * browser on every change (debounced), free and instant. Where the Accounting Guard has the same rule, the
 * threshold comes from its guard_rules.params, so "before save" and "after save" agree:
 *   B1 paid more than the total, negative amounts          (params.tolerance)
 *   B2 possible duplicate: same partner and total within N days   (params.days)
 *   B4 a date in the future
 *   B6 below cost, zero price, discount above the maximum  (params.max_discount_pct, params.tolerance)
 *   B7 a total far above this partner's usual               (params.factor, params.min_documents)
 * plus checks the guard cannot make after the fact: a closed month, stock, the credit limit, a price or a
 * quantity far from this partner's usual, a unit that is not the product's, an unusual VAT rate, a payment
 * without a cash or bank account.
 *
 * A rule returns WatchIssue with an optional DraftPatch; the form applies the patch through its own setters
 * (the form stays the source of truth; the watch never writes to the database).
 */

export type WatchDocType = "sale" | "purchase";
export type WatchSeverity = "warning" | "error";

export interface DraftLine {
  /** Position in the form's own list (the patch points here). */
  index: number;
  productId: string | null;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPercent: number;
  vatRate: number | null;
  /** What the form knows is available in the line's warehouse (sales); null when it does not know. */
  availableStock?: number | null;
}

export interface DocumentDraft {
  docType: WatchDocType;
  /** YYYY-MM-DD */
  date: string | null;
  partnerId: string | null;
  lines: DraftLine[];
  total: number;
  paid: number;
  payments: Array<{ amount: number; accountId: string | null }>;
  /** Sales: the customer's credit limit (0 = none) and what they owe already, as the form shows them. */
  creditLimit?: number;
  openReceivables?: number;
}

export interface ProductFacts {
  unit?: string | null;
  sell_price?: number | null;
  /** The buy price (only for users who may see products). */
  cost?: number | null;
  /** This partner's average price and quantity over their last posted lines of this product. */
  usual_price?: number | null;
  usual_qty?: number | null;
  times?: number;
}

export interface WatchContext {
  today: string;
  rules: Record<string, { enabled?: boolean; params?: Record<string, unknown> }>;
  /** "YYYY-MM" of closed accounting months. */
  closedMonths: string[];
  products: Record<string, ProductFacts>;
  partner: { documents: number; median_total: number | null; recent: Array<{ doc_no: string | null; doc_date: string | null; total: number }> } | null;
}

export type PatchField = "unitPrice" | "discountPercent" | "quantity" | "unit" | "vatRate";
export type DraftPatch = { target: "line"; index: number; field: PatchField; value: number | string } | { target: "header"; field: "date"; value: string };

export interface WatchIssue {
  code: WatchCode;
  severity: WatchSeverity;
  lineIndex: number | null;
  params: Record<string, string | number>;
  fix?: DraftPatch;
  /** The Accounting Guard rule that checks the same after saving. */
  guardRule?: string;
}

export const WATCH_CODES = [
  "closed_period",
  "negative_value",
  "zero_price",
  "overpaid",
  "cash_no_account",
  "below_cost",
  "high_discount",
  "future_date",
  "possible_duplicate",
  "unusual_total",
  "stock_short",
  "credit_limit",
  "price_far",
  "quantity_unusual",
  "unit_mismatch",
  "vat_unusual",
  /** Not a rule: the note of the "unusual draft" check (Haiku, unusual.ts), shown like a warning. */
  "ai_note",
] as const;
export type WatchCode = (typeof WATCH_CODES)[number];

/** Percent away from the usual price, and how many times the usual quantity, that count as unusual. */
export const PRICE_FAR_PCT = 30;
export const QUANTITY_FACTOR = 10;
/** A usual price or quantity needs at least this many earlier lines. */
export const MIN_HISTORY = 2;
export const USUAL_VAT_RATES = [0, 18];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-11-20" → "20.11.2026", "2026-11" → "11.2026" (the ERP's date format, TXT-3). */
export function dots(iso: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso);
  if (!m) return iso;
  return m[3] ? `${m[3]}.${m[2]}.${m[1]}` : `${m[2]}.${m[1]}`;
}

function param(ctx: WatchContext, rule: string, key: string, fallback: number): number {
  const v = Number(ctx.rules[rule]?.params?.[key]);
  return Number.isFinite(v) ? v : fallback;
}

/** Is the guard's rule switched on (missing means on: the defaults apply)? */
function enabled(ctx: WatchContext, rule: string): boolean {
  return ctx.rules[rule]?.enabled !== false;
}

export function lineNet(l: Pick<DraftLine, "quantity" | "unitPrice" | "discountPercent">): number {
  return round2(l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

const filled = (l: DraftLine) => !!l.productId || !!l.productName.trim();

export function checkDraft(draft: DocumentDraft, ctx: WatchContext): WatchIssue[] {
  const issues: WatchIssue[] = [];
  const sale = draft.docType === "sale";
  const tol = param(ctx, "B1", "tolerance", 0.01);
  const lines = draft.lines.filter(filled);

  // ── The header ─────────────────────────────────────────────────────────────
  if (draft.date && ctx.closedMonths.includes(draft.date.slice(0, 7))) {
    issues.push({ code: "closed_period", severity: "error", lineIndex: null, params: { month: dots(draft.date.slice(0, 7)) }, fix: { target: "header", field: "date", value: ctx.today } });
  } else if (draft.date && enabled(ctx, "B4") && draft.date > ctx.today) {
    issues.push({ code: "future_date", severity: "warning", lineIndex: null, params: { date: dots(draft.date) }, fix: { target: "header", field: "date", value: ctx.today }, guardRule: "B4" });
  }

  // ── The lines ──────────────────────────────────────────────────────────────
  const maxDiscount = param(ctx, "B6", "max_discount_pct", 30);
  const costTol = param(ctx, "B6", "tolerance", 0.01);
  for (const l of lines) {
    const facts = (l.productId && ctx.products[l.productId]) || {};
    if (l.quantity < 0 || l.unitPrice < 0 || l.discountPercent < 0) {
      const field: PatchField = l.quantity < 0 ? "quantity" : l.unitPrice < 0 ? "unitPrice" : "discountPercent";
      const value = Math.abs(field === "quantity" ? l.quantity : field === "unitPrice" ? l.unitPrice : l.discountPercent);
      issues.push({ code: "negative_value", severity: "error", lineIndex: l.index, params: { product: l.productName }, fix: { target: "line", index: l.index, field, value }, guardRule: "B1" });
      continue;
    }
    if (l.quantity === 0) continue;
    if (l.unitPrice === 0 && enabled(ctx, "B6")) {
      const price = Number(sale ? facts.usual_price ?? facts.sell_price : facts.usual_price) || 0;
      issues.push({
        code: "zero_price",
        severity: sale ? "error" : "warning",
        lineIndex: l.index,
        params: { product: l.productName },
        ...(price > 0 ? { fix: { target: "line" as const, index: l.index, field: "unitPrice" as const, value: round2(price) } } : {}),
        guardRule: "B6",
      });
      continue;
    }
    if (sale && enabled(ctx, "B6") && l.discountPercent > maxDiscount) {
      issues.push({ code: "high_discount", severity: "warning", lineIndex: l.index, params: { product: l.productName, discount: l.discountPercent, max: maxDiscount }, fix: { target: "line", index: l.index, field: "discountPercent", value: maxDiscount }, guardRule: "B6" });
    }
    const cost = Number(facts.cost);
    if (sale && enabled(ctx, "B6") && cost > 0 && lineNet(l) < round2(cost * l.quantity) - costTol) {
      // The fix: the price this customer usually pays, or the list price, when that is above cost.
      const better = [facts.usual_price, facts.sell_price].map(Number).find((p) => Number.isFinite(p) && p > cost);
      issues.push({
        code: "below_cost",
        severity: "warning",
        lineIndex: l.index,
        params: { product: l.productName, price: round2(l.unitPrice * (1 - l.discountPercent / 100)), cost: round2(cost) },
        ...(better ? { fix: { target: "line" as const, index: l.index, field: "unitPrice" as const, value: round2(better) } } : {}),
        guardRule: "B6",
      });
    } else if ((facts.times ?? 0) >= MIN_HISTORY && Number(facts.usual_price) > 0) {
      const usual = Number(facts.usual_price);
      const pct = Math.round((Math.abs(l.unitPrice - usual) / usual) * 100);
      if (pct > PRICE_FAR_PCT) {
        issues.push({ code: "price_far", severity: "warning", lineIndex: l.index, params: { product: l.productName, price: l.unitPrice, usual, pct }, fix: { target: "line", index: l.index, field: "unitPrice", value: usual } });
      }
    }
    if ((facts.times ?? 0) >= MIN_HISTORY && Number(facts.usual_qty) > 0 && l.quantity >= QUANTITY_FACTOR * Number(facts.usual_qty)) {
      issues.push({ code: "quantity_unusual", severity: "warning", lineIndex: l.index, params: { product: l.productName, quantity: l.quantity, usual: Number(facts.usual_qty) } });
    }
    if (sale && l.availableStock !== null && l.availableStock !== undefined && l.quantity > l.availableStock + 1e-9) {
      issues.push({ code: "stock_short", severity: "warning", lineIndex: l.index, params: { product: l.productName, quantity: l.quantity, available: Math.max(0, l.availableStock) } });
    }
    if (facts.unit && l.unit && facts.unit.trim().toLowerCase() !== l.unit.trim().toLowerCase()) {
      issues.push({ code: "unit_mismatch", severity: "warning", lineIndex: l.index, params: { product: l.productName, unit: l.unit, expected: facts.unit }, fix: { target: "line", index: l.index, field: "unit", value: facts.unit } });
    }
    if (l.vatRate !== null && !USUAL_VAT_RATES.includes(l.vatRate)) {
      issues.push({ code: "vat_unusual", severity: "warning", lineIndex: l.index, params: { product: l.productName, rate: l.vatRate }, fix: { target: "line", index: l.index, field: "vatRate", value: 18 } });
    }
  }

  // ── Money ──────────────────────────────────────────────────────────────────
  if (enabled(ctx, "B1") && draft.paid > draft.total + tol && draft.total > 0) {
    issues.push({ code: "overpaid", severity: "error", lineIndex: null, params: { paid: round2(draft.paid), total: round2(draft.total) }, guardRule: "B1" });
  }
  if (draft.payments.some((p) => p.amount > 0 && !p.accountId)) {
    issues.push({ code: "cash_no_account", severity: "error", lineIndex: null, params: {} });
  }
  if (sale && (draft.creditLimit ?? 0) > 0) {
    const owed = round2((draft.openReceivables ?? 0) + Math.max(0, draft.total - draft.paid));
    if (owed > (draft.creditLimit ?? 0) + tol) {
      issues.push({ code: "credit_limit", severity: "warning", lineIndex: null, params: { owed, limit: round2(draft.creditLimit ?? 0) } });
    }
  }

  // ── This partner's history ─────────────────────────────────────────────────
  if (ctx.partner && draft.total > 0 && lines.length) {
    const days = param(ctx, "B2", "days", 2);
    const dup = enabled(ctx, "B2") && draft.date ? ctx.partner.recent.find((d) => d.doc_date && Math.abs(Number(d.total) - draft.total) <= tol && daysBetween(d.doc_date, draft.date as string) <= days) : undefined;
    if (dup) issues.push({ code: "possible_duplicate", severity: "warning", lineIndex: null, params: { doc: dup.doc_no ?? "", date: dots(dup.doc_date ?? ""), total: round2(draft.total) }, guardRule: "B2" });
    const factor = param(ctx, "B7", "factor", 5);
    const minDocs = param(ctx, "B7", "min_documents", 5);
    const median = Number(ctx.partner.median_total);
    if (enabled(ctx, "B7") && ctx.partner.documents >= minDocs && median > 0 && draft.total > factor * median) {
      issues.push({ code: "unusual_total", severity: "warning", lineIndex: null, params: { total: round2(draft.total), median: round2(median), factor: Math.round((draft.total / median) * 10) / 10 }, guardRule: "B7" });
    }
  }

  // Errors first, then the order above.
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

/** The draft after a fix (what the form's setter does); tests use it to prove a fix clears its issue. */
export function applyPatch(draft: DocumentDraft, patch: DraftPatch): DocumentDraft {
  if (patch.target === "header") return { ...draft, date: String(patch.value) };
  return {
    ...draft,
    lines: draft.lines.map((l) => (l.index !== patch.index ? l : { ...l, [patch.field]: patch.field === "unit" ? String(patch.value) : Number(patch.value) })),
  };
}

/** i18n key of a warning's one-line text. */
export function issueKey(code: WatchCode): string {
  return `assistant.watch.${code}`;
}

/** A stable key of one warning (its code and line), so the bubble does not flicker between renders. */
export function issueId(issue: Pick<WatchIssue, "code" | "lineIndex">): string {
  return `${issue.code}:${issue.lineIndex ?? "doc"}`;
}

// ─── Ignoring ────────────────────────────────────────────────────────────────

/** Ignoring the same code three times silences it for this form. */
export const SILENCE_AFTER = 3;

export interface WatchMemory {
  /** Issues ignored once (by issueId): hidden until they change. */
  dismissed: string[];
  /** How often each code was ignored on this form. */
  ignored: Record<string, number>;
}

export const EMPTY_WATCH_MEMORY: WatchMemory = { dismissed: [], ignored: {} };

export function ignoreIssue(m: WatchMemory, issue: WatchIssue): WatchMemory {
  const id = issueId(issue);
  return {
    dismissed: m.dismissed.includes(id) ? m.dismissed : [...m.dismissed, id],
    ignored: { ...m.ignored, [issue.code]: (m.ignored[issue.code] ?? 0) + 1 },
  };
}

export function isSilenced(m: WatchMemory, code: string): boolean {
  return (m.ignored[code] ?? 0) >= SILENCE_AFTER;
}

/** What the bubble may show: not dismissed, not silenced. */
export function visibleIssues(issues: readonly WatchIssue[], m: WatchMemory): WatchIssue[] {
  return issues.filter((i) => !m.dismissed.includes(issueId(i)) && !isSilenced(m, i.code));
}

/** The avatar's colour for the issues on screen. */
export function worstSeverity(issues: readonly WatchIssue[]): WatchSeverity | null {
  if (issues.some((i) => i.severity === "error")) return "error";
  return issues.length ? "warning" : null;
}

// ─── Timing ──────────────────────────────────────────────────────────────────

export const WATCH_DEBOUNCE_MS = 400;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

/** Runs `fn` once the input stops changing for `ms` (timers injectable for tests). */
export function createDebouncer<A>(fn: (arg: A) => void, ms: number, timers: Timers) {
  let handle: unknown = null;
  return {
    push(arg: A) {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => {
        handle = null;
        fn(arg);
      }, ms);
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
  };
}
