import type { ProductFacts, WatchContext, WatchDocType } from "@/lib/assistant/watch/rules";

/**
 * The facts a form under watch needs (AST-5), as assistant_watch_context returns them: the guard's
 * thresholds, closed months, product cost and this partner's usual price and quantity, and the partner's
 * recent documents. Pure parser: anything malformed becomes "unknown" and the rule that needs it stays quiet.
 */

const num = (v: unknown): number | null => {
  const n = v === null || v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function emptyWatchContext(today: string): WatchContext {
  return { today, rules: {}, closedMonths: [], products: {}, partner: null };
}

export function parseWatchContext(raw: unknown, today: string): WatchContext {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rules: WatchContext["rules"] = {};
  for (const [code, r] of Object.entries((o.rules as Record<string, unknown>) ?? {})) {
    const rr = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    rules[code] = { enabled: rr.enabled !== false, params: rr.params && typeof rr.params === "object" ? (rr.params as Record<string, unknown>) : {} };
  }
  const closedMonths = Array.isArray(o.closed_months) ? (o.closed_months as unknown[]).filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m)) : [];
  const products: Record<string, ProductFacts> = {};
  for (const [id, p] of Object.entries((o.products as Record<string, unknown>) ?? {})) {
    const pp = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    products[id] = {
      unit: typeof pp.unit === "string" ? pp.unit : null,
      sell_price: num(pp.sell_price),
      cost: num(pp.cost),
      usual_price: num(pp.usual_price),
      usual_qty: num(pp.usual_qty),
      times: num(pp.times) ?? 0,
    };
  }
  let partner: WatchContext["partner"] = null;
  if (o.partner && typeof o.partner === "object") {
    const pr = o.partner as Record<string, unknown>;
    partner = {
      documents: num(pr.documents) ?? 0,
      median_total: num(pr.median_total),
      recent: Array.isArray(pr.recent)
        ? (pr.recent as Array<Record<string, unknown>>).map((d) => ({ doc_no: typeof d?.doc_no === "string" ? d.doc_no : null, doc_date: typeof d?.doc_date === "string" ? d.doc_date : null, total: num(d?.total) ?? 0 }))
        : [],
    };
  }
  return { today, rules, closedMonths, products, partner };
}

/** The key that decides when the form's facts must be read again: the document type, partner and products. */
export function contextKey(docType: WatchDocType, partnerId: string | null, productIds: readonly string[]): string {
  return `${docType}|${partnerId ?? ""}|${[...new Set(productIds)].sort().join(",")}`;
}

/** Today in Baku (the ERP's dates), as YYYY-MM-DD. */
export function bakuToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}
