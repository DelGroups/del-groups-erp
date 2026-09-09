"use client";

import React, { useMemo } from "react";
import { GitCompareArrows, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Json } from "@/types/database.types";

interface AuditDiffModalProps {
  open: boolean;
  oldValues: Json | null;
  newValues: Json | null;
  onClose: () => void;
}

function asRecord(value: Json | null): Record<string, Json | undefined> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, Json | undefined>;
  }
  return {};
}

function formatValue(value: Json | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AuditDiffModal({
  open,
  oldValues,
  newValues,
  onClose,
}: AuditDiffModalProps) {
  const { t } = useI18n();

  const keys = useMemo(() => {
    const oldRec = asRecord(oldValues);
    const newRec = asRecord(newValues);
    return Array.from(new Set([...Object.keys(oldRec), ...Object.keys(newRec)])).sort();
  }, [oldValues, newValues]);

  if (!open) return null;

  const oldRec = asRecord(oldValues);
  const newRec = asRecord(newValues);
  const isEmpty = keys.length === 0 && oldValues == null && newValues == null;

  return (
    <div className="app-modal-overlay" onClick={onClose}>
      <div
        className="app-modal flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-app px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-[color:var(--app-accent)]/15 p-2">
              <GitCompareArrows className="h-5 w-5 text-app-accent" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-app">{t("audit.diffTitle")}</h3>
              <p className="mt-1 text-xs text-app-muted">{t("audit.diffSubtitle")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost !p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-0 border-b border-app bg-app-card-hover px-6 py-2 text-[11px] font-bold uppercase tracking-wide text-app-muted">
          <span>{t("audit.oldValues")}</span>
          <span>{t("audit.newValues")}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isEmpty ? (
            <p className="text-xs text-app-muted">{t("audit.noDiff")}</p>
          ) : keys.length === 0 ? (
            <div className="grid grid-cols-2 gap-4">
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-app p-3 font-mono text-[11px] text-rose-300">
                {formatValue(oldValues)}
              </pre>
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-app p-3 font-mono text-[11px] text-emerald-300">
                {formatValue(newValues)}
              </pre>
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => {
                const changed = JSON.stringify(oldRec[key]) !== JSON.stringify(newRec[key]);
                return (
                  <div key={key} className="grid grid-cols-[8rem_1fr_1fr] gap-3 text-[11px]">
                    <div className="truncate pt-2 font-semibold text-app-muted" title={key}>
                      {key}
                    </div>
                    <pre
                      className={`whitespace-pre-wrap break-all rounded-lg p-2 font-mono ${
                        changed ? "bg-rose-500/10 text-rose-200" : "bg-app text-app-muted"
                      }`}
                    >
                      {formatValue(oldRec[key])}
                    </pre>
                    <pre
                      className={`whitespace-pre-wrap break-all rounded-lg p-2 font-mono ${
                        changed ? "bg-emerald-500/10 text-emerald-200" : "bg-app text-app-muted"
                      }`}
                    >
                      {formatValue(newRec[key])}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-app px-6 py-3">
          <button type="button" onClick={onClose} className="btn-ghost">
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
