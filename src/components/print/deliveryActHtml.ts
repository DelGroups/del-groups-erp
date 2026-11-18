import type { DeliveryAct } from "@/lib/deliveryAct/act";
import { BARCODE_COLUMN_MM, BARCODE_PRINT_MM, type ActBarcodes } from "@/lib/deliveryAct/barcodes";

/**
 * The delivery act as one printable HTML page (A4, black on white, no app styles), shown in the dialog's
 * preview frame and printed from it (the browser's "Save as PDF" gives the PDF). Every value is escaped.
 */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function barcodeCell(value: string, barcodes: ActBarcodes): string {
  const img = value ? barcodes[value] : undefined;
  if (!img) return escapeHtml(value);
  return `<img src="data:image/png;base64,${img.png}" alt="${escapeHtml(value)}" />`;
}

const STYLE = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.45; color: #000; background: #fff; }
  @media print { body { padding: 0; } }
  .contract { text-align: center; margin: 0 0 4px; }
  h1 { text-align: center; font-size: 15pt; margin: 0 0 12px; }
  .place { display: flex; justify-content: space-between; margin: 0 0 14px; }
  p { margin: 0 0 10px; text-align: justify; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 8px 0 14px; font-size: 11pt; }
  col.c-n { width: 9mm; } col.c-b { width: ${BARCODE_COLUMN_MM}mm; } col.c-u { width: 17mm; } col.c-q { width: 20mm; }
  td.name { overflow-wrap: anywhere; }
  th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: middle; }
  th { background: #f2f2f2; font-weight: bold; text-align: center; }
  td.n, td.q { text-align: center; white-space: nowrap; }
  td.b { white-space: nowrap; text-align: center; padding: 2px 4px; vertical-align: middle; }
  td.b img { display: block; margin: 0 auto; width: ${BARCODE_PRINT_MM}mm; max-width: 100%; height: auto; }
  tr { break-inside: avoid; }
  .signs { display: flex; justify-content: space-between; align-items: stretch; gap: 40px; margin-top: 28px; break-inside: avoid; }
  .sign { flex: 1; display: flex; flex-direction: column; }
  .sign .role { font-weight: bold; }
  /* Both signature lines on one level, whatever is written above them. */
  .sign .line { margin-top: auto; border-top: 1px solid #000; width: 75%; padding-top: 2px; font-size: 9pt; }
  .sign > div:nth-last-child(2) { margin-bottom: 36px; }
`;

/** `barcodes`: the drawn barcode of each value (drawBarcodes); a value without one is printed as text. */
export function actToHtml(act: DeliveryAct, barcodes: ActBarcodes = {}): string {
  const e = escapeHtml;
  const rows = act.rows
    .map((r) => `<tr><td class="n">${r.no}</td><td class="b">${barcodeCell(r.barcode, barcodes)}</td><td class="name">${e(r.name)}</td><td class="q">${e(r.unit)}</td><td class="q">${e(r.quantity)}</td></tr>`)
    .join("");
  const sign = (p: DeliveryAct["seller"]) =>
    `<div class="sign"><div class="role">"${e(p.role)}"</div><div>${e(p.name)}</div>${p.director ? `<div>${e(p.director)}</div>` : ""}<div class="line">(imza)</div></div>`;
  return `<!doctype html>
<html lang="az"><head><meta charset="utf-8"><title>${e(act.title)} № ${e(act.number)}</title><style>${STYLE}</style></head>
<body>
${act.contractHeading ? `<p class="contract">${e(act.contractHeading)}</p>` : ""}
<h1>${e(act.title)}</h1>
<div class="place"><span>${e(act.city)}</span><span>${e(act.date)}</span></div>
<p>1. ${e(act.clauses[0])}</p>
<table><colgroup><col class="c-n" /><col class="c-b" /><col /><col class="c-u" /><col class="c-q" /></colgroup><thead><tr><th>№</th><th>Barkod</th><th>Malın adı</th><th>Vahid</th><th>Miqdarı</th></tr></thead><tbody>${rows}</tbody></table>
<p>2. ${e(act.clauses[1])}</p>
<p>3. ${e(act.clauses[2])}</p>
<div class="signs">${sign(act.seller)}${sign(act.buyer)}</div>
</body></html>`;
}
