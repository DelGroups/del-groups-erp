"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, KanbanSquare, Plus, Save, Trash2 } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import FileDropzone from "@/components/settings/FileDropzone";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import {
  getCrmConfigAction,
  saveCrmConfigAction,
  uploadCrmSealAction,
} from "@/lib/actions/crmSettings";
import {
  CRM_STAGE_KINDS,
  DEFAULT_CRM_CONFIG,
  parseCrmConfig,
  slugStageId,
  type CrmConfig,
  type CrmPipelineStage,
  type CrmStageKind,
} from "@/lib/crm/config";

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-app bg-app px-3 py-2 text-sm">
      <span className="text-app">{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-[color:var(--app-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function CrmSettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [config, setConfig] = useState<CrmConfig>(DEFAULT_CRM_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    void getCrmConfigAction().then((result) => {
      setLoading(false);
      if (!result.success) {
        showError(result.error);
        return;
      }
      if (result.data) setConfig(result.data);
    });
  }, [showError]);

  const patch = (partial: Partial<CrmConfig>) => {
    setConfig((current) => parseCrmConfig({ ...current, ...partial }));
  };

  const updateStage = (index: number, partial: Partial<CrmPipelineStage>) => {
    setConfig((current) => {
      const stages = current.stages.map((stage, i) => (i === index ? { ...stage, ...partial } : stage));
      const kind = partial.kind;
      const normalized =
        kind && kind !== "open"
          ? stages.map((stage, i) => (i === index ? stage : stage.kind === kind ? { ...stage, kind: "open" } : stage))
          : stages;
      return { ...current, stages: normalized };
    });
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    setConfig((current) => {
      const next = [...current.stages];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row);
      return { ...current, stages: next };
    });
  };

  const removeStage = (index: number) => {
    setConfig((current) => {
      const stage = current.stages[index];
      if (!stage || stage.locked) return current;
      if (current.stages.length <= 2) return current;
      return { ...current, stages: current.stages.filter((_, i) => i !== index) };
    });
  };

  const addStage = () => {
    const label = newLabel.trim();
    if (!label) return;
    setConfig((current) => {
      const id = slugStageId(label, current.stages.map((stage) => stage.id));
      return {
        ...current,
        stages: [
          ...current.stages,
          { id, label: label.slice(0, 40), color: "#94a3b8", kind: "open", locked: false },
        ],
      };
    });
    setNewLabel("");
  };

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    const result = await saveCrmConfigAction(config);
    setSaving(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (result.data) setConfig(result.data);
    showSuccess(t("crmSettings.saved"));
  };

  const handleSeal = async (file: File) => {
    if (!canManage) return;
    setUploading(true);
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadCrmSealAction(formData);
    setUploading(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (result.data?.url) patch({ company_seal_signature_url: result.data.url });
    showSuccess(t("crmSettings.sealUploaded"));
  };

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="crm" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-6xl space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                  <KanbanSquare className="h-6 w-6 text-app-accent" />
                  {t("crmSettings.title")}
                </h1>
                <p className="mt-1 text-sm text-app-muted">{t("crmSettings.description")}</p>
              </div>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                disabled={!canManage || saving || loading}
                onClick={() => void handleSave()}
              >
                <Save className="h-4 w-4" />
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </header>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="app-card app-card-elevated space-y-4 p-5">
                <h2 className="text-sm font-bold text-app">{t("crmSettings.quoteTitle")}</h2>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("crmSettings.quotePrefix")}
                  <input
                    className="app-input mt-1 w-full font-mono"
                    value={config.quote_prefix}
                    disabled={!canManage}
                    maxLength={24}
                    onChange={(event) => patch({ quote_prefix: event.target.value })}
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("crmSettings.validityDays")}
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="app-input mt-1 w-full"
                    value={config.default_validity_days}
                    disabled={!canManage}
                    onChange={(event) =>
                      patch({ default_validity_days: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="block text-xs font-semibold text-app-muted">
                  {t("crmSettings.terms")}
                  <textarea
                    className="app-input mt-1 min-h-[9rem] w-full"
                    value={config.terms_and_conditions}
                    disabled={!canManage}
                    maxLength={8000}
                    onChange={(event) => patch({ terms_and_conditions: event.target.value })}
                  />
                </label>

                <ToggleRow
                  label={t("crmSettings.showBank")}
                  checked={config.show_bank_details_on_quote}
                  disabled={!canManage}
                  onChange={(show_bank_details_on_quote) => patch({ show_bank_details_on_quote })}
                />

                <div>
                  <p className="mb-2 text-xs font-semibold text-app-muted">
                    {t("crmSettings.seal")}
                  </p>
                  {config.company_seal_signature_url ? (
                    <div className="mb-3 flex items-center gap-3 rounded-lg border border-app bg-app p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={config.company_seal_signature_url}
                        alt=""
                        className="h-16 w-16 object-contain"
                      />
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={!canManage}
                        onClick={() => patch({ company_seal_signature_url: null })}
                      >
                        {t("crmSettings.removeSeal")}
                      </button>
                    </div>
                  ) : null}
                  <FileDropzone
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!canManage || uploading}
                    label={uploading ? t("crmSettings.uploading") : t("crmSettings.sealDrop")}
                    hint={t("crmSettings.sealHint")}
                    onFile={handleSeal}
                  />
                </div>
              </section>

              <section className="app-card app-card-elevated space-y-4 p-5">
                <h2 className="text-sm font-bold text-app">{t("crmSettings.pipelineTitle")}</h2>
                <p className="text-xs text-app-muted">{t("crmSettings.pipelineHint")}</p>

                <div className="space-y-2">
                  {config.stages.map((stage, index) => (
                    <div
                      key={stage.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-app bg-app p-3"
                    >
                      <span
                        className="h-8 w-2 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      <input
                        className="app-input min-w-[8rem] flex-1"
                        value={stage.label}
                        disabled={!canManage}
                        maxLength={40}
                        onChange={(event) => updateStage(index, { label: event.target.value })}
                      />
                      <input
                        type="color"
                        className="h-9 w-12 cursor-pointer rounded border border-app bg-transparent"
                        value={stage.color}
                        disabled={!canManage}
                        onChange={(event) => updateStage(index, { color: event.target.value })}
                        title={t("crmSettings.stageColor")}
                      />
                      <select
                        className="app-input w-32 text-xs"
                        value={stage.kind}
                        disabled={!canManage}
                        onChange={(event) =>
                          updateStage(index, { kind: event.target.value as CrmStageKind })
                        }
                      >
                        {CRM_STAGE_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {t(`crmSettings.kinds.${kind}`)}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-ghost !p-1"
                          disabled={!canManage || index === 0}
                          onClick={() => moveStage(index, -1)}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !p-1"
                          disabled={!canManage || index === config.stages.length - 1}
                          onClick={() => moveStage(index, 1)}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !p-1 text-rose-400"
                          disabled={!canManage || stage.locked || config.stages.length <= 2}
                          onClick={() => removeStage(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    className="app-input flex-1"
                    value={newLabel}
                    disabled={!canManage}
                    placeholder={t("crmSettings.newStagePlaceholder")}
                    onChange={(event) => setNewLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addStage();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost inline-flex items-center gap-1"
                    disabled={!canManage || !newLabel.trim()}
                    onClick={addStage}
                  >
                    <Plus className="h-4 w-4" />
                    {t("crmSettings.addStage")}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>

        <ToastMessage message={toastMessage} variant={toastVariant} />
      </PermissionGuard>
    </PageLayout>
  );
}
