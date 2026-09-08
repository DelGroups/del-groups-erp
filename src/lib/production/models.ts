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

export const PRODUCTION_CREATION_TYPES = [
  {
    value: "bom_series",
    model: "series" as ProductionModel,
    label: "Seriya İstehsalı (BOM / Resept ilə)",
  },
  {
    value: "internal_custom",
    model: "in_house_custom" as ProductionModel,
    label: "Daxili Fərdi İstehsalat (Usta və Personal)",
  },
  {
    value: "contractor_outsource",
    model: "subcontractor_custom" as ProductionModel,
    label: "Xarici Podratçı / Outsource",
  },
] as const;

export type ProductionCreationType = (typeof PRODUCTION_CREATION_TYPES)[number]["value"];

export function productionCreationTypeToModel(type: ProductionCreationType): ProductionModel {
  return PRODUCTION_CREATION_TYPES.find((row) => row.value === type)?.model ?? PRODUCTION_MODEL_DEFAULT;
}

export function productionModelToCreationType(model: ProductionModel): ProductionCreationType {
  switch (model) {
    case "series":
      return "bom_series";
    case "subcontractor_custom":
      return "contractor_outsource";
    default:
      return "internal_custom";
  }
}

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
  if (raw === "bom_series" || raw === "internal_custom" || raw === "contractor_outsource") {
    return productionCreationTypeToModel(raw as ProductionCreationType);
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
