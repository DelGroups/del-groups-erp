"use client";

import type { PartnerReconciliationReport } from "@/lib/reports/partnerReconciliation";
import { formatReportMoney } from "@/lib/reports/formatMoney";
import { useI18n } from "@/i18n/I18nProvider";

type PartnerReconciliationDocumentProps = {
  data: PartnerReconciliationReport;
  loading?: boolean;
};

function docTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case "invoice":
      return t("reconciliation.docInvoice");
    case "bill":
      return t("reconciliation.docBill");
    case "payment_receipt":
      return t("reconciliation.docPaymentIn");
    case "payment_disbursement":
      return t("reconciliation.docPaymentOut");
    default:
      return type;
  }
}

export default function PartnerReconciliationDocument({
  data,
  loading,
}: PartnerReconciliationDocumentProps) {
  const { t } = useI18n();

  return (
    <div className="reconciliation-print mx-auto max-w-4xl rounded-2xl border border-app bg-white p-8 text-slate-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="mb-8 border-b border-slate-300 pb-6 text-center">
        <h1 className="text-lg font-bold uppercase tracking-wide">{t("reconciliation.documentTitle")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("reconciliation.period")}: {data.startDate} — {data.endDate}
        </p>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase text-slate-500">{t("reconciliation.ourCompany")}</p>
          <p className="mt-1 font-semibold">DEL GROUPS MMC</p>
          <div className="mt-8 h-16 border-t border-dashed border-slate-300 pt-2 text-[10px] text-slate-500">
            {t("reconciliation.signatureStamp")}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase text-slate-500">{t("reconciliation.partner")}</p>
          <p className="mt-1 font-semibold">{data.partnerName || "—"}</p>
          <div className="mt-8 h-16 border-t border-dashed border-slate-300 pt-2 text-[10px] text-slate-500">
            {t("reconciliation.signatureStamp")}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">{t("reconciliation.initialBalance")}: </span>
          <span className="font-mono font-bold">{formatReportMoney(data.initialBalance)}</span>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">{t("reconciliation.closingBalance")}: </span>
          <span className="font-mono font-bold">{formatReportMoney(data.closingBalance)}</span>
        </div>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100">
            <th className="p-2 text-left">{t("common.date")}</th>
            <th className="p-2 text-left">{t("reconciliation.colDocument")}</th>
            <th className="p-2 text-left">{t("reconciliation.colType")}</th>
            <th className="p-2 text-right">{t("reconciliation.colOurDebit")}</th>
            <th className="p-2 text-right">{t("reconciliation.colOurCredit")}</th>
            <th className="p-2 text-right">{t("reconciliation.colBalance")}</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} className="p-6 text-center text-slate-500">{t("common.loading")}</td>
            </tr>
          ) : data.lines.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-6 text-center text-slate-500">{t("reconciliation.empty")}</td>
            </tr>
          ) : (
            data.lines.map((line, idx) => (
              <tr key={`${line.entryDate}-${line.documentNo}-${idx}`} className="border-b border-slate-200">
                <td className="p-2">{line.entryDate}</td>
                <td className="p-2 font-mono">{line.documentNo}</td>
                <td className="p-2">{docTypeLabel(line.documentType, t)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(line.ourDebit)}</td>
                <td className="p-2 text-right font-mono tabular-nums">{formatReportMoney(line.ourCredit)}</td>
                <td className="p-2 text-right font-mono tabular-nums font-semibold">{formatReportMoney(line.runningBalance)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <footer className="mt-10 grid gap-8 sm:grid-cols-2 print:mt-16">
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">{t("reconciliation.partyA")}</p>
          <p className="mt-1 text-sm">DEL GROUPS MMC</p>
          <div className="mt-12 border-t border-slate-400 pt-1 text-[10px] text-slate-500">
            {t("reconciliation.signLine")}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">{t("reconciliation.partyB")}</p>
          <p className="mt-1 text-sm">{data.partnerName}</p>
          <div className="mt-12 border-t border-slate-400 pt-1 text-[10px] text-slate-500">
            {t("reconciliation.signLine")}
          </div>
        </div>
      </footer>
    </div>
  );
}
