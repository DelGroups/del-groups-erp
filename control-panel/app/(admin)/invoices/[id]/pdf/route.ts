import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { supabaseBillingStore } from "@/lib/billing/billingStore";
import { renderInvoicePdf } from "@/lib/billing/pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An invoice as PDF for platform admins, rendered from the invoice as issued. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  let doc;
  try {
    doc = await supabaseBillingStore(supabase).invoiceDocument(id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const pdf = await renderInvoicePdf(doc);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
