/**
 * INV-2, browser only: makes the invoice file and downloads it. The Excel library, pdfmake and
 * the font are loaded here with dynamic imports when the user clicks, so no page bundle grows.
 * The hook (useInvoiceExport) imports this module itself dynamically, so the mapping comes too.
 */
export { invoiceExportFileName, invoiceExportLabels, purchaseToExportDoc, saleToExportDoc } from "./invoiceExport";
import type { PrintMode } from "@/lib/print/types";
import { downloadBlob, XLSX_MIME, type XlsxModule } from "./exportXlsx";
import {
  buildInvoicePdfDefinition,
  buildInvoiceSheet,
  invoiceExportFileName,
  PDF_FONT,
  PDF_FONT_FILES,
  pdfShowsCompany,
  writeInvoiceXlsxBytes,
  type InvoiceExportDoc,
  type InvoiceExportFormat,
  type InvoiceExportLabels,
} from "./invoiceExport";

interface PdfMakeBrowser {
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
  setFonts: (fonts: Record<string, Record<string, string>>) => void;
  setUrlAccessPolicy: (policy: (url: string) => boolean) => void;
  createPdf: (doc: Record<string, unknown>) => { download: (fileName: string) => Promise<void> };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

let pdfMakeReady: Promise<PdfMakeBrowser> | null = null;

/** pdfmake with Noto Sans from public/fonts (same origin, no CDN); loaded once per page. */
function loadPdfMake(): Promise<PdfMakeBrowser> {
  pdfMakeReady ??= (async () => {
    const [mod, ...fonts] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      ...Object.values(PDF_FONT_FILES).map(async (file) => {
        const res = await fetch(`/fonts/${file}`);
        if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
        return [file, toBase64(await res.arrayBuffer())] as const;
      }),
    ]);
    // The UMD build arrives as the instance or wrapped in { default } depending on the bundler.
    const m = mod as unknown as { default?: unknown };
    const inner = (m.default ?? m) as { default?: unknown; createPdf?: unknown };
    const pdfMake = (typeof inner.createPdf === "function" ? inner : inner.default) as PdfMakeBrowser;
    pdfMake.setUrlAccessPolicy(() => false);
    pdfMake.addVirtualFileSystem(Object.fromEntries(fonts));
    pdfMake.setFonts({ [PDF_FONT]: { normal: PDF_FONT_FILES.normal, bold: PDF_FONT_FILES.bold, italics: PDF_FONT_FILES.normal, bolditalics: PDF_FONT_FILES.bold } });
    return pdfMake;
  })().catch((err) => {
    pdfMakeReady = null;
    throw err;
  });
  return pdfMakeReady;
}

/** The company logo as a data URL, or null when it cannot be read (the file is made without it). */
async function logoDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\/(png|jpe?g)$/.test(blob.type)) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadInvoiceFile(
  doc: InvoiceExportDoc,
  labels: InvoiceExportLabels,
  format: InvoiceExportFormat,
  options: { mode: PrintMode; locale: string }
): Promise<void> {
  const fileName = invoiceExportFileName(doc, format);
  if (format === "xlsx") {
    const XLSX = (await import("xlsx")) as unknown as XlsxModule;
    const bytes = writeInvoiceXlsxBytes(XLSX, buildInvoiceSheet(doc, labels));
    downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), fileName);
    return;
  }
  const [pdfMake, logo] = await Promise.all([
    loadPdfMake(),
    pdfShowsCompany(doc, options.mode) ? logoDataUrl(doc.company.logoUrl) : Promise.resolve(null),
  ]);
  await pdfMake.createPdf(buildInvoicePdfDefinition(doc, labels, { ...options, logoDataUrl: logo })).download(fileName);
}
