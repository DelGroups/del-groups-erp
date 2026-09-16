import { buildProductInsert } from "@/lib/products/api";
import { roundMoney } from "@/lib/polywood/metricPriceConversion";
import type { ProductInsert } from "@/types/database.types";

export interface BulkImportOffcutSpec {
  lengthM: number;
  widthM: number;
}

export function offcutAreaSqM(lengthM: number, widthM: number): number {
  if (lengthM <= 0 || widthM <= 0) return 0;
  return roundMoney(lengthM * widthM);
}

export function calculateOffcutPiecePrice(areaSqM: number, pricePerSqM: number): number {
  if (areaSqM <= 0 || pricePerSqM <= 0) return 0;
  return roundMoney(areaSqM * pricePerSqM);
}

export function formatOffcutChildName(parentName: string, lengthM: number, widthM: number): string {
  const length = roundMoney(lengthM);
  const width = roundMoney(widthM);
  return `${parentName} (Kəsilmiş Hissə: ${length} x ${width})`;
}

export function buildOffcutChildCode(parentCode: string, cutIndex: number): string {
  return `${parentCode}-CUT${cutIndex}`;
}

export function parseCutIndexFromCode(code: string): number | null {
  const match = code.match(/-CUT(\d+)$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function nextOffcutIndex(existingCodes: string[]): number {
  let max = 0;
  for (const code of existingCodes) {
    const index = parseCutIndexFromCode(code);
    if (index) max = Math.max(max, index);
  }
  return max + 1;
}

export function buildOffcutChildProductInsert(params: {
  parent: ProductInsert & { id?: string };
  parentId: string;
  cutIndex: number;
  offcut: BulkImportOffcutSpec;
  barcode: string;
}): ProductInsert {
  const { parent, parentId, cutIndex, offcut, barcode } = params;
  const areaSqM = offcutAreaSqM(offcut.lengthM, offcut.widthM);
  const sellPerSqM = Number(parent.sell_price_cut) || Number(parent.sell_price) || 0;
  const buyPerSqM = Number(parent.buy_price_cut) || Number(parent.buy_price) || 0;

  const childSell = calculateOffcutPiecePrice(areaSqM, sellPerSqM);
  const childBuy = calculateOffcutPiecePrice(areaSqM, buyPerSqM);

  return buildProductInsert({
    code: buildOffcutChildCode(parent.code, cutIndex),
    name: formatOffcutChildName(parent.name, offcut.lengthM, offcut.widthM),
    category: parent.category,
    subcategory: parent.subcategory,
    unit: "Ədəd",
    buy_price: childBuy,
    buy_price_cut: 0,
    sell_price: childSell,
    sell_price_cut: 0,
    stock: 1,
    min_stock: 0,
    brand: parent.brand,
    barcode,
    parent_id: parentId,
    is_dimensional: true,
    base_length: offcut.lengthM,
    base_width: offcut.widthM,
    extra_info: parent.extra_info,
  });
}
