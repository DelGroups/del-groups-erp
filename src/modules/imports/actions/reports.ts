"use server";

import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { canViewFinancials } from "@/lib/auth/permissionMatrix";
import { isNewImportsEnabled } from "@/lib/features/newImports";
import { IMPORTS_CONFIG_KEY, parseImportsConfig } from "@/lib/imports/config";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  payablesReport,
  productsReport,
  shipmentsReport,
  transitReport,
  vatReport,
  type PayableReportRow,
  type ProductReportRow,
  type ShipmentReportRow,
  type TransitReportRow,
  type VatReportRow,
} from "../lib/reports";

/**
 * Imports reports (IMP-3): every report's rows in one read. imports.view and financial figures
 * (every figure is money), NEW_IMPORTS on. Shaped by the pure functions in ../lib/reports.
 */

export interface ImportReports {
  shipments: ShipmentReportRow[];
  products: ProductReportRow[];
  vat: VatReportRow[];
  payables: PayableReportRow[];
  transit: TransitReportRow[];
}

type Row = Record<string, unknown>;
type Query = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  select: (columns?: string) => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, values: readonly unknown[]) => Query;
  like: (column: string, pattern: string) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  limit: (n: number) => Query;
  maybeSingle: () => Query;
};
type Client = { from: (table: string) => Query };

async function rows(q: Query): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Row[] | null) ?? [];
}

const IN_CHUNK = 200;
/** `in (...)` in chunks, so a long id list never makes the request URL too long. */
async function rowsIn(client: Client, table: string, columns: string, column: string, ids: readonly unknown[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out.push(...(await rows(client.from(table).select(columns).in(column, ids.slice(i, i + IN_CHUNK)))));
  }
  return out;
}

export async function importReportsAction(asOf: string | null): Promise<{ success: true; data: ImportReports } | { success: false; error: string }> {
  try {
    if (!isNewImportsEnabled()) throw new ActionAuthError("imports.errors.disabled");
    const ctx = await requirePermissionAction("can_view_imports", { module: "imports" });
    if (!canViewFinancials(ctx.profile)) throw new ActionAuthError("imports.errors.financialsRequired");
    const day = typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);
    const client = (await createSupabaseAdminClient()) as unknown as Client;

    const [shipments, payables, settings, entries] = await Promise.all([
      rows(client.from("import_shipments").select("*").order("created_at", { ascending: false }).limit(5000)),
      rows(client.from("import_payables").select("*")),
      client.from("system_settings").select("value").eq("key", IMPORTS_CONFIG_KEY).maybeSingle(),
      rows(client.from("journal_entries").select("id, document_id, entry_date").like("document_type", "import_%")),
    ]);
    const ids = shipments.map((s) => s.id);
    const [lines, costs] = await Promise.all([
      rowsIn(client, "import_shipment_lines", "*", "shipment_id", ids),
      rowsIn(client, "import_cost_lines", "*", "shipment_id", ids),
    ]);
    const [allocations, products, suppliers, coa] = await Promise.all([
      rowsIn(client, "import_cost_allocations", "*", "cost_line_id", costs.map((c) => c.id)),
      rowsIn(client, "products", "id, code, name, unit", "id", [...new Set(lines.map((l) => l.product_id))]),
      rowsIn(client, "suppliers", "id, full_name, company_name", "id", [...new Set([...shipments.map((s) => s.supplier_id), ...payables.map((p) => p.partner_id)].filter(Boolean))]),
      rows(client.from("chart_of_accounts").select("id").eq("code", "1360")),
    ]);
    const entryById = new Map(entries.map((e) => [String(e.id), e]));
    const transitLines = coa.length
      ? await rowsIn(client, "journal_entry_lines", "journal_entry_id, debit, credit, coa_id", "journal_entry_id", entries.map((e) => e.id))
      : [];
    const coaId = coa[0]?.id;
    const transit = transitLines
      .filter((l) => l.coa_id === coaId)
      .map((l) => {
        const e = entryById.get(String(l.journal_entry_id));
        return { shipment_id: e?.document_id, entry_date: e?.entry_date, debit: l.debit, credit: l.credit };
      });

    const config = parseImportsConfig((settings.data as { value?: unknown } | null)?.value);
    const src = { shipments, lines, costs, allocations, payables, products, suppliers, transit, customsValueCostTypes: config.customsValueCostTypes };
    return {
      success: true,
      data: {
        shipments: shipmentsReport(src),
        products: productsReport(src),
        vat: vatReport(src),
        payables: payablesReport(src, new Date()),
        transit: transitReport(src, day),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message.startsWith("imports.") ? err.message : "imports.errors.forbidden" };
    console.error("[imports reports]", err);
    return { success: false, error: "imports.errors.failed" };
  }
}
