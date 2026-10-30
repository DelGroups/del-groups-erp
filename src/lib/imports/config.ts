/**
 * Settings of the Imports module (IMP-1), stored in system_settings under IMPORTS_CONFIG_KEY:
 * the customs VAT rate, the chargeable-weight factor, which costs make up the customs value, and
 * per cost type its name, default split method, whether it is capitalized, default VAT rate and
 * default partner. The user can change the method on every cost line.
 */
import {
  COST_TYPES,
  DEFAULT_LANDED_COST_SETTINGS,
  SPLIT_METHODS,
  type CostType,
  type LandedCostSettings,
  type SplitMethod,
} from "./landedCost";

export const IMPORTS_CONFIG_KEY = "imports_config";

export interface ImportCostTypeConfig {
  /** Shown instead of the built-in label when set. */
  name: string | null;
  defaultMethod: SplitMethod;
  defaultCapitalized: boolean;
  /** VAT in % of the cost (local freight 18). */
  defaultVatRatePct: number;
  /** Supplier id offered first on a new cost line. */
  defaultPartnerId: string | null;
}

export interface ImportsConfig extends LandedCostSettings {
  costTypes: Record<CostType, ImportCostTypeConfig>;
}

const type = (defaultMethod: SplitMethod, defaultCapitalized = true, defaultVatRatePct = 0): ImportCostTypeConfig => ({
  name: null,
  defaultMethod,
  defaultCapitalized,
  defaultVatRatePct,
  defaultPartnerId: null,
});

export const DEFAULT_IMPORTS_CONFIG: ImportsConfig = {
  ...DEFAULT_LANDED_COST_SETTINGS,
  costTypes: {
    freight_international: type("by_weight"),
    insurance: type("by_value"),
    customs_duty: type("per_line_duty"),
    customs_fee: type("by_value"),
    // The import VAT paid at customs: recoverable (account 1410), never part of the cost.
    customs_vat: type("by_value", false),
    broker: type("by_value", true, 18),
    freight_local: type("by_weight", true, 18),
    labour: type("by_quantity"),
    storage: type("by_volume", true, 18),
    other: type("by_value"),
  },
};

/** Methods each cost type may use (per_line_duty only for customs duty). */
export function methodsFor(costType: CostType): SplitMethod[] {
  return SPLIT_METHODS.filter((m) => m !== "per_line_duty" || costType === "customs_duty");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Reads a stored config, keeping defaults for anything missing or invalid. */
export function parseImportsConfig(value: unknown): ImportsConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawTypes = raw.costTypes && typeof raw.costTypes === "object" ? (raw.costTypes as Record<string, unknown>) : {};
  const costTypes = {} as Record<CostType, ImportCostTypeConfig>;
  for (const key of COST_TYPES) {
    const base = DEFAULT_IMPORTS_CONFIG.costTypes[key];
    const t = rawTypes[key] && typeof rawTypes[key] === "object" ? (rawTypes[key] as Record<string, unknown>) : {};
    const method = typeof t.defaultMethod === "string" && methodsFor(key).includes(t.defaultMethod as SplitMethod) ? (t.defaultMethod as SplitMethod) : base.defaultMethod;
    const name = typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 80) : null;
    costTypes[key] = {
      name,
      defaultMethod: method,
      defaultCapitalized: key === "customs_vat" ? false : typeof t.defaultCapitalized === "boolean" ? t.defaultCapitalized : base.defaultCapitalized,
      defaultVatRatePct: num(t.defaultVatRatePct, base.defaultVatRatePct, 0, 100),
      defaultPartnerId: typeof t.defaultPartnerId === "string" && UUID.test(t.defaultPartnerId) ? t.defaultPartnerId : null,
    };
  }
  const included = Array.isArray(raw.customsValueCostTypes)
    ? raw.customsValueCostTypes.filter((x): x is CostType => typeof x === "string" && (COST_TYPES as readonly string[]).includes(x) && x !== "customs_vat" && x !== "customs_duty")
    : DEFAULT_IMPORTS_CONFIG.customsValueCostTypes;
  return {
    customsVatRatePct: num(raw.customsVatRatePct, DEFAULT_IMPORTS_CONFIG.customsVatRatePct, 0, 100),
    chargeableFactor: num(raw.chargeableFactor, DEFAULT_IMPORTS_CONFIG.chargeableFactor, 1, 10000),
    customsValueCostTypes: [...new Set(included)],
    costTypes,
  };
}
