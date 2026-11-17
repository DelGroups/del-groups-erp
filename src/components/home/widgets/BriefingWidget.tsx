"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, MoonStar, Sunrise } from "lucide-react";
import { Button, EmptyState, Switch } from "@/design-system/components";
import { AiAssistantMarkdown } from "@/components/ai/AiAssistantMarkdown";
import { useAssistantUi } from "@/components/assistant/AssistantProvider";
import type { MorningBriefing } from "@/components/assistant/useMorningBriefing";
import { getBriefingSwitchAction, setBriefingEnabledAction, type BriefingSwitchState } from "@/lib/actions/assistantBriefing";
import { WidgetFrame, WidgetState } from "../WidgetFrame";
import { useFigures } from "./format";
import { frameProps, type WidgetProps } from "./types";

const SWITCH_KEY = ["assistant", "briefing", "switch"] as const;
const BRIEFING_KEY = ["assistant", "briefing", "widget"] as const;

/**
 * The morning briefing on the home page (AST-7): admins and managers, only while the assistant is on.
 * Admins turn the daily briefing on or off here (off by default; every change is audited); managers see
 * the state but not the switch. Off: a calm "switched off" state and no work at night. On: today's
 * briefing (the user's own row), or "not written yet". Reading it here does not mark it read.
 */
export function BriefingWidget(props: WidgetProps) {
  const { t } = useFigures();
  const ui = useAssistantUi();
  const client = useQueryClient();

  const sw = useQuery({
    queryKey: SWITCH_KEY,
    enabled: !props.preview,
    staleTime: 60_000,
    queryFn: async (): Promise<BriefingSwitchState> => {
      const r = await getBriefingSwitchAction();
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });
  const on = sw.data?.enabled === true;
  const briefing = useQuery({
    queryKey: BRIEFING_KEY,
    enabled: !props.preview && on,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<MorningBriefing | null> => {
      const res = await fetch("/api/assistant/briefing");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { briefing?: MorningBriefing | null };
      return body.briefing && typeof body.briefing.body === "string" ? body.briefing : null;
    },
  });
  const flip = useMutation({
    mutationFn: async (next: boolean) => {
      const r = await setBriefingEnabledAction(next);
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
    onSuccess: (data) => {
      client.setQueryData(SWITCH_KEY, data);
      void client.invalidateQueries({ queryKey: BRIEFING_KEY });
    },
  });

  const openButton = (
    <Button size="sm" variant="ghost" icon={MessageSquareText} onClick={() => ui.open()}>
      {t("assistant.briefingWidget.open")}
    </Button>
  );

  if (props.preview) {
    return (
      <WidgetFrame {...frameProps(props)}>
        <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("assistant.briefingWidget.preview")}</p>
      </WidgetFrame>
    );
  }

  const status = sw.status === "success" && on ? briefing.status : sw.status;
  const body = !on ? (
    <EmptyState
      icon={MoonStar}
      title={t("assistant.briefingWidget.offTitle")}
      description={t(sw.data?.canChange ? "assistant.briefingWidget.offHintAdmin" : "assistant.briefingWidget.offHint")}
      className="gap-2! px-3! py-5!"
    />
  ) : briefing.data ? (
    <div className="ds-briefing-widget" data-all-well={briefing.data.all_well || undefined}>
      <AiAssistantMarkdown content={briefing.data.body} />
    </div>
  ) : (
    <EmptyState icon={Sunrise} title={t("assistant.briefingWidget.emptyTitle")} description={t("assistant.briefingWidget.emptyHint")} className="gap-2! px-3! py-5!" />
  );

  return (
    <WidgetFrame {...frameProps(props)} action={openButton}>
      <WidgetState status={status} onRetry={() => void (sw.status === "error" ? sw.refetch() : briefing.refetch())} emptyIcon={Sunrise} emptyTitle={t("assistant.briefingWidget.emptyTitle")} rows={4}>
        {body}
        {sw.data?.canChange ? (
          <div className="ds-briefing-switch">
            <Switch
              checked={on}
              busy={flip.isPending}
              onCheckedChange={(next) => flip.mutate(next)}
              label={t("assistant.briefingWidget.switchLabel")}
              description={t(on ? "assistant.briefingWidget.switchOn" : "assistant.briefingWidget.switchOff")}
            />
            {flip.isError ? (
              <p role="alert" className="m-0 text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
                {t(flip.error instanceof Error && flip.error.message.startsWith("assistant.") ? flip.error.message : "assistant.briefingWidget.saveFailed")}
              </p>
            ) : null}
          </div>
        ) : null}
      </WidgetState>
    </WidgetFrame>
  );
}
