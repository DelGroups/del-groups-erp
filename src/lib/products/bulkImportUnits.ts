import { parseCustomPieceLengths } from "@/lib/polywood/metricReceive";

export type BulkImportStockMode = "piece" | "meter";

const PIECE_UNIT_ALIASES = new Set([
  "ədəd",
  "eded",
  "ad",
  "pcs",
  "pc",
  "piece",
  "şit",
  "şət",
  "sit",
  "set",
  "sheet",
  "vərəq",
  "vereq",
]);

const METER_UNIT_ALIASES = new Set(["metr", "m", "meter", "metre"]);

export function resolveBulkImportStockMode(
  unitRaw: string,
  fallbackDimensional: boolean
): BulkImportStockMode {
  const key = unitRaw.trim().toLowerCase();
  if (!key) return fallbackDimensional ? "meter" : "piece";
  if (METER_UNIT_ALIASES.has(key) || key.includes("metr")) return "meter";
  if (PIECE_UNIT_ALIASES.has(key)) return "piece";
  if (key.includes("kvadrat")) return "meter";
  return fallbackDimensional ? "meter" : "piece";
}

export function normalizeBulkImportMeasureUnit(
  unitRaw: string,
  mode: BulkImportStockMode
): string {
  const trimmed = unitRaw.trim();
  if (trimmed) return trimmed;
  return mode === "meter" ? "Metr" : "Ədəd";
}

export function parseMetrajPieces(raw: string): number[] {
  return parseCustomPieceLengths(raw);
}

export function formatMetrajPiecesPreview(pieces: number[], raw: string): string {
  if (raw.trim()) return raw.trim();
  if (pieces.length === 0) return "—";
  return pieces.map((length) => `${length}m`).join(", ");
}
