"use client";

import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { useI18n } from "@/i18n/I18nProvider";
import type { ImportsConfig } from "@/lib/imports/config";
import type { LandedCostResult } from "@/lib/imports/landedCost";
import type { ImportProduct, ShipmentDraft } from "../lib/shipment";
import { costTypeLabel } from "./LandedCostPanel";

export interface CostSheetData {
  draft: ShipmentDraft;
  result: LandedCostResult;
  config: ImportsConfig;
  products: ReadonlyMap<string, ImportProduct>;
  supplierName: string;
}

const fmt2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUnit = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 });

/**
 * Shipment cost sheet (IMP-3): A4, the landed-cost table of the shipment, one column per
 * capitalized cost with its split method, then landed total and unit costs; the totals and the
 * customs figures below. Same print approach as the receiving sheet (print-area portal).
 */
export default function CostSheet({ data }: { data: CostSheetData }) {
  const { t, formatDate } = useI18n();
  const company = useCompanyProfile().displayName;
  const { draft, result, config, products } = data;
  const capitalized = result.costs.filter((c) => c.capitalized);
  const costLabel = (id: string) => {
    const cost = draft.costs.find((c) => c.key === id);
    return cost ? cost.description || costTypeLabel(cost.costType, config, t) : id;
  };
  return (
    <section className="mx-auto w-[297mm] bg-white p-6 font-sans text-[10px] text-black" style={{ pageBreakInside: "avoid" }} aria-label={t("importReports.costSheet.title")}>
      <style>{"@page { size: A4 landscape; margin: 8mm; }"}</style>
      <header className="mb-3 flex items-start justify-between border-b-2 border-slate-800 pb-2">
        <div>
          <h1 className="text-base font-bold">{company}</h1>
          <p className="text-sm font-semibold">{t("importReports.costSheet.title")}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 text-right">
          <dt>{t("imports.sheet.file")}:</dt>
          <dd className="font-semibold">{draft.number ?? "—"}</dd>
          <dt>{t("imports.fields.supplier")}:</dt>
          <dd>{data.supplierName || "—"}</dd>
          <dt>{t("imports.fields.invoiceNo")}:</dt>
          <dd>{draft.invoiceNo ?? "—"}{draft.invoiceDate ? ` · ${formatDate(draft.invoiceDate)}` : ""}</dd>
          <dt>{t("imports.fields.currency")}:</dt>
          <dd>{draft.currencyCode} × {draft.goodsRateAzn ?? draft.invoiceRate}</dd>
          <dt>{t("imports.fields.customsDeclarationNo")}:</dt>
          <dd>{draft.customsDeclarationNo ?? "—"}{draft.customsDeclarationDate ? ` · ${formatDate(draft.customsDeclarationDate)}` : ""}</dd>
          <dt>{t("common.status")}:</dt>
          <dd>{t(`imports.status.${draft.status}`)}</dd>
        </dl>
      </header>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-100">
            <th className="border p-1 text-left">#</th>
            <th className="border p-1 text-left">{t("imports.fields.product")}</th>
            <th className="border p-1 text-right">{t("imports.fields.qtyPurchase")}</th>
            <th className="border p-1 text-right">{t("imports.landed.goods")}</th>
            {capitalized.map((c) => (
              <th key={c.id} className="border p-1 text-right">
                {costLabel(c.id)}
                <span className="block font-normal text-slate-500">{t(`imports.methods.${c.method}`)}</span>
              </th>
            ))}
            <th className="border p-1 text-right">{t("imports.landed.total")}</th>
            <th className="border p-1 text-right">{t("imports.landed.unitCost")}</th>
            <th className="border p-1 text-right">{t("imports.landed.stockUnitCost")}</th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((line, i) => {
            const draftLine = draft.lines.find((l) => l.key === line.id);
            const p = draftLine ? products.get(draftLine.productId) : undefined;
            return (
              <tr key={line.id}>
                <td className="border p-1">{i + 1}</td>
                <td className="border p-1">
                  <span className="font-mono">{p?.code}</span> {p?.name}
                </td>
                <td className="border p-1 text-right tabular-nums">{draftLine?.qtyPurchase} {draftLine?.purchaseUnit ?? ""}</td>
                <td className="border p-1 text-right tabular-nums">{fmt2(line.goodsAzn)}</td>
                {capitalized.map((c) => (
                  <td key={c.id} className="border p-1 text-right tabular-nums">{fmt2(line.allocations[c.id] ?? 0)}</td>
                ))}
                <td className="border p-1 text-right font-semibold tabular-nums">{fmt2(line.landedAzn)}</td>
                <td className="border p-1 text-right tabular-nums">{fmtUnit(line.unitCostPurchase)}</td>
                <td className="border p-1 text-right tabular-nums">
                  {fmtUnit(line.unitCostStock)} / {p?.sheetLengthM ? t("imports.units.metre") : draftLine?.purchaseUnit ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="border p-1" colSpan={3}>{t("imports.landed.totals")}</td>
            <td className="border p-1 text-right tabular-nums">{fmt2(result.totals.goodsAzn)}</td>
            {capitalized.map((c) => (
              <td key={c.id} className="border p-1 text-right tabular-nums">{fmt2(c.amountAzn)}</td>
            ))}
            <td className="border p-1 text-right tabular-nums">{fmt2(result.totals.landedAzn)}</td>
            <td className="border p-1" colSpan={2} />
          </tr>
        </tfoot>
      </table>

      <dl className="mt-3 grid grid-cols-4 gap-2">
        {(
          [
            ["goods", result.totals.goodsAzn],
            ["capitalized", result.totals.capitalizedAzn],
            ["recoverableVat", result.totals.recoverableVatAzn],
            ["landedTotal", result.totals.landedAzn],
            ["customsValue", result.totals.customsValueAzn],
            ["duty", result.totals.dutyAzn],
            ["customsVat", result.totals.customsVatSuggestionAzn],
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <dt className="text-slate-500">{t(`imports.landed.summary_${key}`, { rate: config.customsVatRatePct })}</dt>
            <dd className="font-semibold tabular-nums">{fmt2(value)} {t("common.currency")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
