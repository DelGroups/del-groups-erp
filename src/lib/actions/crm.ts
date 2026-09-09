"use server";

import { createSupabaseServerClient, getServerAuthContext } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { userHasPermission } from "@/lib/auth/routePermissions";
import { clampString, isValidUuid } from "@/lib/auth/validate";
import { createProductionOrderAction } from "@/lib/actions/production";
import {
  calcQuotationLine,
  calcQuotationTotals,
  DEAL_STAGES,
  QUOTATION_STATUSES,
  type DealStage,
  type QuotationItem,
  type QuotationStatus,
} from "@/types/database.types";

type ActionResult<T = void> = { success: boolean; error?: string; data?: T };

function normalizeItems(raw: unknown): QuotationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const row = (entry || {}) as Record<string, unknown>;
      const quantity = Number(row.quantity) || 0;
      const costPrice = Number(row.cost_price) || 0;
      const marginPercent = Number(row.margin_percent) || 0;
      const priced = calcQuotationLine(quantity, costPrice, marginPercent);
      return {
        product_id: typeof row.product_id === "string" && isValidUuid(row.product_id) ? row.product_id : null,
        product_code: clampString(String(row.product_code || ""), 40),
        product_name: clampString(String(row.product_name || ""), 200),
        unit: clampString(String(row.unit || "Ədəd"), 20) || "Ədəd",
        quantity,
        cost_price: costPrice,
        margin_percent: marginPercent,
        unit_price: priced.unitPrice,
        line_total: priced.lineTotal,
      };
    })
    .filter((item) => item.product_name && item.quantity > 0);
}

function asDealStage(value: string): DealStage | null {
  return (DEAL_STAGES as readonly string[]).includes(value) ? (value as DealStage) : null;
}

function asQuoteStatus(value: string): QuotationStatus | null {
  return (QUOTATION_STATUSES as readonly string[]).includes(value)
    ? (value as QuotationStatus)
    : null;
}

async function syncDealFromQuotation(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  dealId: string,
  status: QuotationStatus,
  total: number
) {
  const patch: Record<string, unknown> = {
    expected_value: total,
    updated_at: new Date().toISOString(),
  };
  if (status === "WON" || status === "ACCEPTED") patch.stage = "WON";
  else if (status === "SENT") patch.stage = "PROPOSAL";
  await client.from("deals").update(patch).eq("id", dealId);
}

export async function createDealAction(payload: {
  title: string;
  clientId?: string | null;
  expectedValue?: number;
  notes?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { user } = await requirePermissionAction("can_manage_crm");
    const title = clampString(payload.title || "", 240);
    if (!title) return { success: false, error: "Sövdələşmə adı tələb olunur" };

    const clientId = payload.clientId?.trim() || null;
    if (clientId && !isValidUuid(clientId)) {
      return { success: false, error: "Etibarlı müştəri seçin" };
    }

    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("deals")
      .insert([
        {
          title,
          client_id: clientId,
          expected_value: Math.max(0, Number(payload.expectedValue) || 0),
          notes: clampString(payload.notes || "", 2000) || null,
          assigned_to: user.id,
          stage: "LEAD",
        },
      ])
      .select("id")
      .single();

    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true, data: { id: data.id as string } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Sövdələşmə yaradılmadı" };
  }
}

export async function updateDealStageAction(
  dealId: string,
  stage: DealStage
): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_crm");
    if (!isValidUuid(dealId)) return { success: false, error: "Etibarlı sövdələşmə seçin" };
    const nextStage = asDealStage(stage);
    if (!nextStage) return { success: false, error: "Etibarsız mərhələ" };

    const client = await createSupabaseServerClient();
    const { error } = await client
      .from("deals")
      .update({ stage: nextStage, updated_at: new Date().toISOString() })
      .eq("id", dealId);

    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Mərhələ yenilənmədi" };
  }
}

export async function saveQuotationAction(payload: {
  dealId: string;
  quotationId?: string | null;
  items: QuotationItem[];
  discount?: number;
  taxRate?: number;
  validUntil?: string | null;
  notes?: string;
  status?: QuotationStatus;
}): Promise<ActionResult<{ id: string; quoteNumber: string }>> {
  try {
    const { user } = await requirePermissionAction("can_manage_crm");
    if (!isValidUuid(payload.dealId)) return { success: false, error: "Etibarlı sövdələşmə seçin" };

    const items = normalizeItems(payload.items);
    if (!items.length) return { success: false, error: "Ən azı bir sətir əlavə edin" };

    const totals = calcQuotationTotals(items, Number(payload.discount) || 0, Number(payload.taxRate) || 0);
    const status = asQuoteStatus(payload.status || "DRAFT") || "DRAFT";
    const client = await createSupabaseServerClient();

    if (payload.quotationId) {
      if (!isValidUuid(payload.quotationId)) {
        return { success: false, error: "Etibarlı təklif seçin" };
      }
      const { data, error } = await client
        .from("quotations")
        .update({
          items_json: items,
          discount: totals.discount,
          tax: totals.tax,
          total_amount: totals.total,
          valid_until: payload.validUntil || null,
          notes: clampString(payload.notes || "", 2000) || null,
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.quotationId)
        .select("id, quote_number")
        .single();

      if (error) return { success: false, error: mapRpcError(error.message) };
      await syncDealFromQuotation(client, payload.dealId, status, totals.total);
      return {
        success: true,
        data: { id: data.id as string, quoteNumber: data.quote_number as string },
      };
    }

    const { data: numberRow, error: numberError } = await client.rpc("next_quotation_number");
    const quoteNumber =
      !numberError && typeof numberRow === "string" && numberRow
        ? numberRow
        : `TKL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const { data, error } = await client
      .from("quotations")
      .insert([
        {
          deal_id: payload.dealId,
          quote_number: quoteNumber,
          items_json: items,
          discount: totals.discount,
          tax: totals.tax,
          total_amount: totals.total,
          valid_until: payload.validUntil || null,
          notes: clampString(payload.notes || "", 2000) || null,
          status,
          created_by: user.id,
        },
      ])
      .select("id, quote_number")
      .single();

    if (error) return { success: false, error: mapRpcError(error.message) };

    await syncDealFromQuotation(client, payload.dealId, status, totals.total);

    return {
      success: true,
      data: { id: data.id as string, quoteNumber: data.quote_number as string },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Təklif saxlanılmadı" };
  }
}

export async function convertQuotationToProductionAction(
  quotationId: string
): Promise<ActionResult<{ orderId: string; orderNo?: string }>> {
  try {
    await requirePermissionAction("can_manage_crm");
    const { profile } = await getServerAuthContext();
    if (!userHasPermission(profile, "can_manage_production")) {
      return { success: false, error: "İstehsalata göndərmək üçün istehsalat icazəsi lazımdır" };
    }
    if (!isValidUuid(quotationId)) return { success: false, error: "Etibarlı təklif seçin" };

    const client = await createSupabaseServerClient();
    const { data: quote, error: quoteError } = await client
      .from("quotations")
      .select("*, deals(id, title, client_id, production_order_id, customers(full_name, company_name))")
      .eq("id", quotationId)
      .maybeSingle();

    if (quoteError) return { success: false, error: mapRpcError(quoteError.message) };
    if (!quote) return { success: false, error: "Təklif tapılmadı" };
    if (quote.production_order_id) {
      return { success: false, error: "Bu təklif artıq istehsalata göndərilib" };
    }

    const status = String(quote.status || "");
    if (!["WON", "ACCEPTED"].includes(status)) {
      return { success: false, error: "Yalnız qazanılmış təkliflər istehsalata göndərilə bilər" };
    }

    const deal = (quote.deals || {}) as Record<string, unknown>;
    const customer = (deal.customers || {}) as Record<string, unknown>;
    const items = normalizeItems(quote.items_json);
    const materials = items
      .filter((item) => item.product_id)
      .map((item) => ({
        product_id: item.product_id as string,
        quantity: item.quantity,
        unit_cost: item.cost_price,
      }));

    const customerName =
      (customer.full_name as string) ||
      (customer.company_name as string) ||
      "";

    const created = await createProductionOrderAction({
      type: "Custom",
      custom_workflow: "in_house",
      production_model: "in_house_custom",
      project_name: clampString(String(deal.title || quote.quote_number || "CRM layihəsi"), 200),
      customer_id: typeof deal.client_id === "string" ? deal.client_id : null,
      customer_name: customerName || null,
      total_project_price: Number(quote.total_amount) || 0,
      notes: `CRM təklifi: ${quote.quote_number}`,
      project_scope: items.map((item) => `${item.product_name} × ${item.quantity}`).join("; "),
      materials,
    });

    if (!created.success || !created.data) {
      return { success: false, error: created.error || "İstehsalat sənədi yaradılmadı" };
    }

    const orderId = created.data.id;
    const now = new Date().toISOString();
    await client
      .from("quotations")
      .update({ status: "CONVERTED", production_order_id: orderId, updated_at: now })
      .eq("id", quotationId);
    await client
      .from("deals")
      .update({
        stage: "WON",
        production_order_id: orderId,
        expected_value: Number(quote.total_amount) || 0,
        updated_at: now,
      })
      .eq("id", quote.deal_id);

    return { success: true, data: { orderId, orderNo: created.data.order_no } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return {
      success: false,
      error: err instanceof Error ? err.message : "İstehsalata göndərilmədi",
    };
  }
}
