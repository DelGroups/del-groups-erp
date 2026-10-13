import { NextResponse } from "next/server";
import { requireBillingAdmin } from "@/lib/billing/apiAuth";
import { fetchInvoicePdf } from "@/lib/billing/server";

export const dynamic = "force-dynamic";

/** One of the tenant's invoices as PDF (stored by the control panel when it was issued). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBillingAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const pdf = await fetchInvoicePdf(id);
    if (!pdf) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return new Response(pdf.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[billing] invoice PDF failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "control_plane_unavailable" }, { status: 503 });
  }
}
