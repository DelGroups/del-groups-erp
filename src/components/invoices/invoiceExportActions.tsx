import { FileSpreadsheet, FileText } from "lucide-react";
import Button from "@/components/ui/button";
import type { InvoiceExportFormat } from "@/lib/export/invoiceExport";

/**
 * INV-2: the two menu entries, the same in every menu. The keys are the ?do= actions a list row
 * hands to the opened invoice (views/rowActions.ts), placed right after "print".
 */
export const INVOICE_EXPORT_ACTIONS = [
  { key: "export_xlsx", format: "xlsx", labelKey: "invoiceTools.export.downloadExcel", Icon: FileSpreadsheet },
  { key: "export_pdf", format: "pdf", labelKey: "invoiceTools.export.downloadPdf", Icon: FileText },
] as const satisfies readonly { key: string; format: InvoiceExportFormat; labelKey: string; Icon: typeof FileText }[];

/** Row "…" menu entries of the new lists; none while INVOICE_TOOLS is off. Every status gets them. */
export function invoiceExportRowActions(t: (key: string) => string, enabled: boolean) {
  if (!enabled) return [];
  return INVOICE_EXPORT_ACTIONS.map((a) => ({ key: a.key, label: t(a.labelKey), icon: <a.Icon className="h-4 w-4" /> }));
}

/** The opened invoice's actions (FormView), run directly or from a ?do= link. */
export function invoiceExportFormActions(t: (key: string) => string, enabled: boolean, run: (format: InvoiceExportFormat) => void) {
  if (!enabled) return [];
  return INVOICE_EXPORT_ACTIONS.map((a) => ({ key: a.key, label: t(a.labelKey), icon: <a.Icon className="h-4 w-4" aria-hidden />, onClick: () => run(a.format) }));
}

/** The classic invoice pages (no action menu): the two entries as small secondary buttons next to Print. */
export function InvoiceExportButtons({
  t,
  disabled,
  onExport,
}: {
  t: (key: string) => string;
  disabled?: boolean;
  onExport: (format: InvoiceExportFormat) => void;
}) {
  return (
    <>
      {INVOICE_EXPORT_ACTIONS.map((a) => (
        <Button key={a.key} type="button" appearance="solid" color="secondary" size="sm" disabled={disabled} onClick={() => onExport(a.format)}>
          <a.Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{t(a.labelKey)}</span>
        </Button>
      ))}
    </>
  );
}
