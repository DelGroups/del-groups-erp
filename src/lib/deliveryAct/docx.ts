import type { DeliveryAct } from "./act";
import type { ActBarcodes } from "./barcodes";

/**
 * The delivery act as a Word file (.docx): the same text and table as the printed page, in plain
 * WordprocessingML (Times New Roman 12, A4), so it opens in Word and LibreOffice and can be edited.
 * Barcodes are the same PNG pictures as on the printed page (inline images in the barcode cell).
 * documentXml() and docxParts() are pure (tested); buildDocx() zips them with jszip.
 */

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function run(text: string, opts: { bold?: boolean; size?: number } = {}): string {
  const props = `${opts.bold ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ""}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function para(content: string, opts: { align?: "left" | "center" | "right" | "both"; after?: number; tabs?: string } = {}): string {
  const pPr = `<w:pPr>${opts.tabs ?? ""}<w:spacing w:after="${opts.after ?? 120}"/>${opts.align ? `<w:jc w:val="${opts.align}"/>` : ""}</w:pPr>`;
  return `<w:p>${pPr}${content}</w:p>`;
}

function cellWith(content: string, width: number, opts: { shade?: boolean; align?: "left" | "center" } = {}): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${opts.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ""}<w:vAlign w:val="center"/></w:tcPr>${para(content, { align: opts.align, after: 0 })}</w:tc>`;
}

function cell(text: string, width: number, opts: { bold?: boolean; align?: "left" | "center" } = {}): string {
  return cellWith(run(text, { bold: opts.bold, size: 22 }), width, { shade: opts.bold, align: opts.align });
}

/** Column widths in twips (A4 text width ≈ 9 638; 1 mm ≈ 56.7): №, barcode 32 mm, name (the rest), unit, quantity. */
export const COLS = [510, 1814, 5194, 960, 1160];
/** The barcode picture's printed width: 28 mm (1 mm = 36 000 EMU), inside the 32 mm column. */
export const BARCODE_WIDTH_EMU = 28 * 36_000;
const EMU_PER_INCH = 914_400;

/** The barcode pictures of an act: one relationship per distinct value, in table order. */
export function barcodeMedia(act: DeliveryAct, barcodes: ActBarcodes): Array<{ value: string; rId: string; path: string; png: string; cx: number; cy: number }> {
  const out: Array<{ value: string; rId: string; path: string; png: string; cx: number; cy: number }> = [];
  for (const r of act.rows) {
    const img = r.barcode ? barcodes[r.barcode] : undefined;
    if (!img || out.some((m) => m.value === r.barcode) || img.width <= 0 || img.height <= 0) continue;
    const n = out.length + 1;
    out.push({ value: r.barcode, rId: `rIdBc${n}`, path: `media/barcode${n}.png`, png: img.png, cx: BARCODE_WIDTH_EMU, cy: Math.round((BARCODE_WIDTH_EMU * img.height) / img.width) });
  }
  return out;
}

function picture(m: { rId: string; cx: number; cy: number; value: string }, id: number): string {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${m.cx}" cy="${m.cy}"/><wp:docPr id="${id}" name="Barkod ${id}" descr="${escapeXml(m.value)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="barcode${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${m.cx}" cy="${m.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

export function documentXml(act: DeliveryAct, barcodes: ActBarcodes = {}): string {
  const media = barcodeMedia(act, barcodes);
  let drawingId = 0;
  const barcodeCell = (value: string) => {
    const m = media.find((x) => x.value === value);
    if (!m) return cell(value, COLS[1], { align: "center" });
    drawingId += 1;
    return cellWith(picture(m, drawingId), COLS[1], { align: "center" });
  };
  const border = '<w:top w:val="single" w:sz="4" w:color="000000"/><w:left w:val="single" w:sz="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:right w:val="single" w:sz="4" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:color="000000"/>';
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${["№", "Barkod", "Malın adı", "Vahid", "Miqdarı"].map((h, i) => cell(h, COLS[i], { bold: true, align: "center" })).join("")}</w:tr>`;
  const rows = act.rows
    .map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(String(r.no), COLS[0], { align: "center" })}${barcodeCell(r.barcode)}${cell(r.name, COLS[2])}${cell(r.unit, COLS[3], { align: "center" })}${cell(r.quantity, COLS[4], { align: "center" })}</w:tr>`)
    .join("");
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${COLS.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${COLS.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>${header}${rows}</w:tbl>`;
  const rightTab = '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>';
  const twoCols = (left: string, right: string, bold = false) => para(`${run(left, { bold })}<w:r><w:tab/></w:r>${run(right, { bold })}`, { tabs: '<w:tabs><w:tab w:val="left" w:pos="5300"/></w:tabs>', after: 40 });
  const body = [
    act.contractHeading ? para(run(act.contractHeading), { align: "center", after: 60 }) : "",
    para(run(act.title, { bold: true, size: 30 }), { align: "center", after: 200 }),
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
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1021" w:right="1134" w:bottom="1021" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="az-Latn-AZ"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

function documentRels(media: ReturnType<typeof barcodeMedia>): string {
  const images = media.map((m) => `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.path}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${images}</Relationships>`;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The .docx file's parts: XML text by path, and the barcode pictures (base64 PNG) by path. */
export function docxParts(act: DeliveryAct, barcodes: ActBarcodes = {}): { xml: Record<string, string>; images: Record<string, string> } {
  const media = barcodeMedia(act, barcodes);
  return {
    xml: {
      "[Content_Types].xml": CONTENT_TYPES,
      "_rels/.rels": ROOT_RELS,
      "word/_rels/document.xml.rels": documentRels(media),
      "word/styles.xml": STYLES,
      "word/document.xml": documentXml(act, barcodes),
    },
    images: Object.fromEntries(media.map((m) => [`word/${m.path}`, m.png])),
  };
}

export async function buildDocx(act: DeliveryAct, barcodes: ActBarcodes = {}): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const parts = docxParts(act, barcodes);
  for (const [path, xml] of Object.entries(parts.xml)) zip.file(path, xml);
  for (const [path, png] of Object.entries(parts.images)) zip.file(path, png, { base64: true });
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME });
}

/** For the tests: inches of a picture. */
export const emuToInches = (emu: number) => emu / EMU_PER_INCH;
