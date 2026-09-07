"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  fetchLinkedDocuments,
  type Contract,
  type LinkedDocument,
} from "@/lib/contracts/api";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  contract: Contract;
  onClose: () => void;
}

export default function ContractLinkedInvoicesModal({ contract, onClose }: Props) {
  const { t, formatDate } = useI18n();
  const [documents, setDocuments] = useState<LinkedDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchLinkedDocuments(contract).then((rows) => {
      if (!active) return;
      setDocuments(rows);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [contract]);

  const totals = useMemo(() => {
    const totalAmount = documents.reduce((sum, d) => sum + d.totalAmount, 0);
    const paidAmount = documents.reduce((sum, d) => sum + d.paidAmount, 0);
    const remainingBalance = documents.reduce((sum, d) => sum + d.remainingBalance, 0);
    const progress = totalAmount > 0 ? Math.min((paidAmount / totalAmount) * 100, 100) : 0;
    return { totalAmount, paidAmount, remainingBalance, progress };
  }, [documents]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="app-modal flex max-h-[90vh] w-full max-w-2xl flex-col">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="font-bold">{t("official.linkedInvoicesTitle")}</h3>
            <p className="text-xs text-app-muted">
              {contract.contract_number} · {contract.party_name || "—"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-xs">
          <div className="rounded-lg border border-app bg-app-card-hover p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{t("official.paymentProgress")}</span>
              <span className="font-mono text-app-muted">
                {totals.progress.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-app-card">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${totals.progress}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-app-muted">{t("official.totalInvoiced")}</p>
                <p className="font-mono font-bold">{totals.totalAmount.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-app-muted">{t("print.paid")}</p>
                <p className="font-mono font-bold text-emerald-600">
                  {totals.paidAmount.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-app-muted">{t("official.remainingBalance")}</p>
                <p className="font-mono font-bold text-amber-600">
                  {totals.remainingBalance.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-center text-app-muted">{t("common.loading")}</p>
          ) : documents.length === 0 ? (
            <p className="text-center text-app-muted">{t("official.noLinkedInvoices")}</p>
          ) : (
            <table className="w-full">
              <thead className="border-b border-app text-left text-app-muted">
                <tr>
                  <th className="px-2 py-2">{t("sales.docNo")}</th>
                  <th className="px-2 py-2">{t("common.date")}</th>
                  <th className="px-2 py-2 text-right">{t("print.total")}</th>
                  <th className="px-2 py-2 text-right">{t("print.paid")}</th>
                  <th className="px-2 py-2 text-right">{t("official.remainingBalance")}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-app/50">
                    <td className="px-2 py-2 font-mono">{doc.docNo || "—"}</td>
                    <td className="px-2 py-2">
                      {doc.docDate ? formatDate(doc.docDate) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {doc.totalAmount.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-600">
                      {doc.paidAmount.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-amber-600">
                      {doc.remainingBalance.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Link
                        href={doc.kind === "purchase" ? `/purchases` : `/sales/${doc.id}`}
                        className="text-app-accent hover:underline"
                      >
                        {t("common.view")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
