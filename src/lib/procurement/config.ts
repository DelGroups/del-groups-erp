export const PROCUREMENT_CONFIG_KEY = "procurement_config";

export interface ProcurementConfig {
  auto_create_purchase_request: boolean;
  default_lead_time_days: number;
  critical_stock_notification: boolean;
  price_weight: number;
  quality_weight: number;
  delivery_speed_weight: number;
}

export const DEFAULT_PROCUREMENT_CONFIG: ProcurementConfig = {
  auto_create_purchase_request: true,
  default_lead_time_days: 7,
  critical_stock_notification: true,
  price_weight: 40,
  quality_weight: 30,
  delivery_speed_weight: 30,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number, decimals = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

export function parseProcurementConfig(raw: unknown): ProcurementConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    auto_create_purchase_request: asBoolean(
      source.auto_create_purchase_request,
      DEFAULT_PROCUREMENT_CONFIG.auto_create_purchase_request
    ),
    default_lead_time_days: asNumber(source.default_lead_time_days, 7, 0, 365),
    critical_stock_notification: asBoolean(
      source.critical_stock_notification,
      DEFAULT_PROCUREMENT_CONFIG.critical_stock_notification
    ),
    price_weight: asNumber(source.price_weight, 40, 0, 100),
    quality_weight: asNumber(source.quality_weight, 30, 0, 100),
    delivery_speed_weight: asNumber(source.delivery_speed_weight, 30, 0, 100),
  };
}

export function procurementWeightTotal(config: ProcurementConfig): number {
  return config.price_weight + config.quality_weight + config.delivery_speed_weight;
}
