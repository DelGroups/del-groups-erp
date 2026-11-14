import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { loadBarcodeLookupApiConfigForServer } from "@/lib/barcode/loadLookupApiConfig";
import { lookupBarcodeWithConfig } from "@/lib/barcode/lookupBarcodeService";
import { requireModuleApi } from "@/lib/modules/server";
import { exactLotMatch, findLotsAction, lotCardHref } from "@/modules/inventory";

export const runtime = "nodejs";

export function OPTIONS() {
  return handleOptions();
}

export async function GET(request: NextRequest) {
  const auth = await requirePermissionApi("can_manage_products");
  if (auth.error) return auth.error;

  const barcode = request.nextUrl.searchParams.get("barcode")?.trim() ?? "";
  if (!barcode) {
    return NextResponse.json({ found: false, error: "Barkod parametri tələb olunur" }, { status: 400 });
  }

  // LOT-4: a scanned lot label (lot no or supplier batch no) opens the lot card. Only while
  // LOT_TRACKING is on for this user and they may view lots (findLotsAction returns [] otherwise).
  const lot = exactLotMatch(barcode, await findLotsAction(barcode));
  if (lot) {
    return NextResponse.json({ found: true, kind: "lot", lot: { id: lot.id, lot_no: lot.lot_no, product_name: lot.product_name }, href: lotCardHref(lot.id) });
  }

  const notInPlan = await requireModuleApi("barcode");
  if (notInPlan) return notInPlan;

  const config = await loadBarcodeLookupApiConfigForServer();
  const result = await lookupBarcodeWithConfig(barcode, config);

  if (!result.found) {
    return NextResponse.json({
      found: false,
      error: result.error ?? "Məhsul tapılmadı",
      source: result.source,
    });
  }

  return NextResponse.json({
    found: true,
    data: result.data,
    source: result.source,
  });
}
