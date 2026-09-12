"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useSuppliers, useUpsertSupplier } from "@/hooks/useSuppliers";
import type { Supplier } from "@/types/database.types";
import type { EntityType } from "@/lib/customers/entityType";
import { useProcurementConfig } from "@/hooks/useProcurementConfig";
import { formatSupplierScore, weightedSupplierScore } from "@/lib/purchases/supplierScore";
import {
  Plus,
  Pencil,
  Search,
  RefreshCw,
  Phone,
  Trash2,
} from "lucide-react";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deleteSupplierAction } from "@/lib/actions/entityDelete";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import SupplierFormDrawer from "@/components/suppliers/SupplierFormDrawer";
import { queryKeys } from "@/lib/query/keys";

const EMPTY_FORM = {
  code: "",
  full_name: "",
  phone: "",
  company_name: "",
  address: "",
  voen: "",
  entity_type: "physical" as EntityType,
  balance: "0.00",
};

export default function SuppliersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageSuppliers = can("can_manage_suppliers");
  const { config: procurementConfig } = useProcurementConfig();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const queryClient = useQueryClient();
  const { data: suppliers = [], isLoading, isFetching, refetch } = useSuppliers();
  const upsertSupplier = useUpsertSupplier();

  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.entity_type === "legal" && !formData.voen.trim()) {
      showError(t("customers.voenRequiredForLegal"));
      return;
    }

    try {
      await upsertSupplier.mutateAsync({
        id: editingSupplierId,
        code: formData.code || `SUP-${Math.floor(1000 + Math.random() * 9000)}`,
        full_name: formData.full_name,
        phone: formData.phone,
        company_name: formData.company_name,
        address: formData.address,
        voen: formData.entity_type === "legal" ? formData.voen.trim() : formData.voen.trim() || null,
        entity_type: formData.entity_type,
        balance: parseFloat(formData.balance) || 0,
      });
      setIsDrawerOpen(false);
      setEditingSupplierId(null);
      setFormData(EMPTY_FORM);
      showSuccess(t("common.save"));
    } catch (error) {
      showError(
        t("common.errorOccurred", {
          message: error instanceof Error ? error.message : t("common.error"),
        })
      );
    }
  };

  const handleDeleteSupplier = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteSupplierAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      showError(result.error || t("common.error"));
      return;
    }
    queryClient.setQueryData<Supplier[]>(queryKeys.suppliers.all, (current = []) =>
      current.filter((row) => row.id !== deleteTarget.id)
    );
    setDeleteTarget(null);
    showSuccess(t("suppliers.deleteSuccess"));
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingSupplierId(null);
  };

  const openCreateDrawer = () => {
    if (!canManageSuppliers) return;
    setEditingSupplierId(null);
    setFormData(EMPTY_FORM);
    setIsDrawerOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    if (!canManageSuppliers) return;
    setEditingSupplierId(supplier.id);
    setFormData({
      code: supplier.code || "",
      full_name: supplier.full_name || "",
      phone: supplier.phone || "",
      company_name: supplier.company_name || "",
      address: supplier.address || "",
      voen: supplier.voen || "",
      entity_type: supplier.entity_type === "legal" ? "legal" : "physical",
      balance: String(supplier.balance ?? 0),
    });
    setIsDrawerOpen(true);
  };

  const filteredSuppliers = suppliers.filter(
    (s) =>
      (s.full_name ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.company_name && s.company_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (s.code && s.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const loading = isLoading || isFetching;

  return (
    <PageLayout>
        <header className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-app">{t("suppliers.pageTitle")}</h2>
            <p className="text-sm text-app-muted">{t("suppliers.pageDescription")}</p>
          </div>
          <button
            onClick={openCreateDrawer}
            className="btn-primary disabled:opacity-50"
            disabled={!canManageSuppliers}
          >
            <Plus className="w-4 h-4" />
            <span>{t("suppliers.createButton")}</span>
          </button>
        </header>

        <main className="app-page-content flex-1 space-y-4 overflow-y-auto">
          <div className="app-card app-card-elevated flex flex-col items-center justify-between gap-4 p-4 sm:flex-row">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-app-muted" />
              <input
                type="text"
                placeholder={t("suppliers.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="app-input pl-9"
              />
            </div>
            <button
              onClick={() => void refetch()}
              className="p-2 border border-app rounded-lg text-app-muted hover:bg-app-card-hover"
              title={t("common.refresh")}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="app-table-wrap">
            {isLoading ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("common.loading")}</div>
            ) : filteredSuppliers.length === 0 ? (
              <div className="p-8 text-center text-app-muted text-sm">
                {t("suppliers.emptyHint")}
              </div>
            ) : (
              <TableWrap className="rounded-none border-0 shadow-none">
                <Table>
                  <THead>
                    <tr>
                      <Th>{t("common.code")}</Th>
                      <Th>{t("suppliers.supplierCompany")}</Th>
                      <Th>{t("common.phone")}</Th>
                      <Th>{t("purchases.qualityScore")}</Th>
                      <Th>{t("purchases.deliverySpeedScore")}</Th>
                      <Th>{t("purchases.totalScore")}</Th>
                      <Th>{t("suppliers.ourDebt")}</Th>
                      {canManageSuppliers ? <ActionsTh>{t("common.actions")}</ActionsTh> : null}
                    </tr>
                  </THead>
                  <tbody>
                    {filteredSuppliers.map((s) => (
                      <Tr key={s.id}>
                        <Td className="font-mono font-semibold text-app">
                          {s.code}
                        </Td>
                        <Td>
                          <div className="font-medium text-app">{s.full_name}</div>
                          {s.company_name && (
                            <div className="text-xs text-app-muted">{s.company_name}</div>
                          )}
                        </Td>
                        <Td className="text-app-muted">
                          {s.phone ? (
                            <span className="flex items-center space-x-1">
                              <Phone className="mr-1 h-3.5 w-3.5 text-app-muted" />
                              {s.phone}
                            </span>
                          ) : (
                            "-"
                          )}
                        </Td>
                        <Td className="font-mono">
                          {s.quality_score ? `★ ${Number(s.quality_score).toFixed(1)}` : "—"}
                        </Td>
                        <Td className="font-mono">
                          {s.delivery_speed_score
                            ? `★ ${Number(s.delivery_speed_score).toFixed(1)}`
                            : "—"}
                        </Td>
                        <Td className="font-mono font-semibold">
                          {(() => {
                            const total = weightedSupplierScore(s, procurementConfig);
                            return total != null ? `★ ${formatSupplierScore(total)}` : "—";
                          })()}
                        </Td>
                        <Td className="font-bold">
                          {(s.balance ?? 0) > 0 ? (
                            <span className="text-rose-600">{(s.balance ?? 0).toFixed(2)} AZN ({t("common.weOwe")})</span>
                          ) : (
                            <span className="text-emerald-600">{(s.balance ?? 0).toFixed(2)} AZN</span>
                          )}
                        </Td>
                        {canManageSuppliers ? (
                          <ActionsTd>
                            <TableRowActionsMenu
                              items={[
                                {
                                  key: "edit",
                                  label: t("common.edit"),
                                  icon: <Pencil className="h-4 w-4" />,
                                  onClick: () => openEditModal(s),
                                },
                                {
                                  key: "delete",
                                  label: t("common.delete"),
                                  icon: <Trash2 className="h-4 w-4" />,
                                  onClick: () => setDeleteTarget(s),
                                  variant: "destructive",
                                },
                              ]}
                            />
                          </ActionsTd>
                        ) : null}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </div>
        </main>

      <SupplierFormDrawer
        open={isDrawerOpen}
        editing={Boolean(editingSupplierId)}
        formData={formData}
        saving={upsertSupplier.isPending}
        onClose={closeDrawer}
        onInputChange={handleInputChange}
        onEntityTypeChange={(entityType) =>
          setFormData((current) => ({ ...current, entity_type: entityType }))
        }
        onSubmit={handleSubmit}
      />
      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemName={deleteTarget?.full_name}
        loading={deleting}
        onConfirm={() => void handleDeleteSupplier()}
        onCancel={() => setDeleteTarget(null)}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
