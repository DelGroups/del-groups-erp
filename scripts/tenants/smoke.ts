/**
 * Smoke test of a live ERP site (prompt 11): signs in as a real user and checks login, the
 * sales list, the data an invoice print needs, and stock levels, through the same public
 * endpoints the browser uses. READ-ONLY: it never writes ERP data.
 *
 * Takes no keys: the Supabase URL and the public anon key come from the site's own
 * /api/public-config, and the user signs in with email + password like in the browser.
 * Passwords and tokens never reach the output.
 *
 * The fingerprint (counts, newest sale, Supabase host, tenant mode) is saved before a
 * change and compared after it: same database, no data lost.
 */
import { createServerClient } from "@supabase/ssr";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SmokeOptions {
  baseUrl: string;
  email: string;
  password: string;
  fetch: Fetch;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Fingerprint {
  /** "control-plane" after the switch to multi-tenant mode, "single-tenant" before. */
  mode: "control-plane" | "single-tenant";
  supabaseHost: string;
  salesCount: number;
  newestSaleId: string | null;
  stockRows: number;
  stockTotal: number;
  modulesEnabled: number | null;
}

export interface SmokeResult {
  ok: boolean;
  checks: Check[];
  fingerprint: Fingerprint | null;
}

const PAGE_SIZE = 1000;
const MAX_STOCK_ROWS = 100_000;

function totalFromContentRange(header: string | null): number | null {
  const m = /\/(\d+)$/.exec(header ?? "");
  return m ? Number(m[1]) : null;
}

/** Cookies the ERP's server code reads for this session, made by @supabase/ssr itself. */
export async function sessionCookies(
  supabaseUrl: string,
  anonKey: string,
  session: { access_token: string; refresh_token: string },
  fetchImpl: Fetch
): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
    global: { fetch: fetchImpl as typeof fetch },
  });
  const { error } = await client.auth.setSession(session);
  if (error) throw new Error(`could not build the session cookie: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const checks: Check[] = [];
  const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
  const fail = (name: string, detail: string) => checks.push({ name, ok: false, detail });
  const done = (fingerprint: Fingerprint | null): SmokeResult => ({ ok: checks.every((c) => c.ok), checks, fingerprint });
  const secrets = [options.password];
  const clean = (text: string) => secrets.reduce((t, s) => (s && s.length >= 6 ? t.split(s).join("[redacted]") : t), text).slice(0, 300);

  // 1. The login page answers (an unknown or suspended tenant would get 404/403/503 here).
  try {
    const res = await options.fetch(`${base}/login`, { redirect: "manual" });
    if (res.status === 200) pass("login page", "HTTP 200");
    else return fail("login page", `HTTP ${res.status}`), done(null);
  } catch (error) {
    return fail("login page", clean(String(error))), done(null);
  }

  // 2. Public config: which Supabase project, and whether it came from the control plane.
  let url = "";
  let anonKey = "";
  let mode: Fingerprint["mode"] = "single-tenant";
  try {
    const res = await options.fetch(`${base}/api/public-config`, { headers: { accept: "application/json" } });
    const body = (await res.json()) as { configured?: boolean; url?: string; anonKey?: string; controlPlane?: boolean };
    if (!res.ok || !body.configured || !body.url || !body.anonKey) {
      return fail("public config", `HTTP ${res.status}, configured=${String(body.configured)}`), done(null);
    }
    url = body.url.replace(/\/+$/, "");
    anonKey = body.anonKey;
    mode = body.controlPlane ? "control-plane" : "single-tenant";
    pass("public config", `${new URL(url).host} (${mode === "control-plane" ? "multi-tenant mode" : "single-tenant mode"})`);
  } catch (error) {
    return fail("public config", clean(String(error))), done(null);
  }
  secrets.push(anonKey);

  // 3. Sign in like the login form does.
  let session: { access_token: string; refresh_token: string };
  try {
    const res = await options.fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: options.email, password: options.password }),
    });
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string; msg?: string };
    if (!res.ok || !body.access_token || !body.refresh_token) {
      return fail("sign in", `HTTP ${res.status} ${clean(body.error_description ?? body.msg ?? "")}`.trim()), done(null);
    }
    session = { access_token: body.access_token, refresh_token: body.refresh_token };
    secrets.push(session.access_token, session.refresh_token);
    pass("sign in", options.email.replace(/^(.).*(@.*)$/, "$1***$2"));
  } catch (error) {
    return fail("sign in", clean(String(error))), done(null);
  }

  const rest = async (pathAndQuery: string, init: RequestInit = {}) =>
    options.fetch(`${url}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, ...(init.headers ?? {}) },
    });
  const json = async <T>(res: Response, what: string): Promise<T> => {
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${clean(await res.text())}`);
    return (await res.json()) as T;
  };

  const fingerprint: Fingerprint = {
    mode,
    supabaseHost: new URL(url).host,
    salesCount: 0,
    newestSaleId: null,
    stockRows: 0,
    stockTotal: 0,
    modulesEnabled: null,
  };

  try {
    // 4. Sales list (what /sales shows first).
    let newest: { id: string; invoice_number: string | null } | null = null;
    try {
      const res = await rest("sales?select=id,invoice_number,total_amount,created_at&order=created_at.desc.nullslast&limit=5", {
        headers: { Prefer: "count=exact" },
      });
      const rows = await json<{ id: string; invoice_number: string | null }[]>(res, "sales");
      fingerprint.salesCount = totalFromContentRange(res.headers.get("content-range")) ?? rows.length;
      newest = rows[0] ?? null;
      fingerprint.newestSaleId = newest?.id ?? null;
      pass("sales list", `${fingerprint.salesCount} sales; newest ${newest?.invoice_number ?? newest?.id ?? "none"}`);
    } catch (error) {
      fail("sales list", clean(error instanceof Error ? error.message : String(error)));
    }

    // 5. Invoice print data: the newest sale's lines and the company header.
    try {
      let lines = "no sale to print";
      if (newest) {
        const items = await json<unknown[]>(
          await rest(`sale_items?select=id,product_name,quantity,unit_price&sale_id=eq.${encodeURIComponent(newest.id)}`),
          "sale_items"
        );
        lines = `${items.length} line(s) on ${newest.invoice_number ?? newest.id}`;
      }
      let company = "";
      const profile = await rest("company_profile?select=display_name,legal_name&limit=1");
      if (profile.ok) {
        const rows = (await profile.json()) as { display_name: string; legal_name: string }[];
        company = rows[0]?.legal_name || rows[0]?.display_name || "";
      } else {
        // Before migration 20261011120000 the header came from `settings`.
        const rows = await json<{ company_name: string | null }[]>(await rest("settings?select=company_name&limit=1"), "settings");
        company = rows[0]?.company_name ?? "";
      }
      if (!company) throw new Error("the company name for the invoice header is empty");
      pass("invoice print data", `${lines}; header "${company}"`);
    } catch (error) {
      fail("invoice print data", clean(error instanceof Error ? error.message : String(error)));
    }

    // 6. Stock levels: every warehouse_stocks row, summed.
    try {
      let offset = 0;
      for (;;) {
        const rows = await json<{ current_stock: number | string | null }[]>(
          await rest("warehouse_stocks?select=current_stock&order=id", {
            headers: { Range: `${offset}-${offset + PAGE_SIZE - 1}`, "Range-Unit": "items" },
          }),
          "warehouse_stocks"
        );
        fingerprint.stockRows += rows.length;
        for (const r of rows) fingerprint.stockTotal += Number(r.current_stock) || 0;
        offset += PAGE_SIZE;
        if (rows.length < PAGE_SIZE || offset >= MAX_STOCK_ROWS) break;
      }
      fingerprint.stockTotal = Math.round(fingerprint.stockTotal * 1000) / 1000;
      pass("stock levels", `${fingerprint.stockRows} rows, total ${fingerprint.stockTotal}`);
    } catch (error) {
      fail("stock levels", clean(error instanceof Error ? error.message : String(error)));
    }

    // 7. Modules (information only: before migration 20261011130000 the table is missing).
    const modules = await rest("tenant_modules?select=module_id,enabled");
    if (modules.ok) {
      const rows = (await modules.json()) as { enabled: boolean }[];
      fingerprint.modulesEnabled = rows.filter((r) => r.enabled).length;
      pass("modules", `${fingerprint.modulesEnabled} of ${rows.length} enabled`);
    } else {
      pass("modules", "tenant_modules not installed yet: every module is on");
    }

    // 8. The pages themselves, rendered by the ERP server for this user.
    try {
      const cookie = await sessionCookies(url, anonKey, session, options.fetch);
      const pages = ["/sales", ...(newest ? [`/sales/${newest.id}`] : []), "/inventory"];
      for (const page of pages) {
        const res = await options.fetch(`${base}${page}`, { headers: { cookie }, redirect: "manual" });
        const location = res.headers.get("location") ?? "";
        if (res.status === 200) pass(`page ${page}`, "HTTP 200");
        else fail(`page ${page}`, `HTTP ${res.status}${location ? ` -> ${location.replace(base, "")}` : ""}`);
      }
    } catch (error) {
      fail("pages", clean(error instanceof Error ? error.message : String(error)));
    }
  } finally {
    // End the session (best effort); nothing else was written.
    await options
      .fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` } })
      .catch(() => undefined);
  }

  return done(fingerprint);
}

/**
 * Before/after comparison. Same project; counts may grow (staff keep working) but never
 * shrink; the mode is reported, not judged (it is expected to change at the switch).
 */
export function compareFingerprints(before: Fingerprint, after: Fingerprint): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  add("same Supabase project", before.supabaseHost === after.supabaseHost, `${before.supabaseHost} -> ${after.supabaseHost}`);
  add("mode", true, `${before.mode} -> ${after.mode}`);
  add("sales not lost", after.salesCount >= before.salesCount, `${before.salesCount} -> ${after.salesCount}`);
  add("stock rows not lost", after.stockRows >= before.stockRows, `${before.stockRows} -> ${after.stockRows}`);
  add(
    "stock total",
    true,
    before.stockTotal === after.stockTotal ? `unchanged (${after.stockTotal})` : `${before.stockTotal} -> ${after.stockTotal} (changes if staff moved stock meanwhile)`
  );
  if (after.modulesEnabled !== null) add("modules enabled", after.modulesEnabled > 0, `${before.modulesEnabled ?? "all (no table)"} -> ${after.modulesEnabled}`);
  return checks;
}
