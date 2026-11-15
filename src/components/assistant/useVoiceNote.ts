"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DictationError } from "@/lib/assistant/ui/dictation";
import { MAX_RECORDING_MS, MIN_AUDIO_BYTES } from "@/lib/assistant/transcribe";

const noop = () => () => {};
const canRecord = () => typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return options.find((m) => window.MediaRecorder.isTypeSupported?.(m)) ?? "";
}

/**
 * The assistant's mic when the server can transcribe (/api/assistant/transcribe): the first click records,
 * the second stops (or 60 s), the note is turned into text on the server and lands in the message box, so
 * the user reads it before sending. The audio is not kept anywhere. Same shape as useDictation.
 */
export function useVoiceNote(locale: string, onText: (text: string) => void) {
  const supported = useSyncExternalStore(noop, canRecord, () => false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const timer = useRef<number>(0);
  const textRef = useRef(onText);
  useEffect(() => {
    textRef.current = onText;
  }, [onText]);

  const release = useCallback(() => {
    window.clearTimeout(timer.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    setListening(false);
  }, []);
  useEffect(() => () => {
    if (recRef.current) recRef.current.onstop = null;
    release();
  }, [release]);

  const upload = useCallback(
    async (blob: Blob) => {
      if (blob.size < MIN_AUDIO_BYTES) {
        setError("silence");
        return;
      }
      setBusy(true);
      try {
        const form = new FormData();
        form.set("audio", blob, "voice");
        form.set("locale", locale);
        const response = await fetch("/api/assistant/transcribe", { method: "POST", credentials: "same-origin", body: form });
        if (!response.ok) {
          setError(response.status === 429 ? "other" : response.status === 503 || response.status === 502 ? "service" : "other");
          return;
        }
        const body = (await response.json()) as { text?: string };
        const text = (body.text ?? "").trim();
        if (text) textRef.current(text);
        else setError("silence");
      } catch {
        setError("network");
      } finally {
        setBusy(false);
      }
    },
    [locale]
  );

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (recRef.current || busy) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError" ? "mic" : "other");
      return;
    }
    const mime = pickMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    streamRef.current = stream;
    recRef.current = rec;
    chunks.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
      chunks.current = [];
      release();
      void upload(blob);
    };
    rec.start();
    setListening(true);
    timer.current = window.setTimeout(() => {
      if (rec.state !== "inactive") rec.stop();
    }, MAX_RECORDING_MS);
  }, [busy, release, upload]);

  return { supported, listening, busy, interim: "", error, start: () => void start(), stop };
}
