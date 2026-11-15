"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DICTATION_LANG, dictationErrorKind, type DictationError } from "@/lib/assistant/ui/dictation";

/** Speech recognition of the browser (Chrome, Edge, Safari); typed loosely, it is not in lib.dom yet. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

/**
 * Dictation for the composer (AST-2): the browser turns speech into text in the user's language and the
 * text lands in the message box, so the user checks it before sending. Only where the browser can do it;
 * elsewhere the mic button is not shown. Nothing is recorded or uploaded by the ERP.
 */
export function useDictation(locale: string, onText: (text: string) => void) {
  const supported = useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const textRef = useRef(onText);
  useEffect(() => {
    textRef.current = onText;
  }, [onText]);
  useEffect(() => () => recRef.current?.abort(), []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = DICTATION_LANG[locale] ?? "az-AZ";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0]?.transcript ?? "";
      if (text.trim()) textRef.current(text.trim());
    };
    rec.onerror = (e) => {
      const kind = dictationErrorKind(e.error);
      if (kind) setError(kind);
      // Keep the cause in the console for support (no audio or text is logged).
      if (kind) console.warn(`[assistant] dictation error: ${e.error} (${rec.lang})`);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      setError("other");
    }
  }, [locale]);

  return { supported, listening, error, start, stop };
}
