/**
 * The morning briefing (AST-6): the numbers of one person's morning, and the prompt that turns them into a
 * short message. Pure; briefingServer.ts reads the rows and calls Claude. Each section is included only
 * when the person may see it (cash with finance, debtors with customers, stock with products, guard
 * findings for admins), and every suggestion comes from these numbers with its link.
 */
import { addDays, debtorsAgeing, grossMarginByProduct, isPosted, round2, stockCover, type ProductRow, type SaleLineRow, type SaleRow } from "./compute";

export interface BriefingAccess {
  isAdmin: boolean;
  sales: boolean;
  finance: boolean;
  customers: boolean;
  products: boolean;
}

export interface BriefingSuggestion {
  kind: "call" | "reorder" | "price" | "guard" | "sales";
  /** The facts the suggestion rests on (the model words it). */
  facts: string;
  href: string;
  label: string;
}

export interface BriefingFacts {
  day: string;
  yesterday: string;
  sales?: { revenue: number; documents: number; usual: number | null; change_pct: number | null };
  cash?: { total: number; accounts: Array<{ name: string; balance: number }> };
  receivables?: { overdue: number; total: number; customers_overdue: number };
  stock?: { running_out: number; slow_value: number };
  guard?: { new_findings: number; high: number };
  suggestions: BriefingSuggestion[];
  all_well: boolean;
}

export interface BriefingData {
  sales: SaleRow[];
  lines: SaleLineRow[];
  products: ProductRow[];
  accounts: Array<{ name: string; type?: string | null; balance: number }>;
  findings: Array<{ severity: string; first_seen_at: string }>;
}

/** Same weekday in the four weeks before: the "usual" for yesterday. */
export const USUAL_WEEKS = 4;
export const LOW_MARGIN_PCT = 5;

const money = (n: number) => round2(n).toFixed(2);

export function briefingFacts(data: BriefingData, access: BriefingAccess, today: string): BriefingFacts {
  const yesterday = addDays(today, -1);
  const facts: BriefingFacts = { day: today, yesterday, suggestions: [], all_well: true };
  const posted = data.sales.filter(isPosted);

  if (access.sales) {
    const on = (d: string) => posted.filter((s) => s.doc_date === d);
    const y = on(yesterday);
    const revenue = y.reduce((a, s) => a + (Number(s.total_amount) || 0), 0);
    const past = Array.from({ length: USUAL_WEEKS }, (_, i) => on(addDays(yesterday, -7 * (i + 1))).reduce((a, s) => a + (Number(s.total_amount) || 0), 0));
    const usual = past.some((v) => v > 0) ? past.reduce((a, v) => a + v, 0) / USUAL_WEEKS : null;
    const change = usual ? Math.round(((revenue - usual) / usual) * 1000) / 10 : null;
    facts.sales = { revenue: round2(revenue), documents: y.length, usual: usual === null ? null : round2(usual), change_pct: change };
    if (change !== null && change <= -30) {
      facts.all_well = false;
      facts.suggestions.push({ kind: "sales", facts: `Yesterday's sales ${money(revenue)} vs usual ${money(usual as number)} for that weekday (${change}%).`, href: "/sales", label: "Satışlar" });
    }
    // Weakest margin last 30 days (needs product costs).
    if (access.products) {
      const m = grossMarginByProduct({ sales: posted, lines: data.lines, products: data.products, from: addDays(today, -30), to: yesterday, order: "margin_pct_low", limit: 30 });
      const weak = m.rows.find((r) => r.revenue >= 50 && r.margin_pct !== null && r.margin_pct < LOW_MARGIN_PCT);
      if (weak) facts.suggestions.push({ kind: "price", facts: `${weak.name}: margin ${weak.margin_pct}% on ${money(weak.revenue)} sold in 30 days (cost ${money(weak.cost)}).`, href: `/products?q=${encodeURIComponent(weak.name)}`, label: weak.name });
    }
  }

  if (access.finance) {
    const accounts = data.accounts.map((a) => ({ name: a.name, balance: round2(Number(a.balance) || 0) })).sort((a, b) => b.balance - a.balance);
    facts.cash = { total: round2(accounts.reduce((a, x) => a + x.balance, 0)), accounts: accounts.slice(0, 5) };
  }

  if (access.customers && access.sales) {
    const ageing = debtorsAgeing({ sales: posted, today, limit: 5 });
    const overdueCustomers = ageing.rows.filter((r) => r.overdue > 0);
    facts.receivables = { overdue: ageing.overdue, total: ageing.total, customers_overdue: overdueCustomers.length };
    const top = overdueCustomers[0];
    if (top) {
      facts.all_well = false;
      facts.suggestions.push({
        kind: "call",
        facts: `${top.name} owes ${money(top.overdue)} overdue; oldest invoice ${top.oldest_doc ?? ""} is ${top.oldest_days} days old.`,
        href: top.oldest_sale_id ? `/sales/${top.oldest_sale_id}` : "/customers",
        label: top.oldest_doc ?? top.name,
      });
    }
  }

  if (access.products && access.sales) {
    const cover = stockCover({ sales: posted, lines: data.lines, products: data.products, today, limit: 5 });
    facts.stock = { running_out: cover.running_out.length, slow_value: cover.slow_stock_value };
    const first = cover.running_out[0];
    if (first) {
      facts.all_well = false;
      facts.suggestions.push({
        kind: "reorder",
        facts: `${first.name}: ${first.stock} ${first.unit ?? ""} left, about ${first.days_of_cover} days at ${first.per_day} a day.`,
        href: `/products?q=${encodeURIComponent(first.code ?? first.name)}`,
        label: first.code ?? first.name,
      });
    }
  }

  if (access.isAdmin) {
    const since = `${yesterday}T00:00:00`;
    const fresh = data.findings.filter((f) => f.first_seen_at >= since);
    const high = fresh.filter((f) => f.severity === "high" || f.severity === "critical").length;
    facts.guard = { new_findings: fresh.length, high };
    if (high > 0) {
      facts.all_well = false;
      facts.suggestions.push({ kind: "guard", facts: `${high} new high-severity Accounting Guard findings since yesterday.`, href: "/finance/guard?tab=findings", label: "Accounting Guard" });
    }
  }

  // At most three, most urgent first.
  const order: BriefingSuggestion["kind"][] = ["guard", "call", "reorder", "price", "sales"];
  facts.suggestions.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  facts.suggestions = facts.suggestions.slice(0, 3);
  return facts;
}

const LANGUAGES = { az: "Azerbaijani", en: "English", ru: "Russian" } as const;
export type BriefingLanguage = keyof typeof LANGUAGES;

export const BRIEFING_SYSTEM_PROMPT = [
  "You write the morning briefing of Del Assistant for one manager of a small trading company in Azerbaijan.",
  "Use only the JSON facts you are given; never invent a number, a customer or a market fact. Money is in AZN (₼), dates as dd.mm.yyyy.",
  "Format (Markdown, under 160 words): one greeting line with the person's name; then short bullet lines for yesterday's sales against the usual, cash, overdue receivables, stock risks and new guard findings, only for sections present in the facts; then a heading-free line 'Today:' followed by the suggestions as a numbered list, each one sentence with its link written as [label](href) exactly as given.",
  "If there are no suggestions, say in one sentence that everything looks in order. Plain, calm, no exclamation marks, no emoji.",
].join("\n");

export function briefingUserMessage(facts: BriefingFacts, name: string, language: BriefingLanguage): string {
  return `Language: ${LANGUAGES[language]}.\nName: ${name}.\nFacts:\n${JSON.stringify(facts)}`;
}

/** Links the briefing may carry (the suggestions' own links, internal only). */
export function briefingLinks(facts: BriefingFacts): Array<{ label: string; href: string }> {
  return facts.suggestions.filter((s) => s.href.startsWith("/")).map((s) => ({ label: s.label, href: s.href }));
}

export function cleanBriefingBody(text: string): string | null {
  const body = text.replace(/\r/g, "").trim();
  if (!body) return null;
  return body.length > 6000 ? body.slice(0, 6000) : body;
}
