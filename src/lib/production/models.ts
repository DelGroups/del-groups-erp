import type { CustomWorkflow, ProductionOrderType } from "@/lib/production/types";

export const PRODUCTION_MODELS = [
  "series",
  "in_house_custom",
  "subcontractor_custom",
] as const;

export type ProductionModel = (typeof PRODUCTION_MODELS)[number];

export const PRODUCTION_MODEL_DEFAULT: ProductionModel = "in_house_custom";

export const PRODUCTION_MODEL_LABELS: Record<ProductionModel, string> = {
  series: "Seri İstehsal",
  in_house_custom: "Daxili Xüsusi Sifariş",
  subcontractor_custom: "Podratçı Sifarişi",
};

export function isProductionModel(value: unknown): value is ProductionModel {
  return typeof value === "string" && (PRODUCTION_MODELS as readonly string[]).includes(value);
}

export function normalizeProductionModel(value: unknown): ProductionModel {
  if (isProductionModel(value)) return value;
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "series" || raw === "seri" || raw === "seriya") return "series";
  if (raw === "in_house_custom" || raw === "in-house" || raw === "in_house") {
    return "in_house_custom";
  }
  if (raw === "subcontractor_custom" || raw === "subcontractor" || raw === "podratci") {
    return "subcontractor_custom";
  }
  return PRODUCTION_MODEL_DEFAULT;
}

export function productionModelFromLegacy(
  type: ProductionOrderType,
  workflow: CustomWorkflow | null | undefined
): ProductionModel {
  if (type === "Series") return "series";
  if (workflow === "subcontractor") return "subcontractor_custom";
  return "in_house_custom";
}

export function legacyFromProductionModel(model: ProductionModel): {
  type: ProductionOrderType;
  custom_workflow: CustomWorkflow | null;
} {
  switch (model) {
    case "series":
      return { type: "Series", custom_workflow: null };
    case "subcontractor_custom":
      return { type: "Custom", custom_workflow: "subcontractor" };
    default:
      return { type: "Custom", custom_workflow: "in_house" };
  }
}

export function productionModelLabel(model: ProductionModel): string {
  return PRODUCTION_MODEL_LABELS[model];
}
