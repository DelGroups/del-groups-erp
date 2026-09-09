"use client";

import React, { useEffect, useState } from "react";
import { Save, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import { getN8nAiConfigAction, saveN8nAiConfigAction } from "@/lib/actions/aiSettings";

export default function AiN8nSettingsCard() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secretToken, setSecretToken] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void getN8nAiConfigAction().then((result) => {
      setLoading(false);
      if (!result.success) {
        showError(result.error);
        return;
      }
      if (result.data) {
        setWebhookUrl(result.data.webhook_url);
        setHasSecret(result.data.has_secret);
        setEnvConfigured(result.data.env_webhook_configured);
      }
    });
  }, [canManage, showError]);

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    const result = await saveN8nAiConfigAction({
      webhook_url: webhookUrl,
      secret_token: secretToken,
    });
    setSaving(false);
    if (!result.success) {
      showError(result.error);
      return;
    }
    if (result.data) {
      setWebhookUrl(result.data.webhook_url);
      setHasSecret(result.data.has_secret);
      setEnvConfigured(result.data.env_webhook_configured);
      setSecretToken("");
    }
    showSuccess(t("aiSettings.saved"));
  };

  if (!canManage) return null;

  return (
    <section className="app-card app-card-elevated space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-app">
            <Sparkles className="h-4 w-4 text-app-accent" />
            {t("aiSettings.sectionTitle")}
          </h2>
          <p className="mt-1 text-xs text-app-muted">{t("aiSettings.description")}</p>
        </div>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          disabled={saving || loading}
          onClick={() => void handleSave()}
        >
          <Save className="h-4 w-4" />
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>

      {envConfigured && <p className="text-[11px] text-app-muted">{t("aiSettings.envHint")}</p>}

      <label className="block text-xs font-semibold text-app">
        {t("aiSettings.webhookUrl")}
        <input
          type="url"
          className="app-input mt-1 w-full font-mono text-sm"
          placeholder="https://n8n.example.com/webhook/erp-ai"
          value={webhookUrl}
          disabled={loading}
          onChange={(event) => setWebhookUrl(event.target.value)}
        />
      </label>

      <label className="block text-xs font-semibold text-app">
        {t("aiSettings.secretToken")}
        <input
          type="password"
          autoComplete="new-password"
          className="app-input mt-1 w-full font-mono text-sm"
          placeholder={hasSecret ? "••••••••" : t("aiSettings.secretPlaceholder")}
          value={secretToken}
          disabled={loading}
          onChange={(event) => setSecretToken(event.target.value)}
        />
        <span className="mt-1 block text-[11px] font-normal text-app-muted">
          {t("aiSettings.secretHint")}
        </span>
      </label>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </section>
  );
}
