/**
 * The numbers behind the assistant's insights (AST-6). Pure functions over rows the user may read; the
 * fetch layer (tools.ts) gets the rows with the user's own client. Every result is compact (the model
 * writes the analysis) and carries what it counted and any caveat (estimated cost, truncated data), so
 * the answer can say how sure it is. Money is rounded to cents only at the end.
 */

export interface SaleRow {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  due_date?: string | null;
  customer_id: string | null;
  customer_name: string | null;
  total_amount: number;
  paid_amount: number;
  status: string | null;
  created_by?: string | null;
}

export interface SaleLineRow {
  sale_id: string;
  product_id: string | null;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  /** Net of discount, before VAT. */
  line_total: number;
  /** FIFO cost of the line when the inventory migration is in; null → estimated from the buy price. */
  cogs_amount: number | null;
}

export interface ProductRow {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  stock: number;
  min_stock: number | null;
  buy_price: number | null;
  sell_price: number | null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, days: number) => new Date(toTime(iso) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY);

/** The period of the same length just before [from, to] (both inclusive). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = daysBetween(from, to) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

const inPeriod = (d: string | null, from: string, to: string) => !!d && d >= from && d <= to;
export const isPosted = (s: { status: string | null }) => (s.status ?? "").toLowerCase() === "posted";

// ─── Sales by period, compared with the previous one ────────────────────────

export type SalesGroup = "total" | "customer" | "product" | "month";

export interface SalesComparison {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  documents: number;
  previous_documents: number;
  revenue: number;
  previous_revenue: number;
  change_pct: number | null;
  rows: Array<{ key: string; label: string; revenue: number; previous_revenue: number; change_pct: number | null; quantity?: number }>;
  caveats: string[];
}

export function salesByPeriod(input: { sales: SaleRow[]; lines: SaleLineRow[]; from: string; to: string; group: SalesGroup; limit?: number }): SalesComparison {
  const prev = previousPeriod(input.from, input.to);
  const posted = input.sales.filter(isPosted);
  const cur = posted.filter((s) => inPeriod(s.doc_date, input.from, input.to));
  const old = posted.filter((s) => inPeriod(s.doc_date, prev.from, prev.to));
  const sum = (rows: SaleRow[]) => rows.reduce((a, s) => a + (Number(s.total_amount) || 0), 0);
  const revenue = sum(cur);
  const previousRevenue = sum(old);

  const rows: SalesComparison["rows"] = [];
  const bucket = new Map<string, { label: string; cur: number; old: number; qty: number }>();
  const add = (key: string, label: string, amount: number, isCur: boolean, qty = 0) => {
    const b = bucket.get(key) ?? { label, cur: 0, old: 0, qty: 0 };
    if (isCur) {
      b.cur += amount;
      b.qty += qty;
    } else b.old += amount;
    bucket.set(key, b);
  };
  if (input.group === "customer") {
    for (const s of cur) add(s.customer_id ?? "-", s.customer_name ?? "-", Number(s.total_amount) || 0, true);
    for (const s of old) add(s.customer_id ?? "-", s.customer_name ?? "-", Number(s.total_amount) || 0, false);
  } else if (input.group === "product") {
    const curIds = new Set(cur.map((s) => s.id));
    const oldIds = new Set(old.map((s) => s.id));
    for (const l of input.lines) {
      const isCur = curIds.has(l.sale_id);
      if (!isCur && !oldIds.has(l.sale_id)) continue;
      add(l.product_id ?? l.product_name ?? "-", l.product_name ?? "-", Number(l.line_total) || 0, isCur, Number(l.quantity) || 0);
    }
  } else if (input.group === "month") {
    for (const s of cur) add((s.doc_date ?? "").slice(0, 7), (s.doc_date ?? "").slice(0, 7), Number(s.total_amount) || 0, true);
  }
  for (const [key, b] of bucket) {
    rows.push({ key, label: b.label, revenue: round2(b.cur), previous_revenue: round2(b.old), change_pct: pct(b.cur - b.old, b.old), ...(input.group === "product" ? { quantity: Math.round(b.qty * 1000) / 1000 } : {}) });
  }
  rows.sort((a, b) => (input.group === "month" ? a.key.localeCompare(b.key) : b.revenue - a.revenue || b.previous_revenue - a.previous_revenue));
  const caveats: string[] = [];
  if (input.group === "product") caveats.push("Product revenue is the lines' net amount (before VAT), so it can differ from document totals.");
  return {
    period: { from: input.from, to: input.to },
    previous: prev,
    documents: cur.length,
    previous_documents: old.length,
    revenue: round2(revenue),
    previous_revenue: round2(previousRevenue),
    change_pct: pct(revenue - previousRevenue, previousRevenue),
    rows: rows.slice(0, input.limit ?? 15),
    caveats,
  };
}

// ─── Gross margin by product ────────────────────────────────────────────────

export interface MarginRow {
  product_id: string;
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number | null;
}

/** Cost of one line: FIFO cost when recorded, else quantity × buy price (estimated). */
function lineCost(l: SaleLineRow, buyPrice: Map<string, number>): { cost: number; estimated: boolean } {
  if (l.cogs_amount !== null && l.cogs_amount !== undefined && Number(l.cogs_amount) > 0) return { cost: Number(l.cogs_amount), estimated: false };
  return { cost: (Number(l.quantity) || 0) * (buyPrice.get(l.product_id ?? "") ?? 0), estimated: true };
}

export function grossMarginByProduct(input: { sales: SaleRow[]; lines: SaleLineRow[]; products: ProductRow[]; from: string; to: string; limit?: number; order?: "margin" | "margin_pct_low" }) {
  const ids = new Set(input.sales.filter((s) => isPosted(s) && inPeriod(s.doc_date, input.from, input.to)).map((s) => s.id));
  const buy = new Map(input.products.map((p) => [p.id, Number(p.buy_price) || 0]));
  const by = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
  let estimatedLines = 0;
  let lines = 0;
  for (const l of input.lines) {
    if (!ids.has(l.sale_id) || !l.product_id) continue;
    lines += 1;
    const c = lineCost(l, buy);
    if (c.estimated) estimatedLines += 1;
    const b = by.get(l.product_id) ?? { name: l.product_name ?? "-", qty: 0, revenue: 0, cost: 0 };
    b.qty += Number(l.quantity) || 0;
    b.revenue += Number(l.line_total) || 0;
    b.cost += c.cost;
    by.set(l.product_id, b);
  }
  const rows: MarginRow[] = [...by].map(([id, b]) => ({
    product_id: id,
    name: b.name,
    quantity: Math.round(b.qty * 1000) / 1000,
    revenue: round2(b.revenue),
    cost: round2(b.cost),
    margin: round2(b.revenue - b.cost),
    margin_pct: pct(b.revenue - b.cost, b.revenue),
  }));
  if (input.order === "margin_pct_low") rows.sort((a, b) => (a.margin_pct ?? 0) - (b.margin_pct ?? 0));
  else rows.sort((a, b) => b.margin - a.margin);
  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const caveats: string[] = [];
  if (estimatedLines) caveats.push(`${estimatedLines} of ${lines} lines have no recorded cost; their cost is estimated from today's buy price.`);
  return {
    period: { from: input.from, to: input.to },
    lines_counted: lines,
    revenue: round2(revenue),
    cost: round2(cost),
    margin: round2(revenue - cost),
    margin_pct: pct(revenue - cost, revenue),
    rows: rows.slice(0, input.limit ?? 15),
    caveats,
  };
}

// ─── Debtors ageing ─────────────────────────────────────────────────────────

export const AGE_BUCKETS = ["0_30", "31_60", "61_90", "over_90"] as const;
type Bucket = (typeof AGE_BUCKETS)[number];
const bucketOf = (days: number): Bucket => (days <= 30 ? "0_30" : days <= 60 ? "31_60" : days <= 90 ? "61_90" : "over_90");

/** What each customer still owes on posted invoices, by age (from the due date when set, else the invoice date). */
export function debtorsAgeing(input: { sales: SaleRow[]; today: string; limit?: number }) {
  const totals: Record<Bucket, number> = { "0_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
  const by = new Map<string, { name: string; owed: number; overdue: number; oldest_days: number; oldest_doc: string | null; oldest_id: string | null; buckets: Record<Bucket, number> }>();
  let open = 0;
  let overdueTotal = 0;
  for (const s of input.sales) {
    if (!isPosted(s) || !s.doc_date) continue;
    const owed = (Number(s.total_amount) || 0) - (Number(s.paid_amount) || 0);
    if (owed <= 0.005) continue;
    open += 1;
    const age = Math.max(0, daysBetween(s.due_date || s.doc_date, input.today));
    const overdue = s.due_date ? s.due_date < input.today : age > 30;
    const k = bucketOf(age);
    totals[k] += owed;
    if (overdue) overdueTotal += owed;
    const key = s.customer_id ?? "-";
    const b = by.get(key) ?? { name: s.customer_name ?? "-", owed: 0, overdue: 0, oldest_days: -1, oldest_doc: null, oldest_id: null, buckets: { "0_30": 0, "31_60": 0, "61_90": 0, over_90: 0 } };
    b.owed += owed;
    if (overdue) b.overdue += owed;
    b.buckets[k] += owed;
    if (age > b.oldest_days) {
      b.oldest_days = age;
      b.oldest_doc = s.doc_no;
      b.oldest_id = s.id;
    }
    by.set(key, b);
  }
  const rows = [...by]
    .map(([id, b]) => ({ customer_id: id, name: b.name, owed: round2(b.owed), overdue: round2(b.overdue), oldest_days: b.oldest_days, oldest_doc: b.oldest_doc, oldest_sale_id: b.oldest_id, buckets: Object.fromEntries(AGE_BUCKETS.map((k) => [k, round2(b.buckets[k])])) }))
    .sort((a, b) => b.overdue - a.overdue || b.owed - a.owed);
  const total = Object.values(totals).reduce((a, n) => a + n, 0);
  return {
    today: input.today,
    open_invoices: open,
    total: round2(total),
    overdue: round2(overdueTotal),
    buckets: Object.fromEntries(AGE_BUCKETS.map((k) => [k, round2(totals[k])])) as Record<Bucket, number>,
    rows: rows.slice(0, input.limit ?? 15),
    caveats: ["Without a due date, an invoice counts as overdue after 30 days."],
  };
}

// ─── Stock cover and slow movers ────────────────────────────────────────────

export const COVER_WINDOW_DAYS = 60;
export const SLOW_DAYS = 90;
export const LOW_COVER_DAYS = 14;

/** Days of stock at the recent selling rate, products running out, and stock that has not moved. */
export function stockCover(input: { sales: SaleRow[]; lines: SaleLineRow[]; products: ProductRow[]; today: string; limit?: number }) {
  const posted = new Map(input.sales.filter(isPosted).map((s) => [s.id, s.doc_date ?? ""]));
  const windowFrom = addDays(input.today, -COVER_WINDOW_DAYS);
  const sold = new Map<string, number>();
  const lastSold = new Map<string, string>();
  for (const l of input.lines) {
    const d = posted.get(l.sale_id);
    if (!d || !l.product_id) continue;
    if (d > windowFrom && d <= input.today) sold.set(l.product_id, (sold.get(l.product_id) ?? 0) + (Number(l.quantity) || 0));
    if (!lastSold.has(l.product_id) || d > (lastSold.get(l.product_id) as string)) lastSold.set(l.product_id, d);
  }
  const running: Array<{ product_id: string; code: string | null; name: string; stock: number; unit: string | null; per_day: number; days_of_cover: number; min_stock: number | null }> = [];
  const slow: Array<{ product_id: string; code: string | null; name: string; stock: number; unit: string | null; last_sold: string | null; stock_value: number }> = [];
  for (const p of input.products) {
    const stock = Number(p.stock) || 0;
    const perDay = (sold.get(p.id) ?? 0) / COVER_WINDOW_DAYS;
    if (perDay > 0) {
      const cover = stock / perDay;
      const belowMin = p.min_stock !== null && p.min_stock !== undefined && stock <= Number(p.min_stock);
      if (cover < LOW_COVER_DAYS || belowMin) running.push({ product_id: p.id, code: p.code, name: p.name, stock, unit: p.unit, per_day: Math.round(perDay * 100) / 100, days_of_cover: Math.round(cover * 10) / 10, min_stock: p.min_stock });
    } else if (stock > 0) {
      const last = lastSold.get(p.id) ?? null;
      if (!last || daysBetween(last, input.today) >= SLOW_DAYS) slow.push({ product_id: p.id, code: p.code, name: p.name, stock, unit: p.unit, last_sold: last, stock_value: round2(stock * (Number(p.buy_price) || 0)) });
    }
  }
  running.sort((a, b) => a.days_of_cover - b.days_of_cover);
  slow.sort((a, b) => b.stock_value - a.stock_value);
  return {
    today: input.today,
    window_days: COVER_WINDOW_DAYS,
    products_counted: input.products.length,
    running_out: running.slice(0, input.limit ?? 15),
    slow_movers: slow.slice(0, input.limit ?? 15),
    slow_stock_value: round2(slow.reduce((a, s) => a + s.stock_value, 0)),
    caveats: [`Selling rate is the last ${COVER_WINDOW_DAYS} days of posted sales; slow movers have stock and no sale in ${SLOW_DAYS} days.`],
  };
}

// ─── Dormant customers ──────────────────────────────────────────────────────

export const DORMANT_MIN_ORDERS = 3;
export const DORMANT_DAYS = 60;

/** Customers who bought at least 3 times but nothing in the last 60 days, largest buyers first. */
export function dormantCustomers(input: { sales: SaleRow[]; today: string; limit?: number }) {
  const by = new Map<string, { name: string; orders: number; revenue: number; last: string }>();
  for (const s of input.sales) {
    if (!isPosted(s) || !s.customer_id || !s.doc_date) continue;
    const b = by.get(s.customer_id) ?? { name: s.customer_name ?? "-", orders: 0, revenue: 0, last: "" };
    b.orders += 1;
    b.revenue += Number(s.total_amount) || 0;
    if (s.doc_date > b.last) b.last = s.doc_date;
    by.set(s.customer_id, b);
  }
  const rows = [...by]
    .filter(([, b]) => b.orders >= DORMANT_MIN_ORDERS && daysBetween(b.last, input.today) > DORMANT_DAYS)
    .map(([id, b]) => ({ customer_id: id, name: b.name, orders: b.orders, revenue: round2(b.revenue), average_order: round2(b.revenue / b.orders), last_order: b.last, days_since: daysBetween(b.last, input.today) }))
    .sort((a, b) => b.revenue - a.revenue);
  return { today: input.today, rule: `at least ${DORMANT_MIN_ORDERS} orders, none in ${DORMANT_DAYS} days`, count: rows.length, rows: rows.slice(0, input.limit ?? 15) };
}

// ─── Products bought together ───────────────────────────────────────────────

export const PAIR_MIN = 3;

/** Pairs of products on the same invoice, at least 3 times (for cross-selling). */
export function coPurchasePairs(input: { sales: SaleRow[]; lines: SaleLineRow[]; from: string; to: string; limit?: number }) {
  const ids = new Set(input.sales.filter((s) => isPosted(s) && inPeriod(s.doc_date, input.from, input.to)).map((s) => s.id));
  const perSale = new Map<string, Map<string, string>>();
  for (const l of input.lines) {
    if (!ids.has(l.sale_id) || !l.product_id) continue;
    const m = perSale.get(l.sale_id) ?? new Map<string, string>();
    m.set(l.product_id, l.product_name ?? "-");
    perSale.set(l.sale_id, m);
  }
  const productCount = new Map<string, number>();
  const pairs = new Map<string, { a: string; b: string; an: string; bn: string; n: number }>();
  for (const m of perSale.values()) {
    const items = [...m].sort(([x], [y]) => x.localeCompare(y));
    for (const [id] of items) productCount.set(id, (productCount.get(id) ?? 0) + 1);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const key = `${items[i][0]}|${items[j][0]}`;
        const p = pairs.get(key) ?? { a: items[i][0], b: items[j][0], an: items[i][1], bn: items[j][1], n: 0 };
        p.n += 1;
        pairs.set(key, p);
      }
  }
  const rows = [...pairs.values()]
    .filter((p) => p.n >= PAIR_MIN)
    .map((p) => {
      const ca = productCount.get(p.a) ?? 0;
      const cb = productCount.get(p.b) ?? 0;
      return { product_a: p.an, product_b: p.bn, together: p.n, share_of_a: pct(p.n, ca), share_of_b: pct(p.n, cb), invoices_with_a: ca, invoices_with_b: cb };
    })
    .sort((x, y) => y.together - x.together || x.product_a.localeCompare(y.product_a));
  return { period: { from: input.from, to: input.to }, invoices_counted: perSale.size, rows: rows.slice(0, input.limit ?? 10) };
}

// ─── Price changes against margin ───────────────────────────────────────────

/** Average selling price and margin per product, this period against the previous one; the biggest moves. */
export function priceChanges(input: { sales: SaleRow[]; lines: SaleLineRow[]; products: ProductRow[]; from: string; to: string; limit?: number }) {
  const prev = previousPeriod(input.from, input.to);
  const date = new Map(input.sales.filter(isPosted).map((s) => [s.id, s.doc_date ?? ""]));
  const buy = new Map(input.products.map((p) => [p.id, Number(p.buy_price) || 0]));
  type Acc = { qty: number; revenue: number; cost: number };
  const by = new Map<string, { name: string; cur: Acc; old: Acc }>();
  for (const l of input.lines) {
    const d = date.get(l.sale_id);
    if (!d || !l.product_id) continue;
    const isCur = inPeriod(d, input.from, input.to);
    if (!isCur && !inPeriod(d, prev.from, prev.to)) continue;
    const b = by.get(l.product_id) ?? { name: l.product_name ?? "-", cur: { qty: 0, revenue: 0, cost: 0 }, old: { qty: 0, revenue: 0, cost: 0 } };
    const acc = isCur ? b.cur : b.old;
    acc.qty += Number(l.quantity) || 0;
    acc.revenue += Number(l.line_total) || 0;
    acc.cost += lineCost(l, buy).cost;
    by.set(l.product_id, b);
  }
  const rows = [...by]
    .filter(([, b]) => b.cur.qty > 0 && b.old.qty > 0)
    .map(([id, b]) => {
      const priceNow = b.cur.revenue / b.cur.qty;
      const priceBefore = b.old.revenue / b.old.qty;
      return {
        product_id: id,
        name: b.name,
        price_before: round2(priceBefore),
        price_now: round2(priceNow),
        price_change_pct: pct(priceNow - priceBefore, priceBefore),
        margin_pct_before: pct(b.old.revenue - b.old.cost, b.old.revenue),
        margin_pct_now: pct(b.cur.revenue - b.cur.cost, b.cur.revenue),
        quantity_before: Math.round(b.old.qty * 1000) / 1000,
        quantity_now: Math.round(b.cur.qty * 1000) / 1000,
      };
    })
    .sort((a, b) => Math.abs(b.price_change_pct ?? 0) - Math.abs(a.price_change_pct ?? 0));
  return { period: { from: input.from, to: input.to }, previous: prev, rows: rows.slice(0, input.limit ?? 15), caveats: ["Average price = net line amount ÷ quantity, so discounts lower it."] };
}

// ─── What each employee did this week (admins) ──────────────────────────────

export interface AuditCountRow {
  user_id: string | null;
  action: string;
  table_name: string | null;
  created_at: string;
}

export interface WatchCountRow {
  user_id: string | null;
  code: string;
  action: string;
  created_at: string;
}

/** Tables whose new rows count as work, and the plain name the answer uses. */
export const WORK_TABLES: Record<string, string> = {
  sales: "sales invoices",
  purchases: "purchase invoices",
  payments: "payments",
  transactions: "cash and bank entries",
  expenses: "expenses",
  customers: "new customers",
  products: "new products",
  production_orders: "production orders",
  warehouse_slips: "warehouse slips",
};

export const MISTAKE_MIN = 2;

/**
 * Facts only, no score and no ranking: per employee (by name), how many documents of each kind they
 * created in the period, how many they changed, and which watch warnings they had to fix at least twice.
 */
export function employeeOverview(input: { audit: AuditCountRow[]; watch: WatchCountRow[]; people: Array<{ id: string; name: string }>; from: string; to: string }) {
  const inRange = (iso: string) => {
    const d = iso.slice(0, 10);
    return d >= input.from && d <= input.to;
  };
  const by = new Map<string, { created: Record<string, number>; changed: number; fixed: Record<string, number>; ignored: number }>();
  const get = (id: string) => {
    const e = by.get(id) ?? { created: {}, changed: 0, fixed: {}, ignored: 0 };
    by.set(id, e);
    return e;
  };
  for (const r of input.audit) {
    if (!r.user_id || !r.table_name || !inRange(r.created_at)) continue;
    const label = WORK_TABLES[r.table_name];
    if (!label) continue;
    const e = get(r.user_id);
    if (r.action === "CREATE" || r.action === "INSERT") e.created[label] = (e.created[label] ?? 0) + 1;
    else if (r.action === "UPDATE") e.changed += 1;
  }
  for (const w of input.watch) {
    if (!w.user_id || !inRange(w.created_at)) continue;
    const e = get(w.user_id);
    if (w.action === "fixed") e.fixed[w.code] = (e.fixed[w.code] ?? 0) + 1;
    else if (w.action === "ignored") e.ignored += 1;
  }
  const names = new Map(input.people.map((p) => [p.id, p.name]));
  const rows = [...by]
    .filter(([id]) => names.has(id))
    .map(([id, e]) => ({
      name: names.get(id) as string,
      created: e.created,
      documents_changed: e.changed,
      recurring_warnings: Object.entries(e.fixed)
        .filter(([, n]) => n >= MISTAKE_MIN)
        .map(([code, n]) => ({ code, times_fixed: n }))
        .sort((a, b) => b.times_fixed - a.times_fixed || a.code.localeCompare(b.code)),
      warnings_ignored: e.ignored,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    period: { from: input.from, to: input.to },
    note: "Facts only. Do not score, rank or compare people; give each person at most one practical coaching suggestion based on their own recurring warnings.",
    people: rows,
  };
}
