"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { collectResults, DICTATION_LANG, DICTATION_TIMEOUTS, dictationErrorKind, type DictationError } from "@/lib/assistant/ui/dictation";

type ResultEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };

/** Speech recognition of the browser (Chrome, Edge, Safari); typed loosely, it is not in lib.dom yet. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

/**
 * Dictation for the composer (AST-2): the browser turns speech into text in the user's language. The words
 * show while they are heard, and the final text lands in the message box, so the user checks it before
 * sending. If the browser's speech service does not answer, it stops by itself and says why
 * (DICTATION_TIMEOUTS) instead of staying on "Listening…". Only where the browser can do it; elsewhere
 * the mic button is not shown. Nothing is recorded or uploaded by the ERP.
 */
export function useDictation(locale: string, onText: (text: string) => void) {
  const supported = useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<DictationError | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const timers = useRef<number[]>([]);
  const textRef = useRef(onText);
  useEffect(() => {
    textRef.current = onText;
  }, [onText]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  /** Ends this dictation for sure, even if the browser never sends its end event. */
  const finish = useCallback(
    (rec: Recognition | null, reason: DictationError | null) => {
      clearTimers();
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.onaudiostart = null;
        try {
          rec.abort();
        } catch {
          // already stopped
        }
      }
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
      setInterim("");
      if (reason) setError(reason);
    },
    [clearTimers]
  );

  useEffect(() => () => finish(recRef.current, null), [finish]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop(); // the browser sends the last words, then its end event
    } catch {
      finish(rec, null);
      return;
    }
    later(DICTATION_TIMEOUTS.stopGraceMs, () => finish(rec, null));
  }, [finish, later]);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = DICTATION_LANG[locale] ?? "az-AZ";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let heardAudio = false;
    let gotWords = false;
    rec.onaudiostart = () => {
      heardAudio = true;
    };
    rec.onresult = (e) => {
      const { final, interim: now } = collectResults(e.results, e.resultIndex);
      if (final || now) gotWords = true;
      if (final) textRef.current(final);
      setInterim(final ? "" : now);
    };
    rec.onerror = (e) => {
      const kind = dictationErrorKind(e.error);
      // Keep the cause in the console for support (no audio or text is logged).
      if (kind) console.warn(`[assistant] dictation error: ${e.error} (${rec.lang})`);
      finish(rec, kind);
    };
    rec.onend = () => finish(rec, null);
    recRef.current = rec;
    clearTimers();
    setError(null);
    setInterim("");
    setListening(true);
    try {
      rec.start();
    } catch {
      finish(rec, "other");
      return;
    }
    // The browser's speech service may never answer: end with a reason instead of listening for ever.
    later(DICTATION_TIMEOUTS.noAudioMs, () => {
      if (!heardAudio && !gotWords) {
        console.warn(`[assistant] dictation: no audio from the speech service (${rec.lang})`);
        finish(rec, "service");
      }
    });
    later(DICTATION_TIMEOUTS.noResultMs, () => {
      if (!gotWords) {
        console.warn(`[assistant] dictation: audio but no words (${rec.lang})`);
        finish(rec, heardAudio ? "silence" : "service");
      }
    });
    later(DICTATION_TIMEOUTS.maxMs, () => stop());
  }, [clearTimers, finish, later, locale, stop]);

  return { supported, listening, interim, error, start, stop };
}
