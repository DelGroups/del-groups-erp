"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { formatGridDate, formatMoney } from "@/lib/dates/localeDate";
import { hasForeignCurrency, sourceGroup, statementStatus, visibleSubtotals, type PartnerStatement } from "@/lib/reports/partnerStatement";

/**
 * The statement on paper (print, or "Save as PDF" in the print dialog): the company letterhead,
 * the partner, the period, the lines with the opening row first and the totals row last, and the
 * signature block of the reconciliation act (PartnerReconciliationDocument). Only `.print-area`
 * prints (globals.css), so the page around it stays off the paper.
 */
export default function StatementPrintLayout({ statement }: { statement: PartnerStatement }) {
  const { t, locale } = useI18n();
  // Table cells: figures only (the columns are AZN; a foreign amount names its currency).
  const fig = (v: number, currency: string | null = null) => (v === 0 ? "—" : formatMoney(v, locale, { currency, decimals: 2 }));
  const azn = (v: number) => formatMoney(v, locale, { currency: "AZN", decimals: 2 });
  const company = useCompanyProfile();
  const c = company.profile;
  const s = statement;
  const foreign = hasForeignCurrency(s.lines);
  const subtotals = visibleSubtotals(s);
  const period = `${s.from ? formatGridDate(s.from) : t("partnerStatement.allTime")} — ${formatGridDate(s.to)}`;
  const cols = 7 + (foreign ? 2 : 0);

  return (
    <div className="print-area hidden bg-white text-slate-900 print:block">
      <div className="mx-auto max-w-[190mm] p-0 text-[11px] leading-snug">
        {/* A div, not <header>: the print CSS hides every <header> of the page around it. */}
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
          <div>
            <p className="text-[14px] font-bold">{company.legalName}</p>
            {c.voen ? <p>{t("partnerStatement.voen")}: {c.voen}</p> : null}
            {c.address ? <p>{c.address}</p> : null}
            {c.phone ? <p>{c.phone}</p> : null}
          </div>
          {c.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logoUrl} alt="" className="max-h-14 max-w-[45mm] object-contain" />
          ) : null}
        </div>

        <h1 className="mb-1 text-center text-[15px] font-bold">{t("nav.items.partnerStatement")}</h1>
        <p className="mb-4 text-center text-slate-600">
          {t("partnerStatement.period")}: {period}
          {s.side !== "net" ? ` · ${t(`partnerStatement.sides.${s.side}`)}` : ""}
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded border border-slate-200 p-2">
            <p className="text-[10px] text-slate-500">{t("partnerStatement.partner")}</p>
            <p className="font-semibold">{s.partner.name}</p>
            {s.partner.voen ? <p>{t("partnerStatement.voen")}: {s.partner.voen}</p> : null}
            {s.partner.phone ? <p>{t("partnerStatement.phone")}: {s.partner.phone}</p> : null}
          </div>
          <div className="rounded border border-slate-200 p-2">
            <p>
              {t("partnerStatement.opening")}: <b>{azn(s.openingBalance)}</b>
            </p>
            <p>
              {t("partnerStatement.periodDebit")}: {azn(s.periodDebit)}
            </p>
            <p>
              {t("partnerStatement.periodCredit")}: {azn(s.periodCredit)}
            </p>
            <p>
              {t("partnerStatement.closing")}: <b>{azn(s.closingBalance)}</b> ({t(`partnerStatement.status.${statementStatus(s.closingBalance)}`)})
            </p>
          </div>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-300 bg-slate-100">
              <th className="p-1 text-left">{t("partnerStatement.cols.date")}</th>
              <th className="p-1 text-left">{t("partnerStatement.cols.type")}</th>
              <th className="p-1 text-left">{t("partnerStatement.cols.docNo")}</th>
              <th className="p-1 text-left">{t("partnerStatement.cols.description")}</th>
              <th className="p-1 text-right">{t("partnerStatement.cols.debit")}</th>
              <th className="p-1 text-right">{t("partnerStatement.cols.credit")}</th>
              <th className="p-1 text-right">{t("partnerStatement.cols.balance")}</th>
              {foreign ? <th className="p-1 text-left">{t("partnerStatement.cols.currency")}</th> : null}
              {foreign ? <th className="p-1 text-right">{t("partnerStatement.cols.amountFc")}</th> : null}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200 font-semibold">
              <td className="p-1">{s.from ? formatGridDate(s.from) : ""}</td>
              <td className="p-1" colSpan={5}>
                {t("partnerStatement.openingRow")}
              </td>
              <td className="p-1 text-right tabular-nums">{fig(s.openingBalance)}</td>
              {foreign ? <td colSpan={2} /> : null}
            </tr>
            {s.lines.map((l, i) => (
              <tr key={`${i}-${l.sourceId}`} className="border-b border-slate-200 [break-inside:avoid]">
                <td className="p-1">{formatGridDate(l.entryDate)}</td>
                <td className="p-1">{t(`partnerStatement.source.${sourceGroup(l.sourceType)}`)}</td>
                <td className="p-1 font-mono">{l.docNo}</td>
                <td className="p-1">{l.description}</td>
                <td className="p-1 text-right tabular-nums">{fig(l.debit)}</td>
                <td className="p-1 text-right tabular-nums">{fig(l.credit)}</td>
                <td className="p-1 text-right tabular-nums">{fig(l.balance)}</td>
                {foreign ? <td className="p-1">{l.currencyCode}</td> : null}
                {foreign ? <td className="p-1 text-right tabular-nums">{l.currencyCode === "AZN" ? "" : fig(l.amountFc)}</td> : null}
              </tr>
            ))}
            {s.lines.length === 0 ? (
              <tr>
                <td colSpan={cols} className="p-3 text-center text-slate-500">
                  {t("partnerStatement.noLines")}
                </td>
              </tr>
            ) : null}
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="p-1" colSpan={4}>
                {t("partnerStatement.totalsRow")}
              </td>
              <td className="p-1 text-right tabular-nums">{fig(s.periodDebit)}</td>
              <td className="p-1 text-right tabular-nums">{fig(s.periodCredit)}</td>
              <td className="p-1 text-right tabular-nums">{fig(s.closingBalance)}</td>
              {foreign ? <td colSpan={2} /> : null}
            </tr>
          </tbody>
        </table>

        {subtotals.length ? (
          <table className="mt-3 w-1/2 border-collapse">
            <caption className="mb-1 text-left font-semibold">{t("partnerStatement.subtotals")}</caption>
            <tbody>
              {subtotals.map((st) => (
                <tr key={st.currencyCode} className="border-b border-slate-200">
                  <td className="p-1">{st.currencyCode}</td>
                  <td className="p-1 text-right tabular-nums">{fig(st.debit)}</td>
                  <td className="p-1 text-right tabular-nums">{fig(st.credit)}</td>
                  <td className="p-1 text-right tabular-nums">{fig(st.netFc, st.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <footer className="mt-12 grid grid-cols-2 gap-8 [break-inside:avoid]">
          <div>
            <p className="text-[10px] font-bold text-slate-500">{t("reconciliation.partyA")}</p>
            <p className="mt-1">{company.legalName}</p>
            <div className="mt-10 border-t border-slate-400 pt-1 text-[10px] text-slate-500">{t("reconciliation.signLine")}</div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500">{t("reconciliation.partyB")}</p>
            <p className="mt-1">{s.partner.name}</p>
            <div className="mt-10 border-t border-slate-400 pt-1 text-[10px] text-slate-500">{t("reconciliation.signLine")}</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
