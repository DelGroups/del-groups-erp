"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button, Field, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { GUARD_KEYS } from "./guardUi";

/**
 * "Ask the accountant" (GUARD-5): a question, or an empty box for a general review. The answer is saved
 * as a report in the list below. The accountant only reads and writes; it never posts or changes anything.
 * Shown on the Reports tab when ACCOUNTING_GUARD_AI is on.
 */
export default function GuardAskPanel() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/guard/agent/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), locale }),
      });
      const body = (await res.json().catch(() => ({}))) as { title?: string; reason?: string };
      if (!res.ok) {
        toast(t("common.error"), body.reason === "budget" ? g("askBudget") : g("askFailed"), "error");
        return;
      }
      toast(g("askDone", { title: body.title ?? "" }), undefined, "success");
      setQuestion("");
      void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.reports });
      void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.memory });
      void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.findings });
    } catch {
      toast(t("common.error"), g("askFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={g("askTitle")} className="mb-4 flex flex-col gap-2 rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] p-3">
      <h2 className="text-[length:var(--ds-text-md)] font-semibold">{g("askTitle")}</h2>
      <p className="ds-muted text-[length:var(--ds-text-sm)]">{g("askHelp")}</p>
      <Field label={g("askLabel")}>
        {({ id }) => <textarea id={id} className="ds-input w-full" rows={2} maxLength={1500} value={question} disabled={busy} onChange={(e) => setQuestion(e.target.value)} />}
      </Field>
      <div>
        <Button variant="secondary" icon={Sparkles} onClick={() => void ask()} loading={busy} disabled={busy}>
          {question.trim() ? g("askButton") : g("buildReport")}
        </Button>
      </div>
    </section>
  );
}
