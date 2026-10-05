"use client";

import React, { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Save, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import {
  createStudioFieldAction,
  listStudioFieldsAction,
  updateStudioFieldAction,
} from "@/lib/actions/studio";
import {
  fieldNameFromLabel,
  STUDIO_FIELD_TYPES,
  STUDIO_MODELS,
  type StudioField,
  type StudioFieldType,
  type StudioModelKey,
} from "@/lib/studio/fields";

type Draft = {
  label: string;
  field_type: StudioFieldType;
  optionsText: string;
  required: boolean;
  show_in_list: boolean;
  help: string;
  sequence: string;
};

const EMPTY_DRAFT: Draft = {
  label: "",
  field_type: "text",
  optionsText: "",
  required: false,
  show_in_list: false,
  help: "",
  sequence: "100",
};

function draftFromField(field: StudioField): Draft {
  return {
    label: field.label,
    field_type: field.field_type,
    optionsText: field.options.map((option) => option.label).join("\n"),
    required: field.required,
    show_in_list: field.show_in_list,
    help: field.help || "",
    sequence: String(field.sequence),
  };
}

/** Keeps existing option values when labels are only edited, so stored values still match. */
function optionsFromText(text: string, previous: StudioField | null) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label, index) => {
      const old = previous?.options[index];
      return old ? { value: old.value, label } : { label };
    });
}

export default function StudioFieldsEditor() {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [model, setModel] = useState<StudioModelKey>("sales");
  const [fields, setFields] = useState<StudioField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<StudioField | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // Bumped to reload the list after a save or an archive.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listStudioFieldsAction(model).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setFields([]);
        showError(t(result.error));
        return;
      }
      setFields(result.data || []);
    });
    return () => {
      cancelled = true;
    };
  }, [model, reloadKey, showError, t]);

  const reload = () => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const startNew = () => {
    setEditing("new");
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (field: StudioField) => {
    setEditing(field);
    setDraft(draftFromField(field));
  };

  const save = async () => {
    setSaving(true);
    const previous = editing && editing !== "new" ? editing : null;
    const common = {
      label: draft.label,
      options: optionsFromText(draft.optionsText, previous),
      required: draft.required,
      show_in_list: draft.show_in_list,
      help: draft.help,
      sequence: draft.sequence,
    };
    const result = previous
      ? await updateStudioFieldAction(previous.id, common)
      : await createStudioFieldAction({ ...common, model_key: model, field_type: draft.field_type });
    setSaving(false);
    if (!result.success) {
      showError(t(result.error));
      return;
    }
    showSuccess(t(previous ? "studio.updated" : "studio.created"));
    setEditing(null);
    reload();
  };

  const toggleActive = async (field: StudioField) => {
    const result = await updateStudioFieldAction(field.id, {
      label: field.label,
      options: field.options,
      required: field.required,
      show_in_list: field.show_in_list,
      help: field.help,
      sequence: field.sequence,
      active: !field.active,
    });
    if (!result.success) {
      showError(t(result.error));
      return;
    }
    showSuccess(t("studio.updated"));
    reload();
  };

  const isNew = editing === "new";
  const previewName = isNew ? fieldNameFromLabel(draft.label) : editing ? editing.name : "";

  return (
    <section className="app-card app-card-elevated space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block text-xs font-semibold text-app">
          {t("studio.model")}
          <select
            className="app-input mt-1 min-w-[220px]"
            value={model}
            onChange={(event) => {
              setEditing(null);
              setLoading(true);
              setModel(event.target.value as StudioModelKey);
            }}
          >
            {STUDIO_MODELS.map((key) => (
              <option key={key} value={key}>
                {t(`studio.models.${key}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={startNew}>
          <Plus className="h-4 w-4" />
          {t("studio.addField")}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3 rounded-lg border border-app p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-app">
              {t("studio.label")} *
              <input
                className="app-input mt-1 w-full"
                value={draft.label}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("studio.fieldType")}
              <select
                className="app-input mt-1 w-full"
                value={draft.field_type}
                disabled={!isNew}
                onChange={(event) => setDraft({ ...draft, field_type: event.target.value as StudioFieldType })}
              >
                {STUDIO_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`studio.types.${type}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-app-muted">
            {t("studio.technicalName")}: <code className="font-mono">{previewName || "x_…"}</code> ·{" "}
            {isNew ? t("studio.technicalNameHint") : t("studio.typeLocked")}
          </p>

          {draft.field_type === "selection" ? (
            <label className="block text-xs font-semibold text-app">
              {t("studio.optionsLabel")} *
              <textarea
                className="app-input mt-1 w-full"
                rows={4}
                value={draft.optionsText}
                onChange={(event) => setDraft({ ...draft, optionsText: event.target.value })}
              />
              <span className="mt-1 block text-[11px] font-normal text-app-muted">{t("studio.optionsHint")}</span>
            </label>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-app">
              {t("studio.help")}
              <input
                className="app-input mt-1 w-full"
                value={draft.help}
                maxLength={300}
                onChange={(event) => setDraft({ ...draft, help: event.target.value })}
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("studio.sequence")}
              <input
                className="app-input mt-1 w-full"
                type="number"
                step={1}
                value={draft.sequence}
                onChange={(event) => setDraft({ ...draft, sequence: event.target.value })}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 text-xs font-medium text-app">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(event) => setDraft({ ...draft, required: event.target.checked })}
              />
              {t("studio.required")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.show_in_list}
                onChange={(event) => setDraft({ ...draft, show_in_list: event.target.checked })}
              />
              {t("studio.showInList")}
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-app px-4 py-2 text-xs font-semibold text-app hover:bg-app-card-hover"
              onClick={() => setEditing(null)}
            >
              <X className="h-4 w-4" />
              {t("studio.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={saving}
              onClick={() => void save()}
            >
              <Save className="h-4 w-4" />
              {saving ? t("common.saving") : isNew ? t("studio.create") : t("studio.saveChanges")}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-app-muted">{t("common.loading")}</p>
      ) : fields.length === 0 ? (
        <p className="text-xs text-app-muted">{t("studio.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-app-muted">
              <tr>
                <th className="py-2 pr-3">{t("studio.label")}</th>
                <th className="py-2 pr-3">{t("studio.technicalName")}</th>
                <th className="py-2 pr-3">{t("studio.fieldType")}</th>
                <th className="py-2 pr-3">{t("studio.required")}</th>
                <th className="py-2 pr-3">{t("studio.showInList")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.id} className={`border-t border-app ${field.active ? "" : "opacity-50"}`}>
                  <td className="py-2 pr-3 font-medium text-app">
                    {field.label}
                    {!field.active ? <span className="ml-2 text-[10px] uppercase">{t("studio.archived")}</span> : null}
                  </td>
                  <td className="py-2 pr-3 font-mono text-app-muted">{field.name}</td>
                  <td className="py-2 pr-3 text-app-muted">{t(`studio.types.${field.field_type}`)}</td>
                  <td className="py-2 pr-3">{field.required ? t("studio.yes") : t("studio.no")}</td>
                  <td className="py-2 pr-3">{field.show_in_list ? t("studio.yes") : t("studio.no")}</td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        title={t("studio.edit")}
                        className="rounded p-1.5 text-app-muted hover:bg-app-card-hover hover:text-app"
                        onClick={() => startEdit(field)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={field.active ? t("studio.archive") : t("studio.restore")}
                        className="rounded p-1.5 text-app-muted hover:bg-app-card-hover hover:text-app"
                        onClick={() => void toggleActive(field)}
                      >
                        {field.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </section>
  );
}
