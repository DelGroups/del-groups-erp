"use client";

import { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PaymentFormModal from "@/components/payments/PaymentFormModal";
import { fetchPartnerPayments } from "@/lib/payments/fetchPayments";
import type { PartnerPaymentRecord } from "@/lib/payments/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Plus, RefreshCw, Search, Wallet } from "lucide-react";

function formatMoney(value: number): string {
  return `${value.toFixed(2)} AZN`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function PaymentsPageClient() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_finance");

  const [rows, setRows] = useState<PartnerPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await fetchPartnerPayments();
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.partner_name, row.reference_note, row.cash_account_name, row.payment_type, row.payment_method]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [rows, search]);

  return (
    <PageLayout>
      <header className="app-glass flex flex-wrap items-center justify-between gap-4 border-b border-app px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-app">
            <Wallet className="h-6 w-6 text-app-accent" />
            {t("payments.pageTitle")}
          </h2>
          <p className="text-sm text-app-muted">{t("payments.pageDescription")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <button type="button" onClick={() => setFormOpen(true)} className="btn-primary">
              <Plus className="h-4 w-4" />
              {t("payments.newPayment")}
            </button>
          ) : null}
          <button type="button" onClick={() => void load()} className="btn-secondary">
            <RefreshCw className="h-4 w-4" />
            {t("common.refresh")}
          </button>
        </div>
      </header>

      <div className="space-y-4 p-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.search")}
            className="app-input w-full pl-9"
          />
        </div>

        <div className="app-card overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-app-card-hover text-xs font-bold uppercase text-app-muted">
              <tr>
                <th className="p-3">{t("common.date")}</th>
                <th className="p-3">{t("payments.partner")}</th>
                <th className="p-3">{t("payments.type")}</th>
                <th className="p-3">{t("payments.method")}</th>
                <th className="p-3 text-right">{t("payments.amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-app-muted">{t("common.loading")}</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-app-muted">{t("payments.empty")}</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-app-card-hover/60">
                    <td className="p-3">{formatDate(row.payment_date)}</td>
                    <td className="p-3 font-semibold">{row.partner_name}</td>
                    <td className="p-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          row.payment_type === "in"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {row.payment_type === "in" ? t("payments.typeIn") : t("payments.typeOut")}
                      </span>
                    </td>
                    <td className="p-3">
                      {row.payment_method === "bank" ? t("payments.methodBank") : t("payments.methodCash")}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">{formatMoney(row.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaymentFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
      />
    </PageLayout>
  );
}
