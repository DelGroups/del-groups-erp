"use client";

import React from "react";
import { Chip, type ChipTone } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import type { GuardSeverity, GuardStatus } from "@/lib/guard/findings";

/** React Query keys of the Accounting Guard screens; invalidate ["guard"] after any change. */
export const GUARD_KEYS = {
  all: ["guard"] as const,
  dashboard: ["guard", "dashboard"] as const,
  findings: ["guard", "findings"] as const,
  events: (id: string) => ["guard", "events", id] as const,
  rules: ["guard", "rules"] as const,
  runs: ["guard", "runs"] as const,
  reports: ["guard", "reports"] as const,
  report: (id: string) => ["guard", "report", id] as const,
  bell: ["guard", "bell"] as const,
};

const SEVERITY_TONE: Record<GuardSeverity, ChipTone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
const STATUS_TONE: Record<GuardStatus, ChipTone> = { open: "warning", acknowledged: "info", resolved: "success", auto_resolved: "success", false_positive: "neutral" };

export function SeverityChip({ severity }: { severity: GuardSeverity }) {
  const { t } = useI18n();
  return <Chip tone={SEVERITY_TONE[severity]}>{t(`guard.severity.${severity}`)}</Chip>;
}

export function StatusChip({ status }: { status: GuardStatus }) {
  const { t } = useI18n();
  return <Chip tone={STATUS_TONE[status]}>{t(`guard.status.${status}`)}</Chip>;
}

/** "A1 · Unbalanced journal entry": the rule code and its description. */
export function ruleTitle(t: (key: string) => string, code: string): string {
  return `${code} · ${t(`guard.rule.${code}`)}`;
}

/** A line of facts (label, value) in the side panel. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)] gap-2 py-1 text-[length:var(--ds-text-sm)]">
      <dt className="ds-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
