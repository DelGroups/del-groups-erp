"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Combobox, ErrorState, Field, LoadingState, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { listGuardRulesAction, updateGuardRuleAction } from "@/lib/actions/accountingGuardSection";
import { GUARD_CATEGORIES, GUARD_SEVERITIES, paramToText, paramsPatch, type GuardRule, type GuardSeverity } from "@/lib/guard/findings";
import { GUARD_KEYS } from "./guardUi";

/**
 * The Rules tab: switch a rule on or off, change its severity and its thresholds (numbers, lists of
 * codes, text). The database checks every value again (a number is not negative, a similarity
 * threshold is between 0.3 and 1, a list keeps its shape); a change is written to the audit log.
 */
export default function GuardRulesTab() {
  const { t } = useI18n();
  const states = stateLabels(t);
  const rules = useQuery({
    queryKey: GUARD_KEYS.rules,
    queryFn: async () => {
      const r = await listGuardRulesAction();
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
  });
  if (rules.isError) return <ErrorState title={states.errorTitle} description={rules.error instanceof Error ? rules.error.message : undefined} retryLabel={states.retry} onRetry={() => void rules.refetch()} />;
  if (!rules.data) return <LoadingState label={states.loading} variant="form" rows={6} />;
  return (
    <div className="flex flex-col gap-6">
      {GUARD_CATEGORIES.map((category) => {
        const list = rules.data.filter((r) => r.category === category);
        if (list.length === 0) return null;
        return (
          <section key={category} aria-labelledby={`rules-${category}`} className="flex flex-col gap-3">
            <h2 id={`rules-${category}`} className="text-[length:var(--ds-text-sm)] font-semibold">
              {t(`guard.category.${category}`)}
            </h2>
            {list.map((rule) => (
              <RuleCard key={`${rule.code}-${rule.enabled}-${rule.severity}-${JSON.stringify(rule.params)}`} rule={rule} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function RuleCard({ rule }: { rule: GuardRule }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const comboLabels = comboboxLabels(t);
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [severity, setSeverity] = useState<GuardSeverity>(rule.severity);
  const [edited, setEdited] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(rule.params).map(([k, v]) => [k, paramToText(v)])));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { patch, invalid: bad } = paramsPatch(rule, edited);
  const changed = enabled !== rule.enabled || severity !== rule.severity || Object.keys(patch).length > 0;

  const save = async () => {
    if (bad.length > 0) {
      setInvalid(bad);
      return;
    }
    setInvalid([]);
    setBusy(true);
    const result = await updateGuardRuleAction(rule.code, {
      enabled: enabled !== rule.enabled ? enabled : undefined,
      severity: severity !== rule.severity ? severity : undefined,
      params: patch,
    });
    setBusy(false);
    if (!result.success) {
      toast(t("common.error"), t(result.error), "error");
      return;
    }
    toast(g("ruleSaved", { code: rule.code }), undefined, "success");
    void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.rules });
  };

  const paramLabel = (key: string) => {
    const label = t(`guard.param.${key}`);
    return label === `guard.param.${key}` ? key.replace(/_/g, " ") : label;
  };

  return (
    <article className="ds-card flex flex-col gap-3 p-4" aria-labelledby={`rule-${rule.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`rule-${rule.code}`} className="text-[length:var(--ds-text-sm)] font-semibold">
            {rule.code} · {t(`guard.rule.${rule.code}`)}
          </h3>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-[length:var(--ds-text-sm)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {g("ruleEnabled")}
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={g("colSeverity")}>
          {({ id }) => <Combobox id={id} value={severity} width="sm" labels={comboLabels} options={GUARD_SEVERITIES.map((s) => ({ value: s, label: t(`guard.severity.${s}`) }))} onChange={(v) => v && setSeverity(v as GuardSeverity)} />}
        </Field>
        {Object.keys(rule.params).map((key) => (
          <Field key={key} label={paramLabel(key)} error={invalid.includes(key) ? g("paramInvalid") : undefined} hint={Array.isArray(rule.params[key]) ? g("paramListHint") : undefined}>
            {({ id, describedBy, invalid: isInvalid }) => (
              <input
                id={id}
                className="ds-input w-40"
                value={edited[key] ?? ""}
                inputMode={typeof rule.params[key] === "number" ? "decimal" : undefined}
                aria-describedby={describedBy}
                aria-invalid={isInvalid || undefined}
                onChange={(e) => {
                  setEdited({ ...edited, [key]: e.target.value });
                  setInvalid(invalid.filter((k) => k !== key));
                }}
              />
            )}
          </Field>
        ))}
        <Button variant="secondary" onClick={() => void save()} loading={busy} disabled={!changed || busy}>
          {g("saveRule")}
        </Button>
      </div>
    </article>
  );
}
