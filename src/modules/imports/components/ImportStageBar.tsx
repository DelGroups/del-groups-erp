"use client";

import React from "react";
import { Check, PencilLine } from "lucide-react";
import { Chip, IconButton, RowActionsMenu, type RowMenuItem } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { formatGridDate } from "@/lib/dates/localeDate";
import type { StageView } from "../lib/stages";

export interface StageBarFact {
  key: string;
  label: string;
  value: React.ReactNode;
}

/**
 * The stage bar of an import (IMP-5): Sifariş → Yolda → Gömrükdə → Gömrükdən buraxıldı →
 * Anbara qəbul → Bağlandı, with the date of each done stage, the next action as the primary
 * button and the other actions in "…"; the transport facts under it. Cancelled is shown apart.
 */
export function ImportStageBar({
  stages,
  cancelled,
  nextLabel,
  onNext,
  nextDisabled,
  nextHint,
  menu,
  facts,
  onEditTracking,
  warning,
}: {
  stages: readonly StageView[];
  cancelled?: boolean;
  nextLabel?: string | null;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextHint?: string;
  menu?: readonly RowMenuItem[];
  facts?: readonly StageBarFact[];
  onEditTracking?: () => void;
  warning?: string | null;
}) {
  const { t } = useI18n();
  return (
    <section className="ds-card ds-stage-bar" aria-label={t("imports.stages.label")} data-ui-frame="stage-bar">
      {cancelled ? (
        <div className="flex items-center gap-2">
          <Chip tone="danger">{t("imports.status.cancelled")}</Chip>
          <span className="ds-muted text-[length:var(--ds-text-sm)]">{t("imports.stages.cancelledHint")}</span>
        </div>
      ) : (
        <ol className="ds-stepper">
          {stages.map((s, i) => (
            <li key={s.stage} className="ds-step" data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
              <span className="ds-step-bar" aria-hidden />
              <span className="ds-step-head">
                <span className="ds-step-dot" aria-hidden>
                  {s.state === "done" ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="ds-step-name">{t(`imports.stages.${s.stage}`)}</span>
              </span>
              <span className="ds-step-date">{s.date ? formatGridDate(s.date) : s.state === "next" ? "" : "—"}</span>
            </li>
          ))}
        </ol>
      )}
      {(facts?.length || nextLabel || menu?.length || warning) ? (
        <div className="ds-stage-foot">
          <dl className="ds-stage-facts">
            {(facts ?? []).map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
            {onEditTracking ? (
              <div className="self-end">
                <IconButton size="sm" label={t("imports.tracking.edit")} icon={<PencilLine className="h-4 w-4" />} onClick={onEditTracking} />
              </div>
            ) : null}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {warning ? <span className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-warning)" }}>{warning}</span> : null}
            {nextLabel && onNext ? (
              <button type="button" className="ds-btn ds-btn-primary" onClick={onNext} disabled={nextDisabled} title={nextHint}>
                {nextLabel}
              </button>
            ) : null}
            {menu?.length ? <RowActionsMenu label={t("imports.moreActions")} items={menu} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
