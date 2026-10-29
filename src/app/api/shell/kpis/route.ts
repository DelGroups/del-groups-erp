import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { getEnabledModules } from "@/lib/modules/server";
import { isNewUiEnabled } from "@/lib/features/newUi";
import { canViewFinancials } from "@/lib/auth/permissionMatrix";
import { composeAppKpis, monthStart, type AppKpis, type KpiInputs } from "@/lib/shell/kpis";

export const dynamic = "force-dynamic";

type Rows = Record<string, unknown>[] | null;

/**
 * Live figures for the launcher tiles of the new shell (prompt 16). Read with the signed-in
 * user's own session, so row level security decides what counts; a query the user may not
 * run, or a module the tenant does not have, gives no figure. 404 while NEW_UI is off.
 *
 * Money amounts and sales counts (dashboard, trade, finance) only for users who may see the home
 * page's financial figures (canViewFinancials, prompt 24b): for anyone else those queries are not
 * run and no figure is returned; their trade tile shows their own activities due today.
 */
export async function GET() {
  if (!isNewUiEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { client, user, profile, isActive } = await getServerAuthContext();
  if (!user || !isActive) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const financials = canViewFinancials(profile);
  const enabled = await getEnabledModules();
  const today = new Date().toISOString().slice(0, 10);
  const since = monthStart(today);
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

  const sales = financials && enabled.has("sales") ? rows(client.from("sales").select("total_amount, status").gte("doc_date", since)) : Promise.resolve(null);
  const accounts = financials && enabled.has("accounting") ? rows(client.from("accounts").select("balance")) : Promise.resolve(null);
  // Non-financial users: their own open activities due today (phase 19 chatter).
  const myActivities = financials
    ? Promise.resolve(null)
    : count("activities", (q) => q.eq("assigned_to" as never, user.id as never).eq("due_date" as never, today as never).is("done_at" as never, null as never));
  const [salesRows, productRows, productionRows, customers, accountRows, employees, users, activitiesToday] = await Promise.all([
    sales,
    enabled.has("inventory") ? rows(client.from("products").select("stock, min_stock, is_service")) : Promise.resolve(null),
    enabled.has("production") ? rows(client.from("production_orders" as never).select("status")) : Promise.resolve(null),
    count("customers"),
    accounts,
    enabled.has("hr") ? count("employees") : Promise.resolve(null),
    count("profiles", (q) => q.eq("is_active" as never, true as never)),
    myActivities,
  ]);

  const kpis: AppKpis = composeAppKpis({
    financials,
    salesRows: salesRows as KpiInputs["salesRows"],
    accountRows: accountRows as KpiInputs["accountRows"],
    productRows: productRows as KpiInputs["productRows"],
    productionRows: productionRows as KpiInputs["productionRows"],
    customers,
    employees,
    users,
    activitiesToday,
  });
  return NextResponse.json(kpis, { headers: { "Cache-Control": "private, no-store" } });
}
