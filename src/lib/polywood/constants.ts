export const POLYWOOD_WAREHOUSE_TYPE = "polywood" as const;
export const GENERAL_WAREHOUSE_TYPE = "general" as const;

export const POLYWOOD_INVENTORY_MODE = "polywood" as const;
export const STANDARD_INVENTORY_MODE = "standard" as const;

export const DEFAULT_FULL_SHEET_LENGTH_M = 4;

export const POLYWOOD_SALE_MODES = ["linear_m", "full_sheet"] as const;
export type PolywoodSaleMode = (typeof POLYWOOD_SALE_MODES)[number];

export const POLYWOOD_PIECE_TYPES = ["full", "cut"] as const;
export type PolywoodPieceType = (typeof POLYWOOD_PIECE_TYPES)[number];

export const POLYWOOD_PIECE_STATUSES = ["available", "sold", "consumed"] as const;
export type PolywoodPieceStatus = (typeof POLYWOOD_PIECE_STATUSES)[number];

export const LENGTH_EPSILON = 0.001;

export function isFullSheetLength(lengthM: number, fullSheetLengthM: number): boolean {
  return Math.abs(lengthM - fullSheetLengthM) < LENGTH_EPSILON;
}
