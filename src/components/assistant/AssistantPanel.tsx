"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { DesignScope, IconButton, ToastProvider, useDesignScope, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { recordLabelFor } from "@/components/shell/useShell";
import { avatarLabelKey } from "@/lib/assistant/ui/avatar";
import {
  closesOnEscape,
  clampPanelWidth,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_WIDTH_STEP,
  panelLayout,
  readPanelWidth,
  resizedWidth,
  writePanelWidth,
  type PanelLayout,
} from "@/lib/assistant/ui/panel";
import { contextFromPath, firstName, suggestionKey, suggestionsFor, type PageContext } from "@/lib/assistant/ui/thread";
import { AssistantEmptyState, AssistantPanelHeader } from "./AssistantPanelParts";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantHistory } from "./AssistantHistory";
import { AssistantThread } from "./AssistantThread";
import { ASSISTANT_PANEL_ID, useAssistantUi } from "./AssistantProvider";
import { AssistantFloatingButton } from "./AssistantLauncher";
import { useAssistantChat } from "./useAssistantChat";

const DOCK_ATTR = "data-assistant-dock";

function subscribeResize(fn: () => void) {
  window.addEventListener("resize", fn);
  return () => window.removeEventListener("resize", fn);
}

function useLayout(): PanelLayout {
  return useSyncExternalStore(subscribeResize, () => panelLayout(window.innerWidth), () => "overlay");
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Del Assistant's panel (AST-2). Docked on the right (360–560 px, the width remembered per user); on wide
 * screens the page shrinks beside it instead of being covered; on phones a bottom sheet. A non-modal
 * side panel like the side menu, built on the Radix dialog primitive (focus, Escape, title), modal only as
 * the phone sheet. Rendered only while ASSISTANT_V2 is on for this user.
 */
export default function AssistantPanel({ floatingFromMd = true }: { floatingFromMd?: boolean }) {
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const { t } = useI18n();
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="ds-scope-contents">
      <ToastProvider closeLabel={t("uiUnified.dialog.close")}>
        <PanelBody />
        <AssistantFloatingButton hideFromMd={!floatingFromMd} />
      </ToastProvider>
    </DesignScope>
  );
}

function PanelBody() {
  const ui = useAssistantUi();
  const { t, locale } = useI18n();
  const { user, profile, can } = useAuth();
  const { toast } = useToast();
  const { portalContainer } = useDesignScope();
  const pathname = usePathname() ?? "/";
  const layout = useLayout();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState("");
  const [contextOffFor, setContextOffFor] = useState<string | null>(null);
  const storedWidth = useMemo(() => (user ? readPanelWidth(safeStorage(), user.id) : clampPanelWidth(NaN)), [user]);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? storedWidth;
  const open = ui.panel.open;
  const view = ui.panel.view;
  const dispatchAvatar = ui.dispatchAvatar;

  const chat = useAssistantChat({ locale, onAvatar: dispatchAvatar });

  // What the user is looking at; the server reloads the record with the user's own client (AST-1).
  const pageContext = useMemo(() => contextFromPath(pathname), [pathname]);
  const contextOn = contextOffFor !== pathname;
  const sentContext: PageContext | null = contextOn ? pageContext : null;
  const contextLabel = useMemo(() => {
    if (!open || !contextOn) return null;
    if (pageContext.recordType === "sale") {
      const number = recordLabelFor(pathname);
      return number ? t("assistant.contextSale", { number }) : t("assistant.contextSaleShort");
    }
    const title = typeof document === "undefined" ? "" : document.title.split("|")[0].trim();
    return title || t("assistant.contextPage");
  }, [open, contextOn, pageContext.recordType, pathname, t]);

  const allSuggestions = useMemo(() => suggestionsFor({ context: pageContext, can: (p) => can(p as never) }), [pageContext, can]);
  const asked = useMemo(() => new Set(chat.messages.filter((m) => m.role === "user").map((m) => m.content)), [chat.messages]);
  const chipSuggestions = useMemo(
    () =>
      chat.messages.length === 0
        ? []
        : allSuggestions
            .map((id) => ({ id, label: t(suggestionKey(id)) }))
            .filter((s) => !asked.has(s.label))
            .slice(0, 2),
    [allSuggestions, asked, chat.messages.length, t]
  );

  // Wide screens: the page makes room for the panel (the shell's layout shrinks, nothing is covered).
  useEffect(() => {
    const root = document.documentElement;
    if (open && layout === "push") {
      root.setAttribute(DOCK_ATTR, "");
      root.style.setProperty("--ds-assistant-w", `${width}px`);
    } else {
      root.removeAttribute(DOCK_ATTR);
    }
    return () => root.removeAttribute(DOCK_ATTR);
  }, [open, layout, width]);

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || chat.streaming) return;
      setDraft("");
      void chat.send(q, sentContext);
    },
    [chat, sentContext]
  );

  const newChat = () => {
    chat.reset();
    setDraft("");
    dispatchAvatar({ type: "stop" });
    ui.dispatchPanel({ type: "chat" });
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("assistant.copied"), undefined, "success");
    } catch {
      toast(t("assistant.actionFailed"), undefined, "error");
    }
  };

  // Resize handle: drag, or arrow keys when it has the focus.
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setDragWidth(resizedWidth(dragRef.current.w, dragRef.current.x, e.clientX));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (user) writePanelWidth(safeStorage(), user.id, width);
  };
  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? PANEL_WIDTH_STEP : e.key === "ArrowRight" ? -PANEL_WIDTH_STEP : 0;
    if (!step) return;
    e.preventDefault();
    const next = clampPanelWidth(width + step);
    setDragWidth(next);
    if (user) writePanelWidth(safeStorage(), user.id, next);
  };

  const name = firstName(profile?.full_name);
  const avatarState = ui.avatar.state;
  const announce = avatarState === "thinking" || avatarState === "success" || avatarState === "alert" || avatarState === "sleeping" ? t(avatarLabelKey(avatarState)) : "";

  return (
    <RadixDialog.Root
      open={open}
      modal={layout === "sheet"}
      onOpenChange={(next) => (next ? ui.open() : ui.close())}
    >
      <RadixDialog.Portal container={portalContainer ?? undefined}>
        {layout === "sheet" ? <RadixDialog.Overlay className="ds-assistant-scrim" /> : null}
        <RadixDialog.Content
          id={ASSISTANT_PANEL_ID}
          className="ds-assistant-panel"
          data-layout={layout}
          style={{ ["--ds-assistant-w" as string]: `${width}px` }}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            composerRef.current?.focus();
          }}
          // The provider puts the focus back on the button that opened the panel.
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Docked, the page stays usable next to the panel; only the phone sheet closes on a tap outside.
            if (layout !== "sheet") e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!closesOnEscape(e)) e.preventDefault();
          }}
        >
          {layout !== "sheet" ? (
            <div
              className="ds-assistant-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("assistant.resize")}
              aria-valuemin={PANEL_MIN_WIDTH}
              aria-valuemax={PANEL_MAX_WIDTH}
              aria-valuenow={width}
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onHandleKey}
            />
          ) : (
            <div className="ds-assistant-grabber" aria-hidden />
          )}

          <AssistantPanelHeader
            t={t}
            avatarState={avatarState}
            title={<RadixDialog.Title className="ds-assistant-title">{view === "history" ? t("assistant.historyTitle") : t("assistant.title")}</RadixDialog.Title>}
            subtitle={view === "chat" ? contextLabel : null}
            historyOpen={view === "history"}
            onNewChat={newChat}
            onToggleHistory={() => ui.dispatchPanel({ type: view === "history" ? "chat" : "history" })}
            closeButton={
              <RadixDialog.Close asChild>
                <IconButton label={`${t("assistant.close")} (Esc)`} icon={<X className="h-5 w-5" />} side="bottom" />
              </RadixDialog.Close>
            }
          />

          <span className="sr-only" aria-live="polite">
            {announce}
          </span>

          {view === "history" ? (
            <div className="ds-assistant-body" data-assistant-scroll="">
              <AssistantHistory
                t={t}
                activeId={chat.conversationId}
                onOpen={(id) => {
                  ui.dispatchPanel({ type: "chat" });
                  void chat.load(id).then((ok) => {
                    if (!ok) toast(t("assistant.actionFailed"), undefined, "error");
                  });
                }}
                onDeletedActive={() => chat.reset()}
              />
            </div>
          ) : (
            <>
              <div className="ds-assistant-body" data-assistant-scroll="">
                {chat.loading ? (
                  <p className="ds-assistant-note" role="status">
                    {t("assistant.loadingChat")}
                  </p>
                ) : chat.messages.length === 0 ? (
                  <AssistantEmptyState
                    t={t}
                    avatarState={avatarState}
                    name={name}
                    suggestions={allSuggestions.map((id) => ({ id, label: t(suggestionKey(id)) }))}
                    onSuggestion={send}
                  />
                ) : (
                  <AssistantThread
                    messages={chat.messages}
                    t={t}
                    busy={chat.streaming}
                    onRetry={(id) => chat.retry(id, sentContext)}
                    onCopy={(text) => void copy(text)}
                    onNavigate={layout === "sheet" ? ui.close : undefined}
                  />
                )}
              </div>
              <AssistantComposer
                ref={composerRef}
                value={draft}
                onChange={setDraft}
                onSend={() => send(draft)}
                onStop={chat.stop}
                streaming={chat.streaming}
                t={t}
                locale={locale}
                contextLabel={contextLabel}
                onRemoveContext={() => {
                  setContextOffFor(pathname);
                  composerRef.current?.focus();
                }}
                suggestions={chipSuggestions}
                onSuggestion={send}
                onFocusChange={(focused) => dispatchAvatar({ type: focused ? "focus" : "blur" })}
              />
            </>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
