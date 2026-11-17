"use client";

import React, { useState } from "react";
import { WidgetFrame } from "@/components/home/WidgetFrame";
import { BriefingOpenButton, BriefingWidgetView } from "@/components/home/widgets/BriefingWidget";
import { widgetDef } from "@/lib/home/registry";

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * The review page's home-widget section (AST-7): the morning briefing widget as an admin sees it (with the
 * switch, which works here on a sample) and as a manager sees it while it is off. Nothing is saved.
 */
export function BriefingWidgetReview({ t }: { t: T }) {
  const def = widgetDef("morning_briefing");
  const [on, setOn] = useState(false);
  if (!def) return null;
  const sample = { id: "sample", day: "2026-11-17", body: t("assistant.dev.demoBriefing"), all_well: false, links: [], seen_at: null };
  const frame = (key: string, body: React.ReactNode) => (
    <div key={key} className="ds-home-card-review">
      <WidgetFrame def={def} size="M" editing={false} action={<BriefingOpenButton t={t} onOpen={() => undefined} />}>
        {body}
      </WidgetFrame>
    </div>
  );
  return (
    <div className="ds-widget-review" data-review="briefing-widget">
      {frame("admin", <BriefingWidgetView t={t} on={on} canChange briefing={on ? sample : null} onFlip={setOn} />)}
      {frame("manager", <BriefingWidgetView t={t} on={false} canChange={false} briefing={null} onFlip={() => undefined} />)}
    </div>
  );
}
