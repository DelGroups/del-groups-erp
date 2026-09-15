import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { loadBarcodeLookupApiConfigForServer } from "@/lib/barcode/loadLookupApiConfig";
import { lookupBarcodeWithConfig } from "@/lib/barcode/lookupBarcodeService";

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
