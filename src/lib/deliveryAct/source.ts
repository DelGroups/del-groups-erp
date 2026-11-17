import type { ActInput } from "./act";

/** The rows loadDeliveryActAction reads, before they become the act's input. */
export interface ActSource {
  sale: { doc_no: string | null; invoice_number: string | null; doc_date: string | null; is_official: boolean | null; contract_id: string | null; customer_id: string | null; customer_name: string | null };
  lines: Array<{ product_id: string | null; product_name: string | null; barcode: string | null; unit: string | null; unit_name: string | null; quantity: number | string | null }>;
  productBarcodes: Array<{ id: string; barcode: string | null }>;
  customer: { full_name: string | null; company_name: string | null; entity_type: string | null; director_name?: string | null } | null;
  contract: { contract_number: string | null; contract_date: string | null } | null;
  company: { legalName: string; directorName: string } | null;
}

/** Rows → the act's input (pure, tested): the document number, barcodes from the product card when the line has none. */
export function mapActSource(src: ActSource): Omit<ActInput, "actDate"> {
  const productBarcode = new Map(src.productBarcodes.map((p) => [p.id, p.barcode]));
  return {
    sale: {
      doc_no: src.sale.doc_no || src.sale.invoice_number || null,
      doc_date: src.sale.doc_date,
      is_official: src.sale.is_official === true,
      customer_name: src.sale.customer_name,
    },
    customer: src.customer ? { full_name: src.customer.full_name, company_name: src.customer.company_name, entity_type: src.customer.entity_type, director_name: src.customer.director_name ?? null } : null,
    contract: src.sale.contract_id ? src.contract : null,
    company: src.company ?? { legalName: "", directorName: "" },
    lines: src.lines.map((l) => ({
      barcode: l.barcode || (l.product_id ? productBarcode.get(l.product_id) ?? null : null),
      name: l.product_name ?? "",
      unit: l.unit || l.unit_name || null,
      quantity: Number(l.quantity) || 0,
    })),
  };
}
