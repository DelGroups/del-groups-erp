import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { ImportsConfig } from "@/lib/imports/config";
import type { CostType, LandedCostIssue, LandedCostResult } from "@/lib/imports/landedCost";
import { useFormatter, figure } from "@/views";
import type { ImportProduct, ShipmentDraft } from "../lib/shipment";

export function costTypeLabel(type: CostType, config: ImportsConfig, t: (key: string) => string): string {
  return config.costTypes[type]?.name || t(`imports.costTypes.${type}`);
}

const amount = (n: number, locale: string, digits = 2) => figure(n, { t: (k) => k, locale }, digits);

/**
 * The live landed cost of the shipment (IMP-1): one row per product, one column per capitalized
 * cost, then landed total, unit cost and cost per stock unit (metre); totals and the customs VAT
 * suggestion below. Every cost is split by its own method.
 */
export function LandedCostPanel({
  draft,
  result,
  config,
  products,
  marginPct,
  onMarginChange,
  onUseCustomsVat,
}: {
  draft: ShipmentDraft;
  result: LandedCostResult;
  config: ImportsConfig;
  products: ReadonlyMap<string, ImportProduct>;
  marginPct: number | null;
  onMarginChange: (value: number | null) => void;
  onUseCustomsVat?: () => void;
}) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const money = (n: number) => amount(n, fmt.locale);
  const capitalized = result.costs.filter((c) => c.capitalized);
  const costLabel = (id: string) => {
    const index = draft.costs.findIndex((c) => c.key === id);
    const cost = draft.costs[index];
    if (!cost) return id;
    return cost.description || `${costTypeLabel(cost.costType, config, t)}${draft.costs.filter((c) => c.costType === cost.costType).length > 1 ? ` ${index + 1}` : ""}`;
  };
  const issueText = (issue: LandedCostIssue) =>
    t(`imports.issues.${issue.code}`, {
      cost: issue.costId ? costLabel(issue.costId) : "",
      amount: issue.amount !== undefined ? money(issue.amount) : "",
    });

  return (
    <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="imports-landed">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="imports-landed" className="font-semibold">{t("imports.landed.title")}</h2>
          <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.landed.hint")}</p>
        </div>
        <label className="flex items-center gap-2 text-[length:var(--ds-text-xs)]">
          <span className="ds-label">{t("imports.landed.margin")}</span>
          <input
            className="ds-input ds-mono w-20"
            type="number"
            min={0}
            max={99}
            step={1}
            value={marginPct ?? ""}
            onChange={(e) => onMarginChange(e.target.value === "" ? null : Math.min(99, Math.max(0, Number(e.target.value))))}
            aria-describedby="imports-margin-hint"
          />
          %
        </label>
      </div>
      <p id="imports-margin-hint" className="sr-only">{t("imports.landed.marginHint")}</p>

      {result.warnings.length || result.errors.length ? (
        <ul className="flex flex-col gap-1" role="status">
          {[...result.errors, ...result.warnings].map((issue, i) => (
            <li key={`${issue.code}-${issue.costId ?? ""}-${i}`} className="flex items-start gap-1.5 text-[length:var(--ds-text-xs)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden style={{ color: result.errors.includes(issue) ? "var(--ds-danger, #e11d48)" : "var(--ds-warning, #d97706)" }} />
              <span>{issueText(issue)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {draft.lines.length === 0 ? (
        <p className="ds-muted">{t("imports.landed.empty")}</p>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[40rem] border-collapse text-[length:var(--ds-text-sm)]">
            <caption className="sr-only">{t("imports.landed.title")}</caption>
            <thead>
              <tr className="text-start">
                <th scope="col" className="px-2 py-1.5 text-start font-semibold">{t("imports.fields.product")}</th>
                <th scope="col" className="px-2 py-1.5 text-end font-semibold">{t("imports.landed.goods")}</th>
                {capitalized.map((c) => (
                  <th key={c.id} scope="col" className="px-2 py-1.5 text-end font-semibold">
                    <span className="block">{costLabel(c.id)}</span>
                    <span className="block text-[length:var(--ds-text-xs)] font-normal ds-muted">{t(`imports.methods.${c.method}`)}</span>
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 text-end font-semibold">{t("imports.landed.total")}</th>
                <th scope="col" className="px-2 py-1.5 text-end font-semibold">{t("imports.landed.unitCost")}</th>
                <th scope="col" className="px-2 py-1.5 text-end font-semibold">{t("imports.landed.stockUnitCost")}</th>
                {marginPct !== null ? <th scope="col" className="px-2 py-1.5 text-end font-semibold">{t("imports.landed.suggestedPrice")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {result.lines.map((line) => {
                const draftLine = draft.lines.find((l) => l.key === line.id);
                const product = draftLine ? products.get(draftLine.productId) : undefined;
                const stockUnit = product?.sheetLengthM ? t("imports.units.metre") : draftLine?.purchaseUnit || t("imports.units.unit");
                return (
                  <tr key={line.id} style={{ borderTop: "1px solid var(--ds-border)" }}>
                    <th scope="row" className="px-2 py-1.5 text-start font-medium">
                      <span className="block">{product?.name ?? "—"}</span>
                      <span className="block text-[length:var(--ds-text-xs)] font-normal ds-muted ds-mono">{product?.code ?? ""}</span>
                    </th>
                    <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(line.goodsAzn)}</td>
                    {capitalized.map((c) => (
                      <td key={c.id} className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(line.allocations[c.id] ?? 0)}</td>
                    ))}
                    <td className="px-2 py-1.5 text-end font-semibold ds-mono tabular-nums">{money(line.landedAzn)}</td>
                    <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(line.unitCostPurchase)}</td>
                    <td className="px-2 py-1.5 text-end ds-mono tabular-nums">
                      {amount(line.unitCostStock, fmt.locale, line.unitCostStock < 1 ? 4 : 2)}
                      <span className="ms-1 text-[length:var(--ds-text-xs)] ds-muted">/ {stockUnit}</span>
                    </td>
                    {marginPct !== null ? (
                      <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{line.suggestedPriceStock !== null ? money(line.suggestedPriceStock) : "—"}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--ds-border)" }} className="font-semibold">
                <th scope="row" className="px-2 py-1.5 text-start">{t("imports.landed.totals")}</th>
                <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(result.totals.goodsAzn)}</td>
                {capitalized.map((c) => (
                  <td key={c.id} className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(c.amountAzn)}</td>
                ))}
                <td className="px-2 py-1.5 text-end ds-mono tabular-nums">{money(result.totals.landedAzn)}</td>
                <td colSpan={marginPct !== null ? 3 : 2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
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
          <div key={key} className="flex flex-col">
            <dt className="text-[length:var(--ds-text-xs)] ds-muted">{t(`imports.landed.summary_${key}`, { rate: config.customsVatRatePct })}</dt>
            <dd className={`ds-mono tabular-nums ${key === "landedTotal" ? "font-semibold" : ""}`}>
              {money(value)} {t("common.currency")}
            </dd>
          </div>
        ))}
        {onUseCustomsVat ? (
          <div className="flex items-end">
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={onUseCustomsVat}>
              {t("imports.landed.useCustomsVat")}
            </button>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
