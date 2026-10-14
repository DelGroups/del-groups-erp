import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { getEnabledModules } from "@/lib/modules/server";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { lowStockCount, monthStart, openProductionOrders, salesThisMonth, totalBalance, type AppKpis } from "@/lib/shell/kpis";

export const dynamic = "force-dynamic";

type Rows = Record<string, unknown>[] | null;

/**
 * Live figures for the launcher tiles of the new shell (prompt 16). Read with the signed-in
 * user's own session, so row level security decides what counts; a query the user may not
 * run, or a module the tenant does not have, gives no figure. 404 while NEW_UI is off.
 */
export async function GET() {
  if (!isNewUiEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { client, user, isActive } = await getServerAuthContext();
  if (!user || !isActive) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const enabled = await getEnabledModules();
  const since = monthStart(new Date().toISOString().slice(0, 10));
  const rows = async (query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Rows> => {
    try {
      const { data, error } = await query;
      return error ? null : ((data as Rows) ?? []);
    } catch {
      return null;
    }
  };
  const count = async (table: string, filter?: (q: ReturnType<typeof head>) => ReturnType<typeof head>): Promise<number | null> => {
    try {
      const base = head(table);
      const { count: n, error } = await (filter ? filter(base) : base);
      return error ? null : (n ?? 0);
    } catch {
      return null;
    }
  };
  function head(table: string) {
    return client.from(table as never).select("id", { count: "exact", head: true });
  }

  const sales = enabled.has("sales") ? rows(client.from("sales").select("total_amount, status").gte("doc_date", since)) : Promise.resolve(null);
  const [salesRows, productRows, productionRows, customers, accountRows, employees, users] = await Promise.all([
    sales,
    enabled.has("inventory") ? rows(client.from("products").select("stock, min_stock, is_service")) : Promise.resolve(null),
    enabled.has("production") ? rows(client.from("production_orders" as never).select("status")) : Promise.resolve(null),
    count("customers"),
    enabled.has("accounting") ? rows(client.from("accounts").select("balance")) : Promise.resolve(null),
    enabled.has("hr") ? count("employees") : Promise.resolve(null),
    count("profiles", (q) => q.eq("is_active" as never, true as never)),
  ]);

  const s = salesThisMonth(salesRows as Parameters<typeof salesThisMonth>[0]);
  const kpis: AppKpis = {
    dashboard: { value: s?.total ?? null, kind: "money" },
    trade: { value: s?.count ?? null, kind: "count" },
    inventory: { value: lowStockCount(productRows as Parameters<typeof lowStockCount>[0]), kind: "count" },
    production: { value: openProductionOrders(productionRows as Parameters<typeof openProductionOrders>[0]), kind: "count" },
    crm: { value: customers, kind: "count" },
    finance: { value: totalBalance(accountRows as Parameters<typeof totalBalance>[0]), kind: "money" },
    hr: { value: employees, kind: "count" },
    settings: { value: users, kind: "count" },
  };
  return NextResponse.json(kpis, { headers: { "Cache-Control": "private, no-store" } });
}
