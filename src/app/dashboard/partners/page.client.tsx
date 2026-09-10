"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import { fetchPartnersWithBalances, partnerDisplayName } from "@/lib/partners/fetchPartners";
import type { PartnerNetBalance, PartnerRecord } from "@/lib/partners/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import PartnerFormModal from "@/components/partners/PartnerFormModal";
import MergePartnersDialog from "@/components/partners/MergePartnersDialog";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deletePartnerAction } from "@/lib/actions/partners";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import {
  Eye,
  GitMerge,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";

type PartnerRow = PartnerRecord & { balance: PartnerNetBalance };

function formatMoney(value: number, currency = "AZN"): string {
  return `${value.toFixed(2)} ${currency}`;
}

function balanceBadgeClass(netBalance: number): string {
  if (netBalance > 0.009) return "bg-emerald-100 text-emerald-800";
  if (netBalance < -0.009) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function codeOrVoen(row: PartnerRow): string {
  if (row.code && row.voen) return `${row.code} / ${row.voen}`;
  return row.code || row.voen || "—";
}

export default function PartnersPageClient() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_customers");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartnerRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        row.email,
        row.voen,
        row.code,
        row.iban,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [rows, search]);

  const openCreate = () => {
    setEditingPartner(null);
    setFormOpen(true);
  };

  const openEdit = (partner: PartnerRecord) => {
    setEditingPartner(partner);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deletePartnerAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    showSuccess(t("partners.deleted"));
    setDeleteTarget(null);
    await load();
  };

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
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <>
              <button type="button" onClick={openCreate} className="btn-primary">
                <Plus className="h-4 w-4" />
                {t("partners.newPartner")}
              </button>
              <button type="button" onClick={() => setMergeOpen(true)} className="btn-secondary">
                <GitMerge className="h-4 w-4" />
                {t("partners.mergePartners")}
              </button>
            </>
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
                <th className="p-3">{t("partners.codeVoen")}</th>
                <th className="p-3">{t("partners.name")}</th>
                <th className="p-3">{t("partners.roles")}</th>
                <th className="p-3">{t("partners.contact")}</th>
                <th className="p-3 text-right">{t("partners.netBalance")}</th>
                <th className="p-3 text-right">{t("partners.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-app-muted">{t("common.loading")}</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-app-muted">{t("partners.empty")}</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-app-card-hover/60">
                    <td className="p-3 font-mono text-xs text-app-muted">{codeOrVoen(row)}</td>
                    <td className="p-3">
                      <Link
                        href={`/dashboard/partners/${row.id}`}
                        className="font-semibold text-app-accent hover:underline"
                      >
                        {partnerDisplayName(row)}
                      </Link>
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
                      <p>{row.email || ""}</p>
                    </td>
                    <td className="p-3 text-right">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${balanceBadgeClass(row.balance.netBalance)}`}
                      >
                        {formatMoney(row.balance.netBalance)}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/dashboard/partners/${row.id}`}
                          className="rounded-lg p-2 text-app-muted hover:bg-app-card-hover hover:text-app-accent"
                          title={t("partners.viewDetails")}
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              className="rounded-lg p-2 text-app-muted hover:bg-app-card-hover hover:text-app-accent"
                              title={t("common.edit")}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(row)}
                              className="rounded-lg p-2 text-app-muted hover:bg-rose-50 hover:text-rose-600"
                              title={t("common.delete")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PartnerFormModal
        open={formOpen}
        partner={editingPartner}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
      />

      <MergePartnersDialog
        open={mergeOpen}
        partners={rows}
        onClose={() => setMergeOpen(false)}
        onMerged={() => void load()}
      />

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={t("partners.deleteTitle")}
        message={t("partners.deleteMessage", { name: deleteTarget ? partnerDisplayName(deleteTarget) : "" })}
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
