"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import {
  fetchPartnerDashboard,
  partnerDisplayName,
} from "@/lib/partners/fetchPartners";
import type { PartnerDashboardData } from "@/lib/partners/types";
import { isCreditLimitExceeded } from "@/lib/partners/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useUiStandard } from "@/design-system/components";
import { StandardGrid } from "@/components/lists/StandardGrid";
import { formatGridDate } from "@/lib/dates/localeDate";
import PaymentFormModal from "@/components/payments/PaymentFormModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { AlertTriangle, ArrowLeft, Building2, CreditCard, FileCheck2, Landmark, Phone, RefreshCw, Wallet } from "lucide-react";

type TabKey = "sales" | "purchases" | "ledger";

function formatMoney(value: number): string {
  return `${value.toFixed(2)} AZN`;
}

function balanceLabel(netBalance: number, t: (key: string) => string): string {
  if (netBalance > 0.009) return t("partners.balanceReceivable");
  if (netBalance < -0.009) return t("partners.balancePayable");
  return t("partners.balanceSettled");
}

function balanceBadgeClass(netBalance: number): string {
  if (netBalance > 0.009) return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (netBalance < -0.009) return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-slate-300 bg-slate-50 text-slate-800";
}

export default function PartnerDetailPageClient() {
  const params = useParams<{ id: string }>();
  const partnerId = params?.id || "";
  const { t } = useI18n();
  // UI_STANDARD (UI-6): sales, purchases and the ledger on the grid; old tables with the flag off.
  const standard = useUiStandard();
  const { can } = useAuth();
  const canManageFinance = can("can_manage_finance");
  const [data, setData] = useState<PartnerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("sales");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<"in" | "out">("in");

  const load = useCallback(async () => {
    if (!partnerId) return;
    setLoading(true);
    const result = await fetchPartnerDashboard(partnerId);
    setData(result);
    setLoading(false);
  }, [partnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const partner = data?.partner;
  const balance = data?.balance;
  const creditExceeded =
    partner && balance ? isCreditLimitExceeded(partner, balance) : false;

  return (
    <PageLayout>
      <header className="app-glass border-b border-app px-6 py-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/partners" className="btn-secondary inline-flex">
            <ArrowLeft className="h-4 w-4" />
            {t("partners.backToList")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {can("can_view_financial_reports") ? (
              <Link
                href={`/dashboard/reports/reconciliation?partnerId=${partnerId}`}
                className="btn-secondary inline-flex"
              >
                <FileCheck2 className="h-4 w-4" />
                {t("reconciliation.exportFromPartner")}
              </Link>
            ) : null}
            {canManageFinance ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentType("in");
                    setPaymentOpen(true);
                  }}
                  className="btn-primary"
                >
                  <Wallet className="h-4 w-4" />
                  {t("payments.receivePayment")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentType("out");
                    setPaymentOpen(true);
                  }}
                  className="btn-secondary"
                >
                  <Wallet className="h-4 w-4" />
                  {t("payments.payPartner")}
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => void load()} className="btn-secondary">
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {loading || !partner || !balance ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-app">{partnerDisplayName(partner)}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {partner.is_customer ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 font-bold text-sky-800">
                    {t("partners.customer")}
                  </span>
                ) : null}
                {partner.is_supplier ? (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 font-bold text-violet-800">
                    {t("partners.supplier")}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 space-y-1 text-sm text-app-muted">
                {partner.phone ? (
                  <p className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {partner.phone}
                  </p>
                ) : null}
                {partner.address ? (
                  <p className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {partner.address}
                  </p>
                ) : null}
                {partner.voen ? <p>{t("partners.voen")}: {partner.voen}</p> : null}
                {partner.email ? <p>{t("partners.email")}: {partner.email}</p> : null}
                {partner.bank_name ? (
                  <p className="flex items-center gap-2">
                    <Landmark className="h-4 w-4" />
                    {partner.bank_name}
                  </p>
                ) : null}
                {partner.iban ? (
                  <p className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    {partner.iban}
                  </p>
                ) : null}
                {partner.credit_limit > 0 ? (
                  <p>{t("partners.creditLimit")}: {formatMoney(partner.credit_limit)}</p>
                ) : null}
              </div>
            </div>

            <div
              className={`rounded-2xl border px-5 py-4 text-right ${
                creditExceeded
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : balanceBadgeClass(balance.netBalance)
              }`}
            >
              {creditExceeded ? (
                <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                  <AlertTriangle className="h-3 w-3" />
                  {t("partners.creditLimitExceeded")}
                </span>
              ) : null}
              <p className="text-xs font-bold uppercase tracking-wide">{balanceLabel(balance.netBalance, t)}</p>
              <p className={`mt-1 text-3xl font-black ${creditExceeded ? "text-rose-700" : ""}`}>
                {formatMoney(balance.netBalance)}
              </p>
              <p className="mt-2 text-xs">
                {t("partners.receivables")}: {formatMoney(balance.receivables)}
              </p>
              <p className="text-xs">
                {t("partners.payables")}: {formatMoney(balance.payables)}
              </p>
            </div>
          </div>
        )}
      </header>

      <div className="p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          {(["sales", "purchases", "ledger"] as TabKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={tab === key ? "btn-primary" : "btn-secondary"}
            >
              {t(`partners.tabs.${key}`)}
            </button>
          ))}
        </div>

        {!data ? (
          <div className="app-card p-8 text-center text-sm text-app-muted">{t("partners.notFound")}</div>
        ) : standard && tab === "sales" ? (
          <StandardGrid<PartnerDashboardData["sales"][number]>
            id="partners.detail.sales"
            label={t("partners.tabs.sales")}
            rows={data.sales}
            rowKey={(sale) => sale.id}
            rowHref={(sale) => `/sales/${sale.id}`}
            empty={t("partners.noSales")}
            columns={[
              { key: "docNo", header: t("partners.documentNo"), type: "code", cell: (sale) => <span className="ds-mono">{sale.doc_no || "—"}</span>, sortValue: (sale) => sale.doc_no },
              { key: "date", header: t("common.date"), type: "date", cell: (sale) => formatGridDate(sale.doc_date), sortValue: (sale) => sale.doc_date },
              { key: "total", header: t("partners.total"), type: "money", cell: (sale) => formatMoney(sale.total_amount), sortValue: (sale) => sale.total_amount },
              { key: "remaining", header: t("partners.remaining"), type: "money", className: "font-semibold", cell: (sale) => formatMoney(sale.remaining_balance), sortValue: (sale) => sale.remaining_balance },
            ]}
          />
        ) : standard && tab === "purchases" ? (
          <StandardGrid<PartnerDashboardData["purchases"][number]>
            id="partners.detail.purchases"
            label={t("partners.tabs.purchases")}
            rows={data.purchases}
            rowKey={(purchase) => purchase.id}
            empty={t("partners.noPurchases")}
            columns={[
              { key: "docNo", header: t("partners.documentNo"), type: "code", cell: (purchase) => <span className="ds-mono">{purchase.invoice_number || "—"}</span>, sortValue: (purchase) => purchase.invoice_number },
              { key: "date", header: t("common.date"), type: "date", cell: (purchase) => formatGridDate(purchase.doc_date), sortValue: (purchase) => purchase.doc_date },
              { key: "total", header: t("partners.total"), type: "money", cell: (purchase) => formatMoney(purchase.total_amount), sortValue: (purchase) => purchase.total_amount },
              { key: "debt", header: t("partners.debt"), type: "money", className: "font-semibold", cell: (purchase) => formatMoney(purchase.debt_amount), sortValue: (purchase) => purchase.debt_amount },
            ]}
          />
        ) : standard ? (
          <StandardGrid<PartnerDashboardData["ledger"][number]>
            id="partners.detail.ledger"
            label={t("partners.tabs.ledger")}
            rows={data.ledger}
            rowKey={(entry) => `${entry.type}-${entry.id}`}
            empty={t("partners.noLedger")}
            columns={[
              { key: "date", header: t("common.date"), type: "date", cell: (entry) => formatGridDate(entry.date), sortValue: (entry) => entry.date },
              { key: "type", header: t("partners.type"), cell: (entry) => (entry.type === "sale" ? t("partners.saleType") : t("partners.purchaseType")), sortValue: (entry) => entry.type },
              { key: "docNo", header: t("partners.documentNo"), type: "code", cell: (entry) => <span className="ds-mono">{entry.documentNo}</span>, sortValue: (entry) => entry.documentNo },
              { key: "debit", header: t("partners.debit"), type: "money", cell: (entry) => (entry.debit > 0 ? formatMoney(entry.debit) : "—"), sortValue: (entry) => entry.debit },
              { key: "credit", header: t("partners.credit"), type: "money", cell: (entry) => (entry.credit > 0 ? formatMoney(entry.credit) : "—"), sortValue: (entry) => entry.credit },
              { key: "balance", header: t("partners.runningBalance"), type: "money", className: "font-semibold", cell: (entry) => formatMoney(entry.runningBalance) },
            ]}
          />
        ) : tab === "sales" ? (
          <div className="app-card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-app-card-hover text-xs font-bold uppercase text-app-muted">
                <tr>
                  <th className="p-3">{t("common.date")}</th>
                  <th className="p-3">{t("partners.documentNo")}</th>
                  <th className="p-3 text-right">{t("partners.total")}</th>
                  <th className="p-3 text-right">{t("partners.remaining")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {data.sales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-app-muted">{t("partners.noSales")}</td>
                  </tr>
                ) : (
                  data.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td className="p-3">{sale.doc_date || "—"}</td>
                      <td className="p-3 font-mono">{sale.doc_no || "—"}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(sale.total_amount)}</td>
                      <td className="p-3 text-right font-mono font-semibold">
                        {formatMoney(sale.remaining_balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : tab === "purchases" ? (
          <div className="app-card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-app-card-hover text-xs font-bold uppercase text-app-muted">
                <tr>
                  <th className="p-3">{t("common.date")}</th>
                  <th className="p-3">{t("partners.documentNo")}</th>
                  <th className="p-3 text-right">{t("partners.total")}</th>
                  <th className="p-3 text-right">{t("partners.debt")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {data.purchases.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-app-muted">{t("partners.noPurchases")}</td>
                  </tr>
                ) : (
                  data.purchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td className="p-3">{purchase.doc_date || "—"}</td>
                      <td className="p-3 font-mono">{purchase.invoice_number || "—"}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(purchase.total_amount)}</td>
                      <td className="p-3 text-right font-mono font-semibold">
                        {formatMoney(purchase.debt_amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="app-card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-app-card-hover text-xs font-bold uppercase text-app-muted">
                <tr>
                  <th className="p-3">{t("common.date")}</th>
                  <th className="p-3">{t("partners.type")}</th>
                  <th className="p-3">{t("partners.documentNo")}</th>
                  <th className="p-3 text-right">{t("partners.debit")}</th>
                  <th className="p-3 text-right">{t("partners.credit")}</th>
                  <th className="p-3 text-right">{t("partners.runningBalance")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {data.ledger.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-app-muted">{t("partners.noLedger")}</td>
                  </tr>
                ) : (
                  data.ledger.map((entry) => (
                    <tr key={`${entry.type}-${entry.id}`}>
                      <td className="p-3">{entry.date || "—"}</td>
                      <td className="p-3">
                        {entry.type === "sale" ? t("partners.saleType") : t("partners.purchaseType")}
                      </td>
                      <td className="p-3 font-mono">{entry.documentNo}</td>
                      <td className="p-3 text-right font-mono">
                        {entry.debit > 0 ? formatMoney(entry.debit) : "—"}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {entry.credit > 0 ? formatMoney(entry.credit) : "—"}
                      </td>
                      <td className="p-3 text-right font-mono font-semibold">
                        {formatMoney(entry.runningBalance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PaymentFormModal
        open={paymentOpen}
        defaultPartnerId={partnerId}
        defaultPaymentType={paymentType}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => void load()}
      />
    </PageLayout>
  );
}
