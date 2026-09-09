import { userHasLegacyPermission } from "@/lib/auth/permissionMatrix";
import { isCriticalStock, productMinStock } from "@/lib/inventory/safetyStock";
import { normalizeUnifiedTransactionType } from "@/lib/finance/unifiedLedger";
import { isValidUuid } from "@/lib/auth/validate";
import type { UserProfile } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type AssistantLink = {
  label: string;
  href: string;
};

export type AssistantSnapshot = {
  generated_at: string;
  finance: {
    income: number;
    expense: number;
    net: number;
    accounts: Array<{ name: string; balance: number }>;
  } | null;
  inventory: {
    product_count: number;
    zero_stock: number;
    critical: Array<{
      id: string;
      code: string;
      name: string;
      stock: number;
      min_stock: number;
      href: string;
    }>;
  } | null;
  production: {
    total: number;
    by_status: Record<string, number>;
    recent: Array<{ id: string; order_no: string; status: string; href: string }>;
  } | null;
  search: {
    products: AssistantLink[];
    customers: AssistantLink[];
    orders: AssistantLink[];
    sales: AssistantLink[];
  };
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeIlike(term: string): string {
  return term.replace(/[%_,()]/g, "").trim().slice(0, 80);
}

export function extractSearchTerm(message: string): string {
  return sanitizeIlike(message.replace(/["'`]/g, " "));
}

export async function buildAssistantSnapshot(
  client: SupabaseClient<Database>,
  profile: UserProfile | null,
  searchTerm: string
): Promise<AssistantSnapshot> {
  const canFinance = userHasLegacyPermission(profile, "can_view_finance");
  const canInventory = userHasLegacyPermission(profile, "can_view_products");
  const canProduction = userHasLegacyPermission(profile, "can_view_production");
  const canCustomers = userHasLegacyPermission(profile, "can_view_customers");
  const canSales = userHasLegacyPermission(profile, "can_view_sales");

  const snapshot: AssistantSnapshot = {
    generated_at: new Date().toISOString(),
    finance: null,
    inventory: null,
    production: null,
    search: { products: [], customers: [], orders: [], sales: [] },
  };

  const tasks: Array<Promise<void>> = [];

  if (canFinance) {
    tasks.push(
      (async () => {
        const [txRes, accountsRes] = await Promise.all([
          client
            .from("transactions")
            .select("type, unified_type, amount")
            .limit(800),
          client.from("accounts").select("name, balance, type").order("name").limit(40),
        ]);
        if (txRes.error) console.warn("[ai-snapshot] transactions", txRes.error.message);
        if (accountsRes.error) console.warn("[ai-snapshot] accounts", accountsRes.error.message);

        let income = 0;
        let expense = 0;
        for (const row of txRes.data || []) {
          const amount = num((row as { amount?: number }).amount);
          const kind = normalizeUnifiedTransactionType(
            (row as { unified_type?: string }).unified_type,
            (row as { type?: string }).type
          );
          if (kind === "INCOME") income += amount;
          if (kind === "EXPENSE") expense += amount;
        }

        snapshot.finance = {
          income: Math.round(income * 100) / 100,
          expense: Math.round(expense * 100) / 100,
          net: Math.round((income - expense) * 100) / 100,
          accounts: (accountsRes.data || []).map((row) => ({
            name: String((row as { name?: string }).name || ""),
            balance: num((row as { balance?: number }).balance),
          })),
        };
      })()
    );
  }

  if (canInventory) {
    tasks.push(
      (async () => {
        const { data, error } = await client
          .from("products")
          .select("id, code, name, stock, min_stock, min_stock_level, is_service")
          .order("name")
          .limit(400);
        if (error) {
          console.warn("[ai-snapshot] products", error.message);
          return;
        }
        const products = (data || []) as Array<{
          id: string;
          code?: string | null;
          name?: string | null;
          stock?: number | null;
          min_stock?: number | null;
          min_stock_level?: number | null;
          is_service?: boolean | null;
        }>;
        const critical = products
          .filter((row) => isCriticalStock(row))
          .slice(0, 12)
          .map((row) => ({
            id: String(row.id),
            code: String(row.code || ""),
            name: String(row.name || ""),
            stock: num(row.stock),
            min_stock: productMinStock(row),
            href: `/products`,
          }));
        snapshot.inventory = {
          product_count: products.length,
          zero_stock: products.filter((row) => !row.is_service && num(row.stock) <= 0).length,
          critical,
        };
      })()
    );
  }

  if (canProduction) {
    tasks.push(
      (async () => {
        const { data, error } = await client
          .from("production_orders")
          .select("id, order_no, status, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) {
          console.warn("[ai-snapshot] production", error.message);
          return;
        }
        const orders = data || [];
        const byStatus: Record<string, number> = {};
        for (const row of orders) {
          const status = String((row as { status?: string }).status || "Draft");
          byStatus[status] = (byStatus[status] || 0) + 1;
        }
        snapshot.production = {
          total: orders.length,
          by_status: byStatus,
          recent: orders.slice(0, 8).map((row) => {
            const id = String(row.id);
            return {
              id,
              order_no: String((row as { order_no?: string }).order_no || id.slice(0, 8)),
              status: String((row as { status?: string }).status || ""),
              href: `/production/${id}`,
            };
          }),
        };
      })()
    );
  }

  if (searchTerm.length >= 2) {
    if (canInventory) {
      tasks.push(
        (async () => {
          const { data, error } = await client
            .from("products")
            .select("id, code, name")
            .or(`name.ilike.%${searchTerm}%,code.ilike.%${searchTerm}%`)
            .limit(8);
          if (error) {
            console.warn("[ai-snapshot] product search", error.message);
            return;
          }
          snapshot.search.products = (data || []).map((row) => ({
            label: `${row.code || ""} ${row.name || ""}`.trim(),
            href: `/products`,
          }));
        })()
      );
    }
    if (canCustomers) {
      tasks.push(
        (async () => {
          const { data, error } = await client
            .from("customers")
            .select("id, full_name, name, company_name, phone")
            .or(
              `full_name.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%,company_name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`
            )
            .limit(8);
          if (error) {
            console.warn("[ai-snapshot] customer search", error.message);
            return;
          }
          snapshot.search.customers = (data || []).map((row) => {
            const id = String(row.id);
            const label =
              String(row.full_name || row.name || row.company_name || id).trim() || id;
            return { label, href: `/customers` };
          });
        })()
      );
    }
    if (canProduction) {
      tasks.push(
        (async () => {
          const { data, error } = await client
            .from("production_orders")
            .select("id, order_no, document_no, project_name, status")
            .or(
              `order_no.ilike.%${searchTerm}%,document_no.ilike.%${searchTerm}%,project_name.ilike.%${searchTerm}%`
            )
            .limit(8);
          if (error) {
            console.warn("[ai-snapshot] order search", error.message);
            return;
          }
          snapshot.search.orders = (data || []).map((row) => {
            const id = String(row.id);
            const label = String(row.order_no || row.document_no || row.project_name || id);
            return {
              label: `${label} (${row.status || ""})`.trim(),
              href: isValidUuid(id) ? `/production/${id}` : "/production",
            };
          });
        })()
      );
    }
    if (canSales) {
      tasks.push(
        (async () => {
          const { data, error } = await client
            .from("sales")
            .select("id, doc_no, invoice_number, customer_name")
            .or(
              `doc_no.ilike.%${searchTerm}%,invoice_number.ilike.%${searchTerm}%,customer_name.ilike.%${searchTerm}%`
            )
            .limit(8);
          if (error) {
            console.warn("[ai-snapshot] sales search", error.message);
            return;
          }
          snapshot.search.sales = (data || []).map((row) => {
            const id = String(row.id);
            const label = String(row.doc_no || row.invoice_number || row.customer_name || id);
            return {
              label,
              href: isValidUuid(id) ? `/sales/${id}` : "/sales",
            };
          });
        })()
      );
    }
  }

  await Promise.all(tasks);
  return snapshot;
}

export function collectSnapshotLinks(snapshot: AssistantSnapshot): AssistantLink[] {
  const links: AssistantLink[] = [];
  for (const item of snapshot.inventory?.critical || []) {
    links.push({ label: `${item.code} ${item.name}`.trim(), href: item.href });
  }
  for (const item of snapshot.production?.recent || []) {
    links.push({ label: item.order_no, href: item.href });
  }
  links.push(
    ...snapshot.search.products,
    ...snapshot.search.customers,
    ...snapshot.search.orders,
    ...snapshot.search.sales
  );
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.href}|${link.label}`;
    if (seen.has(key) || !link.label) return false;
    seen.add(key);
    return true;
  }).slice(0, 16);
}

export function fallbackAssistantReply(snapshot: AssistantSnapshot, locale: string): string {
  const lines: string[] = [];
  if (snapshot.finance) {
    lines.push(
      locale === "ru"
        ? `**Финансы:** доход ${snapshot.finance.income.toFixed(2)} AZN, расход ${snapshot.finance.expense.toFixed(2)} AZN, нетто ${snapshot.finance.net.toFixed(2)} AZN.`
        : locale === "en"
          ? `**Finance:** income ${snapshot.finance.income.toFixed(2)} AZN, expense ${snapshot.finance.expense.toFixed(2)} AZN, net ${snapshot.finance.net.toFixed(2)} AZN.`
          : `**Maliyyə:** mədaxil ${snapshot.finance.income.toFixed(2)} AZN, məxaric ${snapshot.finance.expense.toFixed(2)} AZN, xalis ${snapshot.finance.net.toFixed(2)} AZN.`
    );
  }
  if (snapshot.inventory) {
    lines.push(
      locale === "ru"
        ? `**Склад:** ${snapshot.inventory.product_count} позиций, нулевой остаток: ${snapshot.inventory.zero_stock}, критичных: ${snapshot.inventory.critical.length}.`
        : locale === "en"
          ? `**Inventory:** ${snapshot.inventory.product_count} SKUs, zero stock: ${snapshot.inventory.zero_stock}, critical: ${snapshot.inventory.critical.length}.`
          : `**Anbar:** ${snapshot.inventory.product_count} məhsul, sıfır qalıq: ${snapshot.inventory.zero_stock}, kritik: ${snapshot.inventory.critical.length}.`
    );
    for (const item of snapshot.inventory.critical.slice(0, 5)) {
      lines.push(`- [${item.code} ${item.name}](${item.href}) — ${item.stock}/${item.min_stock}`);
    }
  }
  if (snapshot.production) {
    const status = Object.entries(snapshot.production.by_status)
      .map(([key, count]) => `${key}: ${count}`)
      .join(", ");
    lines.push(
      locale === "ru"
        ? `**Производство:** ${snapshot.production.total} заказов (${status || "нет"}).`
        : locale === "en"
          ? `**Production:** ${snapshot.production.total} orders (${status || "none"}).`
          : `**İstehsalat:** ${snapshot.production.total} sənəd (${status || "yoxdur"}).`
    );
    for (const order of snapshot.production.recent.slice(0, 5)) {
      lines.push(`- [${order.order_no}](${order.href}) — ${order.status}`);
    }
  }
  const hits = [
    ...snapshot.search.products,
    ...snapshot.search.customers,
    ...snapshot.search.orders,
    ...snapshot.search.sales,
  ];
  if (hits.length > 0) {
    lines.push(locale === "ru" ? "**Найдено:**" : locale === "en" ? "**Matches:**" : "**Axtarış nəticələri:**");
    for (const hit of hits.slice(0, 10)) {
      lines.push(`- [${hit.label}](${hit.href})`);
    }
  }
  if (lines.length === 0) {
    return locale === "ru"
      ? "Нет данных в пределах ваших прав. Добавьте операции, склад или заказы."
      : locale === "en"
        ? "No data is visible with your permissions. Add finance, inventory, or production records."
        : "İcazəniz daxilində məlumat yoxdur. Maliyyə, anbar və ya istehsalat qeydi əlavə edin.";
  }
  return lines.join("\n");
}
