"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { avatarReducer, INITIAL_AVATAR, settleAfterMs, type AvatarEvent, type AvatarMachine } from "@/lib/assistant/ui/avatar";
import { assistantUiActive, INITIAL_PANEL, isToggleShortcut, panelReducer, type PanelAction, type PanelState } from "@/lib/assistant/ui/panel";
import type { WatchIssue } from "@/lib/assistant/watch/rules";

/**
 * What a form under the active watch (AST-5) shows next to the avatar: its first warning, with Fix, Why and
 * Ignore, or a notice that a document just saved has a guard finding.
 */
export interface WatchSlot {
  formId: string;
  issues: WatchIssue[];
  fix: (issue: WatchIssue) => void;
  ignore: (issue: WatchIssue) => void;
  why: (issue: WatchIssue) => void;
}
export interface SavedNotice {
  docNo: string;
  href: string;
  rules: string[];
}

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
  /** AST-5: the warnings of the form being filled in (null: no form under watch). */
  watch: WatchSlot | null;
  setWatch: (slot: WatchSlot | null) => void;
  /** AST-5: a saved document has a guard finding. */
  savedNotice: SavedNotice | null;
  setSavedNotice: (notice: SavedNotice | null) => void;
  /** Opens the panel and asks this question ("Why?" of a warning). The panel takes it once. */
  pendingQuestion: string | null;
  ask: (question: string) => void;
  takeQuestion: () => void;
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
  watch: null,
  setWatch: NOOP,
  savedNotice: null,
  setSavedNotice: NOOP,
  pendingQuestion: null,
  ask: NOOP,
  takeQuestion: NOOP,
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

  const [watch, setWatch] = useState<WatchSlot | null>(null);
  const [savedNotice, setSavedNotice] = useState<SavedNotice | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const ask = useCallback(
    (question: string) => {
      setPendingQuestion(question);
      open();
    },
    [open]
  );
  const takeQuestion = useCallback(() => setPendingQuestion(null), []);

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
    // prettier-ignore
    () => (active ? { active, panel, avatar, dispatchPanel, dispatchAvatar, toggle, open, close, watch, setWatch, savedNotice, setSavedNotice, pendingQuestion, ask, takeQuestion } : OFF),
    [active, panel, avatar, toggle, open, close, watch, savedNotice, pendingQuestion, ask, takeQuestion]
  );
  return <AssistantUiContext.Provider value={ctx}>{children}</AssistantUiContext.Provider>;
}

export function useAssistantUi(): AssistantUiValue {
  return useContext(AssistantUiContext);
}
