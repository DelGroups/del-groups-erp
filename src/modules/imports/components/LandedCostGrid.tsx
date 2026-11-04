"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { DataGrid, Section, Truncate, type GridColumn } from "@/design-system/components";
import { LookupScope } from "@/components/lookups/LookupScope";
import { useI18n } from "@/i18n/I18nProvider";
import { dataGridLabels } from "@/i18n/uiStandardLabels";
import { formatFigure, formatMoney } from "@/lib/dates/localeDate";
import type { ImportsConfig } from "@/lib/imports/config";
import type { LandedCostIssue, LandedCostLineResult, LandedCostResult } from "@/lib/imports/landedCost";
import { costColumnTotals, markupFromMargin, priceFromMargin, reconciledTotals, type PlausibilityWarning } from "../lib/landedChecks";
import type { ImportProduct, ShipmentDraft } from "../lib/shipment";
import { costTypeLabel } from "./LandedCostPanel";

/**
 * "Maya dəyəri" (IMP-4, behind UI_STANDARD): the landed cost on the DataGrid, like the Sales lists.
 * One line per product ("code · name", sticky), goods, one column per capitalized cost ("name ·
 * method"), landed total, cost per purchase unit and per stock unit (AZN/m) and the sale price
 * suggestion from a margin. The totals row is the sum of the cells; a cost that is not (fully)
 * split shows its unallocated part in red. A summary strip above it.
 */
export function LandedCostGrid({
  draft,
  result,
  config,
  products,
  marginPct,
  onMarginChange,
  onUseCustomsVat,
  plausibility,
}: {
  draft: ShipmentDraft;
  result: LandedCostResult;
  config: ImportsConfig;
  products: ReadonlyMap<string, ImportProduct>;
  marginPct: number | null;
  onMarginChange: (value: number | null) => void;
  onUseCustomsVat?: () => void;
  plausibility: readonly PlausibilityWarning[];
}) {
  const { t, locale } = useI18n();
  const money = (n: number) => formatMoney(n, locale, { currency: null });
  const lineOf = useMemo(() => new Map(draft.lines.map((l) => [l.key, l])), [draft.lines]);
  const costLabel = (id: string) => {
    const index = draft.costs.findIndex((c) => c.key === id);
    const cost = draft.costs[index];
    if (!cost) return id;
    return cost.description || `${costTypeLabel(cost.costType, config, t)}${draft.costs.filter((c) => c.costType === cost.costType).length > 1 ? ` ${index + 1}` : ""}`;
  };
  const costTypeHeader = (id: string) => {
    const index = draft.costs.findIndex((c) => c.key === id);
    const cost = draft.costs[index];
    if (!cost) return id;
    const same = draft.costs.filter((c) => c.costType === cost.costType);
    return `${costTypeLabel(cost.costType, config, t)}${same.length > 1 ? ` ${same.indexOf(cost) + 1}` : ""}`;
  };
  const stockUnitOf = (line: LandedCostLineResult) => {
    const l = lineOf.get(line.id);
    return products.get(l?.productId ?? "")?.sheetLengthM ? t("imports.units.metre") : l?.purchaseUnit || t("imports.units.unit");
  };
  const capitalized = result.costs.filter((c) => c.capitalized);
  const columnTotals = costColumnTotals(result);
  const reconciled = reconciledTotals(result);
  const markup = markupFromMargin(marginPct);
  const over3x = new Set(plausibility.filter((p) => p.code === "landed_over_3x").map((p) => p.lineId));

  const columns = useMemo<GridColumn<LandedCostLineResult>[]>(() => {
    const productName = (line: LandedCostLineResult) => {
      const p = products.get(lineOf.get(line.id)?.productId ?? "");
      return p ? `${p.code} · ${p.name}` : "—";
    };
    return [
      {
        key: "product",
        header: t("imports.fields.product"),
        type: "text",
        width: 200,
        cell: (line) => (
          <span className="flex min-w-0 items-center gap-1.5">
            {over3x.has(line.id) ? (
              <span title={t("imports.plausibility.landed_over_3x")} className="inline-flex shrink-0" style={{ color: "var(--ds-warning)" }}>
                <AlertTriangle className="h-3.5 w-3.5" aria-label={t("imports.plausibility.landed_over_3x")} />
              </span>
            ) : null}
            <Truncate>{productName(line)}</Truncate>
          </span>
        ),
      },
      { key: "goods", header: t("imports.landed.goods"), type: "money", cell: (line) => money(line.goodsAzn) },
      ...capitalized.map<GridColumn<LandedCostLineResult>>((c) => ({
        key: `cost:${c.id}`,
        // Like the mockup: the cost type (numbered when there are two) · its method.
        header: `${costTypeHeader(c.id)} · ${t(`imports.methodsShort.${c.method}`)}`,
        type: "money",
        width: 108,
        cell: (line) => money(line.allocations[c.id] ?? 0),
      })),
      { key: "landed", header: t("imports.landed.total"), type: "money", className: "font-semibold", cell: (line) => money(line.landedAzn) },
      {
        key: "unitPurchase",
        header: t("imports.landed.unitCost"),
        type: "money",
        cell: (line) => `${formatFigure(line.unitCostPurchase, 2, locale)} /${lineOf.get(line.id)?.purchaseUnit || t("imports.units.unit")}`,
      },
      {
        key: "unitStock",
        header: t("imports.landed.stockUnitCost"),
        type: "money",
        className: "font-semibold",
        cell: (line) => `${formatFigure(line.unitCostStock, line.unitCostStock < 1 ? 4 : 2, locale)} AZN/${stockUnitOf(line)}`,
      },
      {
        key: "salePrice",
        header: t("imports.landed.salePrice"),
        type: "money",
        cell: (line) => {
          const price = priceFromMargin(line.unitCostStock, marginPct);
          return price === null ? <span className="ds-muted">—</span> : `${formatFigure(price, 2, locale)} AZN/${stockUnitOf(line)}`;
        },
      },
    ];
    // Rebuilt with the result; the helpers only read the draft, products and texts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, draft.costs, lineOf, products, marginPct, t, locale, plausibility]);

  const totals: Record<string, React.ReactNode> = {
    product: t("imports.landed.totals"),
    goods: money(reconciled.goodsAzn),
    landed: money(reconciled.landedAzn),
  };
  for (const c of columnTotals) {
    totals[`cost:${c.costId}`] =
      Math.abs(c.unallocatedAzn) >= 0.005 ? (
        <span title={t("imports.landed.unallocatedHint", { amount: money(c.amountAzn), unallocated: money(c.unallocatedAzn) })}>
          {money(c.allocatedAzn)}
          <span className="ds-unallocated">−{money(c.unallocatedAzn)}</span>
        </span>
      ) : (
        money(c.allocatedAzn)
      );
  }

  const issues = [...result.errors, ...result.warnings];
  const issueText = (issue: LandedCostIssue) =>
    issue.code === "zero_basis"
      ? `${costLabel(issue.costId ?? "")}: ${t("imports.draftIssues.cost_unallocated")}`
      : t(`imports.issues.${issue.code}`, { cost: issue.costId ? costLabel(issue.costId) : "", amount: issue.amount !== undefined ? money(issue.amount) : "" });
  const plausibilityText = (p: PlausibilityWarning) =>
    p.costId && p.code !== "rate_off_cbar" ? `${costLabel(p.costId)}: ${t(`imports.plausibility.${p.code}`)}` : t(`imports.plausibility.${p.code}`) + (p.rate && !p.costId ? ` (${t(`imports.rates.${p.rate}`)})` : p.costId ? ` (${costLabel(p.costId)})` : "");

  const stats: [string, number, boolean?][] = [
    [t("imports.landed.summary_goods"), result.totals.goodsAzn],
    [t("imports.landed.summary_customsValue"), result.totals.customsValueAzn],
    [t("imports.landed.summary_duty"), result.totals.dutyAzn],
    [t("imports.landed.summary_capitalized"), reconciled.costsAzn],
    [t("imports.landed.summary_recoverableVat"), result.totals.recoverableVatAzn],
    [t("imports.landed.summary_landedTotal"), reconciled.landedAzn, true],
  ];

  return (
    <LookupScope>
      <Section
        title={t("imports.landed.title")}
        description={t("imports.landed.hint")}
        actions={
          <label className="flex items-center gap-2 text-[length:var(--ds-text-xs)]" title={t("imports.landed.salePriceHint")}>
            <span className="ds-label whitespace-nowrap">{t("imports.landed.marginPct")}</span>
            <input
              className="ds-input ds-mono w-16 text-end tabular-nums"
              inputMode="decimal"
              type="text"
              aria-describedby="imports-margin-hint"
              value={marginPct ?? ""}
              onChange={(e) => {
                const raw = e.target.value.replace(",", ".").trim();
                if (raw === "") return onMarginChange(null);
                const n = Number(raw);
                if (Number.isFinite(n) && n >= 0 && n < 100) onMarginChange(n);
              }}
            />
            {markup !== null ? <span className="ds-muted whitespace-nowrap">{t("imports.landed.markup", { markup: formatFigure(markup, 1, locale) })}</span> : null}
          </label>
        }
      >
        <p id="imports-margin-hint" className="sr-only">
          {t("imports.landed.salePriceHint")}
        </p>
        <div className="flex flex-col gap-3">
          <dl className="ds-stat-strip">
            {stats.map(([label, value, emphasis]) => (
              <div key={label} data-emphasis={emphasis ? "" : undefined}>
                <dt title={label}>{label}</dt>
                <dd>{money(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2 text-[length:var(--ds-text-sm)]">
            <span className="ds-muted">{t("imports.landed.summary_customsVat", { rate: config.customsVatRatePct })}:</span>
            <span className="ds-mono tabular-nums">{money(result.totals.customsVatSuggestionAzn)} AZN</span>
            {onUseCustomsVat ? (
              <button type="button" className="ds-btn ds-btn-sm" onClick={onUseCustomsVat}>
                {t("imports.landed.use")}
              </button>
            ) : null}
            <span className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.landed.customsVatNote")}</span>
          </div>

          {issues.length || plausibility.length ? (
            <ul className="flex flex-col gap-1 text-[length:var(--ds-text-xs)]" role="status">
              {issues.map((issue, i) => (
                <li key={`${issue.code}-${issue.costId ?? ""}-${i}`} className="flex items-start gap-1.5" style={{ color: result.errors.includes(issue) ? "var(--ds-danger-strong)" : undefined }}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden style={{ color: result.errors.includes(issue) ? "var(--ds-danger-strong)" : "var(--ds-warning)" }} />
                  <span>{issueText(issue)}</span>
                </li>
              ))}
              {plausibility.map((p, i) => (
                <li key={`p-${p.code}-${p.costId ?? p.lineId ?? p.rate ?? ""}-${i}`} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden style={{ color: "var(--ds-warning)" }} />
                  <span>{plausibilityText(p)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <DataGrid<LandedCostLineResult>
            columns={columns}
            rows={result.lines}
            rowKey={(l) => l.id}
            label={t("imports.landed.title")}
            labels={dataGridLabels(t)}
            density="compact"
            totals={result.lines.length ? totals : null}
            empty={<span className="ds-muted">{t("imports.landed.empty")}</span>}
          />
          <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("imports.landed.salePriceHint")}</p>
        </div>
      </Section>
    </LookupScope>
  );
}
