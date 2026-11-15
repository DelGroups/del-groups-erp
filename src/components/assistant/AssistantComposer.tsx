"use client";

import React, { forwardRef, useCallback, useLayoutEffect, useRef } from "react";
import { Mic, Send, Square, X } from "lucide-react";
import { Button, IconButton } from "@/design-system/components";
import { COMPOSER_MAX_ROWS, composerKeyAction } from "@/lib/assistant/ui/panel";
import { useDictation } from "./useDictation";

type T = (key: string, params?: Record<string, string | number>) => string;

export interface AssistantComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  t: T;
  locale: string;
  /** The page or record sent with the question; null when the user removed it. */
  contextLabel: string | null;
  onRemoveContext: () => void;
  /** Suggestion chips for this page (shown once the conversation has started). */
  suggestions: Array<{ id: string; label: string }>;
  onSuggestion: (label: string) => void;
  onFocusChange: (focused: boolean) => void;
}

/**
 * The message box (AST-2): grows to six lines, Enter sends and Shift+Enter starts a new line, the page
 * context as a removable chip, suggestions, dictation, and Stop while a reply streams. Send is the
 * panel's one primary action (ACT-2).
 */
export const AssistantComposer = forwardRef<HTMLTextAreaElement, AssistantComposerProps>(function AssistantComposer(
  { value, onChange, onSend, onStop, streaming, t, locale, contextLabel, onRemoveContext, suggestions, onSuggestion, onFocusChange },
  ref
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      localRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );

  const append = useCallback((text: string) => onChange(value ? `${value.replace(/\s+$/, "")} ${text}` : text), [onChange, value]);
  const dictation = useDictation(locale, append);

  // Grow with the text up to six lines, then scroll inside.
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const pad = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    const max = line * COMPOSER_MAX_ROWS + pad;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value]);

  const canSend = value.trim().length > 0 && !streaming;

  return (
    <form
      className="ds-assistant-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      {suggestions.length > 0 && !streaming ? (
        <div className="ds-assistant-chips">
          {suggestions.map((s) => (
            <button key={s.id} type="button" className="ds-assistant-chip" onClick={() => onSuggestion(s.label)} title={s.label}>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="ds-assistant-input">
        {contextLabel ? (
          <span className="ds-assistant-context">
            <span className="ds-assistant-context-label">{t("assistant.contextLabel")}:</span>
            <span className="truncate" title={contextLabel}>
              {contextLabel}
            </span>
            <button type="button" className="ds-assistant-context-remove" aria-label={t("assistant.removeContext")} title={t("assistant.removeContext")} onClick={onRemoveContext}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </span>
        ) : null}

        <label className="sr-only" htmlFor="ds-assistant-textarea">
          {t("assistant.inputLabel")}
        </label>
        <textarea
          id="ds-assistant-textarea"
          ref={setRefs}
          value={value}
          rows={1}
          maxLength={4000}
          placeholder={t("assistant.placeholder")}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={(e) => {
            const action = composerKeyAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing });
            if (action !== "send") return;
            e.preventDefault();
            if (canSend) onSend();
          }}
        />

        <div className="ds-assistant-input-bar">
          {dictation.supported ? (
            <IconButton
              size="sm"
              label={dictation.listening ? t("assistant.stopDictation") : t("assistant.dictate")}
              icon={dictation.listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              data-active={dictation.listening || undefined}
              aria-pressed={dictation.listening}
              disabled={streaming}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            />
          ) : (
            <span />
          )}
          <span className="ds-assistant-hint" aria-live="polite">
            {dictation.listening ? t("assistant.dictating") : dictation.failed ? t("assistant.dictationError") : ""}
          </span>
          {streaming ? (
            <Button size="sm" variant="secondary" icon={Square} onClick={onStop}>
              {t("assistant.stop")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={Send} type="submit" disabled={!canSend}>
              {t("assistant.send")}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
});
