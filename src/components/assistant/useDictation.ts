"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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

const LANG: Record<string, string> = { az: "az-AZ", en: "en-US", ru: "ru-RU" };
const noop = () => () => {};

/**
 * Dictation for the composer (AST-2): the browser turns speech into text in the user's language and the
 * text lands in the message box, so the user checks it before sending. Only where the browser can do it;
 * elsewhere the mic button is not shown. Nothing is recorded or uploaded by the ERP.
 */
export function useDictation(locale: string, onText: (text: string) => void) {
  const supported = useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
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
    rec.lang = LANG[locale] ?? "az-AZ";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0]?.transcript ?? "";
      if (text.trim()) textRef.current(text.trim());
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") setFailed(true);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    setFailed(false);
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      setFailed(true);
    }
  }, [locale]);

  return { supported, listening, failed, start, stop };
}
