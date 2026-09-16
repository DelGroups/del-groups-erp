import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import { submitStockTransfer, type SubmitStockTransferPayload } from "@/lib/inventory/stockTransfer";

export const runtime = "nodejs";

export function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const auth = await requirePermissionApi("can_manage_warehouses");
  if (auth.error) return auth.error;

  let body: SubmitStockTransferPayload;
  try {
    body = (await request.json()) as SubmitStockTransferPayload;
  } catch {
    return NextResponse.json({ success: false, error: "Sorğu formatı yanlışdır" }, { status: 400 });
  }

  const result = await submitStockTransfer({
    ...body,
    created_by: auth.user?.id ?? null,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    transferId: result.transferId,
    print: result.print,
  });
}
