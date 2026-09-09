"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface DealFormModalProps {
  isOpen: boolean;
  customers: { id: string; full_name: string; company_name: string | null }[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    clientId: string;
    expectedValue: number;
    notes: string;
  }) => void | Promise<void>;
}

export default function DealFormModal({
  isOpen,
  customers,
  saving,
  onClose,
  onSubmit,
}: DealFormModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [expectedValue, setExpectedValue] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setTitle("");
    setClientId(customers[0]?.id || "");
    setExpectedValue("");
    setNotes("");
  }, [isOpen, customers]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="font-bold text-app">{t("crm.deal.newTitle")}</h3>
          <button type="button" onClick={onClose} className="text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit({
              title,
              clientId,
              expectedValue: Number(expectedValue) || 0,
              notes,
            });
          }}
          className="space-y-4 p-5"
        >
          <label className="block text-xs font-semibold">
            {t("crm.deal.title")} *
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold">
            {t("crm.deal.client")}
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              <option value="">{t("common.select")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                  {c.company_name ? ` (${c.company_name})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold">
            {t("crm.deal.expectedValue")}
            <input
              type="number"
              min="0"
              step="0.01"
              value={expectedValue}
              onChange={(e) => setExpectedValue(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-xs font-semibold">
            {t("common.notes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-semibold">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
