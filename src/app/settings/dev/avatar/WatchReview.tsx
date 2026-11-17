"use client";

import React, { useMemo, useState } from "react";
import { AssistantAvatar } from "@/components/assistant/AssistantAvatar";
import { WatchIssueCard } from "@/components/assistant/AssistantWatchBubble";
import { applyPatch, checkDraft, EMPTY_WATCH_MEMORY, ignoreIssue, issueId, visibleIssues, worstSeverity, type DocumentDraft, type WatchContext } from "@/lib/assistant/watch/rules";

type T = (key: string, params?: Record<string, string | number>) => string;

const PANEL = "rv-panel";
const SCREW = "rv-screw";

/** The sample: one line below cost, one above the stock, and a VAT rate that is not 18% or 0%. */
const START: DocumentDraft = {
  docType: "sale",
  date: "2026-11-20",
  partnerId: "rv-customer",
  lines: [
    { index: 0, productId: PANEL, productName: "Qara panel 2,8 m", quantity: 2, unit: "Ədəd", unitPrice: 18, discountPercent: 0, vatRate: 18, availableStock: 40 },
    { index: 1, productId: SCREW, productName: "Vint M8", quantity: 120, unit: "Ədəd", unitPrice: 0.4, discountPercent: 0, vatRate: 20, availableStock: 60 },
  ],
  total: 0,
  paid: 0,
  payments: [],
};
const CONTEXT: WatchContext = {
  today: "2026-11-20",
  rules: {},
  closedMonths: [],
  products: {
    [PANEL]: { unit: "Ədəd", sell_price: 30, cost: 22, usual_price: 30, usual_qty: 2, times: 6 },
    [SCREW]: { unit: "Ədəd", sell_price: 0.4, cost: 0.25, usual_price: 0.4, usual_qty: 100, times: 4 },
  },
  partner: { documents: 12, median_total: 160, recent: [] },
};

/** Same on the server and in the browser (toLocaleString differs between them and breaks hydration). */
const money = (n: number) => n.toFixed(2).replace(".", ",");
const withTotal = (d: DocumentDraft): DocumentDraft => ({ ...d, total: Math.round(d.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100 });

/** The review page's watch section (AST-5): the real rules over a sample sales invoice. Nothing is saved. */
export function WatchReview({ t }: { t: T }) {
  const [draft, setDraft] = useState(() => withTotal(START));
  const [memory, setMemory] = useState(EMPTY_WATCH_MEMORY);
  const issues = useMemo(() => visibleIssues(checkDraft(draft, CONTEXT), memory), [draft, memory]);
  const worst = worstSeverity(issues);
  const first = issues[0];

  return (
    <div className="ds-assistant-watch-review" data-review="watch">
      <section className="ds-assistant-proposal" aria-label={t("assistant.dev.watch")}>
        <dl className="ds-assistant-proposal-fields">
          <div className="ds-assistant-proposal-row">
            <dt>{t("assistant.proposal.customer")}</dt>
            <dd>Konik MMC</dd>
          </div>
          <div className="ds-assistant-proposal-row">
            <dt>{t("assistant.proposal.date")}</dt>
            <dd>20.11.2026</dd>
          </div>
        </dl>
        <ul className="ds-assistant-proposal-lines" aria-label={t("assistant.proposal.product")}>
          {draft.lines.map((l) => (
            <li key={l.index} data-flagged={issues.some((i) => i.lineIndex === l.index) || undefined}>
              <span className="ds-assistant-proposal-line-name" title={l.productName}>
                {l.productName}
              </span>
              <span className="ds-assistant-proposal-line-total">{money(l.quantity * l.unitPrice)}</span>
              <span className="ds-assistant-proposal-line-calc">
                {l.quantity} {l.unit} × {money(l.unitPrice)} · ƏDV {l.vatRate}%
              </span>
            </li>
          ))}
        </ul>
        <dl className="ds-assistant-proposal-totals">
          <div className="ds-assistant-proposal-row">
            <dt>{t("assistant.proposal.total")}</dt>
            <dd>{money(draft.total)} ₼</dd>
          </div>
        </dl>
      </section>
      <div className="ds-assistant-watch-review-side">
        <AssistantAvatar state={worst === "error" ? "alert" : worst ? "attention" : "idle"} size={56} />
        <div className="ds-assistant-bubble" data-layout="preview" role="status" aria-live="polite">
          {first ? (
            <WatchIssueCard
              key={issueId(first)}
              issue={first}
              more={issues.length - 1}
              t={t}
              onFix={() => first.fix && setDraft((d) => withTotal(applyPatch(d, first.fix!)))}
              onWhy={() => undefined}
              onIgnore={() => setMemory((m) => ignoreIssue(m, first))}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
