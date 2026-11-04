"use client";

import { useMemo, useState } from "react";
import { Percent, RefreshCw, SplitSquareHorizontal } from "lucide-react";
import { EntityLookup, type LookupRecord } from "@/components/lookups";
import { LineGrid, LineNumberCell, LineSelectCell, LineText, LineTextCell, type LineColumn } from "@/components/line-grid";
import { Chip, IconButton, type ChipTone } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatMoney } from "@/lib/dates/localeDate";
import { IMPORT_CURRENCIES, type ImportCurrency } from "@/lib/imports/cbar";
import { methodsFor, type ImportsConfig } from "@/lib/imports/config";
import { COST_TYPES, round2, type CostType, type LandedCostIssue, type LandedCostResult, type SplitMethod } from "@/lib/imports/landedCost";
import type { ImportLookups } from "../actions/imports";
import type { PlausibilityWarning } from "../lib/landedChecks";
import type { CostPaymentState, CostPaymentStatus } from "../lib/costPayments";
import { newCost, newRowKey, suggestedVat, type CostLineDraft, type ShipmentDraft } from "../lib/shipment";
import { costTypeLabel } from "./LandedCostPanel";
import { ManualSplitDrawer } from "./ManualSplitDrawer";

/** The chip of a cost's payment status (IMP-5). */
const STATUS_TONE: Record<CostPaymentStatus, ChipTone> = {
  estimate: "info",
  not_recorded: "neutral",
  debt: "warning",
  partial: "warning",
  paid: "success",
  nothing_due: "neutral",
};

/** IMP-5: payments and posting of the costs, from the form. */
export interface CostPaymentProps {
  /** The payment state of a cost (chip and "Pay"). */
  stateOf: (cost: CostLineDraft) => CostPaymentState;
  /** Why "Pay" is not offered yet, or null. */
  blockedOf: (cost: CostLineDraft) => "no_partner" | "save_first" | null;
  onPay: (cost: CostLineDraft) => void;
  /** The shipment is confirmed: stored costs are posted (read only); new ones are posted from the grid. */
  posted: boolean;
  /** Ids of the costs stored in the database. */
  storedIds: ReadonlySet<string>;
  /** Costs paid while a draft: amount, currency, rate, VAT, flag and partner are locked. */
  lockedIds: ReadonlySet<string>;
  /** After confirm: post a new cost (add_import_cost). */
  onPost?: (cost: CostLineDraft) => void;
  busyKey?: string | null;
}

/**
 * The costs of an import (IMP-4, behind UI_STANDARD) on the LineGrid: one compact line per cost,
 * type chip | description | paid to (supplier lookup with quick create) | amount | currency |
 * rate (other currencies, refresh inside) | VAT with the type's "18 %" suggestion | capitalized |
 * split method | estimate | allocated AZN | status | payment. "+ Add a cost" opens a menu of the
 * cost types. A cost that cannot be split (nothing to split by) shows the blocking message on its
 * row; a fallback (by weight → by value) and a plausibility warning show as amber.
 */
export function ImportCostsGrid({
  draft,
  setDraft,
  editable,
  config,
  lookups,
  result,
  plausibility,
  rateBusy,
  onFetchRate,
  onRemember,
  payments,
}: {
  draft: ShipmentDraft;
  setDraft: (update: (d: ShipmentDraft) => ShipmentDraft) => void;
  editable: boolean;
  config: ImportsConfig;
  lookups: ImportLookups;
  result: LandedCostResult;
  plausibility: readonly PlausibilityWarning[];
  rateBusy: string | null;
  onFetchRate: (cost: CostLineDraft) => void;
  onRemember: (patch: { supplier?: LookupRecord; account?: LookupRecord }) => void;
  /** IMP-5: payment status and "Pay" per cost (UI_STANDARD). */
  payments?: CostPaymentProps;
}) {
  const { t, locale } = useI18n();
  const [manualFor, setManualFor] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, locale, { currency: null });
  const setCost = (key: string, patch: Partial<CostLineDraft>) => setDraft((d) => ({ ...d, costs: d.costs.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const nameOf = (c: CostLineDraft, index: number) => c.description || `${costTypeLabel(c.costType, config, t)} ${index + 1}`;
  const issueText = (issue: LandedCostIssue, c: CostLineDraft, index: number) =>
    t(`imports.issues.${issue.code}`, { cost: nameOf(c, index), amount: issue.amount !== undefined ? money(issue.amount) : "" });

  const columns = useMemo<LineColumn<CostLineDraft>[]>(() => {
    const byId = new Map(result.costs.map((c) => [c.id, c]));
    const errorsOf = (key: string) => result.errors.filter((e) => e.costId === key);
    const warningsOf = (key: string) => result.warnings.filter((w) => w.costId === key);
    const index = (key: string) => draft.costs.findIndex((c) => c.key === key);
    const allocatedOf = (key: string) => Object.values(byId.get(key)?.allocations ?? {}).reduce((s, v) => s + v, 0);
    const currencyOptions = IMPORT_CURRENCIES.map((c) => ({ value: c, label: c }));
    return [
      {
        key: "type",
        header: t("imports.costFields.type"),
        type: "status",
        width: 148,
        cell: (c) => <Chip tone={c.costType === "customs_vat" ? "info" : "neutral"}>{costTypeLabel(c.costType, config, t)}</Chip>,
        total: <LineText>{t("imports.costsTotal", { count: draft.costs.length })}</LineText>,
      },
      {
        key: "description",
        header: t("imports.costFields.description"),
        type: "text",
        width: 160,
        cell: (c, ctx) => <LineTextCell ctx={ctx} maxLength={500} value={c.description} placeholder={t("imports.costFields.descriptionPlaceholder")} onChange={(v) => setCost(c.key, { description: v })} />,
      },
      {
        key: "partner",
        header: t("lookup.audit.paidTo"),
        hint: t("lookup.audit.paidToHint"),
        type: "text",
        width: 176,
        cell: (c, ctx) =>
          ctx.editable ? (
            <span className="ds-line-lookup">
              <EntityLookup
                entity="supplier"
                size="sm"
                width="full"
                value={c.partnerId}
                selectedLabel={lookups.suppliers.find((x) => x.id === c.partnerId)?.name}
                placeholder={t("imports.costFields.noPartner")}
                onChange={(id, row) => {
                  if (row) onRemember({ supplier: row });
                  setCost(c.key, { partnerId: id });
                }}
                aria-label={ctx.label}
              />
            </span>
          ) : (
            <LineText muted={!c.partnerId}>{lookups.suppliers.find((x) => x.id === c.partnerId)?.name ?? t("imports.costFields.noPartner")}</LineText>
          ),
      },
      {
        key: "amount",
        header: t("imports.costFields.amount"),
        type: "money",
        width: 104,
        cell: (c, ctx) =>
          c.splitMethod === "per_line_duty" ? (
            <span className="block" title={t("imports.costFields.computedDutyHint")}>
              <LineText muted>{money(byId.get(c.key)?.amountAzn ?? 0)}</LineText>
            </span>
          ) : (
            <LineNumberCell ctx={ctx} value={c.amount} onChange={(v) => setCost(c.key, { amount: v ?? 0 })} />
          ),
      },
      {
        key: "currency",
        header: t("imports.costFields.currency"),
        type: "code",
        width: 80,
        cell: (c, ctx) =>
          c.splitMethod === "per_line_duty" ? (
            <LineText muted>AZN</LineText>
          ) : (
            <LineSelectCell
              ctx={ctx}
              value={c.currencyCode}
              options={currencyOptions}
              onChange={(next) => setCost(c.key, { currencyCode: next as ImportCurrency, ...(next === "AZN" ? { rateToAzn: 1 } : {}) })}
            />
          ),
      },
      {
        key: "rate",
        header: t("imports.costFields.rate"),
        type: "number",
        width: 112,
        warning: (c) => (plausibility.some((p) => p.code === "rate_off_cbar" && p.costId === c.key) ? t("imports.plausibility.rate_off_cbar") : null),
        cell: (c, ctx) =>
          c.currencyCode === "AZN" || c.splitMethod === "per_line_duty" ? (
            <LineText muted>—</LineText>
          ) : (
            <span className="ds-rate-field">
              <LineNumberCell ctx={ctx} value={c.rateToAzn} onChange={(v) => setCost(c.key, { rateToAzn: v ?? 0 })} />
              {ctx.editable ? (
                <IconButton
                  size="sm"
                  label={`${t("imports.rates.fetch")}: ${nameOf(c, index(c.key))}`}
                  icon={<RefreshCw className={`h-3.5 w-3.5 ${rateBusy === c.key ? "animate-spin motion-reduce:animate-none" : ""}`} />}
                  disabled={rateBusy !== null}
                  onClick={() => onFetchRate(c)}
                />
              ) : null}
            </span>
          ),
      },
      {
        key: "vat",
        header: t("imports.costFields.vat"),
        type: "money",
        width: 112,
        cell: (c, ctx) => {
          if (c.costType === "customs_vat") {
            return (
              <span className="block" title={t("imports.costFields.customsVatHint")}>
                <LineText muted>{t("imports.costFields.toVatAccount")}</LineText>
              </span>
            );
          }
          if (c.splitMethod === "per_line_duty") return <LineText muted>—</LineText>;
          const rate = config.costTypes[c.costType].defaultVatRatePct;
          return (
            <span className="ds-rate-field">
              <LineNumberCell ctx={ctx} value={c.vatAmountAzn} onChange={(v) => setCost(c.key, { vatAmountAzn: v ?? 0 })} />
              {ctx.editable && rate > 0 ? (
                <IconButton
                  size="sm"
                  label={t("imports.costFields.vatSuggestLabel", { rate })}
                  icon={<Percent className="h-3.5 w-3.5" />}
                  onClick={() => setCost(c.key, { vatAmountAzn: suggestedVat(c, config) })}
                />
              ) : null}
            </span>
          );
        },
      },
      {
        key: "capitalized",
        header: t("imports.costFields.capitalizedShort"),
        hint: t("imports.costFields.capitalized"),
        type: "status",
        width: 88,
        cell: (c, ctx) =>
          c.costType === "customs_vat" ? (
            <LineText muted>—</LineText>
          ) : (
            <label className="flex h-full items-center justify-center">
              <input
                type="checkbox"
                className="ds-grid-checkbox"
                checked={c.isCapitalized}
                disabled={!ctx.editable}
                aria-label={`${t("imports.costFields.capitalized")}: ${nameOf(c, ctx.index)}`}
                onChange={(e) => setCost(c.key, { isCapitalized: e.target.checked })}
              />
            </label>
          ),
      },
      {
        key: "method",
        header: t("imports.costFields.method"),
        type: "text",
        width: 168,
        error: (c) => (methodsFor(c.costType).includes(c.splitMethod) ? null : t("imports.draftIssues.cost_method")),
        cell: (c, ctx) =>
          c.costType === "customs_vat" ? (
            <LineText muted>{t("imports.costFields.notSplit")}</LineText>
          ) : (
            <LineSelectCell
              ctx={payments?.lockedIds.has(c.key) && editable && !payments.posted ? { ...ctx, editable: true } : ctx}
              value={c.splitMethod}
              disabled={!c.isCapitalized}
              options={methodsFor(c.costType).map((m) => ({ value: m, label: t(`imports.methods.${m}`) }))}
              onChange={(next) => setCost(c.key, { splitMethod: next as SplitMethod })}
            />
          ),
      },
      {
        key: "estimate",
        header: t("imports.costFields.estimate"),
        type: "status",
        width: 80,
        cell: (c, ctx) => (
          <label className="flex h-full items-center justify-center">
            <input
              type="checkbox"
              className="ds-grid-checkbox"
              checked={c.isEstimate}
              disabled={!ctx.editable}
              aria-label={`${t("imports.costFields.estimate")}: ${nameOf(c, ctx.index)}`}
              onChange={(e) => setCost(c.key, { isEstimate: e.target.checked })}
            />
          </label>
        ),
      },
      {
        key: "allocated",
        header: t("imports.costFields.allocated"),
        type: "money",
        width: 112,
        error: (c) => {
          const e = errorsOf(c.key)[0];
          return e ? issueText(e, c, index(c.key)) : null;
        },
        warning: (c) => {
          const w = warningsOf(c.key)[0];
          if (w) return issueText(w, c, index(c.key));
          return plausibility.some((p) => p.code === "cost_over_goods" && p.costId === c.key) ? t("imports.plausibility.cost_over_goods") : null;
        },
        cell: (c) => {
          const r = byId.get(c.key);
          if (!r?.capitalized) return <LineText muted>—</LineText>;
          return <LineText>{money(allocatedOf(c.key))}</LineText>;
        },
        total: <LineText>{money(result.totals.capitalizedAzn)}</LineText>,
      },
      {
        key: "status",
        header: t("imports.costFields.status"),
        type: "status",
        width: 120,
        cell: (c) => {
          if (!payments) return <LineText muted>—</LineText>;
          if (payments.posted && !payments.storedIds.has(c.key)) return <Chip tone="neutral">{t("imports.costPay.status.not_recorded")}</Chip>;
          const st = payments.stateOf(c);
          const label =
            st.status === "debt"
              ? t("imports.costPay.debt", { amount: formatMoney(st.openAzn, locale, { currency: "AZN" }) })
              : t(`imports.costPay.status.${st.status}`);
          return <Chip tone={STATUS_TONE[st.status]}>{label}</Chip>;
        },
      },
      {
        key: "payment",
        header: t("imports.costFields.payment"),
        type: "text",
        width: 150,
        // IMP-5: "Pay" opens the one payment dialog; after confirm a new cost is posted first.
        cell: (c) => {
          if (!payments) return <LineText muted>—</LineText>;
          if (payments.posted && !payments.storedIds.has(c.key)) {
            return (
              <button
                type="button"
                className="ds-btn ds-btn-sm ds-btn-primary"
                disabled={!!payments.busyKey || !(c.amount > 0 || c.splitMethod === "per_line_duty")}
                onClick={() => payments.onPost?.(c)}
                data-line-focus=""
              >
                {payments.busyKey === c.key ? t("common.saving") : t("imports.costPay.post")}
              </button>
            );
          }
          const st = payments.stateOf(c);
          if (!st.mode) {
            return <LineText muted>{st.paidFc > 0 ? formatMoney(st.paidFc, locale, { currency: st.currency }) : "—"}</LineText>;
          }
          const blocked = payments.blockedOf(c);
          return (
            <span className="flex h-full min-w-0 items-center gap-1.5" title={blocked ? t(`imports.costPay.blocked.${blocked}`) : undefined}>
              <button type="button" className="ds-btn ds-btn-sm" disabled={!!blocked || !!payments.busyKey} onClick={() => payments.onPay(c)} data-line-focus="">
                {t("imports.costPay.pay")}
              </button>
              {st.paidFc > 0 ? <LineText muted>{formatMoney(st.paidFc, locale, { currency: st.currency })}</LineText> : null}
            </span>
          );
        },
      },
    ];
    // Rebuilt with the draft and the live result; the helpers only close over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.costs, result, plausibility, rateBusy, lookups.suppliers, lookups.accounts, config, t, locale, payments]);

  const blocking = result.errors.filter((e) => e.code === "zero_basis" || e.code === "manual_mismatch");
  const manualCost = manualFor ? draft.costs.find((c) => c.key === manualFor) ?? null : null;

  return (
    <div className="flex flex-col gap-2">
      <LineGrid
        id="imports-costs"
        label={t("imports.sections.costs")}
        lines={draft.costs}
        lineKey={(c) => c.key}
        lineLabel={(c, i) => nameOf(c, i)}
        columns={columns}
        labels={{ ...lineGridLabels(t), addLine: t("imports.addCost"), empty: t("imports.noCosts") }}
        editable={editable}
        addMenu={COST_TYPES.map((c) => ({ key: c, label: costTypeLabel(c, config, t) }))}
        onAddFrom={(type) => setDraft((d) => ({ ...d, costs: [...d.costs, newCost(type as CostType, config)] }))}
        rowEditable={(c) => (payments ? (payments.posted ? !payments.storedIds.has(c.key) : !payments.lockedIds.has(c.key)) : true)}
        rowMenuItems={(c) =>
          c.splitMethod === "manual" && c.isCapitalized && draft.lines.length
            ? [{ key: "manual", label: t("imports.manual.open"), icon: <SplitSquareHorizontal className="h-4 w-4" aria-hidden />, onSelect: () => setManualFor(c.key) }]
            : []
        }
        onRemove={(index) => setDraft((d) => ({ ...d, costs: d.costs.filter((_, i) => i !== index) }))}
        onDuplicate={(index) => setDraft((d) => ({ ...d, costs: d.costs.flatMap((c, i) => (i === index ? [c, { ...c, key: newRowKey("c"), paidNow: false, cashAccountId: null }] : [c])) }))}
      />
      {blocking.length ? (
        <ul className="flex flex-col gap-1 text-[length:var(--ds-text-xs)]" role="alert">
          {blocking.map((e) => {
            const i = draft.costs.findIndex((c) => c.key === e.costId);
            const c = draft.costs[i];
            if (!c) return null;
            return (
              <li key={`${e.code}-${e.costId}`} style={{ color: "var(--ds-danger-strong)" }}>
                <strong>{nameOf(c, i)}:</strong> {e.code === "zero_basis" ? t("imports.draftIssues.cost_unallocated") : issueText(e, c, i)}
              </li>
            );
          })}
        </ul>
      ) : null}
      {manualCost ? (
        <ManualSplitDrawer
          cost={manualCost}
          draft={draft}
          amountAzn={round2(manualCost.amount * (manualCost.currencyCode === "AZN" ? 1 : manualCost.rateToAzn))}
          editable={editable}
          lineName={(key) => {
            const l = draft.lines.find((x) => x.key === key);
            const p = l ? lookups.products.find((x) => x.id === l.productId) : undefined;
            return p ? `${p.code} · ${p.name}` : "";
          }}
          onClose={() => setManualFor(null)}
          onApply={(manual) => {
            setCost(manualCost.key, { manual });
            setManualFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
