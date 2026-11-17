"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertTriangle, OctagonAlert, X } from "lucide-react";
import { Button, IconButton } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { issueId, issueKey, type WatchIssue } from "@/lib/assistant/watch/rules";
import { AssistantAvatar } from "./AssistantAvatar";
import { useAssistantUi } from "./AssistantProvider";

type T = (key: string, params?: Record<string, string | number>) => string;

/** One warning: its line, Fix (only when the rule has one; secondary, ACT-2), Why, Ignore and "+N more". */
export function WatchIssueCard(props: { issue: WatchIssue; more: number; t: T; onFix: () => void; onWhy: () => void; onIgnore: () => void }) {
  const { issue, more, t } = props;
  return (
    <div className="ds-assistant-bubble-card" data-severity={issue.severity}>
      <div className="ds-assistant-bubble-text">
        {issue.severity === "error" ? <OctagonAlert className="h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
        <p>{t(issueKey(issue.code), issue.params)}</p>
      </div>
      <div className="ds-assistant-bubble-actions">
        {issue.fix ? (
          <Button size="sm" variant="secondary" onClick={props.onFix}>
            {t("assistant.watch.fix")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={props.onWhy}>
          {t("assistant.watch.why")}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onIgnore}>
          {t("assistant.watch.ignore")}
        </Button>
        {more > 0 ? <span className="ds-assistant-bubble-count">{t("assistant.watch.more", { count: more })}</span> : null}
      </div>
    </div>
  );
}

/**
 * The active watch's bubble (AST-5): next to the assistant, one line about the first warning of the form
 * being filled in, with Fix (when the rule has one), Why (opens the panel and asks) and Ignore; or, after a
 * save, "the document you just saved has a problem" with a link. It never opens the panel by itself and is
 * announced politely to screen readers.
 */
export function AssistantWatchBubble({ floatingButton }: { floatingButton: boolean }) {
  const ui = useAssistantUi();
  const { t } = useI18n();
  const [hiddenNotice, setHiddenNotice] = useState<string | null>(null);
  if (!ui.active || ui.panel.open) return null;
  const watch = ui.watch;
  const issue = watch?.issues[0];
  const notice = ui.savedNotice && hiddenNotice !== ui.savedNotice.href ? ui.savedNotice : null;
  if (!issue && !notice) return null;

  return (
    <div className="ds-assistant-bubble" data-floating={floatingButton || undefined} role="status" aria-live="polite">
      {issue && watch ? (
        <WatchIssueCard
          key={issueId(issue)}
          issue={issue}
          more={watch.issues.length - 1}
          t={t}
          onFix={() => watch.fix(issue)}
          onWhy={() => watch.why(issue)}
          onIgnore={() => watch.ignore(issue)}
        />
      ) : notice ? (
        <div className="ds-assistant-bubble-card" data-severity="warning">
          <div className="ds-assistant-bubble-text">
            <AssistantAvatar state="attention" size={28} decorative />
            <p>
              {t("assistant.watch.savedProblem", { number: notice.docNo })}{" "}
              <Link href={notice.href} className="ds-assistant-link">
                {t("assistant.watch.open")}
              </Link>
            </p>
            <IconButton
              size="sm"
              label={t("assistant.watch.dismiss")}
              icon={<X className="h-4 w-4" />}
              onClick={() => {
                setHiddenNotice(notice.href);
                ui.setSavedNotice(null);
                ui.dispatchAvatar({ type: "clear_issue" });
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
