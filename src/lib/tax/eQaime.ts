export type EQaimeVatCode = "STANDARD_18" | "ZERO" | "EXEMPT";

export interface EQaimeParty {
  voen: string;
  name: string;
  address?: string | null;
}

export interface EQaimeLine {
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineNet: number;
  vatRate: number;
  vatAmount: number;
  lineGross: number;
  vatCode: EQaimeVatCode;
}

export interface EQaimeDocument {
  documentType: "SALE" | "PURCHASE";
  invoiceSerial: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: "AZN";
  seller: EQaimeParty;
  buyer: EQaimeParty;
  lines: EQaimeLine[];
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  notes?: string | null;
}

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function normalizeVoen(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "").padStart(10, "0").slice(-10);
}

export function parseInvoiceSerial(docNo: string | null | undefined): {
  serial: string;
  number: string;
} {
  const raw = (docNo || "").trim();
  if (!raw) return { serial: "DG", number: "1" };
  const match = raw.match(/^([A-Za-zƏəÜüÖöĞğIıİiŞşÇç]{1,6})[-/\s]*(\d+.*)$/);
  if (match) {
    return { serial: match[1].toUpperCase(), number: match[2] };
  }
  const digits = raw.replace(/\D/g, "");
  return { serial: "DG", number: digits || raw };
}

export function classifyVatRate(rate: number, vatMode?: string | null): EQaimeVatCode {
  if (vatMode === "none") return "EXEMPT";
  if (rate >= 17.5) return "STANDARD_18";
  if (rate <= 0) return "EXEMPT";
  return "ZERO";
}

export function vatCodeLabel(code: EQaimeVatCode): string {
  if (code === "STANDARD_18") return "18";
  if (code === "ZERO") return "0";
  return "exempt";
}

export function buildEQaimeJson(doc: EQaimeDocument): string {
  const payload = {
    schema: "e-taxes.gov.az/e-qaime",
    version: "1.0",
    documentType: doc.documentType,
    invoice: {
      serial: doc.invoiceSerial,
      number: doc.invoiceNumber,
      date: doc.invoiceDate,
      currency: doc.currency,
    },
    seller: {
      voen: normalizeVoen(doc.seller.voen),
      name: doc.seller.name,
      address: doc.seller.address || "",
    },
    buyer: {
      voen: normalizeVoen(doc.buyer.voen),
      name: doc.buyer.name,
      address: doc.buyer.address || "",
    },
    items: doc.lines.map((line, index) => ({
      lineNo: index + 1,
      code: line.code,
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: money(line.unitPrice),
      netAmount: money(line.lineNet),
      vatRate: line.vatRate,
      vatCode: vatCodeLabel(line.vatCode),
      vatAmount: money(line.vatAmount),
      grossAmount: money(line.lineGross),
    })),
    totals: {
      subtotal: money(doc.subtotal),
      vatTotal: money(doc.vatTotal),
      grandTotal: money(doc.grandTotal),
    },
    notes: doc.notes || "",
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function buildEQaimeXml(doc: EQaimeDocument): string {
  const sellerVoen = xmlEscape(normalizeVoen(doc.seller.voen));
  const buyerVoen = xmlEscape(normalizeVoen(doc.buyer.voen));
  const itemsXml = doc.lines
    .map(
      (line, index) => `      <Product>
        <LineNo>${index + 1}</LineNo>
        <Code>${xmlEscape(line.code || "")}</Code>
        <Name>${xmlEscape(line.name || "")}</Name>
        <Unit>${xmlEscape(line.unit || "Ədəd")}</Unit>
        <Quantity>${line.quantity}</Quantity>
        <UnitPrice>${money(line.unitPrice).toFixed(2)}</UnitPrice>
        <NetAmount>${money(line.lineNet).toFixed(2)}</NetAmount>
        <VatRate>${vatCodeLabel(line.vatCode)}</VatRate>
        <VatAmount>${money(line.vatAmount).toFixed(2)}</VatAmount>
        <GrossAmount>${money(line.lineGross).toFixed(2)}</GrossAmount>
      </Product>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<EInvoice xmlns="http://e-taxes.gov.az/eqaime">
  <Version>1.00</Version>
  <DocumentType>${doc.documentType === "PURCHASE" ? "Purchase" : "Sale"}</DocumentType>
  <Header>
    <Serial>${xmlEscape(doc.invoiceSerial)}</Serial>
    <Number>${xmlEscape(doc.invoiceNumber)}</Number>
    <InvoiceDate>${xmlEscape(doc.invoiceDate)}</InvoiceDate>
    <Currency>${doc.currency}</Currency>
  </Header>
  <Seller>
    <VOEN>${sellerVoen}</VOEN>
    <Name>${xmlEscape(doc.seller.name)}</Name>
    <Address>${xmlEscape(doc.seller.address || "")}</Address>
  </Seller>
  <Buyer>
    <VOEN>${buyerVoen}</VOEN>
    <Name>${xmlEscape(doc.buyer.name)}</Name>
    <Address>${xmlEscape(doc.buyer.address || "")}</Address>
  </Buyer>
  <ProductList>
${itemsXml || "      <!-- no lines -->"}
  </ProductList>
  <Totals>
    <Subtotal>${money(doc.subtotal).toFixed(2)}</Subtotal>
    <VatTotal>${money(doc.vatTotal).toFixed(2)}</VatTotal>
    <GrandTotal>${money(doc.grandTotal).toFixed(2)}</GrandTotal>
  </Totals>
  <Notes>${xmlEscape(doc.notes || "")}</Notes>
</EInvoice>
`;
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function eQaimeFilename(doc: EQaimeDocument, ext: "xml" | "json"): string {
  const serial = `${doc.invoiceSerial}-${doc.invoiceNumber}`.replace(/[^\w.-]+/g, "_");
  return `e-qaime_${doc.documentType.toLowerCase()}_${serial}.${ext}`;
}
