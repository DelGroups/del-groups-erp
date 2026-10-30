"use server";

import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { canViewFinancials } from "@/lib/auth/permissionMatrix";
import { isNewImportsEnabled } from "@/lib/features/newImports";
import { cbarUrl, IMPORT_CURRENCIES, isImportCurrency, parseCbarXml, type ImportCurrency } from "@/lib/imports/cbar";
import { IMPORTS_CONFIG_KEY, parseImportsConfig, type ImportsConfig } from "@/lib/imports/config";
import { fetchProfileDisplayNames, type ProfileNamesClient } from "@/lib/profiles/displayNames";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { PermissionKey } from "@/types/database.types";
import { draftIssues, isUuid, landedCostOf, parseShipmentDraft, type DraftIssue, type ImportProduct, type ShipmentDraft } from "../lib/shipment";
import { shipmentFromRows, shipmentListRows, type ShipmentListRow } from "../lib/rows";

/**
 * Server side of the Imports module (IMP-1). Every action checks NEW_IMPORTS, the module and the
 * permission, then reads or writes with the service role (RLS on the tables is the second fence).
 * Amounts are money: users without dashboard.view_financials get shipments without them and
 * cannot save. Errors are i18n keys under imports.errors.
 */

export type ImportsResult<T = void> = { success: true; data: T } | { success: false; error: string; issues?: DraftIssue[] };

/** The tables are newer than the generated Database types. */
type Row = Record<string, unknown>;
type Query = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  select: (columns?: string) => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, values: readonly unknown[]) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  limit: (n: number) => Query;
  maybeSingle: () => Query;
  upsert: (rows: Row | Row[], options?: { onConflict?: string }) => Query;
};
type Client = { from: (table: string) => Query; rpc: (fn: string, args?: Row) => Query };

async function admin(): Promise<Client> {
  return (await createSupabaseAdminClient()) as unknown as Client;
}

async function guard(permission: PermissionKey) {
  if (!isNewImportsEnabled()) throw new ActionAuthError("imports.errors.disabled");
  const ctx = await requirePermissionAction(permission, { module: "imports" });
  return { ...ctx, financials: canViewFinancials(ctx.profile) };
}

function fail(err: unknown, fallback = "imports.errors.failed"): { success: false; error: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message.startsWith("imports.") ? err.message : "imports.errors.forbidden" };
  console.error("[imports]", err);
  return { success: false, error: fallback };
}

async function rows(q: Query): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Row[] | null) ?? [];
}

async function loadConfig(client: Client): Promise<ImportsConfig> {
  const { data } = await client.from("system_settings").select("value").eq("key", IMPORTS_CONFIG_KEY).maybeSingle();
  return parseImportsConfig((data as { value?: unknown } | null)?.value);
}

// ── Lists and lookups ───────────────────────────────────────────────────────

/** Every shipment with its totals (amounts null for users without financial figures). */
export async function listShipmentsAction(): Promise<ImportsResult<ShipmentListRow[]>> {
  try {
    const { financials } = await guard("can_view_imports");
    const client = await admin();
    const shipments = await rows(client.from("import_shipments").select("*").order("created_at", { ascending: false }).limit(2000));
    const ids = shipments.map((s) => s.id);
    const [lines, costs] = ids.length
      ? await Promise.all([
          rows(client.from("import_shipment_lines").select("id, shipment_id, qty_purchase_unit, unit_price_fc").in("shipment_id", ids)),
          rows(client.from("import_cost_lines").select("id, shipment_id, amount, rate_to_azn, vat_amount_azn, cost_type").in("shipment_id", ids)),
        ])
      : [[], []];
    const costIds = costs.map((c) => c.id);
    const allocations = costIds.length ? await rows(client.from("import_cost_allocations").select("cost_line_id, amount_azn").in("cost_line_id", costIds)) : [];
    const supplierIds = [...new Set(shipments.map((s) => s.supplier_id).filter(isUuid))];
    const suppliers = supplierIds.length ? await rows(client.from("suppliers").select("id, full_name, company_name").in("id", supplierIds)) : [];
    const creatorIds = [...new Set(shipments.map((s) => s.created_by).filter(isUuid))];
    const names = creatorIds.length ? await fetchProfileDisplayNames(client as unknown as ProfileNamesClient, creatorIds) : new Map<string, string>();
    return { success: true, data: shipmentListRows({ shipments, lines, costs, allocations, suppliers, names, financials }) };
  } catch (err) {
    return fail(err);
  }
}

export interface ImportLookups {
  suppliers: { id: string; name: string }[];
  products: ImportProduct[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  accounts: { id: string; name: string }[];
}

/** Suppliers (also carriers, customs, brokers), products, warehouses and cash/bank accounts. */
export async function importLookupsAction(): Promise<ImportsResult<ImportLookups>> {
  try {
    await guard("can_view_imports");
    const client = await admin();
    const [suppliers, products, warehouses, accounts] = await Promise.all([
      rows(client.from("suppliers").select("id, full_name, company_name").order("full_name").limit(5000)),
      rows(client.from("products").select("id, code, name, unit, barcode, inventory_mode, full_sheet_length_m, is_service, is_composite").order("name").limit(20000)),
      rows(client.from("warehouses").select("id, name, is_default").order("name")),
      rows(client.from("accounts").select("id, code, name").order("code")),
    ]);
    return {
      success: true,
      data: {
        suppliers: suppliers.map((s) => ({ id: String(s.id), name: String(s.company_name || s.full_name || "") })),
        products: products
          .filter((p) => !p.is_service && !p.is_composite)
          .map((p) => ({
            id: String(p.id),
            code: String(p.code ?? ""),
            name: String(p.name ?? ""),
            unit: (p.unit as string | null) ?? null,
            sheetLengthM: p.inventory_mode === "polywood" && Number(p.full_sheet_length_m) > 0 ? Number(p.full_sheet_length_m) : null,
            barcode: (p.barcode as string | null) ?? null,
          })),
        warehouses: warehouses.map((w) => ({ id: String(w.id), name: String(w.name ?? ""), isDefault: w.is_default === true })),
        accounts: accounts.map((a) => ({ id: String(a.id), name: [a.code, a.name].filter(Boolean).join(" · ") })),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

// ── One shipment ────────────────────────────────────────────────────────────

export interface ShipmentView {
  draft: ShipmentDraft;
  /** False for users without financial figures: amounts are zeroed and saving is refused. */
  financials: boolean;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getShipmentAction(id: string): Promise<ImportsResult<ShipmentView>> {
  try {
    const { financials } = await guard("can_view_imports");
    if (!isUuid(id)) return { success: false, error: "imports.errors.notFound" };
    const client = await admin();
    const { data: header, error } = await client.from("import_shipments").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!header) return { success: false, error: "imports.errors.notFound" };
    const [lines, costs] = await Promise.all([
      rows(client.from("import_shipment_lines").select("*").eq("shipment_id", id).order("position")),
      rows(client.from("import_cost_lines").select("*").eq("shipment_id", id).order("position")),
    ]);
    const costIds = costs.map((c) => c.id);
    const allocations = costIds.length ? await rows(client.from("import_cost_allocations").select("*").in("cost_line_id", costIds)) : [];
    const h = header as Row;
    const names = isUuid(h.created_by) ? await fetchProfileDisplayNames(client as unknown as ProfileNamesClient, [h.created_by]) : new Map<string, string>();
    return {
      success: true,
      data: {
        draft: shipmentFromRows(h, lines, costs, allocations, financials),
        financials,
        createdByName: isUuid(h.created_by) ? names.get(h.created_by) ?? null : null,
        createdAt: (h.created_at as string) ?? null,
        updatedAt: (h.updated_at as string) ?? null,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Saves a draft in one transaction (import_shipment_save_draft): the header, and the lines, costs
 * and split replace the stored ones. The split is computed here again with the tenant's settings,
 * never taken from the client.
 */
export async function saveShipmentDraftAction(input: unknown): Promise<ImportsResult<{ id: string; number: string }>> {
  try {
    const { financials, user } = await guard("can_manage_imports");
    if (!financials) return { success: false, error: "imports.errors.financialsRequired" };
    const draft = parseShipmentDraft(input);
    const client = await admin();
    const config = await loadConfig(client);
    const issues = draftIssues(draft, config);
    if (issues.length) return { success: false, error: "imports.errors.invalid", issues };

    const productIds = [...new Set(draft.lines.map((l) => l.productId))];
    if (productIds.length) {
      const found = await rows(client.from("products").select("id").in("id", productIds));
      if (found.length !== productIds.length) return { success: false, error: "imports.errors.invalid", issues: ["line_product"] };
    }

    const result = landedCostOf(draft, config);
    const lineIndex = new Map(draft.lines.map((l, i) => [l.key, i]));
    const { data, error } = await client.rpc("import_shipment_save_draft", {
      p_id: draft.id,
      p_header: {
        supplier_id: draft.supplierId,
        currency_code: draft.currencyCode,
        invoice_no: draft.invoiceNo,
        invoice_date: draft.invoiceDate,
        invoice_rate: draft.invoiceRate,
        incoterm: draft.incoterm,
        customs_declaration_no: draft.customsDeclarationNo,
        customs_declaration_date: draft.customsDeclarationDate,
        customs_rate: draft.customsRate,
        default_warehouse_id: draft.defaultWarehouseId,
        notes: draft.notes,
      },
      p_lines: draft.lines.map((l, i) => ({
        position: i,
        product_id: l.productId,
        qty_purchase_unit: l.qtyPurchase,
        purchase_unit: l.purchaseUnit,
        qty_stock_unit: l.qtyStock,
        unit_price_fc: l.unitPriceFc,
        weight_kg: l.weightKg,
        volume_m3: l.volumeM3,
        hs_code: l.hsCode,
        duty_rate_pct: l.dutyRatePct,
        warehouse_id: l.warehouseId,
      })),
      p_costs: draft.costs.map((c, i) => {
        const duty = c.splitMethod === "per_line_duty";
        return {
          position: i,
          cost_type: c.costType,
          partner_id: c.partnerId,
          description: c.description,
          // A duty split per line stores the computed duty, in AZN.
          amount: duty ? result.costs[i].amountAzn : c.amount,
          currency_code: duty ? "AZN" : c.currencyCode,
          rate_to_azn: duty || c.currencyCode === "AZN" ? 1 : c.rateToAzn,
          vat_amount_azn: c.vatAmountAzn,
          is_capitalized: c.isCapitalized,
          split_method: c.splitMethod,
          is_estimate: c.isEstimate,
          paid_now: c.paidNow,
          cash_account_id: c.paidNow ? c.cashAccountId : null,
        };
      }),
      p_allocations: result.costs.flatMap((cost, costPosition) =>
        Object.entries(cost.allocations).map(([lineKey, amount]) => ({ cost_position: costPosition, line_position: lineIndex.get(lineKey), amount_azn: amount }))
      ),
      p_actor: user.id,
    });
    if (error) {
      if (error.message.includes("imports_not_draft")) return { success: false, error: "imports.errors.notDraft" };
      if (error.message.includes("imports_not_found")) return { success: false, error: "imports.errors.notFound" };
      throw new Error(error.message);
    }
    const saved = data as { id: string; number: string };
    return { success: true, data: { id: saved.id, number: saved.number } };
  } catch (err) {
    return fail(err, "imports.errors.saveFailed");
  }
}

// ── Settings ────────────────────────────────────────────────────────────────

/** Settings for the form (imports.view) and the settings page. */
export async function getImportsConfigAction(): Promise<ImportsResult<ImportsConfig>> {
  try {
    await guard("can_view_imports");
    return { success: true, data: await loadConfig(await admin()) };
  } catch (err) {
    return fail(err);
  }
}

export async function saveImportsConfigAction(input: unknown): Promise<ImportsResult<ImportsConfig>> {
  try {
    await guard("can_manage_settings");
    const config = parseImportsConfig(input);
    const { error } = await (await admin())
      .from("system_settings")
      .upsert({ key: IMPORTS_CONFIG_KEY, value: config, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { success: true, data: config };
  } catch (err) {
    return fail(err, "imports.errors.saveFailed");
  }
}

// ── CBAR rates ──────────────────────────────────────────────────────────────

export interface RateAnswer {
  currency: ImportCurrency;
  rate: number;
  /** Bulletin date (yyyy-mm-dd): earlier than asked on a weekend or holiday, or for a future date. */
  date: string;
  source: "cbar";
}

/**
 * The official CBAR rate of a currency on a date: from exchange_rates when already fetched,
 * otherwise from cbar.az (all module currencies of that bulletin are stored). When the site is
 * down or answers with something else, the action says so; it never falls back to 1.
 */
export async function cbarRateAction(currency: string, date: string): Promise<ImportsResult<RateAnswer>> {
  try {
    await guard("can_view_imports");
    if (!isImportCurrency(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: "imports.errors.invalidRateRequest" };
    if (currency === "AZN") return { success: true, data: { currency, rate: 1, date, source: "cbar" } };
    const client = await admin();
    const cached = await rows(
      client.from("exchange_rates").select("rate_to_azn, rate_date").eq("currency_code", currency).eq("source", "cbar").eq("rate_date", date).limit(1)
    );
    if (cached.length) return { success: true, data: { currency, rate: Number(cached[0].rate_to_azn), date, source: "cbar" } };

    const url = cbarUrl(date);
    if (!url) return { success: false, error: "imports.errors.invalidRateRequest" };
    let xml: string;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
      if (!response.ok) return { success: false, error: "imports.errors.cbarDown" };
      xml = await response.text();
    } catch {
      return { success: false, error: "imports.errors.cbarDown" };
    }
    const bulletin = parseCbarXml(xml);
    const rate = bulletin?.rates[currency];
    if (!bulletin || !rate) return { success: false, error: "imports.errors.cbarNoRate" };

    const toStore = IMPORT_CURRENCIES.filter((c) => c !== "AZN" && bulletin.rates[c]).map((c) => ({
      currency_code: c,
      rate_date: bulletin.date,
      rate_to_azn: bulletin.rates[c],
      source: "cbar",
    }));
    // Cache under the bulletin's date; a request for a later day without a bulletin asks again.
    if (toStore.length) await client.from("exchange_rates").upsert(toStore, { onConflict: "currency_code,rate_date,source" });
    return { success: true, data: { currency, rate, date: bulletin.date, source: "cbar" } };
  } catch (err) {
    return fail(err, "imports.errors.cbarDown");
  }
}
