// INV-2: pdfmake 0.3 ships no types; only the browser build is imported (invoiceExportDownload.ts).
declare module "pdfmake/build/pdfmake" {
  const pdfMake: unknown;
  export default pdfMake;
}
