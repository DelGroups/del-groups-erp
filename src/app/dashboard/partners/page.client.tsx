"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import { fetchPartnersWithBalances, partnerDisplayName } from "@/lib/partners/fetchPartners";
import type { PartnerNetBalance, PartnerRecord } from "@/lib/partners/types";
import { useI18n } from "@/i18n/I18nProvider";
import { RefreshCw, Search, Users } from "lucide-react";

type PartnerRow = PartnerRecord & { balance: PartnerNetBalance };

function formatMoney(value: number, currency = "AZN"): string {
  return `${value.toFixed(2)} ${currency}`;
}

function balanceBadgeClass(netBalance: number): string {
  if (netBalance > 0.009) return "bg-emerald-100 text-emerald-800";
  if (netBalance < -0.009) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export default function PartnersPageClient() {
  const { t } = useI18n();
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const data = await fetchPartnersWithBalances();
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.name,
        row.full_name,
        row.company_name,
        row.phone,
        row.voen,
        row.code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [rows, search]);

  return (
    <PageLayout>
      <header className="app-glass flex flex-wrap items-center justify-between gap-4 border-b border-app px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-app">
            <Users className="h-6 w-6 text-app-accent" />
            {t("partners.pageTitle")}
          </h2>
          <p className="text-sm text-app-muted">{t("partners.pageDescription")}</p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-secondary">
          <RefreshCw className="h-4 w-4" />
          {t("common.refresh")}
        </button>
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
                <th className="p-3">{t("partners.name")}</th>
                <th className="p-3">{t("partners.roles")}</th>
                <th className="p-3">{t("partners.contact")}</th>
                <th className="p-3 text-right">{t("partners.netBalance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app">
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-app-muted">{t("common.loading")}</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-app-muted">{t("partners.empty")}</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-app-card-hover/60">
                    <td className="p-3">
                      <Link
                        href={`/dashboard/partners/${row.id}`}
                        className="font-semibold text-app-accent hover:underline"
                      >
                        {partnerDisplayName(row)}
                      </Link>
                      {row.code ? <p className="font-mono text-xs text-app-muted">{row.code}</p> : null}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {row.is_customer ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-800">
                            {t("partners.customer")}
                          </span>
                        ) : null}
                        {row.is_supplier ? (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-800">
                            {t("partners.supplier")}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-app-muted">
                      <p>{row.phone || "—"}</p>
                      <p>{row.voen ? `VOEN: ${row.voen}` : ""}</p>
                    </td>
                    <td className="p-3 text-right">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${balanceBadgeClass(row.balance.netBalance)}`}
                      >
                        {formatMoney(row.balance.netBalance)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageLayout>
  );
}
