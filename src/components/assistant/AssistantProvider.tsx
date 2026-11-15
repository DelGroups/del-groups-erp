"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { avatarReducer, INITIAL_AVATAR, settleAfterMs, type AvatarEvent, type AvatarMachine } from "@/lib/assistant/ui/avatar";
import { assistantUiActive, INITIAL_PANEL, isToggleShortcut, panelReducer, type PanelAction, type PanelState } from "@/lib/assistant/ui/panel";

/** The panel element (aria-controls of the buttons that open it). */
export const ASSISTANT_PANEL_ID = "ds-assistant-panel";

/** What the server tells the browser about ASSISTANT_V2 (src/lib/assistant/config.ts). */
export interface AssistantServerValue {
  enabled: boolean;
  audience: "admins" | "all";
}

interface AssistantUiValue {
  /** The new panel replaces the old widget for this user. */
  active: boolean;
  panel: PanelState;
  avatar: AvatarMachine;
  dispatchPanel: (a: PanelAction) => void;
  dispatchAvatar: (e: AvatarEvent) => void;
  /** Opens or closes the panel and remembers what had the focus, so closing returns it there. */
  toggle: () => void;
  open: () => void;
  close: () => void;
}

const NOOP = () => undefined;
const OFF: AssistantUiValue = {
  active: false,
  panel: INITIAL_PANEL,
  avatar: INITIAL_AVATAR,
  dispatchPanel: NOOP,
  dispatchAvatar: NOOP,
  toggle: NOOP,
  open: NOOP,
  close: NOOP,
};

const AssistantUiContext = createContext<AssistantUiValue>(OFF);

/**
 * Del Assistant's UI switch and shared state (AST-2): the panel's open state and the avatar's state live
 * here, so the shell's header button and the panel show the same face. With ASSISTANT_V2 off (the
 * default) `active` is false and nothing anywhere changes.
 */
export function AssistantProvider({ value, children }: { value: AssistantServerValue; children: React.ReactNode }) {
  const { user, isAdmin, ready, loading } = useAuth();
  const aiModule = useEnabledModules().isEnabled("ai");
  const active = assistantUiActive({ enabled: value.enabled, audience: value.audience, aiModule, signedIn: !!user, isAdmin, authReady: ready && !loading });
  const [panel, dispatchPanel] = useReducer(panelReducer, INITIAL_PANEL);
  const [avatar, dispatchAvatar] = useReducer(avatarReducer, INITIAL_AVATAR);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openRef = useRef(panel.open);
  useEffect(() => {
    openRef.current = panel.open;
  }, [panel.open]);

  const restoreFocus = useCallback(() => {
    const el = returnFocus.current;
    returnFocus.current = null;
    // After the panel has left the DOM, so the focus lands on the button that opened it.
    window.requestAnimationFrame(() => {
      if (el && el.isConnected) el.focus();
    });
  }, []);

  const open = useCallback(() => {
    if (!openRef.current) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openRef.current = true;
    dispatchPanel({ type: "open" });
  }, []);
  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    dispatchPanel({ type: "close" });
    restoreFocus();
  }, [restoreFocus]);
  const toggle = useCallback(() => (openRef.current ? close() : open()), [close, open]);

  // Ctrl+J / Cmd+J from anywhere in the app (A11Y-5).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleShortcut(e)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, toggle]);

  // Passing states (success, a reply's error) settle back after a moment.
  useEffect(() => {
    const ms = settleAfterMs(avatar);
    if (ms === null) return;
    const timer = window.setTimeout(() => dispatchAvatar({ type: "settle" }), ms);
    return () => window.clearTimeout(timer);
  }, [avatar]);

  const ctx = useMemo<AssistantUiValue>(
    () => (active ? { active, panel, avatar, dispatchPanel, dispatchAvatar, toggle, open, close } : OFF),
    [active, panel, avatar, toggle, open, close]
  );
  return <AssistantUiContext.Provider value={ctx}>{children}</AssistantUiContext.Provider>;
}

export function useAssistantUi(): AssistantUiValue {
  return useContext(AssistantUiContext);
}
