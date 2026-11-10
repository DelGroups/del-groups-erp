/**
 * INVOICE_TOOLS (INV-1 and later): extra tools in the sales and purchase invoice forms, starting
 * with the "New product" button. Server-only switch, off unless the env value is "true". The root
 * layout passes it to client screens through InvoiceToolsProvider; while off both forms look and
 * behave exactly as before.
 */
export function isInvoiceToolsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.INVOICE_TOOLS ?? "").trim().toLowerCase() === "true";
}
