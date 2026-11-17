import type { DeliveryAct } from "@/lib/deliveryAct/act";

/**
 * The delivery act as one printable HTML page (A4, black on white, no app styles), shown in the dialog's
 * preview frame and printed from it (the browser's "Save as PDF" gives the PDF). Every value is escaped.
 */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 11pt; }
  th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
  th { background: #f2f2f2; font-weight: bold; text-align: center; }
  td.n, td.q { text-align: center; white-space: nowrap; }
  td.b { white-space: nowrap; }
  tr { break-inside: avoid; }
  .signs { display: flex; justify-content: space-between; align-items: stretch; gap: 40px; margin-top: 28px; break-inside: avoid; }
  .sign { flex: 1; display: flex; flex-direction: column; }
  .sign .role { font-weight: bold; }
  /* Both signature lines on one level, whatever is written above them. */
  .sign .line { margin-top: auto; border-top: 1px solid #000; width: 75%; padding-top: 2px; font-size: 9pt; }
  .sign > div:nth-last-child(2) { margin-bottom: 36px; }
`;

export function actToHtml(act: DeliveryAct): string {
  const e = escapeHtml;
  const rows = act.rows
    .map((r) => `<tr><td class="n">${r.no}</td><td class="b">${e(r.barcode)}</td><td>${e(r.name)}</td><td class="q">${e(r.unit)}</td><td class="q">${e(r.quantity)}</td></tr>`)
    .join("");
  const sign = (p: DeliveryAct["seller"]) =>
    `<div class="sign"><div class="role">"${e(p.role)}"</div><div>${e(p.name)}</div>${p.director ? `<div>${e(p.director)}</div>` : ""}<div class="line">(imza)</div></div>`;
  return `<!doctype html>
<html lang="az"><head><meta charset="utf-8"><title>${e(act.title)} № ${e(act.number)}</title><style>${STYLE}</style></head>
<body>
${act.contractHeading ? `<p class="contract">${e(act.contractHeading)}</p>` : ""}
<h1>${e(act.title)} № ${e(act.number)}</h1>
<div class="place"><span>${e(act.city)}</span><span>${e(act.date)}</span></div>
<p>1. ${e(act.clauses[0])}</p>
<table><thead><tr><th>№</th><th>Barkod</th><th>Malın adı</th><th>Vahid</th><th>Miqdarı</th></tr></thead><tbody>${rows}</tbody></table>
<p>2. ${e(act.clauses[1])}</p>
<p>3. ${e(act.clauses[2])}</p>
<div class="signs">${sign(act.seller)}${sign(act.buyer)}</div>
</body></html>`;
}
