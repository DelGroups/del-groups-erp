import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { submitStockTransfer, transferPath, type SubmitStockTransferPayload } from "@/modules/inventory";
import { requireModuleApi } from "@/lib/modules/server";
import { isLotTrackingEnabled } from "@/lib/features/lotTracking";

export const runtime = "nodejs";

export function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const auth = await requirePermissionApi("can_manage_warehouses");
  if (auth.error) return auth.error;
  const notInPlan = await requireModuleApi("inventory");
  if (notInPlan) return notInPlan;

  let body: SubmitStockTransferPayload;
  try {
    body = (await request.json()) as SubmitStockTransferPayload;
  } catch {
    return NextResponse.json({ success: false, error: "Sorğu formatı yanlışdır" }, { status: 400 });
  }

  // LOT-3: with LOT_TRACKING on, one database transaction (post_stock_transfer) with the chosen
  // lots; off, the old path, and the lines' "lots" key is ignored.
  const result = await submitStockTransfer(
    {
      ...body,
      created_by: auth.user?.id ?? null,
    },
    { atomic: transferPath(isLotTrackingEnabled()) === "rpc" }
  );

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    transferId: result.transferId,
    print: result.print,
  });
}
