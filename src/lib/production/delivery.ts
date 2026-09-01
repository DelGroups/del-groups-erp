import { normalizeProductionType, type ProductionOrder } from "@/lib/production/types";
import { formatRpcError } from "@/lib/forms/rpcErrors";

/** Untyped admin client — production RPC may not be in generated Database types yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { rpc: (fn: string, args: Record<string, unknown>) => any };

export type ProductionDeliveryResult =
  | {
      ok: true;
      saleId: string | null;
      docNo: string;
      productId: string;
      orderType: "Custom" | "Series";
      alreadyCompleted: boolean;
      invoiceCreated: boolean;
      eventId?: string;
    }
  | { ok: false; error: string };

type DeliveryRpcPayload = {
  success?: boolean;
  error?: string;
  order_type?: string;
  sale_id?: string;
  doc_no?: string;
  product_id?: string;
  already_completed?: boolean;
  invoice_created?: boolean;
  event_id?: string;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rpcErrorMessage(error: { message?: string | null; details?: string | null; hint?: string | null }): string {
  const parts = [error.message, error.details, error.hint].filter(Boolean);
  return parts.join(" — ") || "Təhvil RPC xətası";
}

function payloadErrorMessage(payload: DeliveryRpcPayload | null): string | null {
  if (!payload || payload.success === false) {
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim();
    if (payload && payload.success === false) return "Təhvil RPC uğursuz oldu";
  }
  return null;
}

function materialsIssuedPreflight(order: ProductionOrder): { ok: true } | { ok: false; error: string } {
  if (!order.materials.length) {
    return { ok: false, error: "Material çıxışı: BOM material sətri tapılmadı" };
  }
  const pending = order.materials.filter((row) => !row.issued);
  if (pending.length) {
    return { ok: false, error: "Bütün material sətirləri verilməlidir" };
  }
  return { ok: true };
}

function assertCustomDeliveryPreflight(
  order: ProductionOrder,
  accountId?: string | null
): { ok: true } | { ok: false; error: string } {
  if (normalizeProductionType(order.type) !== "Custom") {
    return { ok: false, error: "Yalnız fərdi (Custom) sifarişlər üçün təhvil inteqrasiyası aktivdir" };
  }
  if (!order.customer_id) {
    return { ok: false, error: "Təhvil üçün müştəri seçilməlidir" };
  }
  if (num(order.total_project_price) <= 0) {
    return { ok: false, error: "Layihə qiyməti sıfırdan böyük olmalıdır" };
  }
  const materials = materialsIssuedPreflight(order);
  if (!materials.ok) return materials;
  if (num(order.advance_payment) > 0 && !accountId) {
    return { ok: false, error: "Avans ödənişi üçün kassa/bank hesabı seçilməlidir" };
  }
  return { ok: true };
}

function assertSeriesDeliveryPreflight(
  order: ProductionOrder
): { ok: true } | { ok: false; error: string } {
  if (normalizeProductionType(order.type) !== "Series") {
    return { ok: false, error: "Yalnız seriya (Series) sifarişlər üçün təhvil inteqrasiyası aktivdir" };
  }
  if (!order.finished_product_id) {
    return { ok: false, error: "Seriya sifarişi üçün hazır məhsul təyin edilməyib" };
  }
  if (!order.finished_goods_posted) {
    return { ok: false, error: "Hazır məhsul anbara yazılmayıb. Əvvəlcə «Hazır» statusuna keçin." };
  }
  return materialsIssuedPreflight(order);
}

function resolveSeriesSaleAmount(order: ProductionOrder, sellPrice?: number | null): number {
  const qty = Math.max(1, num(order.quantity));
  const projectPrice = num(order.total_project_price);
  if (projectPrice > 0) return projectPrice + num(order.installation_fee);
  const unitSell = num(sellPrice);
  if (unitSell <= 0) return 0;
  return unitSell * qty + num(order.installation_fee);
}

/**
 * Atomic production delivery — Custom MTO and Series via `process_production_delivery_event`.
 */
export async function completeProductionDelivery(
  admin: DbClient,
  orderId: string,
  accountId?: string | null,
  order?: ProductionOrder
): Promise<ProductionDeliveryResult> {
  const orderType = order ? normalizeProductionType(order.type) : null;

  if (order && orderType === "Custom") {
    const preflight = assertCustomDeliveryPreflight(order, accountId);
    if (!preflight.ok) return preflight;
  }

  if (order && orderType === "Series") {
    const preflight = assertSeriesDeliveryPreflight(order);
    if (!preflight.ok) return preflight;

    if (order.customer_id) {
      const amount = resolveSeriesSaleAmount(order);
      if (amount <= 0) {
        return {
          ok: false,
          error: "Satış qiyməti sıfırdan böyük olmalıdır (sifariş qiyməti və ya məhsul satış qiyməti)",
        };
      }
      if (num(order.advance_payment) > 0 && !accountId) {
        return { ok: false, error: "Avans ödənişi üçün kassa/bank hesabı seçilməlidir" };
      }
    }
  }

  const { data, error } = await admin.rpc("process_production_delivery_event", {
    p_order_id: orderId,
    p_account_id: accountId || null,
  });

  if (error) {
    return { ok: false, error: rpcErrorMessage(error) };
  }

  const payload = (data ?? null) as DeliveryRpcPayload | null;
  const payloadError = payloadErrorMessage(payload);
  if (payloadError) {
    return { ok: false, error: payloadError };
  }

  const resolvedType = (payload?.order_type || orderType || "Custom") as "Custom" | "Series";
  const invoiceCreated = Boolean(payload?.invoice_created ?? resolvedType === "Custom");
  const saleId = payload?.sale_id ? String(payload.sale_id) : null;

  if (invoiceCreated && !saleId) {
    return { ok: false, error: "Təhvil RPC cavab vermədi (sale_id yoxdur)" };
  }

  return {
    ok: true,
    saleId,
    docNo: payload?.doc_no ? String(payload.doc_no) : order?.order_no || saleId || orderId,
    productId: payload?.product_id ? String(payload.product_id) : order?.finished_product_id || "",
    orderType: resolvedType,
    alreadyCompleted: Boolean(payload?.already_completed),
    invoiceCreated,
    eventId: payload?.event_id ? String(payload.event_id) : undefined,
  };
}

/** @deprecated Use completeProductionDelivery */
export async function completeSeriesProductionDelivery(
  admin: DbClient,
  orderId: string,
  accountId?: string | null,
  order?: ProductionOrder
): Promise<ProductionDeliveryResult> {
  return completeProductionDelivery(admin, orderId, accountId, order);
}

/** @deprecated Use completeProductionDelivery */
export async function completeCustomProductionDelivery(
  admin: DbClient,
  orderId: string,
  accountId?: string | null,
  order?: ProductionOrder
): Promise<ProductionDeliveryResult> {
  return completeProductionDelivery(admin, orderId, accountId, order);
}

export function validateSeriesDeliveryPreflight(
  order: ProductionOrder,
  sellPrice?: number | null
): { ok: true } | { ok: false; error: string } {
  const base = assertSeriesDeliveryPreflight(order);
  if (!base.ok) return base;

  if (order.customer_id) {
    const amount = resolveSeriesSaleAmount(order, sellPrice);
    if (amount <= 0) {
      return {
        ok: false,
        error: "Müştəriyə satış üçün qiymət təyin edilməyib (məhsul satış qiyməti və ya sifariş qiyməti)",
      };
    }
  }

  return { ok: true };
}

export function validateCustomDeliveryPreflight(
  order: ProductionOrder,
  form: {
    totalProjectPrice: number;
    advancePayment: number;
    advanceAccountId?: string | null;
  }
): { ok: true } | { ok: false; error: string } {
  if (normalizeProductionType(order.type) !== "Custom") {
    return { ok: false, error: "Yalnız fərdi sifarişlər təhvil inteqrasiyasına malikdir" };
  }
  if (!order.customer_id) {
    return { ok: false, error: "Təhvil üçün müştəri seçilməlidir" };
  }
  if (form.totalProjectPrice <= 0) {
    return { ok: false, error: "Layihə qiyməti sıfırdan böyük olmalıdır" };
  }
  const materials = materialsIssuedPreflight(order);
  if (!materials.ok) return materials;
  if (form.advancePayment > 0 && !form.advanceAccountId) {
    return { ok: false, error: "Avans ödənişi üçün kassa/bank hesabı seçilməlidir" };
  }
  return { ok: true };
}

export function formatDeliveryActionError(
  raw: string | null | undefined,
  t?: (key: string, params?: Record<string, string | number>) => string
): string {
  const message = raw?.trim() || "Naməlum xəta";
  const normalized = message.startsWith("Təhvil xətası:")
    ? message.replace(/^Təhvil xətası:\s*/, "")
    : message;
  const friendly = t ? formatRpcError(normalized, t) : normalized;
  return message.startsWith("Təhvil xətası:") ? message : `Təhvil xətası: ${friendly}`;
}
