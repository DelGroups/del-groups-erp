import type { DeliveryAct } from "./act";

/**
 * The delivery act as a Word file (.docx): the same text and table as the printed page, in plain
 * WordprocessingML (Times New Roman 12, A4), so it opens in Word and LibreOffice and can be edited.
 * documentXml() is pure (tested); buildDocx() zips it with jszip.
 */

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function run(text: string, opts: { bold?: boolean; size?: number } = {}): string {
  const props = `${opts.bold ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ""}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function para(content: string, opts: { align?: "left" | "center" | "right" | "both"; after?: number; tabs?: string } = {}): string {
  const pPr = `<w:pPr>${opts.tabs ?? ""}<w:spacing w:after="${opts.after ?? 120}"/>${opts.align ? `<w:jc w:val="${opts.align}"/>` : ""}</w:pPr>`;
  return `<w:p>${pPr}${content}</w:p>`;
}

function cell(text: string, width: number, opts: { bold?: boolean; align?: "left" | "center" } = {}): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${opts.bold ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ""}</w:tcPr>${para(run(text, { bold: opts.bold, size: 22 }), { align: opts.align, after: 0 })}</w:tc>`;
}

/** Column widths in twips (A4 text width ≈ 9 638). */
const COLS = [600, 1900, 5038, 1000, 1100];

export function documentXml(act: DeliveryAct): string {
  const border = '<w:top w:val="single" w:sz="4" w:color="000000"/><w:left w:val="single" w:sz="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:right w:val="single" w:sz="4" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:color="000000"/>';
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${["№", "Barkod", "Malın adı", "Vahid", "Miqdarı"].map((h, i) => cell(h, COLS[i], { bold: true, align: "center" })).join("")}</w:tr>`;
  const rows = act.rows
    .map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(String(r.no), COLS[0], { align: "center" })}${cell(r.barcode, COLS[1])}${cell(r.name, COLS[2])}${cell(r.unit, COLS[3], { align: "center" })}${cell(r.quantity, COLS[4], { align: "center" })}</w:tr>`)
    .join("");
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${COLS.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${COLS.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>${header}${rows}</w:tbl>`;
  const rightTab = '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>';
  const twoCols = (left: string, right: string, bold = false) => para(`${run(left, { bold })}<w:r><w:tab/></w:r>${run(right, { bold })}`, { tabs: '<w:tabs><w:tab w:val="left" w:pos="5300"/></w:tabs>', after: 40 });
  const body = [
    act.contractHeading ? para(run(act.contractHeading), { align: "center", after: 60 }) : "",
    para(run(`${act.title} № ${act.number}`, { bold: true, size: 30 }), { align: "center", after: 200 }),
    para(`${run(act.city)}<w:r><w:tab/></w:r>${run(act.date)}`, { tabs: rightTab, after: 200 }),
    para(run(`1. ${act.clauses[0]}`), { align: "both" }),
    table,
    para("", { after: 60 }),
    para(run(`2. ${act.clauses[1]}`), { align: "both" }),
    para(run(`3. ${act.clauses[2]}`), { align: "both", after: 400 }),
    twoCols(`"${act.seller.role}"`, `"${act.buyer.role}"`, true),
    twoCols(act.seller.name, act.buyer.name),
    act.seller.director || act.buyer.director ? twoCols(act.seller.director, act.buyer.director) : "",
    para("", { after: 360 }),
    twoCols("______________________ (imza)", "______________________ (imza)"),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1021" w:right="1134" w:bottom="1021" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="az-Latn-AZ"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The .docx file's parts (path → XML); buildDocx zips them. */
export function docxParts(act: DeliveryAct): Record<string, string> {
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/_rels/document.xml.rels": DOC_RELS,
    "word/styles.xml": STYLES,
    "word/document.xml": documentXml(act),
  };
}

export async function buildDocx(act: DeliveryAct): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, xml] of Object.entries(docxParts(act))) zip.file(path, xml);
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME });
}
