"use client";

import { useEffect, useId, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { SettingsV2Page, useSettingsV2 } from "@/components/settings/v2/SettingsV2Page";
import { useAuth } from "@/components/auth/AuthProvider";
import { PageHeader, Section } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { getLotPrintOnInvoice, saveLotPrintOnInvoice } from "../actions/lots";

/**
 * LOT-3: Settings > Lots (admins, LOT_TRACKING on). One switch for now: lot numbers under each
 * line of the sales invoice print (system_settings lot_tracking.print_on_invoice, default off).
 * It saves as soon as it is switched.
 */
export default function LotSettingsPage() {
  const settingsV2 = useSettingsV2();
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const id = useId();
  // Feedback next to the switch (aria-live), so no toast layer is needed (OVL-3).
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [printOnInvoice, setPrintOnInvoice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getLotPrintOnInvoice().then((v) => {
      if (!alive) return;
      setPrintOnInvoice(v);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setStatus(null);
    setPrintOnInvoice(next);
    const result = await saveLotPrintOnInvoice(next);
    setSaving(false);
    if (!result.success) {
      setPrintOnInvoice(!next);
      setStatus({ text: t("lots.settings.saveFailed", { message: result.error }), error: true });
      return;
    }
    setStatus({ text: t("lots.settings.saved"), error: false });
  };

  const body = (
    <Section title={t("lots.settings.invoiceSection")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={`${id}-print`} className="font-medium text-[length:var(--ds-text-md)]">
            {t("lots.settings.printOnInvoice")}
          </label>
          <p id={`${id}-print-hint`} className="ds-muted text-[length:var(--ds-text-sm)]">
            {t("lots.settings.printOnInvoiceHint")}
          </p>
        </div>
        <input
          id={`${id}-print`}
          type="checkbox"
          role="switch"
          className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--ds-accent,var(--app-accent))]"
          aria-describedby={`${id}-print-hint`}
          aria-checked={printOnInvoice}
          checked={printOnInvoice}
          disabled={loading || saving || !isAdmin}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-[length:var(--ds-text-sm)]" style={status?.error ? { color: "var(--ds-danger, #e11d48)" } : undefined}>
        {status?.text ?? ""}
      </p>
    </Section>
  );

  if (settingsV2) {
    return (
      <SettingsV2Page id="lot-tracking">{body}</SettingsV2Page>
    );
  }
  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="lot-tracking" />
        <div className="space-y-5 p-6">
          <PageHeader title={t("settingsNav.lotTracking.title")} description={t("settingsNav.lotTracking.description")} />
          {body}
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}
