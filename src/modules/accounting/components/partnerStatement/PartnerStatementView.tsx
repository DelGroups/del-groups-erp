"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Chip, EmptyState, ErrorState, MoneyCell, type ChipTone } from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { useI18n } from "@/i18n/I18nProvider";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDate, formatMoney } from "@/lib/dates/localeDate";
import {
  hasForeignCurrency,
  sourceGroup,
  statementDocHref,
  statementStatus,
  visibleSubtotals,
  type PartnerStatement,
  type StatementLine,
  type StatementStatus,
} from "@/lib/reports/partnerStatement";

type Row = { kind: "opening" } | { kind: "line"; line: StatementLine; index: number };

const STATUS_TONE: Record<StatementStatus, ChipTone> = { debtor: "warning", creditor: "info", settled: "success" };

/** Translated message of an action error (an i18n key, or the server's own text). */
export function useStatementError(): (error: string) => string {
  const { t } = useI18n();
  return (error) => {
    const text = t(error);
    return text === error && error.startsWith("partnerStatement.") ? t("partnerStatement.errors.load") : text;
  };
}

/** The header card: who, terms, the period's numbers and the debtor / creditor / settled badge. */
export function StatementHeaderCard({ statement }: { statement: PartnerStatement }) {
  const { t, locale } = useI18n();
  const p = statement.partner;
  const status = statementStatus(statement.closingBalance);
  const money = (v: number) => formatMoney(v, locale, { currency: "AZN", decimals: 2 });
  const fact = (label: string, value: string) => (
    <div className="min-w-0">
      <dt className="ds-muted text-[length:var(--ds-text-xs)]">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
  return (
    <section aria-label={t("partnerStatement.headerLabel")} className="ds-card flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[length:var(--ds-text-lg)] font-semibold" title={p.name}>
            {p.name || "—"}
          </h2>
          {p.isDeleted ? <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("partnerStatement.deleted")}</p> : null}
        </div>
        <Chip tone={STATUS_TONE[status]}>{t(`partnerStatement.status.${status}`)}</Chip>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[length:var(--ds-text-sm)] sm:grid-cols-4">
        {fact(t("partnerStatement.voen"), p.voen || "—")}
        {fact(t("partnerStatement.phone"), p.phone || "—")}
        {fact(t("partnerStatement.creditLimit"), p.creditLimit > 0 ? money(p.creditLimit) : "—")}
        {fact(t("partnerStatement.paymentTerms"), p.paymentTermsDays === null ? "—" : t("partnerStatement.paymentTermsDays", { days: p.paymentTermsDays }))}
      </dl>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[color:var(--ds-border)] pt-3 sm:grid-cols-4">
        {[
          ["opening", statement.openingBalance],
          ["periodDebit", statement.periodDebit],
          ["periodCredit", statement.periodCredit],
          ["closing", statement.closingBalance],
        ].map(([key, value]) => (
          <div key={key as string} className="min-w-0">
            <dt className="ds-muted text-[length:var(--ds-text-xs)]">{t(`partnerStatement.${key}`)}</dt>
            <dd className={`ds-num tabular-nums ${key === "closing" ? "text-[length:var(--ds-text-lg)] font-semibold" : "font-medium"}`}>{money(value as number)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The statement lines: opening row first, totals row last (sticky), subtotals per currency under it. */
export function StatementGrid({ statement, loading, gridId }: { statement: PartnerStatement; loading?: boolean; gridId: string }) {
  const { t, locale } = useI18n();
  const foreign = hasForeignCurrency(statement.lines);
  const rows: Row[] = [{ kind: "opening" }, ...statement.lines.map((line, index) => ({ kind: "line" as const, line, index }))];
  const money = (v: number) => <MoneyCell value={v} locale={locale} currency={null} />;
  const optionalMoney = (v: number) => (v ? money(v) : <span className="ds-muted">—</span>);

  const columns: StandardColumn<Row>[] = [
    {
      key: "date",
      header: t("partnerStatement.cols.date"),
      type: "date",
      cell: (r) => (r.kind === "opening" ? (statement.from ? formatGridDate(statement.from) : "—") : formatGridDate(r.line.entryDate)),
    },
    {
      key: "type",
      header: t("partnerStatement.cols.type"),
      samples: [t("partnerStatement.source.sale"), t("partnerStatement.source.importPayment")],
      cell: (r) => (r.kind === "opening" ? <span className="font-semibold">{t("partnerStatement.openingRow")}</span> : t(`partnerStatement.source.${sourceGroup(r.line.sourceType)}`)),
    },
    {
      key: "docNo",
      header: t("partnerStatement.cols.docNo"),
      type: "code",
      // Full numbers such as "SS-2026-00041" in the mono font (wider than the 136 px code default).
      width: 168,
      cell: (r) => {
        if (r.kind === "opening" || !r.line.docNo) return "";
        const href = statementDocHref(r.line);
        return href ? (
          <Link href={href} className="ds-mono hover:underline" style={{ color: "var(--ds-brand)" }} aria-label={t("partnerStatement.openDocument", { no: r.line.docNo })}>
            {r.line.docNo}
          </Link>
        ) : (
          <span className="ds-mono">{r.line.docNo}</span>
        );
      },
    },
    { key: "description", header: t("partnerStatement.cols.description"), cell: (r) => (r.kind === "opening" ? "" : r.line.description) },
    { key: "debit", header: t("partnerStatement.cols.debit"), type: "money", cell: (r) => (r.kind === "opening" ? "" : optionalMoney(r.line.debit)) },
    { key: "credit", header: t("partnerStatement.cols.credit"), type: "money", cell: (r) => (r.kind === "opening" ? "" : optionalMoney(r.line.credit)) },
    {
      key: "balance",
      header: t("partnerStatement.cols.balance"),
      type: "money",
      className: "font-semibold",
      cell: (r) => money(r.kind === "opening" ? statement.openingBalance : r.line.balance),
    },
    ...(foreign
      ? ([
          { key: "currency", header: t("partnerStatement.cols.currency"), samples: ["USD"], cell: (r: Row) => (r.kind === "opening" ? "" : r.line.currencyCode) },
          {
            key: "amountFc",
            header: t("partnerStatement.cols.amountFc"),
            type: "money",
            cell: (r: Row) => (r.kind === "opening" || r.line.currencyCode === "AZN" ? "" : money(r.line.amountFc)),
          },
        ] as StandardColumn<Row>[])
      : []),
    { key: "createdBy", header: t("partnerStatement.cols.createdBy"), cell: (r) => (r.kind === "opening" ? "" : r.line.createdByName || "—") },
  ];

  const subtotals = visibleSubtotals(statement);
  return (
    <div className="flex flex-col gap-3">
      <StandardGrid<Row>
        id={gridId}
        label={t("partnerStatement.gridLabel", { name: statement.partner.name })}
        rows={rows}
        rowKey={(r) => (r.kind === "opening" ? "opening" : `${r.index}-${r.line.sourceType}-${r.line.sourceId}`)}
        columns={columns}
        loading={loading}
        defaultDensity="compact"
        empty={t("partnerStatement.noLines")}
        totals={{
          debit: money(statement.periodDebit),
          credit: money(statement.periodCredit),
          balance: money(statement.closingBalance),
        }}
      />
      {statement.lines.length === 0 && !loading ? <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("partnerStatement.noLines")}</p> : null}
      {subtotals.length ? (
        <section aria-label={t("partnerStatement.subtotals")} className="ds-card p-4">
          <h3 className="mb-2 text-[length:var(--ds-text-sm)] font-semibold">{t("partnerStatement.subtotals")}</h3>
          <ul className="flex flex-col gap-2 text-[length:var(--ds-text-sm)]">
            {subtotals.map((s) => (
              <li key={s.currencyCode} className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-[color:var(--ds-border)] pt-2 sm:grid-cols-4">
                <span className="font-medium">{s.currencyCode}</span>
                <span className="tabular-nums sm:text-end">
                  <span className="ds-muted">{t("partnerStatement.cols.debit")}: </span>
                  {formatMoney(s.debit, locale, { currency: "AZN" })}
                </span>
                <span className="tabular-nums sm:text-end">
                  <span className="ds-muted">{t("partnerStatement.cols.credit")}: </span>
                  {formatMoney(s.credit, locale, { currency: "AZN" })}
                </span>
                <span className="tabular-nums sm:text-end">
                  <span className="ds-muted">{t("partnerStatement.cols.amountFc")}: </span>
                  {formatMoney(s.netFc, locale, { currency: s.currencyCode })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Empty (no partner chosen) and error states of the statement. */
export function StatementEmpty() {
  const { t } = useI18n();
  return <EmptyState icon={FileText} title={t("partnerStatement.emptyTitle")} description={t("partnerStatement.emptyBody")} />;
}

export function StatementError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  const states = stateLabels(t);
  return <ErrorState title={states.errorTitle} description={message} retryLabel={states.retry} onRetry={onRetry} />;
}
